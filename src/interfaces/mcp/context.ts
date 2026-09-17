import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { MemoryStore } from "../../app";
import type { McpToolName } from "../../modules/assistants";
import { MemoryError } from "../../shared/errors";
function result(value: unknown) {
  return { content:[{ type:"text" as const,text:JSON.stringify(value) }] };
}
function failure(error: unknown) {
  if (error instanceof MemoryError) return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:error.code,error:error.message }) }] };
  return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:"STORAGE_ERROR",error:"No se pudo completar la operación local." }) }] };
}


export const safely = <T extends unknown[]>(handler: (...args:T) => unknown | Promise<unknown>) =>
  async (...args:T) => { try { return result(await handler(...args)); } catch (error) { return failure(error); } };
export interface ToolContext {
  memoryStore:()=>MemoryStore;
  projectDirectory:(explicit?:string)=>Promise<string>;
  register:<Input extends z.ZodType>(name:McpToolName,config:{description:string;inputSchema:Input},handler:ToolCallback<Input>)=>void;
  safely:typeof safely;
}
