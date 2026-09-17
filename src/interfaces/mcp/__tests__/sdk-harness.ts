import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MemoryStore } from "../../../app";
import { safely, type ToolContext } from "../context";

// Real SDK transports and ephemeral SQLite; no module mocks or personal paths.
export async function sdkHarness(register?: (context:ToolContext,server:McpServer)=>void, roots?:string[]) {
  const directory=mkdtempSync(join(tmpdir(),"engram-handler-"));
  const store=new MemoryStore(":memory:"); store.enableAssistantIntegration(); store.enableSessions();
  const server=new McpServer({name:"handler-test",version:"1"});
  const client=new Client({name:"test",version:"1"},{capabilities:roots?{roots:{}}:{}});
  if(roots) client.setRequestHandler(ListRootsRequestSchema,()=>({roots:roots.map(uri=>({uri}))}));
  const context:ToolContext={memoryStore:()=>store,projectDirectory:async explicit=>explicit??directory,safely,
    register:(name,config,handler)=>{server.registerTool(name,config,handler);}};
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  const close=async()=>{try{await client.close();await server.close();}finally{store.close();rmSync(directory,{recursive:true,force:true});}};
  try {register?.(context,server);await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);}
  catch(error){await close();throw error;}
  return {client,server,store,directory,close,call:async(name:string,args:Record<string,unknown>={})=>{
    const result=await client.callTool({name,arguments:args}) as CallToolResult;
    const text=result.content.find(block=>block.type==="text");
    if(!text||text.type!=="text")throw new Error("Missing result text");
    return {result,data:JSON.parse(text.text)};
  }};
}
