import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { readMeta } from "./meta";
import { countPinsOutsideReservation, readPinnedPage } from "./pinned";
import { enableIntelligence } from "./schema";
import { startupBlock } from "./startup";
import { save } from "./writes";

const notebook = { projectId: null, groupId: null, scope: "shared" } as const;

test("legacy pinned short text stays intact and both read paths clip it at a Unicode boundary", () => withDatabase(db => {
  enableIntelligence(db);
  const fields = { scope: "shared", projectId: null, title: "Legacy tip", type: "fact", content: "Original content",
    topicKey: "legacy-tip", requestKey: "saved-by-legacy-client", pinned: true } as const;
  const pin = save(db, { ...fields, short: "Short text" });
  const oldShort = "🛠".repeat(140);
  db.query("UPDATE memory_meta SET short=? WHERE memory_id=?").run(oldShort, pin.id);

  const page = readPinnedPage(db, notebook, { maxBytes: 1024 }, {});
  const display = "🛠".repeat(119) + "…";
  expect(page.pinned).toEqual([{ id: pin.id, scope: "shared", short: display, marks: [] }]);
  expect(startupBlock(db, null).text).toContain(`- ${display} · personal · ${pin.id}`);
  expect(save(db, { ...fields, short: oldShort })).toEqual(pin);
  expect(readMeta(db, pin.id)?.short).toBe(oldShort);
}));

test("a personal notebook can borrow all startup space while its reservation warning stays scoped", () => withDatabase(db => {
  const pins = Array.from({ length: 3 }, (_, n) => save(db, { scope: "shared", projectId: null,
    title: `Shared ${n} ${"x".repeat(120)}`, type: "fact", content: `Rule ${n}`, topicKey: `rule/${n}`, pinned: true }));
  expect(countPinsOutsideReservation(db, notebook)).toBe(1);
  expect(startupBlock(db, null).omitted).toBe(0);
  expect(readPinnedPage(db, notebook, { cursor: pins.length }, {})).toEqual({ format: 1, pinned: [], total: 3, nextCursor: null });
}));
