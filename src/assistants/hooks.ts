import { MEMORY_PROTOCOL } from '../memory-protocol';
import type { ClientId } from './catalog';

const RECOVERY = 'After compaction or resuming, call memory_current_project and memory_search to recover durable project context. Preserve the user’s instructions; save only curated durable value.';
export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function hookConfiguration(client: ClientId, executable: string): Record<string, unknown> {
  if(client === 'opencode') return {};
  const command = `${shellQuote(executable)} memory-hook --client ${client}`;
  if(client === 'cursor') return {sessionStart:[{command,timeout:3}]};
  const events = client === 'gemini-cli' ? ['SessionStart','BeforeAgent'] : ['SessionStart','UserPromptSubmit'];
  return Object.fromEntries(events.map(event=>[event,[{hooks:[{
    type:'command', ...(client === 'gemini-cli' ? {name:'forge614-engram'} : {}), command,timeout:client === 'gemini-cli' ? 3000 : 3,
  }]}]]));
}
export function createOpenCodePlugin(): string {
  return `// Owned by Forge614 Engram. Embedded protocol; no runtime dependencies.\nconst protocol = ${JSON.stringify(MEMORY_PROTOCOL)};\nconst recovery = ${JSON.stringify(RECOVERY)};\nexport default async function Forge614Engram() {\n  return {\n    "experimental.chat.system.transform": async (_input, output) => {\n      if (!Array.isArray(output.system)) return;\n      if (output.system.some(entry => typeof entry === "string" && entry.includes(protocol))) return;\n      if (output.system.length === 0) output.system.push(protocol);\n      else if (typeof output.system[0] === "string") output.system[0] += "\\n\\n" + protocol;\n    },\n    "experimental.session.compacting": async (_input, output) => {\n      if (Array.isArray(output.context) && !output.context.includes(recovery)) output.context.push(recovery);\n    },\n  };\n}\n`;
}
function response(client: ClientId, text: string): object {
  try {
    const input = JSON.parse(text); const event = input?.hook_event_name;
    const allowed = client === 'cursor' ? ['sessionStart'] : client === 'gemini-cli' ? ['SessionStart','BeforeAgent'] : client === 'opencode' ? [] : ['SessionStart','UserPromptSubmit'];
    if(!allowed.includes(event)) return {};
    const context = MEMORY_PROTOCOL + (event === 'SessionStart' || event === 'sessionStart' ? '\n\n' + RECOVERY : '');
    if(client === 'cursor') return {additional_context:context};
    return {hookSpecificOutput:{...(client === 'gemini-cli' ? {} : {hookEventName:event}),additionalContext:context}};
  } catch { return {}; }
}
export async function runMemoryHook(client: ClientId): Promise<void> {
  const input = await new Promise<string|null>(resolve=>{
    let bytes = 0; const chunks:Buffer[]=[]; let finished=false;
    const done = (value:string|null) => {
      if(finished)return;finished=true;clearTimeout(timer);
      process.stdin.removeListener('data',data);process.stdin.removeListener('end',end);process.stdin.removeListener('error',error);process.stdin.pause();resolve(value);
    };
    const data=(chunk:Buffer|string)=>{const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>65536)done(null);else chunks.push(buffer);};
    const end=()=>done(Buffer.concat(chunks).toString('utf8')); const error=()=>done(null);
    const timer=setTimeout(()=>done(null),2000);
    process.stdin.on('data',data);process.stdin.once('end',end);process.stdin.once('error',error);process.stdin.resume();
  });
  process.stdout.write(JSON.stringify(input === null ? {} : response(client,input))+'\n');
}
