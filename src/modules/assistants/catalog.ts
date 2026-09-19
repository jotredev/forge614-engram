export const CLIENT_IDS=["claude-code","codex","cursor","opencode","antigravity"] as const;
export type ClientId=typeof CLIENT_IDS[number];
export interface AssistantLocation{configDir?:string;configFile?:string;executable?:string}
export interface AssistantOptions{home?:string;env?:Record<string,string|undefined>;path?:string;platform?:NodeJS.Platform;locations?:Partial<Record<ClientId,AssistantLocation>>;engramExecutable?:string}
export const LABELS:Record<ClientId,string>={"claude-code":"Claude Code",codex:"Codex",cursor:"Cursor",opencode:"OpenCode",antigravity:"Antigravity"};
export function isClientId(value:string):value is ClientId{return (CLIENT_IDS as readonly string[]).includes(value);}
export function coverageWarnings(id:ClientId,options:AssistantOptions={}):string[]{return[
  "Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save.",
  ...(id==="codex"?["Review and trust new hooks in Codex /hooks before they can run."]:[]),
  ...(id==="cursor"?["Cursor injects memory guidance at sessionStart only; there is no verified prompt or compaction recovery hook."]:[]),
  ...(id==="opencode"?["OpenCode system and compaction callbacks are experimental upstream."]:[]),
  ...(id==="antigravity"?["Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified."]:[]),
  ...(id==="opencode"&&(options.env??{}).OPENCODE_CONFIG_CONTENT?["OPENCODE_CONFIG_CONTENT is set and may override personal configuration at runtime."]:[]),
  ...(id==="opencode"&&((options.env??{}).OPENCODE_CONFIG||(options.env??{}).OPENCODE_CONFIG_DIR||options.locations?.opencode?.configFile)?["OpenCode can merge multiple configuration sources; the selected file and global plugin location are shown in this preview."]:[]),
  "Managed policies and runtime trust can restrict MCP or hooks; this preview does not change them.",
]}
export interface AssistantDescriptor{id:ClientId;label:string;detected:{installed:boolean;executable:string|null;configFound:boolean;evidence:string[]};configuration:{status:"absent"|"needs-configuration"|"configured"|"conflict"|"malformed"|"blocked";paths:string[];message?:string};automation:{coverage:"session-and-prompt"|"session-only"|"experimental-system-and-compaction"|"mcp-only";warnings:string[]}}
