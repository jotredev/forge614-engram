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


test('optional own-server test performs compiled SDK handshake without enrollment or launching client commands',async()=>{
  const {home,options,config}=fixture(),binary=join(home,'compiled/forge614-engram');mkdirSync(join(home,'compiled'));
  expect(Bun.spawnSync([process.execPath,'build',resolve(import.meta.dir,'../../../cli.ts'),'--compile','--outfile',binary]).exitCode).toBe(0);
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


test('nonTTY tui returns INTERACTIVE_REQUIRED with no terminal escapes or workspace writes',async()=>{
  const {home,options}=fixture();const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',chunk=>text+=chunk);
  await expect(assistantTui({...options,input:input as any,output:output as any})).rejects.toMatchObject({code:'INTERACTIVE_REQUIRED'});
  expect(text).toBe('');expect(existsSync(join(home,'.forge614'))).toBe(false);
  const child=Bun.spawnSync([process.execPath,resolve(import.meta.dir,'../../../cli.ts'),'tui'],{env:{HOME:home,PATH:'',BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  expect(child.exitCode).toBe(1);expect(JSON.parse(child.stderr.toString()).code).toBe('INTERACTIVE_REQUIRED');expect(child.stdout.toString()).toBe('');
});


test.skipIf(!existsSync('/usr/bin/expect'))('compiled TUI cancels from preview and Escape on a real PTY and restores stty',()=>{
  const {home}=fixture();const binary=join(home,'compiled/forge614-engram');mkdirSync(join(home,'compiled'));
  const build=Bun.spawnSync([process.execPath,'build',resolve(import.meta.dir,'../../../cli.ts'),'--compile','--outfile',binary]);
  expect(build.exitCode).toBe(0);
  for(const scenario of ['cancel','escape']){
    const run=Bun.spawnSync(['/usr/bin/expect',join(import.meta.dir,'../../../../tests/fixtures/assistant-tui-pty.exp'),binary,scenario],{
      cwd:home,env:{HOME:home,PATH:'/usr/bin:/bin',TERM:'xterm-256color'},timeout:20000,
    });
    expect(run.stderr.toString()).toBe('');expect(run.stdout.toString()).toContain('PASS real PTY');expect(run.exitCode).toBe(0);
    expect(existsSync(join(home,'.forge614'))).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
  }
},45000);
