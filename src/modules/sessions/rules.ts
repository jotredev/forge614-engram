/**
 * Reglas de sesión: validación del identificador, el aviso legible (session notice) sobre una sesión
 * previa dejada abierta o sesiones en paralelo, y el armado del texto de un resumen estructurado. Lo usa
 * `src/infrastructure/sqlite/writes.ts` y `sessions.ts` al validar y componer estos datos.
 */
import { MemoryError } from "../../shared/errors";
import type { ParallelSession, PreviousSession, SummaryFields } from "./types";
// Horas sin actividad tras las que una sesión de ejecución automática abierta deja de inferirse para un
// guardado sin sessionId (nivel 11).
export const INACTIVITY_HOURS = 6;
// Minutos: una sesión de ejecución automática abierta con actividad tan reciente cuenta como abierta en
// paralelo; más vieja cuenta como dejada abierta (1.7.1, nivel 11).
export const PARALLEL_MINUTES = 30;
/**
 * Comprueba que un valor sea un identificador de sesión válido: de 1 a 200 caracteres Unicode, sin
 * espacios al inicio o al final y sin caracteres de control ni de formato invisible.
 * @param value Valor a validar; típicamente el `sessionId` recibido de un cliente.
 * @returns El mismo valor, ya confirmado como identificador válido.
 * @throws MemoryError con código "INVALID_INPUT" si no es una cadena, está fuera del rango de largo, tiene espacios exteriores o contiene un carácter de control o de formato.
 */
export function sessionIdentity(value:unknown):string{const length=typeof value==="string"?Array.from(value).length:0;if(typeof value!=="string"||length<1||length>200||value.trim()!==value||/[\p{Cc}\p{Cf}]/u.test(value))throw new MemoryError("INVALID_INPUT","sessionId debe tener entre 1 y 200 caracteres, sin controles ni espacios exteriores.");return value;}
/**
 * Comprueba que un valor sea texto sin caracteres nulos, opcionalmente exigiendo que no quede en blanco.
 * @param value Valor a validar.
 * @param field Nombre del campo, usado en el mensaje de error.
 * @param nonblank Si es `true`, además de ser texto, no puede quedar vacío tras recortar espacios.
 * @returns El mismo valor, ya validado.
 * @throws MemoryError con código "INVALID_INPUT" si no es una cadena, contiene un carácter nulo, o (con `nonblank`) queda en blanco.
 */
function textField(value:unknown,field:string,nonblank=false):string{if(typeof value!=="string"||value.includes("\0")||(nonblank&&!value.trim()))throw new MemoryError("INVALID_INPUT",`${field} debe ser texto${nonblank?" no vacío":""}.`);return value;}
// Un hecho legible para el asistente, derivado de `previous`/`parallel` (1.7.2): es un dato, nunca una orden.
/**
 * Arma el aviso legible sobre el estado de otras sesiones: menciona primero la sesión previa dejada
 * abierta (si la hay, diciendo si guardó resumen o no), y después cuáles sesiones están abiertas en
 * paralelo ahora mismo (en singular o plural según cuántas haya).
 * @param previous Sesión previa dejada abierta, o `null`/`undefined` si no hay ninguna que avisar.
 * @param parallel Sesiones abiertas en paralelo a la actual, o `null`/`undefined` si no hay ninguna.
 * @returns El texto del aviso combinando ambas partes, o `null` si no hay nada que avisar.
 */
export function sessionNotice(previous?:PreviousSession|null,parallel?:ParallelSession[]|null):string|null{
  const parts:string[]=[];
  if(previous) parts.push(`Session ${previous.sessionId} was left open; its last activity was at ${previous.interruptedAt}; ${previous.summary?"its summary is available.":"it saved no summary."}`);
  if(parallel&&parallel.length===1) parts.push(`Another session is open now: ${parallel[0]!.sessionId}.`);
  else if(parallel&&parallel.length>1) parts.push(`Other sessions are open now: ${parallel.map(session=>session.sessionId).join(", ")}.`);
  return parts.length?parts.join(" "):null;
}
/**
 * Valida los campos estructurados de un resumen de sesión y arma el texto final, con cada campo bajo
 * su propio encabezado y los archivos uno por línea.
 * @param fields Los campos estructurados del resumen: objetivo (obligatorio, no puede quedar en blanco), instrucciones, hallazgos, logros, próximos pasos y archivos.
 * @returns El texto del resumen, con los seis bloques separados por una línea en blanco.
 * @throws MemoryError con código "INVALID_INPUT" si `fields` no es un objeto, algún campo de texto es inválido, o `files` no es un arreglo de cadenas.
 */
export function summaryContent(fields:SummaryFields):string{if(!fields||typeof fields!=="object")throw new MemoryError("INVALID_INPUT","El resumen debe ser estructurado.");const goal=textField(fields.goal,"goal",true),instructions=textField(fields.instructions,"instructions"),discoveries=textField(fields.discoveries,"discoveries"),accomplishments=textField(fields.accomplishments,"accomplishments"),nextSteps=textField(fields.nextSteps,"nextSteps");if(!Array.isArray(fields.files)||fields.files.some(file=>typeof file!=="string"))throw new MemoryError("INVALID_INPUT","files debe ser un arreglo de textos.");return [`Goal:\n${goal}`,`Instructions:\n${instructions}`,`Discoveries:\n${discoveries}`,`Accomplishments:\n${accomplishments}`,`Next steps:\n${nextSteps}`,`Files:\n${fields.files.join("\n")}`].join("\n\n");}
