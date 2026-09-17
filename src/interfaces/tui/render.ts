import { LABELS } from '../../modules/assistants';
import type { AssistantState } from './controller';

/** All external text crosses this boundary. No ANSI, bidi or line-control injection. */
function clean(text:string):string{
  return text.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,'?');
}
const coverage={
  'session-and-prompt':'inicio de sesión + cada prompt',
  'session-only':'solo inicio de sesión',
  'experimental-system-and-compaction':'sistema + compactación (experimental)',
};
export function renderAssistantScreen(state:AssistantState,width:number,height:number):string{
  // ASCII path replacements keep width bounded even for full-width glyphs/emoji.
  const columns=Math.max(1,Math.min(240,Math.floor(width)||80));
  const rows=Math.max(1,Math.min(200,Math.floor(height)||24));
  const lines:string[]=[];let focused=0;
  const add=(text:string)=>lines.push(clean(text));
  const item=(index:number,text:string)=>{if(state.cursor===index)focused=lines.length;add(`${state.cursor===index?'>':' '} ${text}`);};
  add('Forge614 Engram | Asistentes');
  const serverStatus={'not-run':'no realizada',running:'en curso',passed:'correcta',failed:'fallida'};
  add(`Prueba del servidor propio: ${serverStatus[state.serverTest.status]}${state.serverTest.code?' ('+state.serverTest.code+')':''}.`);
  add('Sesiones de asistentes no probadas. Reinicia el cliente y comprueba sus herramientas MCP.');
  if(state.notice)add(state.notice);
  if(state.page==='menu'){item(0,'Asistentes');item(1,'Salir');}
  if(state.page==='clients'){
    state.clients.forEach((client,index)=>{
      item(index,`[${state.selected.has(client.id)?'x':' '}] ${client.label} | ${client.detected.installed?'detectado':client.detected.configFound?'solo configuración':'no detectado'} | ${client.configuration.status}`);
    });
    item(5,'Volver a detectar');item(6,'Previsualizar selección');item(7,'Volver');item(8,'Probar servidor propio (opcional)');
    const current=state.clients[state.cursor];
    if(current){
      add(`Evidencia: ${current.detected.evidence.join('; ')||'sin ejecutable ni configuración'}`);
      for(const path of current.configuration.paths)add(`Ruta: ${path}`);
      if(current.configuration.message)add(current.configuration.message);
      add(`Hooks: ${coverage[current.automation.coverage]}. Sesión no probada.`);
      current.automation.warnings.forEach(add);
    }
  }
  if(state.page==='custom'){
    add(`Ruta personalizada: ${LABELS[state.clients[state.cursor]!.id]}`);
    add(state.customField==='executable'?'Ejecutable del asistente (ruta absoluta; Enter conserva):':'Directorio de configuración (ruta absoluta; Enter conserva):');
    add('[entrada oculta]');add('Enter continúa. Escape descarta. No pegues credenciales.');
  }
  if(state.page==='preview'||state.page==='confirm'){
    add(state.page==='preview'?'Vista previa: aún no se ha escrito nada.':'Confirmar: Enter habilita esquema 5 y aplica esta selección.');
    for(const plan of state.plans){
      add(`${LABELS[plan.client]} | configuración propuesta; sesión no probada`);
      if(!plan.writes.length)add('Sin cambios de configuración necesarios.');
      for(const write of plan.writes)add(`${write.kind}: ${write.path} (${write.expectedHash?'copia exacta antes de reemplazar':'archivo nuevo'})`);
      plan.warnings.forEach(add);
    }
    add('Se valida toda la selección antes de habilitar la integración local.');
    add('Esquema 5 aditivo, sin downgrade. Los recuerdos existentes se conservan.');
    add('Aplicación por archivo; pueden existir fallos parciales y copias retenidas.');
    add('La configuración no prueba conexión ni garantiza que el modelo guarde recuerdos.');
  }
  if(state.page==='results'){state.messages.forEach(add);add('Enter vuelve a Asistentes. Flechas desplazan resultados.');}
  const footer=state.page==='clients'?'Espacio elegir | Enter previa | t probar | PgUp/Dn leer | c rutas | r detectar | Esc | Ctrl+C'
    :state.page==='confirm'?'Enter CONFIRMAR | Flechas leer | Esc volver | Ctrl+C cancelar'
    :'Flechas navegar/leer | Enter continuar | Esc volver | Ctrl+C cancelar';
  // Use one cell for ASCII/Latin; unfamiliar wide characters are escaped to ASCII.
  const cellSafe=(line:string)=>Array.from(line).map(char=>char.codePointAt(0)!>0x24f?'?':char).join('');
  const wrapped:string[]=[];let focusRow=0;
  for(const [index,line] of lines.entries()){
    if(index===focused)focusRow=wrapped.length;
    const chars=Array.from(cellSafe(line));
    for(let offset=0;offset<Math.max(chars.length,1);offset+=columns)wrapped.push(chars.slice(offset,offset+columns).join(''));
  }
  const budget=Math.max(0,rows-1);
  const auto=state.page==='clients'||state.page==='menu'?state.scroll||Math.max(0,focusRow-budget+1):state.scroll;
  const offset=Math.min(auto,Math.max(0,wrapped.length-budget));
  return [...wrapped.slice(offset,offset+budget),Array.from(cellSafe(clean(footer))).slice(0,columns).join('')].join('\n');
}
