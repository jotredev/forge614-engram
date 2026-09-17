import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, type SaveInput } from "../../index";

const stores: MemoryStore[] = [];
const dirs: string[] = [];
function fixture(path = ":memory:") {
  const store = new MemoryStore(path); stores.push(store);
  const a = store.createProject("Same").projectId;
  const b = store.createProject("Same").projectId;
  return { store, a, b };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
const content = { title: "SQLite UI", content: "Learning", type: "fact" as const };

test("default search includes own and shared matches but never another project in either search path", () => {
  const { store, a, b } = fixture();
  const own = store.save({ ...content, projectId: a });
  const shared = store.save({ ...content, scope: "shared", projectId: null });
  store.save({ ...content, projectId: b });
  for (const query of ["SQLite", "UI"]) {
    expect(store.search(a, query).map(r => r.memory.id).sort()).toEqual([own.id, shared.id].sort());
    expect(store.search(a, query, 10, "project").map(r => r.memory.id)).toEqual([own.id]);
    expect(store.search(a, query, 10, "shared").map(r => r.memory.id)).toEqual([shared.id]);
    expect(store.search(null, query, 10, "shared").map(r => r.memory.id)).toEqual([shared.id]);
    expect(store.search(a, query, 1)).toHaveLength(1);
  }
  expect(own.scope).toBe("project");
  expect(shared.projectId).toBeNull(); expect(shared.scope).toBe("shared");
});

test("shared memory needs no projects and is explicitly selected for direct reads and mutations", () => {
  const store = new MemoryStore(":memory:"); stores.push(store);
  const shared = store.save({ ...content, scope: "shared", projectId: null });
  expect(store.listProjects()).toEqual([]);
  expect(store.get(null, shared.id)?.scope).toBe("shared");
  expect(store.history(null, shared.id)).toEqual([shared]);
  const a = store.createProject("A").projectId;
  expect(store.get(a, shared.id)).toBeNull();
  expect(store.history(a, shared.id)).toEqual([]);
  expect(() => store.archive(a, shared.id)).toThrow();
  store.archive(null, shared.id);
  expect(store.search(null, "SQLite", 10, "shared")).toEqual([]);
  expect(store.history(null, shared.id)).toEqual([shared]);
  store.restore(null, shared.id);
  expect(store.search(a, "SQLite")).toHaveLength(1);
});

test("identical topic and request keys stay independent in shared and project namespaces", () => {
  const { store, a, b } = fixture();
  const input = { ...content, topicKey: "runtime", requestKey: "first" };
  const sharedInput = { ...input, scope: "shared" as const, projectId: null };
  const shared = store.save(sharedInput);
  const one = store.save({ ...input, projectId: a });
  const two = store.save({ ...input, projectId: b });
  expect(new Set([shared.id, one.id, two.id]).size).toBe(3);
  const revised = store.save({ ...sharedInput, content: "New learning", expectedVersion: 1, requestKey: "second" });
  expect(revised.version).toBe(2);
  expect(store.save(sharedInput)).toEqual(shared);
  expect(() => store.save({ ...sharedInput, content: "Collision" })).toThrow();
  expect(() => store.save({ ...sharedInput, requestKey: "third" })).toThrow();
  expect(store.history(null, shared.id).map(r => r.content)).toEqual(["Learning", "New learning"]);
  expect(store.get(a, one.id)?.version).toBe(1);
});

test("an active exact project topic overrides shared only in combined search and archive restores shared visibility", () => {
  const { store, a, b } = fixture();
  const shared = store.save({ ...content, scope: "shared", projectId: null, topicKey: "runtime" });
  const own = store.save({ projectId: a, topicKey: "runtime", title: "Node exception", content: "Use Node", type: "decision" });
  for (const query of ["SQLite", "UI"]) {
    // Shadowing is by topic identity, not by whether the override matches query.
    expect(store.search(a, query)).toEqual([]);
    expect(store.search(b, query).map(r => r.memory.id)).toEqual([shared.id]);
    expect(store.search(a, query, 10, "shared").map(r => r.memory.id)).toEqual([shared.id]);
  }
  store.archive(a, own.id);
  expect(store.search(a, "SQLite").map(r => r.memory.id)).toEqual([shared.id]);
  store.restore(a, own.id);
  expect(store.search(a, "SQLite")).toEqual([]);
  expect(store.get(null, shared.id)?.state).toBe("active");
});

test("matching text without a matching topic does not silently merge project and shared memories", () => {
  const { store, a } = fixture();
  store.save({ ...content, scope: "shared", projectId: null });
  store.save({ ...content, projectId: a });
  expect(store.search(a, "SQLite")).toHaveLength(2);
});

test("invalid scope/identity pairs and ambiguous shared access fail closed", () => {
  const { store, a } = fixture();
  const invalid = [
    { ...content }, { ...content, projectId: null },
    { ...content, scope: "project", projectId: null },
    { ...content, scope: "shared", projectId: a },
    { ...content, scope: "all", projectId: a },
    { ...content, scope: "project", projectId: crypto.randomUUID() },
  ];
  for (const input of invalid) expect(() => store.save(input as SaveInput)).toThrow();
  expect(() => store.search(null, "SQLite")).toThrow();
  expect(() => store.search(null, "SQLite", 10, "project")).toThrow();
  expect(() => store.search(crypto.randomUUID(), "SQLite")).toThrow();
  expect(store.search(null, "SQLite", 10, "shared")).toEqual([]);
});

test("schema prevents invalid ownership and duplicate shared topics even outside the SDK", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge614-shared-")); dirs.push(dir);
  const path = join(dir, "memory.sqlite"); const { store, a } = fixture(path);
  const shared = store.save({ ...content, scope: "shared", projectId: null, topicKey: "topic" });
  const own = store.save({ ...content, projectId: a, topicKey: "topic" });
  const db = new Database(path); db.exec("PRAGMA foreign_keys=ON;");
  try {
    expect(() => db.query("UPDATE memories SET projectId=? WHERE id=?").run(a, shared.id)).toThrow();
    expect(() => db.query("UPDATE memories SET projectId=NULL WHERE id=?").run(own.id)).toThrow();
    expect(() => db.query("UPDATE memories SET scope='shared', projectId=NULL WHERE id=?").run(own.id)).toThrow();
    expect(db.query("SELECT scope,projectId FROM memories WHERE id=?").get(shared.id)).toEqual({ scope: "shared", projectId: null });
  } finally { db.close(); }
});
