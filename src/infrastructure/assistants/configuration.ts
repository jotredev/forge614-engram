import { accessSync, constants, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { applyEdits, modify, parseTree, getNodeValue, type Node, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { coverageWarnings, resolveAssistantPaths, type AssistantOptions, type ClientId } from './catalog';
import { createOpenCodePlugin, hookConfiguration } from '../../modules/assistants';
import { AssistantConfigurationError, fail, guardedWrite, hash, MAX_CONFIG_BYTES, readSafeFile, validPath, type PrivateWrite, type ConfigurationFileIO } from '../filesystem/private-files';
export { AssistantConfigurationError } from '../filesystem/private-files';

const NAME='forge614-engram';
type ObjectValue=Record<string,any>;
function object(value:unknown):value is ObjectValue{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function json(text:string):ObjectValue {
  const errors:ParseError[]=[];const tree=parseTree(text,errors,{allowTrailingComma:true,disallowComments:false});
  if(!tree||tree.type!=='object'||errors.length)fail('MALFORMED','Configuration contains invalid JSON/JSONC. Fix it before configuring the assistant.');
  function duplicates(node:Node){
    if(node.type==='object'){
      const keys=new Set<string>();for(const property of node.children??[]){const key=property.children?.[0]?.value;if(keys.has(key))fail('MALFORMED','Configuration contains duplicate JSON keys.');keys.add(key);}
    }
    for(const child of node.children??[])duplicates(child);
  }
  duplicates(tree);return getNodeValue(tree);
}
function toml(text:string):ObjectValue{try{return parseToml(text);}catch{fail('MALFORMED','Configuration contains invalid or duplicate TOML definitions.');}}
function checkPolicies(value:ObjectValue,id:ClientId):void{
  if(value.disableAllHooks===true||value.hooksConfig?.enabled===false||value.allow_managed_hooks_only===true||value.features?.hooks===false||value.features?.codex_hooks===false)
    fail('POLICY_BLOCKED','Personal hooks are disabled or restricted by existing settings. Review that policy in the client.');
  if(value.hooks?.disabled?.includes?.(NAME))fail('POLICY_BLOCKED','The existing settings disable the Engram hook.');
  const excluded=value.mcp?.excluded,allowed=value.mcp?.allowed;
  if(Array.isArray(excluded)&&excluded.includes(NAME)||Array.isArray(allowed)&&!allowed.includes(NAME))fail('POLICY_BLOCKED','Existing MCP exclusions or allowlists prevent this server. Review the policy in the client.');
  if(value.enableAllProjectMcpServers===false&&id==='claude-code'){/* Personal scope does not alter project policy. */}
  for(const key of ['allowedMcpServers','deniedMcpServers'])if(Array.isArray(value[key])){
    const names=value[key].map((entry:any)=>typeof entry==='string'?entry:entry?.serverName);
    if(key==='allowedMcpServers'?!names.includes(NAME):names.includes(NAME))fail('POLICY_BLOCKED','An MCP allowlist or denylist restricts this server.');
  }
}
function addEntry(value:ObjectValue,key:string,entry:unknown):void{
  if(value[key]!==undefined&&!object(value[key]))fail('MALFORMED','The existing MCP section is not an object.');
  const existing=value[key]?.[NAME];if(existing!==undefined&&!isDeepStrictEqual(existing,entry))fail('CONFLICT','An existing Forge614 Engram MCP entry differs. Review it manually; it was not changed.');
}
function mergeHooks(value:unknown,desired:Record<string,unknown>,client:ClientId):ObjectValue{
  if(value!==undefined&&!object(value))fail('MALFORMED','The existing hooks section is not an object.');
  const output=structuredClone(value??{}) as ObjectValue;
  const owned=(hook:any)=>hook?.name===NAME||(typeof hook?.command==='string'&&(/\bmemory-hook\b/.test(hook.command)||hook.command.includes(NAME)));
  for(const [event,groups] of Object.entries(output)){
    if(Object.hasOwn(desired,event)||!Array.isArray(groups))continue;
    if(groups.some(group=>(client==='cursor'?[group]:Array.isArray(group?.hooks)?group.hooks:[]).some(owned)))fail('CONFLICT','An existing Forge614 Engram hook uses an unsupported event. Review it manually.');
  }
  for(const [event,groups] of Object.entries(desired)){
    const target=(groups as any[])[0];const existing=output[event];
    if(existing!==undefined&&!Array.isArray(existing))fail('MALFORMED','A native hooks event must contain an array.');
    const candidates=existing??[];
    let found=false;
    for(const group of candidates){
      const hooks=client==='cursor'?[group]:group?.hooks;
      if(!Array.isArray(hooks))fail('MALFORMED','A native hook group has an invalid shape.');
      for(const hook of hooks){
        const own=owned(hook);
        if(!own)continue;
        const expected=client==='cursor'?target:target.hooks[0];
        if(!isDeepStrictEqual(hook,expected)||(client!=='cursor'&&Object.keys(group).some(key=>key!=='hooks'))||found)fail('CONFLICT','An existing Forge614 Engram hook differs or is duplicated. Review it manually.');
        found=true;
      }
    }
    if(!found)output[event]=[...candidates,target];
  }
  return output;
}
export interface ConfigurationPlan {
  readonly client:ClientId;readonly executable:string;
  readonly writes:readonly Readonly<{path:string;kind:'config'|'hooks'|'plugin';expectedHash:string|null}>[];
  readonly warnings:readonly string[];
}
const contents=new WeakMap<ConfigurationPlan,{writes:readonly PrivateWrite[];guards:readonly {path:string;before:string|null}[]}>();
export function planAssistantConfiguration(client:ClientId,executable:string,options:AssistantOptions={}):ConfigurationPlan{
  try{return buildPlan(client,executable,options);}catch(error){if(error instanceof AssistantConfigurationError)throw error;fail('IO_ERROR','Could not safely read or plan assistant configuration. Check paths and permissions.');}
}
function buildPlan(client:ClientId,executable:string,options:AssistantOptions):ConfigurationPlan{
  executable=validPath(executable);try{accessSync(executable,constants.X_OK);if(!statSync(executable).isFile())throw new Error();}catch{fail('INVALID_EXECUTABLE','The Engram executable must be an existing executable file.');}
  const paths=resolveAssistantPaths(client,options),writes:PrivateWrite[]=[];
  const observed=new Map<string,string|null>();
  function inspect(path:string){const before=readSafeFile(path);observed.set(path,before);return before;}
  function add(path:string,before:string|null,after:string,kind:PrivateWrite['kind']){if(Buffer.byteLength(after)>MAX_CONFIG_BYTES)fail('FILE_TOO_LARGE','The planned configuration exceeds the 1 MiB limit.');if(before!==after)writes.push({path,before,after,kind});}
  function editJson(path:string,kind:PrivateWrite['kind'],change:(value:ObjectValue)=>[string,unknown][]) {
    const before=inspect(path);let after=before??'{}\n';const value=json(after);checkPolicies(value,client);
    function edit(keys:(string|number)[],previous:unknown,next:unknown):void{
      if(isDeepStrictEqual(previous,next))return;
      if(object(previous)&&object(next)){
        for(const [key,child] of Object.entries(next))edit([...keys,key],previous[key],child);
      }else if(Array.isArray(previous)&&Array.isArray(next)&&previous.every((item,index)=>isDeepStrictEqual(item,next[index]))){
        for(let index=previous.length;index<next.length;index++)after=applyEdits(after,modify(after,[...keys,-1],next[index],{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));
      }else after=applyEdits(after,modify(after,keys,next,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}));
    }
    for(const [key,data] of change(value))edit([key],value[key],data);
    json(after);add(path,before,after,kind);
  }
  const entry=client==='opencode'?{type:'local',command:[executable,'mcp']}:{command:executable,args:['mcp']};
  const desiredHooks=hookConfiguration(client,executable);
  if(client==='opencode'){
    for(const path of paths.activeConfigs){
      if(path===paths.config)continue;
      const before=inspect(path);if(before===null)continue;
      const value=json(before);checkPolicies(value,client);addEntry(value,'mcp',entry);
    }
    let pluginCount=0;
    for(const path of paths.activePlugins){
      const before=inspect(path);if(before===null)continue;pluginCount++;
      if(before!==createOpenCodePlugin())fail('CONFLICT','An existing Engram plugin in an active OpenCode directory differs. Review it manually.');
    }
    if(pluginCount>1)fail('CONFLICT','Multiple active OpenCode directories contain the Engram plugin. Resolve duplicate ownership before configuring it.');
  }
  if(client==='codex'){
    const before=inspect(paths.config),value=toml(before??'');checkPolicies(value,client);
    if(value.hooks!==undefined)fail('POLICY_BLOCKED','Codex already uses inline hooks. Review that source before adding hooks.json; no duplicate source was created.');
    addEntry(value,'mcp_servers',entry);
    let after=before??'';
    if(value.mcp_servers?.[NAME]===undefined){
      after+=(after.endsWith('\n')||after===''?'':'\n')+`\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(executable)}\nargs = ["mcp"]\n`;
      const parsed=toml(after),expected=structuredClone(value);expected.mcp_servers={...(expected.mcp_servers??{}),[NAME]:entry};
      if(!isDeepStrictEqual(parsed,expected))fail('CONFLICT','The MCP table cannot be safely appended without altering existing TOML semantics.');
    }
    add(paths.config,before,after,'config');
  }else editJson(paths.config,'config',value=>{
    const key=client==='opencode'?'mcp':'mcpServers';addEntry(value,key,entry);
    return [[key,{...(value[key]??{}),[NAME]:entry}],...(client==='gemini-cli'?[['hooks',mergeHooks(value.hooks,desiredHooks,client)] as [string,unknown]]:[])];
  });
  if(client==='opencode'){
    const before=inspect(paths.plugin),after=createOpenCodePlugin();
    if(before!==null&&before!==after)fail('CONFLICT','The dedicated Engram plugin already exists with different contents. Review it manually.');add(paths.plugin,before,after,'plugin');
  }else if(client!=='gemini-cli')editJson(paths.hooks,'hooks',value=>{
    if(client==='cursor'&&value.version!==undefined&&value.version!==1)fail('CONFLICT','Cursor hooks use an unsupported version.');
    return [...(client==='cursor'?[['version',1] as [string,unknown]]:[]),['hooks',mergeHooks(value.hooks,desiredHooks,client)]];
  });
  const plan:ConfigurationPlan=Object.freeze({client,executable,writes:Object.freeze(writes.map(write=>Object.freeze({path:write.path,kind:write.kind,expectedHash:hash(write.before)}))),warnings:Object.freeze(coverageWarnings(client,options))});
  const written=new Set(writes.map(write=>write.path));
  contents.set(plan,{writes,guards:[...observed].filter(([path])=>!written.has(path)).map(([path,before])=>({path,before}))});return plan;
}
/** appliedPaths includes every publication; unverifiedPaths is its unsafe/mismatched subset. */
export interface ConfigurationResult {ok:boolean;appliedPaths:string[];unverifiedPaths:string[];backupPaths:string[];error?:{code:string;message:string};}
/** Read-only validation for a batch caller before explicit workspace enrollment. */
export function preflightAssistantConfiguration(plan:ConfigurationPlan):void{
  try{
    const state=contents.get(plan);if(!state)fail('INVALID_PLAN','Use the original configuration preview object to apply changes.');
    for(const guard of state.guards)if(readSafeFile(guard.path)!==guard.before)fail('CHANGED','An active personal configuration source changed after preview. Preview again before applying.');
    for(const write of state.writes)if(readSafeFile(write.path)!==write.before)fail('CHANGED','Configuration changed after preview. Preview again before applying.');
  }catch(error){if(error instanceof AssistantConfigurationError)throw error;fail('IO_ERROR','Could not safely validate configuration. Preview again after checking paths and permissions.');}
}
export function applyAssistantConfiguration(plan:ConfigurationPlan,io?:ConfigurationFileIO):ConfigurationResult{
  const result:ConfigurationResult={ok:false,appliedPaths:[],unverifiedPaths:[],backupPaths:[]};
  try{
    const state=contents.get(plan);if(!state)fail('INVALID_PLAN','Use the original configuration preview object to apply changes.');
    const {writes,guards}=state;
    const checkGuards=()=>{for(const guard of guards)if(readSafeFile(guard.path)!==guard.before)fail('CHANGED','An active personal configuration source changed after preview. Preview again before applying.');};
    // Preflight all files first; each replacement then checks again immediately before rename.
    preflightAssistantConfiguration(plan);
    for(const write of writes){
      checkGuards();
      try{guardedWrite(write,path=>result.backupPaths.push(path),path=>result.appliedPaths.push(path),io);}
      catch(error){if(error instanceof AssistantConfigurationError&&error.code==='PUBLISHED_UNVERIFIED')result.unverifiedPaths.push(write.path);throw error;}
    }
    result.ok=true;
  }catch(error){result.error=error instanceof AssistantConfigurationError?{code:error.code,message:error.message}:{code:'IO_ERROR',message:'Could not safely apply all configuration files. Applied files and retained backups are listed; review them before retrying.'};}
  return result;
}
