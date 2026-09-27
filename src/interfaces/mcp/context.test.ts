/** Comprueba que `safely` envuelve resultados y errores en el formato de texto que exige el protocolo MCP. */
import { expect, test } from "bun:test";
import { MemoryError } from "../../shared/errors";
import { safely } from "./context";

// El resultado del manejador se serializa como JSON dentro de un bloque de texto, tal como pide el protocolo.
test("safely awaits the handler and serializes its result as protocol text", async () => {
  const handler = safely(async (value:number) => ({answer:value + 1}));
  expect(await handler(41)).toEqual({content:[{type:"text", text:'{"answer":42}'}]});
});
// Un MemoryError conserva su código y mensaje; cualquier otro error se oculta detrás de STORAGE_ERROR para no filtrar detalles internos.
test("safely preserves domain codes and hides unexpected exception details", async () => {
  expect<unknown>(await safely(() => {throw new MemoryError("NOT_FOUND", "Missing memory");})()).toEqual({
    isError:true,content:[{type:"text",text:'{"code":"NOT_FOUND","error":"Missing memory"}'}],
  });
  const failure = await safely(async () => {throw new Error("SECRET_DATABASE_PATH");})();
  expect<unknown>(failure).toEqual({isError:true,content:[{type:"text",text:'{"code":"STORAGE_ERROR","error":"No se pudo completar la operación local."}'}]});
});
