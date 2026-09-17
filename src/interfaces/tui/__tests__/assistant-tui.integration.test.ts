import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { AssistantSession, assistantTui, resolveInstalledEngram } from '../controller';
import { renderAssistantScreen } from '../render';
import { WorkspaceConfig } from '../../../infrastructure/filesystem/workspace-config';
import { MemoryWorkspace } from '../../../app/workspace';

const roots:string[]=[];
function fixture(){
  const home=mkdtempSync(join(tmpdir(),'engram-tui-'));roots.push(home);
  const executable=join(home,'forge614-engram');writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const config=new WorkspaceConfig(join(home,'.forge614'));
  const options={discovery:{home,env:{},path:home,platform:'linux' as const},executable,config};
  return {home,executable,config,options,session:new AssistantSession(options)};
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function preview(session:AssistantSession){session.key('enter');session.key('space');session.key('enter');}

async function childPid(path:string):Promise<number>{
  const deadline=Date.now()+2500;
  while(!existsSync(path)&&Date.now()<deadline)await Bun.sleep(10);
  return Number(readFileSync(path,'utf8').trim());
}
async function expectStopped(pid:number){
  const deadline=Date.now()+1000;let alive=true;
  while(alive&&Date.now()<deadline){try{process.kill(pid,0);await Bun.sleep(10);}catch{alive=false;}}
  expect(alive).toBe(false);
}


test('selection and previews do not enroll; only confirmed selected clients change and old memories survive',()=>{
  const {home,config,session}=fixture();
  const workspace=new MemoryWorkspace(config);const project=workspace.createProject('Keep');
  const store=workspace.open();const memory=store.save({projectId:project.projectId,title:'Keep',content:'Existing data',type:'fact'});store.close();
  const original=readFileSync(join(config.root,'.env'),'utf8');
  preview(session);
  expect(session.state.page).toBe('preview');expect(existsSync(join(home,'.claude.json'))).toBe(false);
  session.key('enter');expect(session.state.page).toBe('confirm');
  session.key('enter');expect(session.state.page).toBe('results');
  expect(existsSync(join(home,'.claude.json'))).toBe(true);
  expect(existsSync(join(home,'.codex'))).toBe(false);
  expect(readFileSync(join(config.root,'.env'),'utf8')).toBe(original);
  const check=workspace.open();try{expect(check.get(project.projectId,memory.id)?.content).toBe('Existing data');expect(check.projectForDirectory('/unbound')).toBeNull();}finally{check.close();}
});


test('entire selection is preflighted before workspace enrollment',()=>{
  const {home,config,session}=fixture();session.key('enter');session.key('space');session.key('down');session.key('space');session.key('enter');
  mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex/config.toml'),'# changed\n');
  session.key('enter');session.key('enter');
  expect(session.state.page).toBe('results');expect(session.state.messages.join(' ')).toContain('CHANGED');
  expect(existsSync(config.root)).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
});


test('redetection discovers fresh executable, distinguishes config-only and supports hidden custom paths',()=>{
  const {session,home}=fixture();mkdirSync(join(home,'.cursor'));session.key('enter');session.key('redetect');
  expect(session.state.clients[2]!.detected).toMatchObject({installed:false,configFound:true});
  writeFileSync(join(home,'cursor'),'#!/bin/sh\nexit 0\n',{mode:0o700});session.key('redetect');
  expect(session.state.clients[2]!.detected.installed).toBe(true);
  session.key('down');session.key('custom');expect(session.state.page).toBe('custom');
  const custom=join(home,'private-client');writeFileSync(custom,'#!/bin/sh\nexit 0\n',{mode:0o700});
  session.key('text',custom);expect(renderAssistantScreen(session.state,80,30)).not.toContain(custom);
  session.key('enter');session.key('text',join(home,'custom-config'));session.key('enter');
  expect(session.state.clients[1]!.detected.executable).toBe(custom);
  session.key('space');session.key('enter');expect(session.state.plans[0]!.writes[0]!.path).toBe(join(home,'custom-config/config.toml'));
});


test('source execution never resolves Bun as an installed Engram prerequisite',()=>{
  const {home}=fixture();expect(resolveInstalledEngram({home,path:''})).toBeNull();
  const session=new AssistantSession({discovery:{home,env:{},path:''}});
  preview(session);expect(session.state.page).toBe('clients');expect(session.state.notice).toContain('instalado');
  expect(renderAssistantScreen(session.state,80,24)).toContain('Requisito:');
  expect(existsSync(join(home,'.forge614'))).toBe(false);
});


test('self-test failures never expose server stderr or protocol content',async()=>{
  const {session,executable,config}=fixture();writeFileSync(executable,'#!/bin/sh\nprintf "SECRET_TOKEN\\033[31m" >&2\nprintf "PRIVATE_JSON"\nexit 1\n',{mode:0o700});
  session.key('enter');await session.runSelfTest();
  expect(session.state.serverTest).toMatchObject({status:'failed',code:'MCP_FAILED'});
  expect(renderAssistantScreen(session.state,100,100)).not.toMatch(/SECRET_TOKEN|PRIVATE_JSON/);
  expect(existsSync(config.root)).toBe(false);
});


test('self-test refuses a source runtime and remains not-run without touching storage',async()=>{
  const {home,config,options}=fixture();const session=new AssistantSession({...options,executable:process.execPath});
  await session.runSelfTest();expect(session.state.serverTest).toMatchObject({status:'not-run',code:'INSTALLATION_REQUIRED'});
  expect(existsSync(config.root)).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
});

test('self-test timeout kills an unresponsive child and does not enroll',async()=>{
  const {home,options,executable,config}=fixture(),pidPath=join(home,'child.pid');
  writeFileSync(executable,`#!/bin/sh\necho $$ > '${pidPath}'\nexec /bin/sleep 30\n`,{mode:0o700});
  const session=new AssistantSession({...options,selfTestTimeoutMs:1000});const started=Date.now(),pending=session.runSelfTest();
  const pid=await childPid(pidPath);await pending;
  expect(Date.now()-started).toBeLessThan(2000);expect(session.state.serverTest).toMatchObject({status:'failed',code:'TIMED_OUT'});
  await expectStopped(pid);expect(existsSync(config.root)).toBe(false);
});


test('self-test deadline covers shutdown after successful initialize and listTools',async()=>{
  const {home,options,executable,config}=fixture();
  expect(Bun.spawnSync([process.execPath,'build',join(import.meta.dir,'../../../../tests/fixtures/self-test-stalled-shutdown.ts'),'--compile','--outfile',executable]).exitCode).toBe(0);
  const session=new AssistantSession({...options,selfTestTimeoutMs:1500}),started=Date.now();
  const pending=session.runSelfTest(),pid=await childPid(join(home,'child.pid'));await pending;
  expect(existsSync(join(home,'listed'))).toBe(true);
  expect(session.state.serverTest).toMatchObject({status:'failed',code:'TIMED_OUT'});
  expect(Date.now()-started).toBeLessThan(2500);await expectStopped(pid);expect(existsSync(config.root)).toBe(false);
});


test.each(['escape','cancel','eof','error'])('terminal stays responsive and closes own test on %s',async ending=>{
  const {home,options,executable,config}=fixture(),pidPath=join(home,'child.pid');
  writeFileSync(executable,`#!/bin/sh\necho $$ > '${pidPath}'\nexec /bin/sleep 30\n`,{mode:0o700});
  const input=new PassThrough() as any,output=new PassThrough() as any;
  input.isTTY=true;input.isRaw=false;input.setRawMode=(raw:boolean)=>{input.isRaw=raw;return input;};
  output.isTTY=true;output.columns=100;output.rows=50;let text='';output.on('data',(chunk:Buffer)=>text+=chunk);
  const pending=assistantTui({...options,input,output});input.write('\r');input.write('t');
  const pid=await childPid(pidPath);expect(text).toContain('en curso');
  output.emit('resize');
  if(ending==='eof')input.end();else if(ending==='error')input.emit('error',new Error('fixture input failure'));else input.write(ending==='escape'?'\x1b':'\x03');
  if(ending==='escape'){
    await expectStopped(pid);input.write('\x03');
  }
  await pending;await expectStopped(pid);
  expect(input.isRaw).toBe(false);expect(text).toContain('\x1b[?1049l');
  expect(existsSync(config.root)).toBe(false);
});


test('client details can scroll to trust warnings in a small viewport',()=>{
  const {session}=fixture();session.key('enter');session.key('down');
  let displayed=renderAssistantScreen(session.state,40,8);
  for(let i=0;i<10;i++){session.key('pagedown');displayed+='\n'+renderAssistantScreen(session.state,40,8);}
  expect(displayed.replaceAll('\n','')).toContain('/hooks');
  session.key('up');expect(renderAssistantScreen(session.state,40,8)).toContain('Claude Code');
});


test('partial application reports retained files and backups without undoing a successful client',()=>{
  const {home,options}=fixture();mkdirSync(join(home,'shared-config'));writeFileSync(join(home,'shared-config/settings.json'),'{}\n');
  const session=new AssistantSession({...options,discovery:{...options.discovery,locations:{'claude-code':{configDir:join(home,'shared-config')},'gemini-cli':{configDir:join(home,'shared-config')}}}});
  session.key('enter');session.key('space');for(let i=0;i<4;i++)session.key('down');session.key('space');session.key('enter');session.key('enter');session.key('enter');
  const results=session.state.messages.join('\n');
  expect(results).toContain('Claude Code: configuración aplicada');expect(results).toContain('Gemini CLI: fallo parcial');expect(results).toContain('CHANGED');expect(results).toContain('Copia conservada:');
  expect(readFileSync(join(home,'shared-config/settings.json'),'utf8')).toContain('SessionStart');
  expect(existsSync(join(home,'shared-config/.claude.json'))).toBe(true);
});
