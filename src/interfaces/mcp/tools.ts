/**
 * Punto de entrada que arma el `ToolContext` (funciones comunes de `context.ts`) y registra las diez
 * herramientas MCP (protocolo de contexto de modelo) del servidor: las de memoria (`memory-tools.ts`) y las
 * de sesión y contexto (`sessions-tools.ts`). `server.ts` la llama una sola vez al construir el servidor.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore } from "../../app";
import { MCP_TOOL_NAMES } from "../../modules/mcp";
import { safely, type ToolContext } from "./context";
import { registerMemoryTools } from "./memory-tools";
import { registerSessionTools } from "./sessions-tools";

/** Registra en `server` las herramientas de memoria y de sesión, usando `memoryStore` y `projectDirectory` como sus dos dependencias compartidas. */
export function registerTools(server:McpServer,memoryStore:()=>MemoryStore,projectDirectory:(explicit?:string)=>Promise<string>):void {
  // Envuelve server.registerTool para rechazar en el momento cualquier nombre que no esté en la lista cerrada MCP_TOOL_NAMES.
  const register:ToolContext["register"]=(name,config,handler)=>{
    if (!MCP_TOOL_NAMES.includes(name)) throw new Error(`Unknown MCP tool: ${name}`);
    server.registerTool(name,config,handler);
  };
  const context={register,safely,memoryStore,projectDirectory};
  registerMemoryTools(context);
  registerSessionTools(context);
}
