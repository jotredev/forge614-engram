import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { intelligenceEnabled } from "./intelligence";
import { enableIntelligence, enableSearchReinforcement, initialize } from "./schema";

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
