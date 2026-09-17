import { afterEach, expect, setSystemTime, test } from "bun:test";
import { search, searchPreviews, getVersion, context } from "./search";
import { createProject } from "./projects";
import { save, archive } from "./writes";
import { enableSearchReinforcement } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";
import { rankingFactors } from "../../modules/memory";

afterEach(() => setSystemTime());

test("active project topics shadow shared results and archived overrides reveal them", () => withDatabase(db => {
  const p = createProject(db, "Owner");
  const shared = save(db, { projectId: null, scope: "shared", type: "fact", title: "needle", content: "global", topicKey: "topic" });
  const local = save(db, { projectId: p.projectId, type: "fact", title: "needle", content: "local", topicKey: "topic" });
  expect(search(db, p.projectId, "needle").map(r => r.memory.id)).toEqual([local.id]);
  expect(search(db, p.projectId, "ne").map(r => r.memory.id)).toEqual([local.id]);
  archive(db, p.projectId, local.id);
  expect(search(db, p.projectId, "needle").map(r => r.memory.id)).toEqual([shared.id]);
  expect(getVersion(db, p.projectId, local.id, 1)).toMatchObject({ state: "archived", currentVersion: 1, memory: { content: "local" } });
}));

test("preview truncates content while bounded context reports omitted rows", () => withDatabase(db => {
  const p = createProject(db, "Owner");
  for (let i = 0; i < 4; i++) save(db, { projectId: p.projectId, type: "fact", title: "needle", content: "x".repeat(400), pinned: true });
  expect(searchPreviews(db, p.projectId, "needle")[0]?.memory).toMatchObject({ preview: "x".repeat(300), truncated: true });
  const result = context(db, p.projectId, { maxBytes: 1024 });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024);
  expect(result.truncated).toBe(true);
  expect(result.omitted.pinned).toBeGreaterThan(0);
}));

test("schema 7 ranks equal BM25 candidates with derived reinforcement before limit", () => withDatabase(db => {
  setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
  const project = createProject(db, "Rank");
  enableSearchReinforcement(db);
  const reinforced = save(db, {
    projectId: project.projectId, topicKey: "rank-a", title: "equal lexical candidate",
    content: "equal lexical body", type: "fact", pinned: true,
  });
  const baseline = save(db, {
    projectId: project.projectId, topicKey: "rank-b", title: "equal lexical candidate",
    content: "equal lexical body", type: "fact", pinned: false,
  });
  save(db, { projectId: project.projectId, topicKey: "rank-a", title: "equal lexical candidate",
    content: "equal lexical body", type: "decision", pinned: true, expectedVersion: 1 });
  save(db, { projectId: project.projectId, topicKey: "rank-a", title: "equal lexical candidate",
    content: "equal lexical body", type: "fact", pinned: true, expectedVersion: 2 });
  for (let i = 0; i < 2; i++) save(db, {
    projectId: project.projectId, topicKey: "rank-a", title: "equal lexical candidate",
    content: "equal lexical body", type: "fact", pinned: true, expectedVersion: 3,
  });

  const all = search(db, project.projectId, "equal lexical");
  expect(new Set(all.map(row => row.memory.id)).size).toBe(2);
  expect(all.map(row => row.memory.id)).toEqual([reinforced.id, baseline.id]);
  expect(all[0]!.explanation.bm25).toBe(all[1]!.explanation.bm25);
  expect(all[0]!.explanation.multiplier).toBeCloseTo(1.18, 12);
  expect(all[0]!.explanation.reinforcement).toEqual({
    revisionCount: 2,
    duplicateCount: 2,
    lastSeenAt: "2026-09-17T12:00:00.000Z",
    ageDays: 0,
    pinnedBoost: 0.1,
    recencyBoost: 0.06,
    stabilityBoost: 0.02,
  });
  expect(search(db, project.projectId, "equal lexical", 1)[0]!.memory.id).toBe(reinforced.id);

  const previews = searchPreviews(db, project.projectId, "equal lexical");
  expect(previews.map(row => row.memory.id)).toEqual(all.map(row => row.memory.id));
  expect(previews.map(row => row.explanation)).toEqual(all.map(row => row.explanation));
}));

test("legacy and literal searches retain their prior explanation shape", () => withDatabase(db => {
  const project = createProject(db, "Compatibility");
  save(db, { projectId: project.projectId, title: "legacy searchable", content: "body", type: "fact" });
  const legacy = search(db, project.projectId, "searchable")[0]!;
  expect(legacy.explanation).not.toHaveProperty("reinforcement");

  enableSearchReinforcement(db);
  const literal = search(db, project.projectId, "é")[0];
  expect(literal).toBeUndefined();
  save(db, { projectId: project.projectId, title: "é Unicode", content: "exact", type: "fact" });
  expect(search(db, project.projectId, "é")[0]!.explanation).toEqual({
    mode: "literal", bm25: null, multiplier: 1, orderScore: null,
  });
}));

test("schema 7 reports the exact SQL multiplier for a fixed subday clock", () => withDatabase(db => {
  const lastSeenAt = "2026-09-16T23:59:59.123Z";
  const now = "2026-09-17T12:34:56.789Z";
  setSystemTime(new Date(lastSeenAt));
  const project = createProject(db, "Subday clock");
  enableSearchReinforcement(db);
  save(db, { projectId: project.projectId, topicKey: "clock-a", title: "subday timing", content: "body", type: "fact" });

  setSystemTime(new Date(now));
  const result = search(db, project.projectId, "subday timing")[0]!;
  const expected = rankingFactors({ revisionCount: 0, duplicateCount: 0, lastSeenAt }, false, now);
  const { multiplier,...reinforcement } = expected;
  expect(result.explanation.reinforcement).toEqual(reinforcement);
  expect(result.explanation.multiplier).toBe(multiplier);
  expect(result.explanation.orderScore).toBe(result.explanation.bm25! * multiplier);
}));
