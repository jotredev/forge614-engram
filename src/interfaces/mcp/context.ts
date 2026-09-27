/**
 * Piezas comunes que usan los archivos `*-tools.ts` (`memory-tools.ts`, `sessions-tools.ts`) para registrar
 * las herramientas MCP (protocolo de contexto de modelo, el canal por el que el cliente de IA llama funciones):
 * cómo se envuelve un resultado o un error en el formato de texto que exige el protocolo (`safely`) y la forma
 * del contexto (`ToolContext`) que cada archivo de herramientas recibe para leer la memoria y registrar sus propias herramientas.
 */
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { MemoryStore } from "../../app";
import type { McpToolName } from "../../modules/mcp";
import { MemoryError } from "../../shared/errors";
/** Envuelve un valor de éxito en el bloque de texto que el protocolo MCP espera como respuesta de una herramienta. */
function result(value: unknown) {
  return { content:[{ type:"text" as const,text:JSON.stringify(value) }] };
}
/**
 * Envuelve un error en el formato de fallo del protocolo MCP.
 * Si es un `MemoryError` conserva su código y mensaje (pensados para mostrarse); cualquier otro error
 * se oculta detrás de `STORAGE_ERROR` para no filtrar detalles internos (p. ej. rutas o valores secretos).
 */
function failure(error: unknown) {
  if (error instanceof MemoryError) return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:error.code,error:error.message }) }] };
  return { isError:true, content:[{ type:"text" as const,
    text:JSON.stringify({ code:"STORAGE_ERROR",error:"No se pudo completar la operación local." }) }] };
}


/**
 * Convierte el manejador de una herramienta en el callback que exige el SDK de MCP: ejecuta `handler`,
 * envuelve su valor de retorno con `result` y, si lanza, envuelve el error con `failure`. Cada archivo
 * `*-tools.ts` (`memory-tools.ts`, `sessions-tools.ts`) la usa para no repetir el try/catch en cada herramienta.
 * @param handler la función propia de la herramienta (recibe los argumentos ya validados por su esquema de entrada).
 */
export const safely = <T extends unknown[]>(handler: (...args:T) => unknown | Promise<unknown>) =>
  async (...args:T) => { try { return result(await handler(...args)); } catch (error) { return failure(error); } };
/** Contexto que `registerTools` (`tools.ts`) arma una sola vez y pasa a `registerMemoryTools` y `registerSessionTools` para que registren sus herramientas. */
export interface ToolContext {
  /** Da acceso al almacén de memoria (`MemoryStore`) ya abierto para el directorio del proyecto en curso. */
  memoryStore:()=>MemoryStore;
  /** Resuelve el directorio del proyecto a partir de uno explícito (si lo da la herramienta) o del que detecta el servidor. */
  projectDirectory:(explicit?:string)=>Promise<string>;
  /** Da de alta una herramienta MCP por nombre, con su descripción, esquema de entrada y manejador. */
  register:<Input extends z.ZodType>(name:McpToolName,config:{description:string;inputSchema:Input},handler:ToolCallback<Input>)=>void;
  /** La misma función `safely` de este archivo, expuesta en el contexto para que cada archivo de herramientas la use sin importarla aparte. */
  safely:typeof safely;
}
