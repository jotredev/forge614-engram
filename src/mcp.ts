import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryError, memoryTypes, type MemoryType, type SearchScope } from "./domain";
import { MEMORY_PROTOCOL } from "./memory-protocol";
import { assertGitProjectDirectory, resolveProjectContext, saveProjectMemoryWithSession, startProjectSession } from "./project-context";
import { MemoryStore } from "./store";
import { MemoryWorkspace } from "./workspace";
import { MCP_TOOL_NAMES, type McpToolName } from "./mcp-tools";
import { sessionIdentity } from "./sessions";
import { version } from "../package.json";

const path = z.string().trim().min(1).max(4096).refine(value => !value.includes("\0"));
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !value.includes("\0"));
const directory = path.optional();
const id = text(128);
const sessionId = z.string().superRefine((value,context) => {
  try { sessionIdentity(value); }
  catch { context.addIssue({code:"custom",message:"sessionId debe tener entre 1 y 200 caracteres, sin controles ni espacios exteriores."}); }
});
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
  const register = <Input extends z.ZodType>(name:McpToolName,
      config:{description:string;inputSchema:Input},handler:ToolCallback<Input>) => {
    if (!MCP_TOOL_NAMES.includes(name)) throw new Error(`Unknown MCP tool: ${name}`);
    server.registerTool(name,config,handler);
  };

  register("memory_current_project", {
    description:"Resolve the current local project binding without creating a project.",
    inputSchema:z.object({ directory }).strict(),
  }, safely(async ({ directory }) => {
    const selected = await projectDirectory(directory);
    return resolveProjectContext(memoryStore(),selected,false);
  }));

  register("memory_search", {
    description:"Search active memories and return format 2 preview results. Previews can omit details; use memory_get before relying on them.",
    inputSchema:z.object({ directory,query:text(500),limit:z.number().int().min(1).max(50).optional(),scope:searchScope.optional() }).strict(),
  }, safely(async ({ directory,query,limit,scope }) => {
    const selected = scope ?? "all";
    if (selected === "shared") return {format:2,results:memoryStore().searchPreviews(null,query,limit ?? 10,"shared")};
    const directoryPath = await projectDirectory(directory);
    const context = resolveProjectContext(memoryStore(),directoryPath,false);
    if (!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla.");
    return {format:2,results:memoryStore().searchPreviews(context.projectId,query,limit ?? 10,selected as SearchScope)};
  }));

  register("memory_get", {
    description:"Get one memory after verifying it belongs to the selected project or explicit shared scope.",
    inputSchema:z.object({ directory,id,scope:projectScope.optional(),version:z.number().int().min(1).optional() }).strict(),
  }, safely(async ({ directory,id,scope,version }) => {
    let projectId: string | null = null;
    if (scope !== "shared") {
      const directoryPath = await projectDirectory(directory);
      projectId = resolveProjectContext(memoryStore(),directoryPath,false).projectId;
    }
    if (scope !== "shared" && !projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const memory = memoryStore().getVersion(projectId,id,version);
    if (!memory) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
    return memory;
  }));

  register("memory_save", {
    description:"Save or revise a curated durable memory. Project is default; shared requires explicit scope and global intent.",
    inputSchema:z.object({
      directory,scope:projectScope.optional(),globalIntent:text(1000).optional(),title:text(300),content:text(20_000),
      type:z.enum(memoryTypes),topicKey:text(300).optional(),pinned:z.boolean().optional(),
      expectedVersion:z.number().int().min(1).optional(),requestKey:text(300).optional(),
      sessionId:sessionId.optional(),sessionProjectId:id.optional(),
    }).strict(),
  }, safely(async ({ directory,scope,globalIntent,sessionId,sessionProjectId,...input }) => {
    const saveInput: { title:string; content:string; type:MemoryType; topicKey?:string; pinned?:boolean;
      expectedVersion?:number; requestKey?:string } = { title:input.title,content:input.content,type:input.type };
    if (input.topicKey !== undefined) saveInput.topicKey = input.topicKey;
    if (input.pinned !== undefined) saveInput.pinned = input.pinned;
    if (input.expectedVersion !== undefined) saveInput.expectedVersion = input.expectedVersion;
    if (input.requestKey !== undefined) saveInput.requestKey = input.requestKey;
    if (scope === "shared") {
      if (!globalIntent) throw new MemoryError("SHARED_INTENT_REQUIRED","scope shared requiere explicar la intención global explícita del usuario.");
      if ((sessionId === undefined) !== (sessionProjectId === undefined)) throw new MemoryError("INVALID_INPUT","sessionId y sessionProjectId son obligatorios juntos para shared.");
      return memoryStore().saveWithSession({ ...saveInput,scope:"shared",projectId:null },
        {mode:"assistant",...(sessionId?{sessionId}:{}),...(sessionProjectId?{projectId:sessionProjectId}:{})}).memory;
    }
    if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
    if (sessionProjectId !== undefined) throw new MemoryError("INVALID_INPUT","sessionProjectId solo se acepta con scope shared.");
    const directoryPath = await projectDirectory(directory);
    const saved=saveProjectMemoryWithSession(memoryStore(),directoryPath,saveInput,{mode:"assistant",...(sessionId?{sessionId}:{})});
    return {...saved.memory,sessionId:saved.sessionId,sessionSource:saved.sessionSource};
  }));

  register("memory_history", {
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

  register("memory_session_start", {
    description:"Start or replay an explicit conversation session for the atomically resolved project directory.",
    inputSchema:z.object({directory,sessionId}).strict(),
  }, safely(async ({directory,sessionId}) => startProjectSession(memoryStore(),await projectDirectory(directory),sessionId)));

  register("memory_session_end", {
    description:"Close an explicit session after its summary has been saved.",
    inputSchema:z.object({directory,sessionId}).strict(),
  }, safely(async ({directory,sessionId}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().endSession(context.projectId,sessionId);
  }));

  const narrative=(maximum:number)=>z.string().max(maximum).refine(value=>!value.includes("\0"));
  const summaryFields=z.object({goal:text(4000),instructions:narrative(8000),discoveries:narrative(8000),accomplishments:narrative(8000),nextSteps:narrative(8000),files:z.array(path).max(200)}).strict();
  register("memory_session_summary", {
    description:"Save a structured durable session summary before closing the explicit session.",
    inputSchema:z.object({directory,sessionId,summary:summaryFields,requestKey:text(300),expectedVersion:z.number().int().min(1).optional()}).strict(),
  }, safely(async ({directory,sessionId,summary,requestKey,expectedVersion}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().saveSessionSummary(context.projectId,sessionId,summary,{requestKey,...(expectedVersion?{expectedVersion}:{})});
  }));

  register("memory_timeline", {
    description:"Read owner-checked neighboring session decisions around an exact memory version.",
    inputSchema:z.object({directory,sessionId,id,version:z.number().int().min(1),before:z.number().int().min(0).max(20).optional(),after:z.number().int().min(0).max(20).optional()}).strict(),
  }, safely(async ({directory,sessionId,id:memoryId,version,before,after}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().timeline(context.projectId,{sessionId,memoryId,version,...(before===undefined?{}:{before}),...(after===undefined?{}:{after})});
  }));

  register("memory_context", {
    description:"Return bounded project or shared orientation without a query.",
    inputSchema:z.object({directory,scope:z.literal("shared").optional(),compact:z.boolean().optional(),maxBytes:z.number().int().min(1024).max(65536).optional()}).strict(),
  }, safely(async ({directory,scope,compact,maxBytes}) => {
    let projectId:string|null=null;
    if(scope!=="shared") {
      const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
      if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
      projectId=context.projectId;
    }
    return memoryStore().context(projectId,{...(compact===undefined?{}:{compact}),...(maxBytes===undefined?{}:{maxBytes})});
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
