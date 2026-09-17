import { expect, test } from "bun:test";
import { startRuntimeSession, endRuntimeSession, getSession, inferredSessions, manualSession, validateSelectedSession } from "./sessions";
import { createProject } from "./projects";
import { enableSessionLifecycle } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

test("runtime bindings infer only open sessions in the selected directory", () => withDatabase(db => {
  enableSessionLifecycle(db); const p = createProject(db, "Owner");
  startRuntimeSession(db, p.projectId, "run", "/one");
  startRuntimeSession(db, p.projectId, "run", "/one");
  expect(inferredSessions(db, p.projectId, "/one", new Date().toISOString())).toEqual(["run"]);
  expect(inferredSessions(db, p.projectId, "/two", new Date().toISOString())).toEqual([]);
  const ended = endRuntimeSession(db, p.projectId, "run");
  expect(ended.endedAt).not.toBeNull();
  expect(endRuntimeSession(db, p.projectId, "run")).toEqual(ended);
  expect(getSession(db, p.projectId, "run")).toEqual(ended);
  expect(inferredSessions(db, p.projectId, "/one", new Date().toISOString())).toEqual([]);
  expect(() => validateSelectedSession(db, "run", "project", p.projectId, null, true)).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
}));

test("manual session is reused per project and cannot be explicitly closed", () => withDatabase(db => {
  enableSessionLifecycle(db); const p = createProject(db, "Owner");
  const id = manualSession(db, p.projectId, "2026-01-01T00:00:00.000Z");
  expect(manualSession(db, p.projectId, "2026-02-01T00:00:00.000Z")).toBe(id);
  expect(() => endRuntimeSession(db, p.projectId, id)).toThrow(expect.objectContaining({ code: "SESSION_KIND" }));
}));
