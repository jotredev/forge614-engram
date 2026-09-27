/** Comprueba que `intelligenceEnabled` solo da verdadero desde el nivel 11 del esquema. */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { intelligenceEnabled } from "./intelligence";
import { enableIntelligence, enableSearchReinforcement, initialize } from "./schema";

// Recién inicializada (nivel 3) y con el refuerzo de búsqueda (nivel 7) la base aún no cuenta como inteligente; solo desde el nivel 11.
test("intelligence is enabled only at level 11", () => {
  const db = new Database(":memory:");
  try {
    initialize(db);
    expect(intelligenceEnabled(db)).toBe(false);
    enableSearchReinforcement(db);
    expect(intelligenceEnabled(db)).toBe(false);
    enableIntelligence(db);
    expect(intelligenceEnabled(db)).toBe(true);
  } finally { db.close(); }
});
