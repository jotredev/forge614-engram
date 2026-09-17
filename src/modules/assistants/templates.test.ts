import { afterEach, expect, test } from "bun:test";
import { createOpenCodePlugin, hookConfiguration, shellQuote } from "./templates";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots:string[]=[];
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function root(){const path=mkdtempSync(join(tmpdir(),'engram-hooks-'));roots.push(path);return path;}

test("hook configuration selects client events and timeout units", () => {
  expect(hookConfiguration("opencode","/tmp/engram")).toEqual({});
  expect(hookConfiguration("cursor","/tmp/engram")).toEqual({sessionStart:[{command:"'/tmp/engram' memory-hook --client cursor",timeout:3}]});
  expect(hookConfiguration("gemini-cli","/tmp/engram")).toEqual({
    SessionStart:[{hooks:[{type:"command",name:"forge614-engram",command:"'/tmp/engram' memory-hook --client gemini-cli",timeout:3000}]}],
    BeforeAgent:[{hooks:[{type:"command",name:"forge614-engram",command:"'/tmp/engram' memory-hook --client gemini-cli",timeout:3000}]}],
  });
  for (const client of ["codex","claude-code"] as const) {
    expect(Object.keys(hookConfiguration(client,"/tmp/engram"))).toEqual(["SessionStart","UserPromptSubmit"]);
  }
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
  expect(system.system[0]).toStartWith('Original system\n\n');
  expect(system.system[0]).toContain('memory_session_start');
  const compact={context:['Existing recovery'],prompt:'Custom compaction prompt'};
  await hooks['experimental.session.compacting']({},compact);await hooks['experimental.session.compacting']({},compact);
  expect(compact.context).toHaveLength(2);expect(compact.context[0]).toBe('Existing recovery');expect(compact.prompt).toBe('Custom compaction prompt');
  expect(compact.context[1]).toContain('memory_current_project');
  expect(compact.context[1]).toContain('known conversation sessionId');
  expect(compact.context[1]).toContain('not guaranteed model obedience');
});

test('native hook commands quote binary paths and clients use their own timeout units',()=>{
  const executable="/tmp/it's a binary;$HOME`touch`";
  const command=shellQuote(executable);
  const proc=Bun.spawnSync(['/bin/sh','-c',`printf '%s' ${command}`]);
  expect(proc.stdout.toString()).toBe(executable);
  const gemini=hookConfiguration('gemini-cli',executable) as any;
  const claude=hookConfiguration('claude-code',executable) as any;
  expect(gemini.SessionStart[0].hooks[0].timeout).toBe(3000);
  expect(claude.SessionStart[0].hooks[0].timeout).toBe(3);
  const substitution = "a'b $(printf unsafe)";
  const result = Bun.spawnSync(["/bin/sh","-c",`printf '%s' ${shellQuote(substitution)}`]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(substitution);
});
