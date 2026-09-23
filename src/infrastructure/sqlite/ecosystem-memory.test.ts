import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { bindProjectToGroup, createGroup } from "./ecosystem-groups";
import { get, getByTopic, history } from "./memory";
import { createProject } from "./projects";
import { enableEcosystem, enableProjectBindings, enableSearchReinforcement, enableSessionLifecycle } from "./schema";
import { context, getVersion, search, searchPreviews } from "./search";
import { archive, restore, save, saveWithSession } from "./writes";

type Level = "bindings" | "sessions" | "reinforcement";
function ecosystem(run: (db: Database, x: { project: string; other: string; group: string; second: string }) => void, level: Level = "bindings"): void {
  withDatabase(db => {
    enableProjectBindings(db);
    if (level === "sessions") enableSessionLifecycle(db);
    if (level === "reinforcement") enableSearchReinforcement(db);
    enableEcosystem(db);
    const project = createProject(db, "Frontend").projectId, other = createProject(db, "Loose").projectId;
    const group = createGroup(db, "tienda").id, second = createGroup(db, "otra").id;
    bindProjectToGroup(db, project, group, "command");
    run(db, { project, other, group, second });
  });
}
const eco = (group: string, extra: Record<string, unknown> = {}) => ({ scope: "ecosystem" as const, projectId: null, groupId: group, title: "Regla", content: "contenido compartido", type: "decision" as const, ...extra });

test("an ecosystem memory keeps topic, version, history, archive and restore semantics", () => ecosystem((db, { group }) => {
  const first = save(db, eco(group, { topicKey: "api/contrato" }));
  expect(first).toMatchObject({ scope: "ecosystem", groupId: group, projectId: null, version: 1, topicKey: "api/contrato" });
  const second = save(db, eco(group, { topicKey: "api/contrato", content: "nueva", expectedVersion: 1 }));
  expect(second).toMatchObject({ id: first.id, version: 2 });
  expect(() => save(db, eco(group, { topicKey: "api/contrato", content: "otra", expectedVersion: 1 }))).toThrow(expect.objectContaining({ code: "VERSION_CONFLICT" }));
  expect(() => save(db, eco(group, { topicKey: "api/contrato", content: "sin version" }))).toThrow(expect.objectContaining({ code: "VERSION_CONFLICT" }));
  expect(history(db, { groupId: group }, first.id).map(version => version.version)).toEqual([1, 2]);
  expect(get(db, { groupId: group }, first.id)).toMatchObject({ id: first.id, state: "active", groupId: group });
  expect(getByTopic(db, { groupId: group }, "api/contrato")?.id).toBe(first.id);
  expect(archive(db, { groupId: group }, first.id).state).toBe("archived");
  expect(() => save(db, eco(group, { topicKey: "api/contrato", content: "x", expectedVersion: 2 }))).toThrow(expect.objectContaining({ code: "ARCHIVED" }));
  expect(restore(db, { groupId: group }, first.id).state).toBe("active");
  expect(getVersion(db, { groupId: group }, first.id, 1)?.memory.content).toBe("contenido compartido");
}));

test("ecosystem memories never leak into the project or shared namespaces", () => ecosystem((db, { project, group, second }) => {
  const shared = save(db, { scope: "shared", projectId: null, title: "S", content: "c", type: "fact", topicKey: "t" });
  const mine = save(db, { scope: "project", projectId: project, title: "P", content: "c", type: "fact", topicKey: "t" });
  const group1 = save(db, eco(group, { topicKey: "t" }));
  const group2 = save(db, eco(second, { topicKey: "t" }));
  expect(new Set([shared.id, mine.id, group1.id, group2.id]).size).toBe(4);
  expect(get(db, null, group1.id)).toBeNull();
  expect(get(db, project, group1.id)).toBeNull();
  expect(get(db, { groupId: second }, group1.id)).toBeNull();
  expect(get(db, { groupId: group }, shared.id)).toBeNull();
  expect(get(db, { groupId: group }, mine.id)).toBeNull();
  expect(getByTopic(db, null, "t")?.id).toBe(shared.id);
  expect(history(db, null, group1.id)).toEqual([]);
  expect(() => archive(db, null, group1.id)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
}));

test("saving needs an existing group and a database enrolled in the ecosystem level", () => {
  ecosystem((db, { group }) => {
    expect(() => save(db, eco(crypto.randomUUID()))).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
    expect(() => save(db, { ...eco(group), projectId: crypto.randomUUID() } as never)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
  withDatabase(db => {
    enableProjectBindings(db);
    expect(() => save(db, eco(crypto.randomUUID()))).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
    expect(() => get(db, { groupId: crypto.randomUUID() }, "x")).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  });
});

test("search precedence is project over ecosystem over shared for a repeated topic", () => ecosystem((db, { project, other, group }) => {
  const shared = save(db, { scope: "shared", projectId: null, title: "Deploy", content: "compartida despliegue", type: "procedure", topicKey: "deploy" });
  const ecosystemMemory = save(db, eco(group, { title: "Deploy", content: "ecosistema despliegue", topicKey: "deploy" }));
  const ids = (scopeName: "all" | "project" | "shared" | "ecosystem", from: string | null = project, groupId?: string) =>
    search(db, from, "despliegue", 10, scopeName, groupId).map(result => result.memory.id);
  expect(ids("all")).toEqual([ecosystemMemory.id]);
  const mine = save(db, { scope: "project", projectId: project, title: "Deploy", content: "proyecto despliegue", type: "procedure", topicKey: "deploy" });
  expect(ids("all")).toEqual([mine.id]);
  archive(db, project, mine.id);
  expect(ids("all")).toEqual([ecosystemMemory.id]);
  archive(db, { groupId: group }, ecosystemMemory.id);
  expect(ids("all")).toEqual([shared.id]);
  restore(db, { groupId: group }, ecosystemMemory.id);
  // A project outside the group keeps today's behavior: it only sees shared.
  expect(ids("all", other)).toEqual([shared.id]);
  expect(ids("shared", null)).toEqual([shared.id]);
  expect(ids("ecosystem")).toEqual([ecosystemMemory.id]);
  expect(ids("ecosystem", null, group)).toEqual([ecosystemMemory.id]);
  expect(() => ids("ecosystem", other)).toThrow(expect.objectContaining({ code: "GROUP_REQUIRED" }));
  expect(() => ids("ecosystem", null)).toThrow(expect.objectContaining({ code: "GROUP_REQUIRED" }));
  expect(searchPreviews(db, project, "despliegue", 10, "ecosystem")[0]!.memory).toMatchObject({ scope: "ecosystem", groupId: group });
}));

test("a project that joins a group starts seeing its memories in all-scope search, without duplicates", () => ecosystem((db, { other, group }) => {
  const memory = save(db, eco(group, { title: "Convención", content: "usa kebab-case en rutas", topicKey: "estilo" }));
  expect(search(db, other, "kebab-case", 10, "all")).toEqual([]);
  bindProjectToGroup(db, other, group, "command");
  expect(search(db, other, "kebab-case", 10, "all").map(result => result.memory.id)).toEqual([memory.id]);
}));

test("context can orient on the ecosystem block and leaves project and shared blocks unchanged", () => ecosystem((db, { project, group }) => {
  save(db, eco(group, { title: "Anclada", content: "importante", pinned: true }));
  save(db, eco(group, { title: "Reciente", content: "otra" }));
  save(db, { scope: "project", projectId: project, title: "Mía", content: "c", type: "fact" });
  const block = context(db, { groupId: group });
  expect(block.pinned.map(row => row.title)).toEqual(["Anclada"]);
  expect(block.recent.map(row => row.title)).toEqual(["Reciente"]);
  expect(block.pinned[0]).toMatchObject({ scope: "ecosystem", groupId: group });
  expect(context(db, project).recent.map(row => row.title)).toEqual(["Mía"]);
  expect(context(db, null).recent).toEqual([]);
}));

test("request keys replay per group and never collide across scopes", () => ecosystem((db, { project, group, second }) => {
  const first = save(db, eco(group, { requestKey: "k", topicKey: "a" }));
  expect(save(db, eco(group, { requestKey: "k", topicKey: "a" })).id).toBe(first.id);
  expect(() => save(db, eco(group, { requestKey: "k", topicKey: "a", content: "distinto" }))).toThrow(expect.objectContaining({ code: "REQUEST_CONFLICT" }));
  expect(save(db, eco(second, { requestKey: "k", topicKey: "a" })).id).not.toBe(first.id);
  expect(save(db, { scope: "project", projectId: project, title: "P", content: "c", type: "fact", requestKey: "k" }).scope).toBe("project");
  expect(save(db, { scope: "shared", projectId: null, title: "S", content: "c", type: "fact", requestKey: "k" }).scope).toBe("shared");
}));

test("repeating an identical untopiced ecosystem memory is a confirmation when reinforcement is on", () => ecosystem((db, { group, second }) => {
  const first = save(db, eco(group));
  const again = save(db, eco(group));
  expect(again).toMatchObject({ id: first.id, version: 1 });
  expect(db.query("SELECT count(*) AS n FROM confirmations").get()).toEqual({ n: 1 });
  expect(save(db, eco(second)).id).not.toBe(first.id);
}, "reinforcement"));

test("ecosystem memories can be tied to an explicit session like shared ones", () => ecosystem((db, { project, group }) => {
  db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES('s1',?,'runtime','now',NULL)").run(project);
  expect(() => saveWithSession(db, eco(group), { sessionId: "s1" })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  const saved = saveWithSession(db, eco(group), { sessionId: "s1", projectId: project });
  expect(saved).toMatchObject({ sessionId: "s1", sessionSource: "explicit" });
  expect(db.query("SELECT sessionId FROM session_entries WHERE memoryId=?").get(saved.memory.id)).toEqual({ sessionId: "s1" });
  // Without an explicit session an ecosystem save is not attached to the manual project session.
  expect(saveWithSession(db, eco(group, { title: "Otra" }), {}).sessionId).toBeNull();
}, "sessions"));

test("databases below the ecosystem level keep project and shared behavior untouched", () => withDatabase(db => {
  enableProjectBindings(db);
  const project = createProject(db, "Old").projectId;
  const mine = save(db, { scope: "project", projectId: project, title: "P", content: "texto", type: "fact", topicKey: "t" });
  const shared = save(db, { scope: "shared", projectId: null, title: "S", content: "texto", type: "fact", topicKey: "t" });
  expect(search(db, project, "texto", 10, "all").map(result => result.memory.id)).toEqual([mine.id]);
  expect(get(db, null, shared.id)?.id).toBe(shared.id);
  expect(get(db, project, mine.id)?.id).toBe(mine.id);
  expect(Object.keys(mine)).not.toContain("groupId");
  expect(() => search(db, project, "texto", 10, "ecosystem")).toThrow(expect.objectContaining({ code: "GROUP_REQUIRED" }));
}));
