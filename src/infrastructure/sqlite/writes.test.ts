import { expect, test } from "bun:test";
import { save, archive, restore, saveForProjectDirectory } from "./writes";
import { createProject, listProjects } from "./projects";
import { enableAssistantIntegration } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

test("idempotent replay retains the original version and conflicts leave history untouched", () => withDatabase(db => {
  const project = createProject(db, "Owner");
  const input = { projectId: project.projectId, type: "fact" as const, title: "A", content: "body", requestKey: "request" };
  const first = save(db, input);
  expect(save(db, input)).toEqual(first);
  expect(() => save(db, { ...input, content: "changed" })).toThrow(expect.objectContaining({ code: "REQUEST_CONFLICT" }));
  expect(db.query("SELECT count(*) AS n FROM memory_versions").get()).toEqual({ n: 1 });
  expect(archive(db, project.projectId, first.id).state).toBe("archived");
  archive(db, project.projectId, first.id);
  expect(restore(db, project.projectId, first.id).state).toBe("active");
  expect(db.query("SELECT action FROM events ORDER BY id").all()).toEqual([{ action: "save" }, { action: "archive" }, { action: "restore" }]);
}));

test("invalid directory save rolls back newly created project and binding", () => withDatabase(db => {
  enableAssistantIntegration(db);
  expect(() => saveForProjectDirectory(db, "/new", "New", { type: "fact", title: "", content: "body" })).toThrow();
  expect(listProjects(db)).toEqual([]);
  expect(db.query("SELECT * FROM project_bindings").all()).toEqual([]);
}));
