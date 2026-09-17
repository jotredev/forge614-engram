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
function preview(session:AssistantSession){session.key('enter');session.key('space');session.key('enter');}
test('Escape backs out and Ctrl+C before confirmation leaves a new workspace absent',()=>{
  const {config,home,session}=fixture();preview(session);session.key('enter');session.key('escape');
  expect(session.state.page).toBe('preview');session.key('escape');expect(session.state.page).toBe('clients');
  session.key('cancel');expect(session.state.cancelled).toBe(true);
  expect(existsSync(config.root)).toBe(false);expect(existsSync(join(home,'.claude.json'))).toBe(false);
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
