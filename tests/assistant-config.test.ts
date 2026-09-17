import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, symlinkSync, chmodSync, rmSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJson } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { planAssistantConfiguration, applyAssistantConfiguration, preflightAssistantConfiguration } from '../src/assistants/configuration';
import { detectAssistants, type AssistantOptions, type ClientId } from '../src/assistants/catalog';
import { createOpenCodePlugin } from '../src/assistants/hooks';

const roots: string[] = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'engram-adapter-')); roots.push(home);
  const executable = join(home, "engram's binary;$x"); writeFileSync(executable, '#!/bin/sh\nexit 0\n', {mode:0o700});
  const options: AssistantOptions = { home, env: {}, path: '', platform:'linux' };
  return {home,executable,options};
}
afterEach(() => { for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

test.each(['changed','unsafe'])('post-publication %s interference retains backups and reports published but unverified', interference=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.cursor'));
  const path=join(home,'.cursor/mcp.json'),original='{"secret":"ORIGINAL_PRIVATE"}\n';writeFileSync(path,original);
  const external=join(home,'external');writeFileSync(external,'EXTERNAL_PRIVATE');
  const plan=planAssistantConfiguration('cursor',executable,options);
  const result=applyAssistantConfiguration(plan,{rename(from,to){
    renameSync(from,to);
    if(interference==='changed')writeFileSync(to,'EXTERNAL_PRIVATE');
    else{unlinkSync(to);symlinkSync(external,to);}
  }});
  expect(result).toMatchObject({ok:false,appliedPaths:[path],unverifiedPaths:[path],error:{code:'PUBLISHED_UNVERIFIED'}});
  expect(result.backupPaths).toHaveLength(1);
  expect(readFileSync(result.backupPaths[0]!,'utf8')).toBe(original);
  expect(readFileSync(path,'utf8')).toBe('EXTERNAL_PRIVATE');
  expect(existsSync(join(home,'.cursor/hooks.json'))).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('public preflight rejects stale previews without creating any planned files', () => {
  const {home,executable,options}=fixture();
  const plan=planAssistantConfiguration('cursor',executable,options);
  preflightAssistantConfiguration(plan);
  expect(existsSync(join(home,'.cursor'))).toBe(false);
  mkdirSync(join(home,'.cursor'));writeFileSync(join(home,'.cursor/mcp.json'),'{}');
  expect(()=>preflightAssistantConfiguration(plan)).toThrow('changed after preview');
  expect(existsSync(join(home,'.cursor/hooks.json'))).toBe(false);
});

test('public preflight observes unchanged Codex config so newly disabled hooks cannot evade the preview',()=>{
  const {home,executable,options}=fixture();
  expect(applyAssistantConfiguration(planAssistantConfiguration('codex',executable,options)).ok).toBe(true);
  const plan=planAssistantConfiguration('codex',executable,options);expect(plan.writes).toHaveLength(0);
  const path=join(home,'.codex/config.toml');
  writeFileSync(path,readFileSync(path,'utf8')+'\n[features]\nhooks = false\n');
  expect(()=>preflightAssistantConfiguration(plan)).toThrow('changed after preview');
  expect(applyAssistantConfiguration(plan)).toMatchObject({ok:false,error:{code:'CHANGED'}});
});

test('preview never creates directories or exposes config secrets; apply preserves comments and exact backup', () => {
  const {home,executable,options} = fixture();
  mkdirSync(join(home,'.gemini'));
  const path = join(home,'.gemini/settings.json');
  const original = '{\n // retain this comment\n "apiKey": "SECRET_SENTINEL", "theme":"dark"\n}\n';
  writeFileSync(path,original);
  const before = readdirSync(home);
  const plan = planAssistantConfiguration('gemini-cli',executable,options);
  expect(readdirSync(home)).toEqual(before);
  expect(readFileSync(path,'utf8')).toBe(original);
  expect(JSON.stringify(plan)).not.toContain('SECRET_SENTINEL');
  expect(Object.isFrozen(plan)).toBe(true);
  expect(plan.writes[0]!.expectedHash).toMatch(/^[a-f0-9]{64}$/);
  const result = applyAssistantConfiguration(plan);
  expect(result.ok).toBe(true);
  expect(readFileSync(result.backupPaths[0]!,'utf8')).toBe(original);
  expect(statSync(result.backupPaths[0]!).mode & 0o777).toBe(0o600);
  expect(readFileSync(path,'utf8')).toContain('// retain this comment');
  expect(readFileSync(path,'utf8')).toContain('SECRET_SENTINEL');
  expect(planAssistantConfiguration('gemini-cli',executable,options).writes).toHaveLength(0);
});

test.each(['claude-code','codex','cursor','opencode','gemini-cli'] as ClientId[])('%s configures an empty home privately and repeats as no-op', id => {
  const {home,executable,options} = fixture();
  const before = readdirSync(home);
  const plan = planAssistantConfiguration(id,executable,options);
  expect(readdirSync(home)).toEqual(before);
  expect(plan.writes.length).toBeGreaterThan(0);
  const result = applyAssistantConfiguration(plan);
  expect(result.ok).toBe(true);
  for(const path of result.appliedPaths) expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(planAssistantConfiguration(id,executable,options).writes).toHaveLength(0);
});

test.each(['{"mcpServers":{"forge614-engram":{"command":"other"}}}', '{"x":1,"x":2}', '{"secret":"DO_NOT_LEAK",BROKEN}'])('rejects conflicting, duplicate and malformed configs without exposing contents', content => {
  const {home,executable,options} = fixture(); mkdirSync(join(home,'.cursor'));
  writeFileSync(join(home,'.cursor/mcp.json'),content);
  try { planAssistantConfiguration('cursor',executable,options); throw new Error('unexpected success'); }
  catch(error) { expect(String(error)).not.toContain('DO_NOT_LEAK'); expect(String(error)).not.toContain('unexpected success'); }
  expect(readFileSync(join(home,'.cursor/mcp.json'),'utf8')).toBe(content);
});

test('rejects changed bytes, symlink traversal and oversized files', () => {
  const {home,executable,options} = fixture();
  const plan = planAssistantConfiguration('cursor',executable,options);
  mkdirSync(join(home,'.cursor')); writeFileSync(join(home,'.cursor/mcp.json'),'{}');
  const result = applyAssistantConfiguration(plan);
  expect(result.ok).toBe(false); expect(result.appliedPaths).toHaveLength(0);
  const outside = join(home,'outside'); mkdirSync(outside); symlinkSync(outside,join(home,'.gemini'));
  expect(() => planAssistantConfiguration('gemini-cli',executable,options)).toThrow();
  writeFileSync(join(home,'.cursor/mcp.json'),' '.repeat(1024*1024+1));
  expect(() => planAssistantConfiguration('cursor',executable,options)).toThrow();
});

test('TOML preserves unrelated semantics and comments and refuses inline hooks and duplicate tables', () => {
  const {home,executable,options} = fixture(); mkdirSync(join(home,'.codex'));
  const path=join(home,'.codex/config.toml'); const original='# keep\nmodel = "test-model"\n[features]\nx = true\n';
  writeFileSync(path,original);
  expect(applyAssistantConfiguration(planAssistantConfiguration('codex',executable,options)).ok).toBe(true);
  expect(readFileSync(path,'utf8')).toStartWith(original);
  writeFileSync(path,'[hooks]\nSessionStart = []\n');
  expect(() => planAssistantConfiguration('codex',executable,options)).toThrow();
  writeFileSync(path,'[features]\nx=true\n[features]\nx=false');
  expect(() => planAssistantConfiguration('codex',executable,options)).toThrow();
});

test('policy restrictions remain intact and block installation', () => {
  const {home,executable,options} = fixture(); mkdirSync(join(home,'.gemini'));
  for(const content of ['{"disableAllHooks":true}', '{"mcp":{"excluded":["forge614-engram"]}}', '{"mcp":{"allowed":["other"]}}']) {
    writeFileSync(join(home,'.gemini/settings.json'),content);
    expect(() => planAssistantConfiguration('gemini-cli',executable,options)).toThrow();
    expect(readFileSync(join(home,'.gemini/settings.json'),'utf8')).toBe(content);
  }
});

test('detection distinguishes stale configs and rescans executables without starting them', () => {
  const {home,options} = fixture(); mkdirSync(join(home,'.cursor'));
  const bin=join(home,'bin');mkdirSync(bin);options.path=bin;
  const first=detectAssistants(options);
  expect(first.map(x=>x.id)).toEqual(['claude-code','codex','cursor','opencode','gemini-cli']);
  expect(first[2]!.detected.installed).toBe(false);
  expect(first[2]!.detected.configFound).toBe(true);
  writeFileSync(join(bin,'cursor'),'#!/bin/sh\ntouch SHOULD_NOT_EXIST\n');chmodSync(join(bin,'cursor'),0o700);
  expect(detectAssistants(options)[2]!.detected.installed).toBe(true);
  expect(existsSync(join(home,'SHOULD_NOT_EXIST'))).toBe(false);
});

test('custom directories and documented home overrides are honored; ambiguous OpenCode is refused', () => {
  const {home,executable,options} = fixture();
  options.env={CODEX_HOME:join(home,'custom-codex'),XDG_CONFIG_HOME:join(home,'xdg')};
  expect(planAssistantConfiguration('codex',executable,options).writes[0]!.path).toBe(join(home,'custom-codex/config.toml'));
  mkdirSync(join(home,'xdg/opencode'),{recursive:true});
  writeFileSync(join(home,'xdg/opencode/opencode.json'),'{}');writeFileSync(join(home,'xdg/opencode/opencode.jsonc'),'{}');
  expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  options.locations={opencode:{configFile:join(home,'xdg/opencode/opencode.jsonc')}};
  expect(planAssistantConfiguration('opencode',executable,options).writes[0]!.path).toEndWith('opencode.jsonc');
});

test('nested MCP and hook comments survive insertion beside unrelated entries',()=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.gemini'));
  const path=join(home,'.gemini/settings.json');
  writeFileSync(path,'{ "mcpServers": { /* other server annotation */ "other": {"command":"keep"}}, "hooks": { "SessionStart": [/* keep native hook comment */ {"hooks":[{"type":"command","command":"echo keep"}]}] } }');
  expect(applyAssistantConfiguration(planAssistantConfiguration('gemini-cli',executable,options)).ok).toBe(true);
  const actual=readFileSync(path,'utf8');expect(actual).toContain('/* other server annotation */');expect(actual).toContain('/* keep native hook comment */');
});

test('partial failure reports applied files and retains their exact backups',()=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.claude'));
  const path=join(home,'.claude.json');writeFileSync(path,'{"keep":true}\n');
  const plan=planAssistantConfiguration('claude-code',executable,options);
  chmodSync(join(home,'.claude'),0o500);
  try{
    const result=applyAssistantConfiguration(plan);expect(result.ok).toBe(false);expect(result.appliedPaths).toEqual([path]);
    expect(result.backupPaths).toHaveLength(1);expect(readFileSync(result.backupPaths[0]!,'utf8')).toBe('{"keep":true}\n');
  }finally{chmodSync(join(home,'.claude'),0o700);}
});

test.each([
 ['gemini-cli','settings.json','{"hooksConfig":{"enabled":false}}'],
 ['codex','config.toml','[features]\nhooks = false\n'],
 ['codex','config.toml','[features]\ncodex_hooks = false\n'],
 ['codex','config.toml','allow_managed_hooks_only = true\n'],
] as const)('%s preserves native hook disable policy', (id,file,content)=>{
  const {home,executable,options}=fixture();const directory=join(home,id==='codex'?'.codex':'.gemini');mkdirSync(directory);writeFileSync(join(directory,file),content);
  expect(()=>planAssistantConfiguration(id,executable,options)).toThrow();expect(readFileSync(join(directory,file),'utf8')).toBe(content);
});

test('an existing owned hook on an unsupported event is a conflict',()=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.claude'));
  writeFileSync(join(home,'.claude/settings.json'),'{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/old/forge614-engram memory-hook --client claude-code"}]}]}}');
  expect(()=>planAssistantConfiguration('claude-code',executable,options)).toThrow();
});

test.each(['claude-code','codex','cursor','opencode','gemini-cli'] as ClientId[])('%s writes the documented native MCP and hook structure',id=>{
  const {home,executable,options}=fixture();const result=applyAssistantConfiguration(planAssistantConfiguration(id,executable,options));expect(result.ok).toBe(true);
  const value=id==='codex'?parseToml(readFileSync(join(home,'.codex/config.toml'),'utf8')):parseJson(readFileSync(result.appliedPaths[0]!,'utf8'));
  if(id==='opencode')expect(value.mcp['forge614-engram']).toEqual({type:'local',command:[executable,'mcp']});
  else expect(value[id==='codex'?'mcp_servers':'mcpServers']['forge614-engram']).toEqual({command:executable,args:['mcp']});
  if(id==='opencode')return;
  const native=id==='gemini-cli'?value:parseJson(readFileSync(result.appliedPaths[1]!,'utf8'));
  if(id==='cursor'){expect(native.version).toBe(1);expect(Object.keys(native.hooks)).toEqual(['sessionStart']);expect(native.hooks.sessionStart[0].timeout).toBe(3);}
  else {expect(Object.keys(native.hooks)).toEqual(id==='gemini-cli'?['SessionStart','BeforeAgent']:['SessionStart','UserPromptSubmit']);expect(native.hooks.SessionStart[0].hooks[0].type).toBe('command');}
});

test('file symlinks, directories masquerading as files, and nonexecutable overrides are refused',()=>{
  const {home,executable,options}=fixture();mkdirSync(join(home,'.cursor'));const path=join(home,'.cursor/mcp.json');
  symlinkSync(executable,path);expect(()=>planAssistantConfiguration('cursor',executable,options)).toThrow();
  options.locations={'gemini-cli':{configFile:join(home,'.cursor')}};expect(()=>planAssistantConfiguration('gemini-cli',executable,options)).toThrow();
  options.locations={cursor:{executable:join(home,'absent')}};expect(detectAssistants(options)[2]!.configuration.status).toBe('blocked');
  expect(()=>planAssistantConfiguration('codex','relative',options)).toThrow();
});

test('OpenCode runtime override is visible without exposing its contents',()=>{
  const {executable,options}=fixture();options.env={OPENCODE_CONFIG_CONTENT:'{"secret":"DO_NOT_LEAK"}'};
  const plan=planAssistantConfiguration('opencode',executable,options);expect(plan.warnings.join(' ')).toContain('OPENCODE_CONFIG_CONTENT');expect(JSON.stringify(plan)).not.toContain('DO_NOT_LEAK');
});

test('OpenCode custom file retains global plugin location and reports multiple active config sources',()=>{
  const {home,executable,options}=fixture();const global=join(home,'.config/opencode');mkdirSync(global,{recursive:true});
  const custom=join(home,'custom.json');options.env={OPENCODE_CONFIG:custom};
  const plan=planAssistantConfiguration('opencode',executable,options);expect(plan.writes.find(x=>x.kind==='plugin')!.path).toBe(join(global,'plugins/forge614-engram.js'));
  writeFileSync(join(global,'opencode.json'),'{}');expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  options.locations={opencode:{configFile:custom}};expect(planAssistantConfiguration('opencode',executable,options).writes[0]!.path).toBe(custom);
});

test('Gemini documented home override replaces the home before appending .gemini',()=>{
  const {home,executable,options}=fixture();options.env={GEMINI_CLI_HOME:join(home,'gemini-home')};
  expect(planAssistantConfiguration('gemini-cli',executable,options).writes[0]!.path).toBe(join(home,'gemini-home/.gemini/settings.json'));
  options.env={GEMINI_CLI_HOME:'relative'};expect(()=>planAssistantConfiguration('gemini-cli',executable,options)).toThrow();
});

test('OpenCode custom directory cannot silently override an active default global entry',()=>{
  const {home,executable,options}=fixture();const global=join(home,'xdg/opencode'),custom=join(home,'custom-opencode');
  mkdirSync(global,{recursive:true});const path=join(global,'opencode.json');const original='{"mcp":{"forge614-engram":{"type":"local","command":["/existing/engram","mcp"]}}}';writeFileSync(path,original);
  options.env={XDG_CONFIG_HOME:join(home,'xdg'),OPENCODE_CONFIG_DIR:custom};
  expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  options.locations={opencode:{configFile:join(custom,'opencode.json')}};
  expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  expect(readFileSync(path,'utf8')).toBe(original);expect(existsSync(custom)).toBe(false);
});

test('OpenCode requires explicit selection across default and custom configs, then preserves unrelated active source',()=>{
  const {home,executable,options}=fixture();const global=join(home,'.config/opencode'),custom=join(home,'custom-opencode');
  mkdirSync(global,{recursive:true});mkdirSync(custom);writeFileSync(join(global,'opencode.jsonc'),'{/* global */"theme":"keep"}');writeFileSync(join(custom,'opencode.json'),'{}');
  options.env={OPENCODE_CONFIG_DIR:custom};expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  options.locations={opencode:{configFile:join(custom,'opencode.json')}};
  expect(applyAssistantConfiguration(planAssistantConfiguration('opencode',executable,options)).ok).toBe(true);
  expect(readFileSync(join(global,'opencode.jsonc'),'utf8')).toBe('{/* global */"theme":"keep"}');
});

test('OpenCode reuses the single matching global plugin instead of creating another in the custom directory',()=>{
  const {home,executable,options}=fixture();const global=join(home,'.config/opencode'),custom=join(home,'custom-opencode');
  mkdirSync(join(global,'plugins'),{recursive:true});const plugin=join(global,'plugins/forge614-engram.js');writeFileSync(plugin,createOpenCodePlugin());
  options.env={OPENCODE_CONFIG_DIR:custom};const plan=planAssistantConfiguration('opencode',executable,options);
  expect(plan.writes.some(x=>x.kind==='plugin')).toBe(false);expect(applyAssistantConfiguration(plan).ok).toBe(true);
  expect(existsSync(join(custom,'plugins/forge614-engram.js'))).toBe(false);expect(readFileSync(plugin,'utf8')).toBe(createOpenCodePlugin());
});

test('OpenCode refuses conflicting and duplicate owned plugins across active personal directories',()=>{
  const {home,executable,options}=fixture();const global=join(home,'.config/opencode'),custom=join(home,'custom-opencode');
  mkdirSync(join(global,'plugins'),{recursive:true});const plugin=join(global,'plugins/forge614-engram.js');writeFileSync(plugin,'// existing owned plugin');
  options.env={OPENCODE_CONFIG_DIR:custom};options.locations={opencode:{configFile:join(custom,'opencode.json')}};
  expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
  writeFileSync(plugin,createOpenCodePlugin());mkdirSync(join(custom,'plugins'),{recursive:true});writeFileSync(join(custom,'plugins/forge614-engram.js'),createOpenCodePlugin());
  expect(()=>planAssistantConfiguration('opencode',executable,options)).toThrow();
});

test('OpenCode rechecks an unmodified active source before applying its selected config',()=>{
  const {home,executable,options}=fixture();const global=join(home,'.config/opencode'),custom=join(home,'custom-opencode');
  mkdirSync(global,{recursive:true});const path=join(global,'opencode.json');writeFileSync(path,'{}');
  options.env={OPENCODE_CONFIG_DIR:custom};options.locations={opencode:{configFile:join(custom,'opencode.json')}};
  const plan=planAssistantConfiguration('opencode',executable,options);writeFileSync(path,'{"mcp":{"forge614-engram":false}}');
  const result=applyAssistantConfiguration(plan);expect(result.ok).toBe(false);expect(result.error?.code).toBe('CHANGED');expect(result.appliedPaths).toEqual([]);expect(existsSync(custom)).toBe(false);
});
