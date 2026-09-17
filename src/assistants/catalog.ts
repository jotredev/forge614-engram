import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { AssistantConfigurationError, assertSafePath, fail, validPath } from './files';
import { planAssistantConfiguration } from './configuration';

export const CLIENT_IDS=['claude-code','codex','cursor','opencode','gemini-cli'] as const;
export type ClientId=typeof CLIENT_IDS[number];
export interface AssistantLocation { configDir?:string;configFile?:string;executable?:string; }
export interface AssistantOptions {
  home?:string;env?:Record<string,string|undefined>;path?:string;platform?:NodeJS.Platform;
  locations?:Partial<Record<ClientId,AssistantLocation>>;
  /** Installed Engram executable used when comparing existing entries. */
  engramExecutable?:string;
}
export const LABELS:Record<ClientId,string>={'claude-code':'Claude Code',codex:'Codex',cursor:'Cursor',opencode:'OpenCode','gemini-cli':'Gemini CLI'};
export function isClientId(value:string):value is ClientId{return (CLIENT_IDS as readonly string[]).includes(value);}
export function resolveAssistantPaths(id:ClientId,options:AssistantOptions={}) {
  if(!isClientId(id))fail('INVALID_CLIENT','Unknown assistant.');
  if(!['darwin','linux'].includes(options.platform??process.platform))fail('UNSUPPORTED_PLATFORM','Assistant configuration currently supports macOS and Linux.');
  const home=validPath(options.home??homedir()),env=options.env??process.env,location=options.locations?.[id];
  const defaults:Record<ClientId,string>={
    'claude-code':env.CLAUDE_CONFIG_DIR||join(home,'.claude'),codex:env.CODEX_HOME||join(home,'.codex'),cursor:join(home,'.cursor'),
    opencode:env.OPENCODE_CONFIG_DIR||join(env.XDG_CONFIG_HOME||join(home,'.config'),'opencode'),'gemini-cli':join(env.GEMINI_CLI_HOME||home,'.gemini'),
  };
  const directory=validPath(location?.configDir??defaults[id]);
  const explicit=location?.configFile??(id==='opencode'?env.OPENCODE_CONFIG:undefined);
  let config=explicit??(id==='claude-code'?(location?.configDir||env.CLAUDE_CONFIG_DIR?join(directory,'.claude.json'):join(home,'.claude.json')):
    join(directory,id==='codex'?'config.toml':id==='cursor'?'mcp.json':id==='opencode'?'opencode.json':'settings.json'));
  if(id==='opencode'&&!explicit){
    const json=join(directory,'opencode.json'),jsonc=join(directory,'opencode.jsonc');
    assertSafePath(json);assertSafePath(jsonc);
    if(existsSync(json)&&existsSync(jsonc))fail('AMBIGUOUS','Both OpenCode JSON and JSONC configs exist. Select an explicit config file.');
    if(existsSync(jsonc))config=jsonc;
  }
  let plugin=join(directory,'plugins/forge614-engram.js');
  let activeConfigs:string[]=[];let activePlugins:string[]=[];
  if(id==='opencode'){
    // OPENCODE_CONFIG_DIR adds a source; it never replaces the XDG global source.
    const globalDirectory=validPath(join(env.XDG_CONFIG_HOME||join(home,'.config'),'opencode'));
    const directories=[...new Set([globalDirectory,...(env.OPENCODE_CONFIG_DIR?[validPath(env.OPENCODE_CONFIG_DIR)]:[]),directory])];
    activeConfigs=[...new Set([...directories.flatMap(dir=>[join(dir,'opencode.json'),join(dir,'opencode.jsonc')]),...(env.OPENCODE_CONFIG?[validPath(env.OPENCODE_CONFIG)]:[]),validPath(config)])];
    activePlugins=directories.map(dir=>join(dir,'plugins/forge614-engram.js'));
    for(const path of [...activeConfigs,...activePlugins])assertSafePath(path);
    if(!location?.configFile&&activeConfigs.some(path=>path!==validPath(config)&&existsSync(path)))
      fail('AMBIGUOUS','OpenCode has another active personal config source. Select the intended config file explicitly.');
    const existingPlugins=activePlugins.filter(existsSync);
    // Reuse one existing global plugin; do not manufacture another active copy.
    if(existingPlugins.length===1)plugin=existingPlugins[0]!;
  }
  return {directory,config:validPath(config),hooks:join(directory,id==='claude-code'?'settings.json':'hooks.json'),plugin,activeConfigs,activePlugins};
}
export function coverageWarnings(id:ClientId,options:AssistantOptions={}):string[]{
  return [
    'Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save.',
    ...(id==='codex'?['Review and trust new hooks in Codex /hooks before they can run.']:[]),
    ...(id==='cursor'?['Cursor injects memory guidance at sessionStart only; there is no verified prompt or compaction recovery hook.']:[]),
    ...(id==='opencode'?['OpenCode system and compaction callbacks are experimental upstream.']:[]),
    ...(id==='gemini-cli'?['Gemini SessionStart and BeforeAgent reminders do not guarantee a post-compaction callback.']:[]),
    ...(id==='opencode'&&(options.env??process.env).OPENCODE_CONFIG_CONTENT?['OPENCODE_CONFIG_CONTENT is set and may override personal configuration at runtime.']:[]),
    ...(id==='opencode'&&((options.env??process.env).OPENCODE_CONFIG||(options.env??process.env).OPENCODE_CONFIG_DIR||options.locations?.opencode?.configFile)?['OpenCode can merge multiple configuration sources; the selected file and global plugin location are shown in this preview.']:[]),
    'Managed policies and runtime trust can restrict MCP or hooks; this preview does not change them.',
  ];
}
function executable(path:string):boolean{try{accessSync(path,constants.X_OK);return statSync(path).isFile();}catch{return false;}}
export interface AssistantDescriptor {
  id:ClientId;label:string;
  detected:{installed:boolean;executable:string|null;configFound:boolean;evidence:string[]};
  configuration:{status:'absent'|'needs-configuration'|'configured'|'conflict'|'malformed'|'blocked';paths:string[];message?:string};
  automation:{coverage:'session-and-prompt'|'session-only'|'experimental-system-and-compaction';warnings:string[]};
}
export function detectAssistants(options:AssistantOptions={}):AssistantDescriptor[]{
  const env=options.env??process.env,home=options.home??homedir(),platform=options.platform??process.platform;
  const names:Record<ClientId,string[]>={'claude-code':['claude'],codex:['codex'],cursor:['cursor'],opencode:['opencode'],'gemini-cli':['gemini']};
  return CLIENT_IDS.map(id=>{
    const warnings=coverageWarnings(id,options);const evidence:string[]=[];
    const candidates=(options.path??env.PATH??'').split(delimiter).filter(Boolean).flatMap(dir=>names[id].map(name=>join(dir,name)));
    if(id==='claude-code')candidates.push(join(home,'.local/bin/claude'));
    if(id==='opencode')candidates.push(join(home,'.opencode/bin/opencode'));
    if(platform==='darwin'&&id==='cursor')candidates.push('/Applications/Cursor.app/Contents/MacOS/Cursor',join(home,'Applications/Cursor.app/Contents/MacOS/Cursor'));
    if(platform==='darwin'&&id==='codex')candidates.push('/Applications/Codex.app/Contents/MacOS/Codex',join(home,'Applications/Codex.app/Contents/MacOS/Codex'));
    let binary:string|null=null,configFound=false;let configuration:AssistantDescriptor['configuration']={status:'absent',paths:[]};
    try{
      const custom=options.locations?.[id]?.executable;
      if(custom){validPath(custom);if(!executable(custom))fail('INVALID_EXECUTABLE','The selected assistant executable is not executable.');binary=custom;}
      else binary=candidates.find(executable)??null;
      if(binary)evidence.push('executable-found');
      const paths=resolveAssistantPaths(id,options);assertSafePath(paths.directory);
      configuration.paths=[paths.config,...(id==='opencode'?[paths.plugin]:id==='gemini-cli'?[]:[paths.hooks])];
      configFound=existsSync(paths.directory)||existsSync(paths.config);if(configFound)evidence.push('config-found');
      const plan=planAssistantConfiguration(id,options.engramExecutable??process.execPath,options);
      configuration={...configuration,status:plan.writes.length===0?'configured':configFound?'needs-configuration':'absent'};
    }catch(error){
      const code=error instanceof AssistantConfigurationError?error.code:'IO_ERROR';
      configuration={...configuration,status:code==='CONFLICT'?'conflict':code==='MALFORMED'?'malformed':'blocked',message:error instanceof AssistantConfigurationError?error.message:'Could not safely inspect configuration.'};
    }
    return {id,label:LABELS[id],detected:{installed:binary!==null,executable:binary,configFound,evidence},configuration,automation:{coverage:id==='cursor'?'session-only':id==='opencode'?'experimental-system-and-compaction':'session-and-prompt',warnings}};
  });
}
