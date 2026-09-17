import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root=dirname(process.execPath);
writeFileSync(join(root,'child.pid'),String(process.pid));
const server=new Server({name:'forge614-engram',version:'test'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>{
  writeFileSync(join(root,'listed'),'yes');
  return {tools:['memory_current_project','memory_get','memory_history','memory_save','memory_search'].map(name=>({name,inputSchema:{type:'object' as const}}))};
});
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
await server.connect(new StdioServerTransport());
