import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryError, memoryTypes, type MemoryType, type SearchScope } from "./domain";
import { MEMORY_PROTOCOL } from "./memory-protocol";
import { assertGitProjectDirectory, resolveProjectContext, saveProjectMemory } from "./project-context";
import { MemoryStore } from "./store";
import { MemoryWorkspace } from "./workspace";
import { version } from "../package.json";

const path = z.string().trim().min(1).max(4096).refine(value => !value.includes("\0"));
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !value.includes("\0"));
const directory = path.optional();
const id = text(128);
const projectScope = z.enum(["project","shared"]);
const searchScope = z.enum(["all","project","shared"]);

function result(value: unknown) {
  return { content:[{ type:"text" as const,text:JSON.stringify(value) }] };
}
function failure(error: unknown) {
  if (error instanceof MemoryError) return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:error.code,error:error.message }) }] };
  return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:"STORAGE_ERROR",error:"No se pudo completar la operación local." }) }] };
}

/** Starts the local stdio MCP server. Opening SQLite is deferred until a tool call. */
export async function startMcp(): Promise<void> {
  let store: MemoryStore | null = null;
  let closing = false;
  const memoryStore = () => {
    if (closing) throw new MemoryError("SERVER_CLOSING","El servidor MCP se está cerrando.");
    return store ??= new MemoryWorkspace().open();
  };
  const server = new McpServer({ name:"forge614-engram",version }, { instructions:MEMORY_PROTOCOL });

  async function selectedDirectory(explicit?: string): Promise<{ directory:string; implicitCwd:boolean }> {
    if (explicit !== undefined) return { directory:explicit,implicitCwd:false };
    const rootsCapability = server.server.getClientCapabilities()?.roots;
    if (rootsCapability) {
      const roots = (await server.server.listRoots()).roots;
      if (roots.length > 1) throw new MemoryError("AMBIGUOUS_PROJECT","Varias raíces MCP requieren indicar directory explícitamente.");
      if (roots.length === 1) {
        let url: URL;
        try { url = new URL(roots[0]!.uri); }
        catch { throw new MemoryError("INVALID_DIRECTORY","La raíz MCP no es una URL de archivo válida."); }
        if (url.protocol !== "file:") throw new MemoryError("INVALID_DIRECTORY","La raíz MCP debe ser una carpeta file:// local.");
        return { directory:fileURLToPath(url),implicitCwd:false };
      }
    }
    return { directory:process.cwd(),implicitCwd:true };
  }
  async function projectDirectory(explicit?: string): Promise<string> {
    const selected = await selectedDirectory(explicit);
    if (selected.implicitCwd) {
      try {
        if (realpathSync(selected.directory) === realpathSync(dirname(process.execPath))) {
          throw new MemoryError("PROJECT_DIRECTORY_REQUIRED","La carpeta del ejecutable no se usa como proyecto implícito.");
        }
      } catch (error) {
        if (error instanceof MemoryError) throw error;
      }
      assertGitProjectDirectory(selected.directory);
    }
    return selected.directory;
  }

  const safely = <T extends unknown[]>(handler: (...args:T) => unknown | Promise<unknown>) =>
    async (...args:T) => { try { return result(await handler(...args)); } catch (error) { return failure(error); } };

  server.registerTool("memory_current_project", {
    description:"Resolve the current local project binding without creating a project.",
    inputSchema:z.object({ directory }).strict(),
  }, safely(async ({ directory }) => {
    const selected = await projectDirectory(directory);
    return resolveProjectContext(memoryStore(),selected,false);
  }));

  server.registerTool("memory_search", {
    description:"Search active project memories and, when selected, shared memories. Read-only and never creates a project.",
    inputSchema:z.object({ directory,query:text(500),limit:z.number().int().min(1).max(50).optional(),scope:searchScope.optional() }).strict(),
  }, safely(async ({ directory,query,limit,scope }) => {
    const selected = scope ?? "all";
    if (selected === "shared") return memoryStore().search(null,query,limit ?? 10,"shared");
    const directoryPath = await projectDirectory(directory);
    const context = resolveProjectContext(memoryStore(),directoryPath,false);
    if (!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla.");
    return memoryStore().search(context.projectId,query,limit ?? 10,selected as SearchScope);
  }));

  server.registerTool("memory_get", {
    description:"Get one memory after verifying it belongs to the selected project or explicit shared scope.",
    inputSchema:z.object({ directory,id,scope:projectScope.optional() }).strict(),
  }, safely(async ({ directory,id,scope }) => {
    let projectId: string | null = null;
    if (scope !== "shared") {
      const directoryPath = await projectDirectory(directory);
      projectId = resolveProjectContext(memoryStore(),directoryPath,false).projectId;
    }
    if (scope !== "shared" && !projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const memory = memoryStore().get(projectId,id);
    if (!memory) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
    return memory;
  }));

  server.registerTool("memory_save", {
    description:"Save or revise a curated durable memory. Project is default; shared requires explicit scope and global intent.",
    inputSchema:z.object({
      directory,scope:projectScope.optional(),globalIntent:text(1000).optional(),title:text(300),content:text(20_000),
      type:z.enum(memoryTypes),topicKey:text(300).optional(),pinned:z.boolean().optional(),
      expectedVersion:z.number().int().min(1).optional(),requestKey:text(300).optional(),
    }).strict(),
  }, safely(async ({ directory,scope,globalIntent,...input }) => {
    const saveInput: { title:string; content:string; type:MemoryType; topicKey?:string; pinned?:boolean;
      expectedVersion?:number; requestKey?:string } = { title:input.title,content:input.content,type:input.type };
    if (input.topicKey !== undefined) saveInput.topicKey = input.topicKey;
    if (input.pinned !== undefined) saveInput.pinned = input.pinned;
    if (input.expectedVersion !== undefined) saveInput.expectedVersion = input.expectedVersion;
    if (input.requestKey !== undefined) saveInput.requestKey = input.requestKey;
    if (scope === "shared") {
      if (!globalIntent) throw new MemoryError("SHARED_INTENT_REQUIRED","scope shared requiere explicar la intención global explícita del usuario.");
      return memoryStore().save({ ...saveInput,scope:"shared",projectId:null });
    }
    if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
    const directoryPath = await projectDirectory(directory);
    return saveProjectMemory(memoryStore(),directoryPath,saveInput);
  }));

  server.registerTool("memory_history", {
    description:"List all versions after verifying memory ownership in the selected scope.",
    inputSchema:z.object({ directory,id,scope:projectScope.optional() }).strict(),
  }, safely(async ({ directory,id,scope }) => {
    let projectId: string | null = null;
    if (scope !== "shared") {
      const directoryPath = await projectDirectory(directory);
      projectId = resolveProjectContext(memoryStore(),directoryPath,false).projectId;
    }
    if (scope !== "shared" && !projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const history = memoryStore().history(projectId,id);
    if (history.length === 0) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
    return history;
  }));

  const transport = new StdioServerTransport(process.stdin,process.stdout,{ maxBufferSize:256 * 1024 });
  const closeStore = () => { store?.close(); store = null; };
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    closing = true; closeStore();
    shutdownPromise = server.close().catch(() => {}).finally(closeStore);
    return shutdownPromise;
  };
  process.stdin.once("end",() => { void shutdown(); });
  const stop = (code:number) => { void shutdown().finally(() => process.exit(code)); };
  process.once("SIGINT",() => stop(130));
  process.once("SIGTERM",() => stop(143));
  try { await server.connect(transport); }
  catch (error) { await shutdown(); throw error; }
}
