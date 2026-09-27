/**
 * Servidor MCP real de un solo archivo, pensado para correr como proceso hijo en una prueba:
 * simula un servidor instalado que se queda colgado al apagarse (ignora la señal SIGTERM y sigue
 * vivo con un intervalo que no hace nada), para poner a prueba cómo se detecta y maneja un
 * servidor que no responde al apagado normal. Escribe su propio pid en `child.pid` y, en cuanto
 * responde la lista de herramientas, un archivo `listed`, ambos junto al ejecutable que lo lanzó,
 * para que la prueba que lo arrancó pueda comprobar en qué punto se quedó sin tener que
 * interpretar su salida estándar. Ningún archivo actual del árbol lo referencia por su ruta.
 */
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
  return {tools:[
    'memory_context','memory_current_project','memory_get','memory_history','memory_save','memory_search',
    'memory_session_end','memory_session_start','memory_session_summary','memory_timeline',
  ].map(name=>({name,inputSchema:{type:'object' as const}}))};
});
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
await server.connect(new StdioServerTransport());
