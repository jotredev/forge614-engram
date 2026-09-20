import { expect, test } from "bun:test";
import { createProject, getProject, listProjects, projectForDirectory, resolveProjectDirectory } from "./projects";
import { enableProjectBindings } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

test("project persistence trims display names and sorts independently of insertion order", () => withDatabase(db => {
  const z = createProject(db, " Zeta "); const a = createProject(db, "Alpha");
  expect(getProject(db, z.projectId)?.name).toBe("Zeta");
  expect(listProjects(db).map(p => p.projectId)).toEqual([a.projectId, z.projectId]);
  expect(() => createProject(db, "  ")).toThrow();
  expect(listProjects(db)).toHaveLength(2);
}));

test("directory resolution reuses its binding and refuses same-name ambiguity", () => withDatabase(db => {
  enableProjectBindings(db);
  expect(resolveProjectDirectory(db, "/new", "New", false)).toEqual({ project: null, created: false });
  const first = resolveProjectDirectory(db, "/new", "New", true);
  expect(first.created).toBe(true);
  expect(projectForDirectory(db, "/new")?.projectId).toBe(first.project?.projectId);
  expect(resolveProjectDirectory(db, "/new", "New", true).created).toBe(false);
  expect(() => resolveProjectDirectory(db, "/other", "New", true)).toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(listProjects(db)).toHaveLength(1);
}));

test("schema 7 retains project bindings without admitting future versions", () => withDatabase(db => {
  enableProjectBindings(db); db.exec("PRAGMA user_version=7");
  expect(resolveProjectDirectory(db,"/seven","Seven",true).project?.name).toBe("Seven");
  db.exec("PRAGMA user_version=8");
  expect(()=>projectForDirectory(db,"/seven")).toThrow(expect.objectContaining({code:"MIGRATION_REQUIRED"}));
}));
