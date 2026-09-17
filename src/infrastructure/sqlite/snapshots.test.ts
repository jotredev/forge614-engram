import { expect, test } from "bun:test";
import { applySnapshot, checkpoint, exportSnapshot } from "./snapshots";
import { createProject } from "./projects";
import { enableSynchronization } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

test("snapshot application persists data and checkpoint atomically and refuses stale local state", () => withDatabase(db => {
  enableSynchronization(db);
  const empty = { format: 1 as const, projects: [], memories: [] };
  const next = { ...empty, projects: [{ projectId: "11111111-1111-4111-8111-111111111111", name: "Remote", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };
  expect(checkpoint(db, "remote")).toEqual(empty);
  applySnapshot(db, empty, next, "remote");
  expect(exportSnapshot(db)).toEqual(next);
  expect(checkpoint(db, "remote")).toEqual(next);
  createProject(db, "Local");
  expect(() => applySnapshot(db, next, next, "remote")).toThrow(expect.objectContaining({ code: "SYNC_LOCAL_CHANGED" }));
  expect(exportSnapshot(db).projects.map(p => p.name).sort()).toEqual(["Local", "Remote"]);
  expect(checkpoint(db, "remote")).toEqual(next);
}));
