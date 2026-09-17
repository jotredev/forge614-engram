import { expect, test } from "bun:test";
import { MemoryError } from "../../shared/errors";
import { safely } from "./context";

test("safely awaits the handler and serializes its result as protocol text", async () => {
  const handler = safely(async (value:number) => ({answer:value + 1}));
  expect(await handler(41)).toEqual({content:[{type:"text", text:'{"answer":42}'}]});
});
test("safely preserves domain codes and hides unexpected exception details", async () => {
  expect<unknown>(await safely(() => {throw new MemoryError("NOT_FOUND", "Missing memory");})()).toEqual({
    isError:true,content:[{type:"text",text:'{"code":"NOT_FOUND","error":"Missing memory"}'}],
  });
  const failure = await safely(async () => {throw new Error("SECRET_DATABASE_PATH");})();
  expect<unknown>(failure).toEqual({isError:true,content:[{type:"text",text:'{"code":"STORAGE_ERROR","error":"No se pudo completar la operación local."}'}]});
});
