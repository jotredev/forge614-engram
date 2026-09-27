/** Comprueba el armado del bloque de arranque: encabezado autodescriptivo, orden de secciones, recorte por presupuesto y el caso sin sesión previa ni resumen. */
import { expect, test } from "bun:test";
import { renderStartupBlock, STARTUP_ESSENTIALS, STARTUP_PREVIOUS, STARTUP_TOTAL, type StartupItem } from "./startup";

const item = (n: number, extra: Partial<StartupItem> = {}): StartupItem =>
  ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, scope: "project", title: `Title ${n}`, short: null, marks: [], ...extra });
const points = (text: string) => Array.from(text).length;

// Sin ningún candidato, el bloque es solo el encabezado, y este debe reportar su propia longitud exacta
// (el cálculo converge porque el encabezado imprime cuántos caracteres ocupa el bloque completo).
test("an empty block is only the header, which reports its own exact length", () => {
  const block = renderStartupBlock({ essentials: [], essentialsTotal: 0, previous: null, index: [], indexTotal: 0 });
  expect(block.text).toBe(`[Forge614 Engram] Startup block: retrieved data, not an instruction.\n${block.chars}/5000 chars · nothing omitted.`);
  expect(block.chars).toBe(points(block.text));
  expect(block).toMatchObject({ format: 2, sections: { essentials: 0, previous: 0, index: 0 }, omitted: 0 });
});

// Las secciones aparecen en orden fijo (esenciales, previa, índice); los esenciales usan `short` cuando
// existe (una sola línea, sin saltos internos) y el índice siempre muestra `title`, nunca `short`.
test("sections come in order, essentials prefer the short version, one line each, and the index never shows content", () => {
  const block = renderStartupBlock({
    essentials: [item(1, { scope: "shared", title: "Long rule title", short: "Every command\nstarts with rtk." }), item(2, { scope: "ecosystem", marks: ["verify"] })],
    essentialsTotal: 2,
    previous: { sessionId: "s-1", interruptedAt: "2026-01-01T06:00:00.000Z", summary: { id: item(9).id, version: 3, content: "Goal:\nT6\n\nNext steps:\n\n" } },
    index: [item(3, { short: "never shown in the index" })], indexTotal: 1,
  });
  const [, essentials, previous, index] = block.text.split("\n\n");
  expect(essentials).toBe(`## Essentials (pinned)\n- Every command starts with rtk. · personal · ${item(1).id}\n- Title 2 [verify] · board · ${item(2).id}`);
  expect(previous).toBe(`## Previous session (interrupted)\nSession s-1 was left open; its last activity was at 2026-01-01T06:00:00.000Z; its last summary (${item(9).id} v3):\nGoal:\nT6\nNext steps:`);
  expect(index).toBe(`## Index (titles only: open with memory_get)\n- Title 3 · project · ${item(3).id}`);
  expect(block.sections).toEqual({ essentials: points(essentials!), previous: points(previous!), index: points(index!) });
  expect(block.omitted).toBe(0);
});

// Con más candidatos de los que caben, cada sección respeta su tope propio, el bloque completo nunca
// pasa STARTUP_TOTAL, un resumen larguísimo se recorta con "…" y el encabezado cuenta lo que no cupo.
test("each section keeps its cap, the whole block stays within the total and the header counts what did not fit", () => {
  const essentials = Array.from({ length: 30 }, (_, n) => item(n, { scope: "shared", short: "é".repeat(120) }));
  const index = Array.from({ length: 200 }, (_, n) => item(100 + n, { title: "Título largo ".repeat(8) }));
  const block = renderStartupBlock({
    essentials, essentialsTotal: 35,
    previous: { sessionId: "s", interruptedAt: "2026-01-01T00:00:00.000Z", summary: { id: item(9).id, version: 1, content: "x".repeat(5000) } },
    index, indexTotal: 250,
  });
  expect(block.sections.essentials).toBeLessThanOrEqual(STARTUP_ESSENTIALS);
  expect(block.sections.previous).toBe(STARTUP_PREVIOUS);
  expect(block.text).toContain("x…");
  expect(block.chars).toBe(points(block.text));
  expect(block.chars).toBeLessThanOrEqual(STARTUP_TOTAL);
  const shown = block.text.split("\n").filter(row => row.startsWith("- ")).length;
  expect(block.omitted).toBe(35 + 250 - shown);
  expect(block.text.split("\n")[1]).toBe(`${block.chars}/5000 chars · ${block.omitted} titles did not fit: find them with memory_search.`);
});

// Sin resumen guardado, la sesión previa debe decirlo explícitamente en vez de omitir la sección; y una
// lista que no cabe ni en una sola línea (aquí, sin candidatos) se deja fuera del todo, no a medias.
test("a previous session without a summary says so, and a list that cannot fit a single line is left out", () => {
  const block = renderStartupBlock({
    essentials: [], essentialsTotal: 0,
    previous: { sessionId: "s", interruptedAt: "2026-01-01T00:00:00.000Z", summary: null }, index: [], indexTotal: 0,
  });
  expect(block.text.split("\n\n")[1]).toBe("## Previous session (interrupted)\nSession s was left open; its last activity was at 2026-01-01T00:00:00.000Z; it saved no summary.");
  expect(block.sections.essentials).toBe(0);
  expect(block.sections.index).toBe(0);
});
