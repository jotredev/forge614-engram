import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { readMeta, readMetas, upsertMeta } from "./meta";
import { enableIntelligence } from "./schema";
import { save } from "./writes";

test("upsertMeta merges patches and readMeta/readMetas return the stored metadata", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Meta");
  const a = save(db, { projectId: project.projectId, type: "fact", title: "A", content: "a" });
  const b = save(db, { projectId: project.projectId, type: "fact", title: "B", content: "b" });
  expect(readMeta(db, a.id)).toBeNull();
  upsertMeta(db, a.id, { short: "corta" }, "2026-09-24T00:00:00.000Z");
  upsertMeta(db, a.id, { affects: ["engram", "shell"] }, "2026-09-24T00:00:01.000Z");
  expect(readMeta(db, a.id)).toEqual({ short: "corta", reviewAfter: null, supersededBy: null, affects: ["engram", "shell"] });
  upsertMeta(db, a.id, { short: null }, "2026-09-24T00:00:02.000Z");
  expect(readMeta(db, a.id)?.short).toBeNull();
  expect([...readMetas(db, [a.id, b.id]).keys()]).toEqual([a.id]);
}));
