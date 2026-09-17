import { expect, test } from "bun:test";
import { createProject, getProject, listProjects, projectForDirectory, resolveProjectDirectory } from "./projects";
import { enableAssistantIntegration } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

test("project persistence trims display names and sorts independently of insertion order", () => withDatabase(db => {
  const z = createProject(db, " Zeta "); const a = createProject(db, "Alpha");
  expect(getProject(db, z.projectId)?.name).toBe("Zeta");
  expect(listProjects(db).map(p => p.projectId)).toEqual([a.projectId, z.projectId]);
  expect(() => createProject(db, "  ")).toThrow();
  expect(listProjects(db)).toHaveLength(2);
}));

test("directory resolution reuses its binding and refuses same-name ambiguity", () => withDatabase(db => {
  enableAssistantIntegration(db);
  expect(resolveProjectDirectory(db, "/new", "New", false)).toEqual({ project: null, created: false });
  const first = resolveProjectDirectory(db, "/new", "New", true);
  expect(first.created).toBe(true);
  expect(projectForDirectory(db, "/new")?.projectId).toBe(first.project?.projectId);
  expect(resolveProjectDirectory(db, "/new", "New", true).created).toBe(false);
  expect(() => resolveProjectDirectory(db, "/other", "New", true)).toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(listProjects(db)).toHaveLength(1);
}));
