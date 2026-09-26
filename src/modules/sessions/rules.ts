import { MemoryError } from "../../shared/errors";
import type { ParallelSession, PreviousSession, SummaryFields } from "./types";
// Hours without activity after which an open runtime session is no longer inferred for a save without sessionId (level 11).
export const INACTIVITY_HOURS = 6;
// Minutes: an open runtime session with activity this recent counts as open in parallel; older counts as left open (1.7.1, level 11).
export const PARALLEL_MINUTES = 30;
export function sessionIdentity(value:unknown):string{const length=typeof value==="string"?Array.from(value).length:0;if(typeof value!=="string"||length<1||length>200||value.trim()!==value||/[\p{Cc}\p{Cf}]/u.test(value))throw new MemoryError("INVALID_INPUT","sessionId debe tener entre 1 y 200 caracteres, sin controles ni espacios exteriores.");return value;}
function textField(value:unknown,field:string,nonblank=false):string{if(typeof value!=="string"||value.includes("\0")||(nonblank&&!value.trim()))throw new MemoryError("INVALID_INPUT",`${field} debe ser texto${nonblank?" no vacío":""}.`);return value;}
// A readable fact for the assistant, derived from `previous`/`parallel` (1.7.2): data, never an order.
export function sessionNotice(previous?:PreviousSession|null,parallel?:ParallelSession[]|null):string|null{
  const parts:string[]=[];
  if(previous) parts.push(`Session ${previous.sessionId} was left open; its last activity was at ${previous.interruptedAt}; ${previous.summary?"its summary is available.":"it saved no summary."}`);
  if(parallel&&parallel.length===1) parts.push(`Another session is open now: ${parallel[0]!.sessionId}.`);
  else if(parallel&&parallel.length>1) parts.push(`Other sessions are open now: ${parallel.map(session=>session.sessionId).join(", ")}.`);
  return parts.length?parts.join(" "):null;
}
export function summaryContent(fields:SummaryFields):string{if(!fields||typeof fields!=="object")throw new MemoryError("INVALID_INPUT","El resumen debe ser estructurado.");const goal=textField(fields.goal,"goal",true),instructions=textField(fields.instructions,"instructions"),discoveries=textField(fields.discoveries,"discoveries"),accomplishments=textField(fields.accomplishments,"accomplishments"),nextSteps=textField(fields.nextSteps,"nextSteps");if(!Array.isArray(fields.files)||fields.files.some(file=>typeof file!=="string"))throw new MemoryError("INVALID_INPUT","files debe ser un arreglo de textos.");return [`Goal:\n${goal}`,`Instructions:\n${instructions}`,`Discoveries:\n${discoveries}`,`Accomplishments:\n${accomplishments}`,`Next steps:\n${nextSteps}`,`Files:\n${fields.files.join("\n")}`].join("\n\n");}
