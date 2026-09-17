import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOpenCodePlugin, hookConfiguration, shellQuote } from '../../modules/assistants';
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
