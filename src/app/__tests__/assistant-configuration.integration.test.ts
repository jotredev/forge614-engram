import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planAssistantConfiguration } from '../../infrastructure/assistants/configuration';
import { detectAssistants } from '../index';
import type { AssistantOptions } from '../../modules/assistants';

const roots: string[] = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'engram-assistant-collaboration-')); roots.push(home);
  const executable = join(home, "engram's binary;$x"); writeFileSync(executable, '#!/bin/sh\nexit 0\n', {mode:0o700});
  const options: AssistantOptions = { home, env: {}, path: '', platform:'linux' };
  return {home,executable,options};
}
afterEach(() => { for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

test('detection distinguishes stale configs and rescans executables without starting them', () => {
  const {home,options} = fixture(); mkdirSync(join(home,'.cursor'));
  const bin=join(home,'bin');mkdirSync(bin);options.path=bin;
  const first=detectAssistants(options);
  expect(first.map(x=>x.id)).toEqual(['claude-code','codex','cursor','opencode','antigravity']);
  expect(first[2]!.detected.installed).toBe(false);
  expect(first[2]!.detected.configFound).toBe(true);
  writeFileSync(join(bin,'cursor'),'#!/bin/sh\ntouch SHOULD_NOT_EXIST\n');chmodSync(join(bin,'cursor'),0o700);
  expect(detectAssistants(options)[2]!.detected.installed).toBe(true);
  expect(existsSync(join(home,'SHOULD_NOT_EXIST'))).toBe(false);
});

test('file symlinks, directories masquerading as files, and nonexecutable overrides are refused',()=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.cursor'));const path=join(home,'.cursor/mcp.json');
  symlinkSync(executable,path);expect(()=>planAssistantConfiguration('cursor',executable,options)).toThrow();
  symlinkSync(executable,join(home,'.gemini'));expect(()=>planAssistantConfiguration('antigravity',executable,options)).toThrow();
  options.locations={cursor:{executable:join(home,'absent')}};expect(detectAssistants(options)[2]!.configuration.status).toBe('blocked');
  expect(()=>planAssistantConfiguration('codex','relative',options)).toThrow();
});
