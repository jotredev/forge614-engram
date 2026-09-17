import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryStore } from "../../app";
import { MCP_TOOL_NAMES } from "../../modules/assistants";
import { safely, type ToolContext } from "./context";
import { registerMemoryTools } from "./memory-tools";
import { registerSessionTools } from "./sessions-tools";

export function registerTools(server:McpServer,memoryStore:()=>MemoryStore,projectDirectory:(explicit?:string)=>Promise<string>):void {
  const register:ToolContext["register"]=(name,config,handler)=>{
    if (!MCP_TOOL_NAMES.includes(name)) throw new Error(`Unknown MCP tool: ${name}`);
    server.registerTool(name,config,handler);
  };
  const context={register,safely,memoryStore,projectDirectory};
  registerMemoryTools(context);
  registerSessionTools(context);
}
