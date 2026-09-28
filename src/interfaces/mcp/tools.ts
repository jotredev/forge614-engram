/**
 * Punto de entrada que arma el `ToolContext` (funciones comunes de `context.ts`) y registra las diez
 * herramientas MCP (protocolo de contexto de modelo) del servidor: las de memoria (`memory-tools.ts`) y las
 * de sesión y contexto (`sessions-tools.ts`). `server.ts` la llama una sola vez al construir el servidor.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore } from "../../app";
import { MCP_TOOL_NAMES, type McpToolName } from "../../modules/mcp";
import { safely, type ToolContext } from "./context";
import { registerMemoryTools } from "./memory-tools";
import { registerSessionTools } from "./sessions-tools";

// Herramientas que escriben en el store: las que llaman a un método de escritura de `MemoryStore`
// (comprobado por grep sobre `memory-tools.ts`/`sessions-tools.ts`: `saveWithSession`/`saveForProjectDirectory`,
// `startProjectSessionWithNotices`, `endSession` y `saveSessionSummary`/`saveSessionSummaryInGroup`).
// Tras cada llamada exitosa, `register` avisa a la tarea de fondo (`onWrite`, D7) para que agrupe un ciclo.
const WRITE_TOOLS: ReadonlySet<McpToolName> = new Set(["memory_save","memory_session_start","memory_session_end","memory_session_summary"]);

/** Registra en `server` las herramientas de memoria y de sesión, usando `memoryStore` y `projectDirectory` como sus dos dependencias compartidas, y avisando `onWrite` tras cada llamada exitosa de una herramienta que escribe. */
export function registerTools(server:McpServer,memoryStore:()=>MemoryStore,projectDirectory:(explicit?:string)=>Promise<string>,onWrite?:()=>void):void {
  // Envuelve server.registerTool para rechazar en el momento cualquier nombre que no esté en la lista cerrada MCP_TOOL_NAMES.
  const register:ToolContext["register"]=(name,config,handler)=>{
    if (!MCP_TOOL_NAMES.includes(name)) throw new Error(`Unknown MCP tool: ${name}`);
    // Las herramientas que no escriben se registran tal cual; las que sí escriben avisan a `onWrite`
    // solo cuando la llamada terminó sin error (una lectura fallida, o un guardado rechazado, no cuenta como escritura).
    if (!onWrite || !WRITE_TOOLS.has(name)) { server.registerTool(name,config,handler); return; }
    const wrapped = async (...args:unknown[]) => {
      const result = await (handler as (...callArgs:unknown[]) => Promise<{isError?:boolean}>)(...args);
      if (!result.isError) onWrite();
      return result;
    };
    server.registerTool(name,config,wrapped as typeof handler);
  };
  const context={register,safely,memoryStore,projectDirectory};
  registerMemoryTools(context);
  registerSessionTools(context);
}
