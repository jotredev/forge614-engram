import { emitKeypressEvents, type Key } from 'node:readline';
import { join } from 'node:path';
import type { ReadStream, WriteStream } from 'node:tty';
import { MemoryError } from '../../shared/errors';
import { MemoryWorkspace } from '../../app';
import { WorkspaceConfig } from '../../app';
import { CLIENT_IDS, LABELS, type AssistantOptions, type AssistantDescriptor, type ClientId } from '../../modules/assistants';
import { detectAssistants } from '../../app';
import { AssistantConfigurationError, applyAssistantConfiguration, planAssistantConfiguration, preflightAssistantConfiguration, type ConfigurationPlan } from '../../app';
import { renderAssistantScreen } from './render';
import { testInstalledServer, type ServerTestResult } from '../../app';

export interface AssistantTuiOptions {
  discovery?:AssistantOptions;
  executable?:string;
  config?:WorkspaceConfig;
  input?:ReadStream;
  output?:WriteStream;
  selfTestTimeoutMs?:number;
}
export interface AssistantState {
  page:'menu'|'clients'|'custom'|'preview'|'confirm'|'results';
  cursor:number;scroll:number;selected:Set<ClientId>;
  clients:AssistantDescriptor[];plans:ConfigurationPlan[];
  notice:string;messages:string[];done:boolean;cancelled:boolean;
  customField:'executable'|'configDir';
  serverTest:ServerTestResult;
}

export { resolveInstalledEngram } from "../../app";
import { resolveInstalledEngram } from "../../app";
function safeError(error:unknown):string{
  return error instanceof AssistantConfigurationError||error instanceof MemoryError
    ? `${error.code}: ${error.message}`
    : 'IO_ERROR: No se pudo completar la operación. Revisa rutas y permisos sin compartir archivos privados.';
}

/** Keyboard-driven state transitions; all configuration semantics stay in the adapter service. */
export class AssistantSession {
  readonly state:AssistantState={page:'menu',cursor:0,scroll:0,selected:new Set(),clients:[],plans:[],notice:'',messages:[],done:false,cancelled:false,customField:'executable',serverTest:{status:'not-run'}};
  private discovery:AssistantOptions;
  private readonly executable:string|null;
  private readonly config:WorkspaceConfig;
  private input='';
  private customExecutable='';
  private selfTestAbort:AbortController|null=null;
  private selfTestPending:Promise<void>|null=null;
  private readonly selfTestTimeoutMs:number|undefined;
  constructor(options:AssistantTuiOptions={}){
    this.discovery={...options.discovery,locations:{...options.discovery?.locations}};
    this.executable=resolveInstalledEngram({...options.discovery,...(options.executable?{executable:options.executable}:{})});
    this.config=options.config??new WorkspaceConfig(options.discovery?.home?join(options.discovery.home,'.forge614'):undefined);
    this.selfTestTimeoutMs=options.selfTestTimeoutMs;
    this.detect();
  }
  runSelfTest():Promise<void>{
    if(this.selfTestPending)return this.selfTestPending;
    if(this.state.done)return Promise.resolve();
    const executable=this.executable?resolveInstalledEngram({executable:this.executable}):null;
    if(!executable){this.state.serverTest={status:'not-run',code:'INSTALLATION_REQUIRED'};return Promise.resolve();}
    const controller=new AbortController();this.selfTestAbort=controller;
    this.state.serverTest={status:'running'};
    this.selfTestPending=testInstalledServer(executable,{signal:controller.signal,
      ...(this.selfTestTimeoutMs!==undefined?{timeoutMs:this.selfTestTimeoutMs}:{}),
      ...(this.discovery.home?{home:this.discovery.home}:{})})
      .then(result=>{this.state.serverTest=result;})
      .finally(()=>{this.selfTestAbort=null;this.selfTestPending=null;});
    return this.selfTestPending;
  }
  async stopSelfTest():Promise<void>{this.selfTestAbort?.abort();await this.selfTestPending;}
  private detect(){
    // An absent installation gets an impossible comparison path, never process.execPath (Bun).
    this.state.clients=detectAssistants({...this.discovery,engramExecutable:this.executable??'/engram-installation-required/forge614-engram'});
  }
  key(key:string,text=''):void{
    const state=this.state;if(state.done)return;
    if(key==='cancel'){this.selfTestAbort?.abort();state.done=true;state.cancelled=true;this.input='';return;}
    if(key==='escape'){
      if(this.selfTestAbort){this.selfTestAbort.abort();return;}
      state.notice='';state.scroll=0;this.input='';
      if(state.page==='menu'){state.done=true;return;}
      if(state.page==='clients'){state.page='menu';state.cursor=0;return;}
      state.page=state.page==='confirm'?'preview':'clients';state.cursor=Math.min(state.cursor,4);return;
    }
    if(state.page==='custom'){
      if(key==='text'){if(this.input.length+text.length<=4096&&!/[\x00-\x1f\x7f-\x9f]/.test(text))this.input+=text;return;}
      if(key==='backspace'){this.input=Array.from(this.input).slice(0,-1).join('');return;}
      if(key!=='enter')return;
      if(state.customField==='executable'){this.customExecutable=this.input.trim();this.input='';state.customField='configDir';return;}
      const id=CLIENT_IDS[state.cursor]!;
      const location={...this.discovery.locations?.[id],...(this.customExecutable?{executable:this.customExecutable}:{}),...(this.input.trim()?{configDir:this.input.trim()}: {})};
      this.discovery.locations={...this.discovery.locations,[id]:location};this.input='';this.customExecutable='';
      state.page='clients';this.detect();return;
    }
    if(key==='pageup'||key==='pagedown'){
      state.scroll=Math.max(0,state.scroll+(key==='pagedown'?5:-5));return;
    }
    if(key==='up'||key==='down'){
      const direction=key==='down'?1:-1;
      if(state.page==='menu'||state.page==='clients'){
        const size=state.page==='menu'?2:9;state.cursor=(state.cursor+direction+size)%size;state.scroll=0;
      }else state.scroll=Math.max(0,state.scroll+direction);
      return;
    }
    if(state.page==='menu'){
      if(key==='enter'){if(state.cursor===1)state.done=true;else{state.page='clients';state.cursor=0;}}
      return;
    }
    if(state.page==='clients'){
      if(key==='selftest'||key==='enter'&&state.cursor===8){void this.runSelfTest();return;}
      if(key==='redetect'||key==='enter'&&state.cursor===5){this.detect();state.scroll=0;state.notice='Detección actualizada.';return;}
      if(key==='custom'&&state.cursor<5){state.page='custom';state.scroll=0;state.customField='executable';this.input='';return;}
      if(key==='space'&&state.cursor<5){const id=CLIENT_IDS[state.cursor]!;state.selected.has(id)?state.selected.delete(id):state.selected.add(id);return;}
      if(key!=='enter')return;
      if(state.cursor===7){state.page='menu';state.cursor=0;return;}
      if(!this.executable){state.notice='Requisito: ejecuta forge614-engram tui con el binario instalado. Bun no es el servidor instalado.';return;}
      if(!state.selected.size){state.notice='Selecciona asistentes con Espacio antes de previsualizar.';return;}
      try{
        state.plans=CLIENT_IDS.filter(id=>state.selected.has(id)).map(id=>planAssistantConfiguration(id,this.executable!,this.discovery));
        state.page='preview';state.scroll=0;state.notice='';
      }catch(error){state.plans=[];state.notice=safeError(error);}
      return;
    }
    if(key!=='enter')return;
    if(state.page==='preview'){state.page='confirm';state.scroll=0;return;}
    if(state.page==='confirm'){
      state.messages=[];
      try{
        for(const plan of state.plans)preflightAssistantConfiguration(plan);
        const workspace=new MemoryWorkspace(this.config);workspace.init();
        const store=workspace.open();try{store.enableAssistantIntegration();}finally{store.close();}
        state.messages.push('Integración local habilitada: esquema 5. Recuerdos existentes conservados.');
        for(const plan of state.plans){
          const result=applyAssistantConfiguration(plan);
          state.messages.push(`${LABELS[plan.client]}: ${result.ok?'configuración aplicada; sesión no probada':'fallo parcial o sin cambios'}`);
          for(const path of result.appliedPaths)state.messages.push(`${result.unverifiedPaths.includes(path)?'Publicado sin verificar':'Aplicado y verificado'}: ${path}`);
          for(const path of result.backupPaths)state.messages.push(`Copia conservada: ${path}`);
          if(result.error)state.messages.push(`${result.error.code}: ${result.error.message}`);
          state.messages.push(...plan.warnings);
        }
      }catch(error){state.messages.push(safeError(error),'No se continuó con los asistentes. La preparación local puede haber ocurrido si el error fue posterior al preflight.');}
      state.page='results';state.scroll=0;this.detect();return;
    }
    if(state.page==='results'){state.page='clients';state.scroll=0;state.plans=[];state.notice='';}
  }
}

/** Human-only terminal adapter. MCP never calls this and retains clean protocol stdout. */
export async function assistantTui(options:AssistantTuiOptions={}):Promise<{cancelled:boolean}>{
  const input=options.input??process.stdin,output=options.output??process.stdout;
  if(!input.isTTY||!output.isTTY||typeof input.setRawMode!=='function')throw new MemoryError('INTERACTIVE_REQUIRED','tui necesita una terminal interactiva. Ejecuta forge614-engram tui en tu terminal; assistant-list ofrece detección de solo lectura.');
  const session=new AssistantSession(options);
  const wasRaw=!!input.isRaw,wasFlowing=input.readableFlowing===true;
  let resolveDone:()=>void;
  const done=new Promise<void>(resolve=>{resolveDone=resolve;});
  const draw=()=>output.write('\x1b[H\x1b[2J'+renderAssistantScreen(session.state,output.columns||80,output.rows||24));
  const finish=()=>{session.key('cancel');resolveDone();};
  const press=(text:string,key:Key)=>{
    if(key.ctrl&&key.name==='c'){finish();return;}
    const name=key.name==='return'?'enter':key.name==='space'?'space':key.name;
    if(session.state.page==='custom'&&!key.ctrl&&!key.meta&&text&&(!name||!['enter','escape','backspace','up','down','left','right','tab'].includes(name)))session.key('text',text);
    else if(session.state.page==='clients'&&(name==='t'||name==='enter'&&session.state.cursor===8)){
      void session.runSelfTest().then(()=>{if(!session.state.done)draw();});
    }else session.key(name==='r'?'redetect':name==='c'?'custom':name??'');
    if(session.state.done)resolveDone();else draw();
  };
  try{
    emitKeypressEvents(input);input.setRawMode(true);
    output.write('\x1b[?1049h\x1b[?25l');
    input.on('keypress',press);input.on('end',finish);input.on('error',finish);
    output.on('resize',draw);process.on('SIGINT',finish);process.on('SIGTERM',finish);
    input.resume();draw();await done;await session.stopSelfTest();
    return {cancelled:session.state.cancelled};
  }finally{
    await session.stopSelfTest();
    input.off('keypress',press);input.off('end',finish);input.off('error',finish);output.off('resize',draw);
    process.off('SIGINT',finish);process.off('SIGTERM',finish);
    input.setRawMode(wasRaw);if(!wasFlowing)input.pause();
    output.write('\x1b[?25h\x1b[?1049l');
  }
}
