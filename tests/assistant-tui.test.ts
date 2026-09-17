import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { AssistantSession, assistantTui, resolveInstalledEngram } from '../src/assistant-tui';
import { renderAssistantScreen } from '../src/assistant-tui-render';
import { WorkspaceConfig } from '../src/workspace-config';
import { MemoryWorkspace } from '../src/workspace';

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

test('Escape backs out and Ctrl+C before confirmation leaves a new workspace absent',()=>{
  const {config,home,session}=fixture();preview(session);session.key('enter');session.key('escape');
  expect(session.state.page).toBe('preview');session.key('escape');expect(session.state.page).toBe('clients');
  session.key('cancel');expect(session.state.cancelled).toBe(true);
  expect(existsSync(config.root)).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
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

test('optional own-server test performs compiled SDK handshake without enrollment or launching client commands',async()=>{
  const {home,options,config}=fixture(),binary=join(home,'compiled/forge614-engram');mkdirSync(join(home,'compiled'));
  expect(Bun.spawnSync([process.execPath,'build',resolve(import.meta.dir,'../src/cli.ts'),'--compile','--outfile',binary]).exitCode).toBe(0);
  const marker=join(home,'client-started'),client=join(home,'claude');
  writeFileSync(client,`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o700});
  const session=new AssistantSession({...options,executable:binary});session.key('enter');session.key('space');
  expect(renderAssistantScreen(session.state,100,100)).toContain('no realizada');
  await session.runSelfTest();
  expect(session.state.serverTest.status).toBe('passed');
  expect(session.state.selected.has('claude-code')).toBe(true);expect(session.state.page).toBe('clients');
  const rendered=renderAssistantScreen(session.state,100,100);
  expect(rendered).toContain('correcta');expect(rendered).toContain('Sesiones de asistentes no probadas');
  expect(existsSync(config.root)).toBe(false);expect(existsSync(marker)).toBe(false);
},15000);

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
  expect(Bun.spawnSync([process.execPath,'build',join(import.meta.dir,'fixtures/self-test-stalled-shutdown.ts'),'--compile','--outfile',executable]).exitCode).toBe(0);
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

test('renderer bounds every viewport, sanitizes controls, exposes coverage and never private config bytes',()=>{
  const {session,home}=fixture();mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex/config.toml'),'api_key="SECRET_SENTINEL"\n');
  session.key('enter');session.key('down');session.key('space');session.key('enter');
  const full=renderAssistantScreen(session.state,100,100);
  expect(full).toContain('/hooks');expect(full).toContain('no probada');expect(full).not.toContain('SECRET_SENTINEL');
  session.state.notice='unsafe\x1b]52;c;SECRET\x07\r\nINJECT\u202e';
  const sanitized=renderAssistantScreen(session.state,100,100);
  expect(sanitized).toContain('unsafe?');expect(sanitized).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e]/);
  const tiny=renderAssistantScreen(session.state,18,5);
  expect(tiny.split('\n').length).toBeLessThanOrEqual(5);
  expect(tiny.split('\n').every(line=>Array.from(line).length<=18)).toBe(true);
  expect(tiny).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e]/);
});

test('nonTTY tui returns INTERACTIVE_REQUIRED with no terminal escapes or workspace writes',async()=>{
  const {home,options}=fixture();const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',chunk=>text+=chunk);
  await expect(assistantTui({...options,input:input as any,output:output as any})).rejects.toMatchObject({code:'INTERACTIVE_REQUIRED'});
  expect(text).toBe('');expect(existsSync(join(home,'.forge614'))).toBe(false);
  const child=Bun.spawnSync([process.execPath,resolve(import.meta.dir,'../src/cli.ts'),'tui'],{env:{HOME:home,PATH:'',BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  expect(child.exitCode).toBe(1);expect(JSON.parse(child.stderr.toString()).code).toBe('INTERACTIVE_REQUIRED');expect(child.stdout.toString()).toBe('');
});

test('terminal stream redraws on resize and restores raw/cursor state on Ctrl+C and EOF',async()=>{
  for(const ending of ['cancel','eof']){
    const {home,options}=fixture();const input=new PassThrough() as any,output=new PassThrough() as any;
    input.isTTY=true;input.isRaw=false;input.setRawMode=(raw:boolean)=>{input.isRaw=raw;return input;};
    output.isTTY=true;output.columns=80;output.rows=24;let text='';output.on('data',(chunk:Buffer)=>text+=chunk);
    const result=assistantTui({...options,input,output});
    expect(input.isRaw).toBe(true);const before=text.length;output.columns=24;output.rows=8;output.emit('resize');expect(text.length).toBeGreaterThan(before);
    input.write('\r');input.write(' ');input.write('\r');
    if(ending==='cancel')input.write('\x03');else input.end();
    expect((await result).cancelled).toBe(true);expect(input.isRaw).toBe(false);
    expect(text).toContain('\x1b[?25h');expect(text).toContain('\x1b[?1049l');
    expect(output.listenerCount('resize')).toBe(0);expect(existsSync(join(home,'.forge614'))).toBe(false);
  }
});

test.skipIf(!existsSync('/usr/bin/expect'))('compiled TUI cancels from preview and Escape on a real PTY and restores stty',()=>{
  const {home}=fixture();const binary=join(home,'compiled/forge614-engram');mkdirSync(join(home,'compiled'));
  const build=Bun.spawnSync([process.execPath,'build',resolve(import.meta.dir,'../src/cli.ts'),'--compile','--outfile',binary]);
  expect(build.exitCode).toBe(0);
  for(const scenario of ['cancel','escape']){
    const run=Bun.spawnSync(['/usr/bin/expect',join(import.meta.dir,'fixtures/assistant-tui-pty.exp'),binary,scenario],{
      cwd:home,env:{HOME:home,PATH:'/usr/bin:/bin',TERM:'xterm-256color'},timeout:20000,
    });
    expect(run.stderr.toString()).toBe('');expect(run.stdout.toString()).toContain('PASS real PTY');expect(run.exitCode).toBe(0);
    expect(existsSync(join(home,'.forge614'))).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
  }
},45000);

test('partial application reports retained files and backups without undoing a successful client',()=>{
  const {home,options}=fixture();mkdirSync(join(home,'shared-config'));writeFileSync(join(home,'shared-config/settings.json'),'{}\n');
  const session=new AssistantSession({...options,discovery:{...options.discovery,locations:{'claude-code':{configDir:join(home,'shared-config')},'gemini-cli':{configDir:join(home,'shared-config')}}}});
  session.key('enter');session.key('space');for(let i=0;i<4;i++)session.key('down');session.key('space');session.key('enter');session.key('enter');session.key('enter');
  const results=session.state.messages.join('\n');
  expect(results).toContain('Claude Code: configuración aplicada');expect(results).toContain('Gemini CLI: fallo parcial');expect(results).toContain('CHANGED');expect(results).toContain('Copia conservada:');
  expect(readFileSync(join(home,'shared-config/settings.json'),'utf8')).toContain('SessionStart');
  expect(existsSync(join(home,'shared-config/.claude.json'))).toBe(true);
});
