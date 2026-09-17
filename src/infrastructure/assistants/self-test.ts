import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_TOOL_NAMES } from '../../modules/assistants';

export interface ServerTestResult {
  status:'not-run'|'running'|'passed'|'failed';
  code?:'INSTALLATION_REQUIRED'|'CANCELLED'|'TIMED_OUT'|'MCP_FAILED';
}
const tools=[...MCP_TOOL_NAMES].sort();

/** Only the TUI's resolved own installation is passed here, never client configuration commands. */
export async function testInstalledServer(executable:string,options:{signal:AbortSignal;timeoutMs?:number;home?:string}):Promise<ServerTestResult>{
  if(options.signal.aborted)return {status:'not-run',code:'CANCELLED'};
  const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(30000,options.timeoutMs!)):5000;
  const transport=new StdioClientTransport({command:executable,args:['mcp'],stderr:'ignore',maxBufferSize:256*1024,
    ...(options.home?{env:{HOME:options.home,USERPROFILE:options.home}}:{})});
  const client=new Client({name:'forge614-engram-self-test',version:'1'},{capabilities:{}});
  let pid:number|null=null,exited=false,closing:Promise<void>|undefined;
  client.onclose=()=>{exited=true;};
  const close=()=>closing??=client.close().catch(()=>{});
  const kill=()=>{const child=pid??transport.pid;if(child&&!exited)try{process.kill(child,'SIGKILL');}catch{/* Already exited. */}};
  let rejectStop:(code:ServerTestResult['code'])=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const cancel=()=>rejectStop('CANCELLED');
  options.signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>rejectStop('TIMED_OUT'),timeoutMs);
  client.onerror=()=>rejectStop('MCP_FAILED');
  try{
    await Promise.race([stopped,(async()=>{
      const connected=client.connect(transport);pid=transport.pid;await connected;
      if(client.getServerVersion()?.name!=='forge614-engram')throw new Error();
      const names=(await client.listTools()).tools.map(tool=>tool.name).sort();
      if(names.length!==tools.length||names.some((name,index)=>name!==tools[index]))throw new Error();
      await close();
    })()]);
    return {status:'passed'};
  }catch(error){
    kill();
    return error==='CANCELLED'?{status:'not-run',code:'CANCELLED'}
      :{status:'failed',code:error==='TIMED_OUT'?'TIMED_OUT':'MCP_FAILED'};
  }finally{
    clearTimeout(timer);options.signal.removeEventListener('abort',cancel);
    // The deadline also covers normal SDK shutdown. Forced cleanup gets a bounded reap grace.
    let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
    await Promise.race([close(),new Promise<void>(resolve=>{cleanupTimer=setTimeout(resolve,250);})]);
    clearTimeout(cleanupTimer);
  }
}
