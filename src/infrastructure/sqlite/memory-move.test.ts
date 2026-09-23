import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { bindProjectToGroup, createGroup, identityEvents } from "./ecosystem-groups";
import { get, history } from "./memory";
import { createProject } from "./projects";
import { enableEcosystem, enableProjectBindings, enableSearchReinforcement, enableSessionLifecycle } from "./schema";
import { search } from "./search";
import { archive, moveMemoryToGroup, save, startSession, saveSessionSummary } from "./writes";

function setup(run: (db: Database, x: { project: string; group: string; other: string }) => void, reinforcement = false): void {
  withDatabase(db => {
    enableProjectBindings(db); if (reinforcement) enableSearchReinforcement(db); enableEcosystem(db);
    const project = createProject(db, "Frontend").projectId;
    const group = createGroup(db, "tienda").id, other = createGroup(db, "otra").id;
    run(db, { project, group, other });
  });
}
const note = (project: string, extra: Record<string, unknown> = {}) => ({ scope: "project" as const, projectId: project, title: "Contrato", content: "v1", type: "decision" as const, topicKey: "api", ...extra });

test("moving keeps the id, appends a version and preserves the whole history", () => setup((db, { project, group }) => {
  const first = save(db, note(project));
  save(db, note(project, { content: "v2", expectedVersion: 1 }));
  const moved = moveMemoryToGroup(db, project, first.id, group);
  expect(moved.from).toEqual({ scope: "project", projectId: project });
  expect(moved.memory).toMatchObject({ id: first.id, scope: "ecosystem", projectId: null, groupId: group, version: 3, content: "v2", state: "active", createdAt: first.createdAt });
  expect(history(db, { groupId: group }, first.id).map(version => [version.version, version.scope, version.content])).toEqual([[1, "project", "v1"], [2, "project", "v2"], [3, "ecosystem", "v2"]]);
  expect(get(db, project, first.id)).toBeNull();
  expect(get(db, { groupId: group }, first.id)?.version).toBe(3);
  expect(db.query("SELECT count(*) AS n FROM memories WHERE id=?").get(first.id)).toEqual({ n: 1 });
  expect(db.query("SELECT action,version FROM events WHERE memory_id=? ORDER BY id").all(first.id)).toEqual([{ action: "save", version: 1 }, { action: "save", version: 2 }, { action: "save", version: 3 }]);
  expect(identityEvents(db).filter(event => event.action === "MEMORY_MOVED")).toEqual([expect.objectContaining({ memoryId: first.id, previousProjectId: project, groupId: group })]);
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('integrity-check')");
  expect(search(db, null, "Contrato", 5, "ecosystem", group).map(result => result.memory.id)).toEqual([first.id]);
}));

test("a shared memory moves too and an archived one stays archived", () => setup((db, { group }) => {
  const shared = save(db, { scope: "shared", projectId: null, title: "S", content: "c", type: "fact", topicKey: "s" });
  expect(moveMemoryToGroup(db, null, shared.id, group).from).toEqual({ scope: "shared", projectId: null });
  const other = save(db, { scope: "shared", projectId: null, title: "T", content: "c", type: "fact" });
  archive(db, null, other.id);
  expect(moveMemoryToGroup(db, null, other.id, group).memory.state).toBe("archived");
}));

test("nothing is copied, overwritten or deleted silently", () => setup((db, { project, group, other }) => {
  const mine = save(db, note(project));
  const taken = save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Ya", content: "c", type: "fact", topicKey: "api" });
  expect(() => moveMemoryToGroup(db, project, mine.id, group)).toThrow(expect.objectContaining({ code: "TOPIC_CONFLICT" }));
  expect(get(db, project, mine.id)?.version).toBe(1);
  expect(get(db, { groupId: group }, taken.id)?.content).toBe("c");
  expect(() => moveMemoryToGroup(db, project, crypto.randomUUID(), group)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(() => moveMemoryToGroup(db, null, mine.id, group)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(() => moveMemoryToGroup(db, project, mine.id, crypto.randomUUID())).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
  moveMemoryToGroup(db, project, mine.id, other);
  expect(() => moveMemoryToGroup(db, project, mine.id, group)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(identityEvents(db).filter(event => event.action === "MEMORY_MOVED")).toHaveLength(1);
}));

test("request keys travel with the memory and a colliding key stops the move", () => setup((db, { project, group }) => {
  const first = save(db, note(project, { requestKey: "k" }));
  save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Otra", content: "c", type: "fact", requestKey: "k" });
  expect(() => moveMemoryToGroup(db, project, first.id, group)).toThrow(expect.objectContaining({ code: "REQUEST_CONFLICT" }));
  const free = save(db, note(project, { topicKey: "libre", requestKey: "libre" }));
  moveMemoryToGroup(db, project, free.id, group);
  expect(db.query("SELECT scope,projectId,groupId FROM requests WHERE request_key='libre'").get()).toEqual({ scope: "ecosystem", projectId: null, groupId: group });
  // The key now belongs to the group's namespace, so a different payload under it is refused.
  expect(() => save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Nuevo", content: "otro", type: "fact", requestKey: "libre" })).toThrow(expect.objectContaining({ code: "REQUEST_CONFLICT" }));
}));

test("confirmations keep pointing at the moved memory", () => setup((db, { project, group }) => {
  const first = save(db, note(project, { topicKey: undefined })); save(db, note(project, { topicKey: undefined }));
  moveMemoryToGroup(db, project, first.id, group);
  expect(db.query("SELECT count(*) AS n FROM confirmations WHERE memoryId=?").get(first.id)).toEqual({ n: 1 });
}, true));

test("a session summary cannot be moved out of its project", () => setup((db, { project, group }) => {
  enableSessionLifecycle(db);
  startSession(db, project, "s1");
  const summary = saveSessionSummary(db, project, "s1", { goal: "g", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: "r" });
  expect(() => moveMemoryToGroup(db, project, summary.memory.id, group)).toThrow(expect.objectContaining({ code: "SUMMARY_TOPIC_RESERVED" }));
}));
