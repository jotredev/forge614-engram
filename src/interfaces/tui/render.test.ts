import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { AssistantSession, assistantTui, resolveInstalledEngram } from './controller';
import { renderAssistantScreen } from './render';
import { WorkspaceConfig } from '../../infrastructure/filesystem/workspace-config';
import { MemoryWorkspace } from '../../app/workspace';

const roots:string[]=[];
function fixture(){
  const home=mkdtempSync(join(tmpdir(),'engram-tui-'));roots.push(home);
  const executable=join(home,'forge614-engram');writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const config=new WorkspaceConfig(join(home,'.forge614'));
  const options={discovery:{home,env:{},path:home,platform:'linux' as const},executable,config};
  return {home,executable,config,options,session:new AssistantSession(options)};
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
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
