import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../app/memory-store";

const dirs: string[] = [];
const stores: MemoryStore[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-projects-")); dirs.push(dir);
  return join(dir, "memory.sqlite");
}
function open(path = ":memory:") { const store = new MemoryStore(path); stores.push(store); return store; }
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

test("same display names have independent persistent identities and topics", () => {
  const path = fixture(); const store = open(path);
  const a = store.createProject(" My App "); const b = store.createProject("My App");
  expect(a.projectId).toMatch(/^[0-9a-f-]{36}$/);
  expect(a.projectId).not.toBe(b.projectId);
  expect(a.name).toBe("My App");
  const saved = store.save({ projectId: a.projectId, title: "SQLite", content: "choice", type: "decision", topicKey: "db" });
  store.save({ projectId: b.projectId, title: "SQLite", content: "other", type: "decision", topicKey: "db" });
  expect(store.search(a.projectId, "SQLite").map(r => r.memory.id)).toEqual([saved.id]);
  expect(store.get(b.projectId, saved.id)).toBeNull();
  store.close();
  expect(open(path).getProject(a.projectId)).toEqual(a);
});

test("renaming preserves memory ownership, history, archive state and request replay", () => {
  const store = open(); const project = store.createProject("Before");
  const input = { projectId: project.projectId, title: "Title", content: "SQLite", type: "fact" as const, requestKey: "same", topicKey: "db" };
  const saved = store.save(input);
  store.save({ ...input, requestKey: "revision", content: "PostgreSQL", expectedVersion: 1 });
  store.archive(project.projectId, saved.id);
  expect(store.renameProject(project.projectId, "After").projectId).toBe(project.projectId);
  expect(store.getProject(project.projectId)?.name).toBe("After");
  expect(store.save(input)).toEqual(saved);
  expect(store.history(project.projectId, saved.id).map(v => v.content)).toEqual(["SQLite", "PostgreSQL"]);
  expect(store.get(project.projectId, saved.id)?.state).toBe("archived");
  expect(store.listProjects()).toHaveLength(1);
});

test("unregistered IDs and project names cannot save memories", () => {
  const store = open();
  for (const projectId of ["demo", "../escape", crypto.randomUUID()]) {
    expect(() => store.save({ projectId, title: "Title", content: "Text", type: "fact" })).toThrow();
  }
  expect(store.listProjects()).toEqual([]);
  expect(() => store.createProject(" ")).toThrow();
});

test("version 1 and 2 databases are rejected byte-for-byte unchanged", () => {
  for (const version of [1,2]) {
    const path = fixture(); const db = new Database(path);
    db.exec(`CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('keep'); PRAGMA application_id=1177956660; PRAGMA user_version=${version};`);
    db.close(); const before = readFileSync(path);
    expect(() => new MemoryStore(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
  }
});

test("a forged current schema version does not authorize schema repair", () => {
  const path = fixture(); const db = new Database(path);
  db.exec("CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('keep'); PRAGMA application_id=1177956660; PRAGMA user_version=3;");
  db.close(); const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

test("missing FTS triggers are rejected without repair", () => {
  const path = fixture(); open(path).close();
  const db = new Database(path); db.exec("DROP TRIGGER memory_update;"); db.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

test("names similar to SQLite internals cannot hide foreign tables or triggers", () => {
  const path = fixture();
  const foreign = new Database(path); foreign.exec("CREATE TABLE sqlitex_private(value TEXT);"); foreign.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
  const modified = fixture(); open(modified).close();
  const db = new Database(modified);
  db.exec("CREATE TRIGGER sqlitex_extra AFTER INSERT ON projects BEGIN SELECT 1; END;"); db.close();
  expect(() => new MemoryStore(modified)).toThrow();
});
