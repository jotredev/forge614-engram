import { expect, test } from "bun:test";
import { search, searchPreviews, getVersion, context } from "./search";
import { createProject } from "./projects";
import { save, archive } from "./writes";
import { withDatabase } from "../__test-support__/fixtures";

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
