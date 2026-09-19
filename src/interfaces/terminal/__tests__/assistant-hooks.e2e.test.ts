import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOpenCodePlugin, hookConfiguration, shellQuote } from '../../../modules/assistants';
const roots:string[]=[];
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function root(){const path=mkdtempSync(join(tmpdir(),'engram-hooks-'));roots.push(path);return path;}


test('standalone compiled hooks and assistant listing run with no Bun on PATH and no storage writes',async()=>{
  const home=root(),binary=join(home,'engram-standalone');
  const build=Bun.spawnSync([process.execPath,'build','--compile',resolve('src/cli.ts'),'--outfile',binary],{env:{...process.env,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  expect(build.exitCode).toBe(0);const before=readdirSync(home);
  const env={HOME:home,PATH:'',BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0',FORGE614_TEST_USER_DIRECTORY:join(home,'store')};
  const hook=Bun.spawnSync([binary,'memory-hook','--client','codex'],{cwd:home,env,stdin:Buffer.from('{"hook_event_name":"SessionStart","source":"compact"}')});
  expect(hook.exitCode).toBe(0);expect(hook.stderr.toString()).toBe('');expect(JSON.parse(hook.stdout.toString()).hookSpecificOutput.additionalContext).toContain('memory_current_project');
  const list=Bun.spawnSync([binary,'assistant-list'],{cwd:home,env});expect(list.exitCode).toBe(0);expect(list.stderr.toString()).toBe('');
  expect(JSON.parse(list.stdout.toString()).map((entry:any)=>entry.id)).toEqual(['claude-code','codex','cursor','opencode','antigravity']);
  expect(readdirSync(home)).toEqual(before);
});
