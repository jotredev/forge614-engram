import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOpenCodePlugin, hookConfiguration, shellQuote } from '../src/assistants/hooks';
const roots:string[]=[];
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function root(){const path=mkdtempSync(join(tmpdir(),'engram-hooks-'));roots.push(path);return path;}
async function invoke(client:string,payload:string, close=true){
  const home=root();const before=readdirSync(home);
  const proc=Bun.spawn([process.execPath,resolve('src/cli.ts'),'memory-hook','--client',client],{cwd:home,env:{HOME:home,PATH:'',BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0',FORGE614_TEST_USER_DIRECTORY:join(home,'store')},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  proc.stdin.write(payload); if(close)proc.stdin.end();
  const output=await new Response(proc.stdout).text(); const error=await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);expect(error).toBe('');expect(readdirSync(home)).toEqual(before);
  return JSON.parse(output);
}
test.each([
  ['claude-code','SessionStart'],['claude-code','UserPromptSubmit'],['codex','SessionStart'],['codex','UserPromptSubmit'],['gemini-cli','SessionStart'],['gemini-cli','BeforeAgent'],
])('%s %s emits native additional context without echoing input',async(client,event)=>{
  const output=await invoke(client,JSON.stringify({hook_event_name:event,source:'compact',prompt:'SECRET_SENTINEL',transcript_path:'/do-not-read'}));
  expect(output.hookSpecificOutput.additionalContext).toContain('memory_current_project');
  expect(JSON.stringify(output)).not.toContain('SECRET_SENTINEL');
  if(client!=='gemini-cli')expect(output.hookSpecificOutput.hookEventName).toBe(event);
});
test('Cursor uses sessionStart additional_context and no beforeSubmitPrompt support',async()=>{
  expect((await invoke('cursor','{"hook_event_name":"sessionStart"}')).additional_context).toContain('memory_search');
  expect(await invoke('cursor','{"hook_event_name":"beforeSubmitPrompt"}')).toEqual({});
});
test.each(['{BROKEN','{"hook_event_name":"Stop"}', ' '.repeat(65537)])('unsafe or unsupported input returns empty native JSON',async input=>{
  expect(await invoke('claude-code',input)).toEqual({});
});
test('never-closed stdin times out without blocking the client',async()=>{
  const start=Date.now();expect(await invoke('codex','{"hook_event_name":"SessionStart"}',false)).toEqual({});
  expect(Date.now()-start).toBeLessThan(4000);
},5000);
test('native hook commands quote binary paths and clients use their own timeout units',()=>{
  const executable="/tmp/it's a binary;$HOME`touch`";
  const command=shellQuote(executable);
  const proc=Bun.spawnSync(['/bin/sh','-c',`printf '%s' ${command}`]);
  expect(proc.stdout.toString()).toBe(executable);
  const gemini=hookConfiguration('gemini-cli',executable) as any;
  const claude=hookConfiguration('claude-code',executable) as any;
  expect(gemini.SessionStart[0].hooks[0].timeout).toBe(3000);
  expect(claude.SessionStart[0].hooks[0].timeout).toBe(3);
});
test('generated OpenCode plugin executes independently and preserves custom system and compaction state idempotently',async()=>{
  const directory=root(); const path=join(directory,'forge614-engram.js');writeFileSync(path,createOpenCodePlugin());
  const module=await import(path); expect(Object.keys(module)).toEqual(['default']);
  const hooks=await module.default({});
  const system={system:['Original system','Another original']};
  await hooks['experimental.chat.system.transform']({},system);
  const once=[...system.system];await hooks['experimental.chat.system.transform']({},system);
  expect(system.system).toEqual(once);expect(system.system).toHaveLength(2);
  expect(system.system[0]).toStartWith('Original system');expect(system.system[0]).toContain('memory_search');expect(system.system[1]).toBe('Another original');
  const compact={context:['Existing recovery'],prompt:'Custom compaction prompt'};
  await hooks['experimental.session.compacting']({},compact);await hooks['experimental.session.compacting']({},compact);
  expect(compact.context).toHaveLength(2);expect(compact.context[0]).toBe('Existing recovery');expect(compact.prompt).toBe('Custom compaction prompt');
  expect(compact.context[1]).toContain('memory_current_project');
});

test('standalone compiled hooks and assistant listing run with no Bun on PATH and no storage writes',async()=>{
  const home=root(),binary=join(home,'engram-standalone');
  const build=Bun.spawnSync([process.execPath,'build','--compile',resolve('src/cli.ts'),'--outfile',binary],{env:{...process.env,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  expect(build.exitCode).toBe(0);const before=readdirSync(home);
  const env={HOME:home,PATH:'',BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0',FORGE614_TEST_USER_DIRECTORY:join(home,'store')};
  const hook=Bun.spawnSync([binary,'memory-hook','--client','codex'],{cwd:home,env,stdin:Buffer.from('{"hook_event_name":"SessionStart","source":"compact"}')});
  expect(hook.exitCode).toBe(0);expect(hook.stderr.toString()).toBe('');expect(JSON.parse(hook.stdout.toString()).hookSpecificOutput.additionalContext).toContain('memory_current_project');
  const list=Bun.spawnSync([binary,'assistant-list'],{cwd:home,env});expect(list.exitCode).toBe(0);expect(list.stderr.toString()).toBe('');
  expect(JSON.parse(list.stdout.toString()).map((entry:any)=>entry.id)).toEqual(['claude-code','codex','cursor','opencode','gemini-cli']);
  expect(readdirSync(home)).toEqual(before);
});
