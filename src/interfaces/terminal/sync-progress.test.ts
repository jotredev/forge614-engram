/** Comprueba el avance de `sync` en la terminal: solo con una terminal real, una sola línea reescrita y borrada al terminar. */
import { expect, test } from "bun:test";
import { createSyncProgress, formatCount } from "./sync-progress";

/** Un flujo falso que solo guarda lo que se le escribe; `isTTY` se fija desde la prueba. */
function fakeStream(isTTY?: boolean | undefined): { stream: { isTTY?: boolean | undefined; write(text: string): boolean }; written: string[] } {
  const written: string[] = [];
  return { written, stream: { isTTY, write(text: string) { written.push(text); return true; } } };
}

// Con una terminal, la subida reescribe una sola línea con el texto exacto y `finish` la borra.
test("update writes the exact upload line and finish erases it", () => {
  const { stream, written } = fakeStream(true);
  const progress = createSyncProgress(stream as never, {});
  expect(progress).toBeDefined();
  progress!.update({ phase: "upload", done: 1000, total: 2426 });
  expect(written).toEqual(["\rSubiendo 1 000 de 2 426 cambios…\x1b[K"]);
  progress!.finish();
  expect(written[1]).toBe("\r\x1b[K");
  expect(written).toHaveLength(2);
});

// La bajada no tiene total: solo cuántas filas se han leído.
test("update writes the exact download line", () => {
  const { stream, written } = fakeStream(true);
  const progress = createSyncProgress(stream as never, {});
  progress!.update({ phase: "download", done: 2000 });
  expect(written).toEqual(["\rBajando cambios de la nube: 2 000 leídos…\x1b[K"]);
});

// Si nunca se escribió nada, no hay línea que borrar.
test("finish without a previous update writes nothing", () => {
  const { stream, written } = fakeStream(true);
  createSyncProgress(stream as never, {})!.finish();
  expect(written).toEqual([]);
});

// Sin terminal (tubería, archivo, pruebas, agentes) o con TERM=dumb, no se crea avance.
test("createSyncProgress returns undefined when stderr is not a terminal or TERM is dumb", () => {
  expect(createSyncProgress(fakeStream(false).stream as never, {})).toBeUndefined();
  expect(createSyncProgress(fakeStream(undefined).stream as never, {})).toBeUndefined();
  expect(createSyncProgress(fakeStream(true).stream as never, { TERM: "dumb" })).toBeUndefined();
});

// Separador de miles con espacio, sin depender del idioma del sistema.
test("formatCount groups thousands with a space", () => {
  expect(formatCount(999)).toBe("999");
  expect(formatCount(1000)).toBe("1 000");
  expect(formatCount(2426)).toBe("2 426");
  expect(formatCount(1234567)).toBe("1 234 567");
});
