/** Comprueba la fecha de revisión por tipo, las marcas superseded/verify, y la normalización de short y affects. */
import { expect, test } from "bun:test";
import { marksFor, normalizeAffects, normalizeShort, reviewAfterFor } from "./meta";

const NOW = "2026-09-24T12:00:00.000Z";

// Solo decision y procedure reciben fecha de revisión (90 días después); los demás tipos no vencen.
test("decisions and procedures get a review date 90 days ahead; other types none", () => {
  expect(reviewAfterFor("decision", NOW)).toBe("2026-12-23T12:00:00.000Z");
  expect(reviewAfterFor("procedure", NOW)).toBe("2026-12-23T12:00:00.000Z");
  for (const type of ["fact", "warning", "preference"] as const) expect(reviewAfterFor(type, NOW)).toBeNull();
});

// Sin metadatos o con metadatos vacíos no hay marcas; supersededBy da "superseded", una fecha de
// revisión ya pasada da "verify", y ambas condiciones a la vez dan las dos marcas juntas.
test("marks: superseded when replaced, verify once the review date has passed", () => {
  const base = { short: null, reviewAfter: null, supersededBy: null, affects: null };
  expect(marksFor(null, NOW)).toEqual([]);
  expect(marksFor(base, NOW)).toEqual([]);
  expect(marksFor({ ...base, supersededBy: "other" }, NOW)).toEqual(["superseded"]);
  expect(marksFor({ ...base, reviewAfter: "2026-09-24T11:59:59.000Z" }, NOW)).toEqual(["verify"]);
  expect(marksFor({ ...base, reviewAfter: "2026-09-24T12:00:01.000Z" }, NOW)).toEqual([]);
  expect(marksFor({ ...base, supersededBy: "x", reviewAfter: "2020-01-01T00:00:00.000Z" }, NOW)).toEqual(["superseded", "verify"]);
});

// El resumen corto se recorta de espacios y debe quedar entre 1 y 300 caracteres, sin bytes nulos.
test("short is trimmed and bounded", () => {
  expect(normalizeShort("  Resumen corto  ")).toBe("Resumen corto");
  expect(normalizeShort("a".repeat(300))).toHaveLength(300);
  for (const bad of ["", "   ", "a".repeat(301), "a\0b"]) expect(() => normalizeShort(bad)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
});

// Los nombres de proyectos afectados se recortan, se deduplican y se ordenan alfabéticamente; una
// lista vacía, con más de 20 nombres, con un nombre vacío, muy largo o con byte nulo debe rechazarse.
test("affects is trimmed, deduplicated, sorted and bounded", () => {
  expect(normalizeAffects([" shell", "engram", "shell "])).toEqual(["engram", "shell"]);
  for (const bad of [[], Array.from({ length: 21 }, (_, i) => `p${i}`), [""], ["x".repeat(65)], ["a\0b"]]) {
    expect(() => normalizeAffects(bad)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});
