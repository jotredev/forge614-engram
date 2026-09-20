import { expect, test } from "bun:test";
import { get, getByTopic, history, required } from "./memory";
import { createProject } from "./projects";
import { save } from "./writes";
import { withDatabase } from "../__test-support__/fixtures";

test("reads enforce ownership and preserve historical snapshots in version order", () => withDatabase(db => {
  const p = createProject(db, "Owner"), other = createProject(db, "Other");
  const input = { projectId: p.projectId, type: "fact" as const, title: "First", content: "original", topicKey: "topic", pinned: true };
  const first = save(db, input); save(db, { ...input, content: "revised", expectedVersion: 1 });
  expect(get(db, p.projectId, first.id)).toMatchObject({ content: "revised", pinned: true, version: 2, topicKey: "topic", state: "active" });
  expect(history(db, p.projectId, first.id).map(v => v.content)).toEqual(["original", "revised"]);
  expect(get(db, other.projectId, first.id)).toBeNull();
  expect(history(db, null, first.id)).toEqual([]);
}));

test("reads a memory by topic within its owner scope", () => withDatabase(db => {
  const project = createProject(db, "Topic owner");
  const local = save(db, { projectId: project.projectId, type: "decision", title: "Module", content: "analyzed", topicKey: "atlas:module" });
  const shared = save(db, { scope: "shared", projectId: null, type: "preference", title: "Shared", content: "global", topicKey: "atlas:shared" });

  expect(getByTopic(db, project.projectId, "atlas:module")).toMatchObject({ id: local.id, projectId: project.projectId });
  expect(getByTopic(db, null, "atlas:shared")).toMatchObject({ id: shared.id, projectId: null });
  expect(getByTopic(db, null, "atlas:module")).toBeNull();
}));

test("required trims text and rejects blank or null-containing identifiers", () => {
  expect(required(" value ", "id")).toBe("value");
  for (const value of [null, "", "  ", "a\0b"]) expect(() => required(value, "id")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
});
