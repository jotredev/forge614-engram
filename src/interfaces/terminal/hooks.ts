import { MEMORY_PROTOCOL, RECOVERY } from '../../modules/assistants';
import type { ClientId } from '../../modules/assistants';

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
