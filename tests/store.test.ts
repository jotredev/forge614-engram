import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/index";
import { Database } from "bun:sqlite";

const directories: string[] = [];
const stores: MemoryStore[] = [];
function database() {
  const directory = mkdtempSync(join(tmpdir(), "forge614-test-"));
  directories.push(directory);
  return join(directory, "memory.sqlite");
}
function open(path = ":memory:") {
  const store = new MemoryStore(path);
  stores.push(store);
  demoId = (store.listProjects().find(p => p.name === "Demo") ?? store.createProject("Demo")).projectId;
  otherId = (store.listProjects().find(p => p.name === "Other") ?? store.createProject("Other")).projectId;
  input.projectId = demoId;
  return store;
}
let demoId: string;
let otherId: string;
const input = { projectId: "", title: "Database choice", content: "Use SQLite locally", type: "decision" as const };
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("memoria local", () => {
  test("preserves content after closing and opening a real file", () => {
    const path = database();
    const first = open(path);
    const saved = first.save(input);
    first.close();
    expect(open(path).get(demoId, saved.id)?.content).toBe("Use SQLite locally");
  });

  test("isolates reads, history, search and archive by project", () => {
    const store = open();
    const saved = store.save(input);
    expect(store.get(otherId, saved.id)).toBeNull();
    expect(store.history(otherId, saved.id)).toEqual([]);
    expect(store.search(otherId, "SQLite")).toEqual([]);
    expect(() => store.archive(otherId, saved.id)).toThrow();
    expect(store.get(demoId, saved.id)?.state).toBe("active");
  });

  test("keeps topic keys scoped to registered project identities", () => {
    const store = open();
    const a = store.save({ ...input, projectId: demoId, topicKey: "architecture/db" });
    const b = store.save({ ...input, projectId: otherId, topicKey: "architecture/db" });
    expect(a.projectId).toBe(demoId);
    expect(a.id).not.toBe(b.id);
    expect(store.search(demoId, "SQLite")).toHaveLength(1);
  });

  test("preserves revisions and replaces old FTS content", () => {
    const store = open();
    const saved = store.save({ ...input, topicKey: "architecture/db" });
    const updated = store.save({ ...input, topicKey: "architecture/db", content: "Use PostgreSQL remotely", expectedVersion: 1 });
    expect(updated.id).toBe(saved.id);
    expect(updated.version).toBe(2);
    expect(store.history(demoId, saved.id).map(v => v.content)).toEqual(["Use SQLite locally", "Use PostgreSQL remotely"]);
    expect(store.search(demoId, "SQLite")).toEqual([]);
    expect(store.search(demoId, "PostgreSQL")[0]?.memory.id).toBe(saved.id);
  });

  test("rejects stale revisions from another connection without losing data", () => {
    const path = database();
    const one = open(path);
    const two = open(path);
    const saved = one.save({ ...input, topicKey: "database" });
    two.save({ ...input, topicKey: "database", content: "New decision", expectedVersion: 1 });
    expect(() => one.save({ ...input, topicKey: "database", expectedVersion: 1 })).toThrow();
    expect(one.get(demoId, saved.id)?.content).toBe("New decision");
    expect(one.history(demoId, saved.id)).toHaveLength(2);
  });

  test("requires a revision when replacing a topic", () => {
    const store = open();
    store.save({ ...input, topicKey: "database" });
    expect(() => store.save({ ...input, topicKey: "database", content: "Changed" })).toThrow();
    expect(() => store.save({ ...input, expectedVersion: 1 })).toThrow();
  });

  test("replayed request returns its original version even after an update", () => {
    const store = open();
    const request = { ...input, topicKey: "database", requestKey: "req-1" };
    const saved = store.save(request);
    store.save({ ...input, topicKey: "database", content: "New choice", expectedVersion: 1 });
    expect(store.save(request)).toEqual(saved);
    expect(store.history(demoId, saved.id)).toHaveLength(2);
    expect(() => store.save({ ...request, content: "Different request" })).toThrow();
  });

  test("archives reversibly without erasing versions or allowing silent replacement", () => {
    const store = open();
    const saved = store.save({ ...input, topicKey: "database" });
    store.archive(demoId, saved.id);
    expect(store.search(demoId, "SQLite")).toEqual([]);
    expect(store.get(demoId, saved.id)?.state).toBe("archived");
    expect(store.history(demoId, saved.id)).toHaveLength(1);
    expect(() => store.save({ ...input, topicKey: "database", expectedVersion: 1 })).toThrow();
    store.restore(demoId, saved.id);
    expect(store.search(demoId, "SQLite")).toHaveLength(1);
  });

  test("archive and restore accept the same trimmed IDs as get", () => {
    const store = open();
    const saved = store.save(input);
    expect(store.archive(demoId,` ${saved.id} `).state).toBe("archived");
    expect(store.restore(demoId,` ${saved.id} `).state).toBe("active");
  });

  test("a short term does not break accented case-insensitive search", () => {
    const store = open();
    store.save({ ...input, title: "ÁRBOL", content: "UI de navegación" });
    expect(store.search(demoId,"árbol")).toHaveLength(1);
    expect(store.search(demoId,"UI árbol")).toHaveLength(1);
  });

  test("limited literal searches release their statements for reuse and writes", () => {
    const store = open();
    store.save({ ...input, title: "UI first" });
    store.save({ ...input, title: "UI second" });
    expect(store.search(demoId,"UI",1)).toHaveLength(1);
    expect(store.search(demoId,"UI",1)).toHaveLength(1);
    store.save({ ...input, title: "UI third" });
    expect(store.search(demoId,"UI",10)).toHaveLength(3);
  });

  test("searches substrings and short words as literals", () => {
    const store = open();
    store.save({ ...input, title: "UI uploadHandler", content: "Discount 10% _field" });
    store.save({ ...input, title: "Other", content: "Discount 100 unrelated" });
    expect(store.search(demoId, "loadHand")).toHaveLength(1);
    expect(store.search(demoId, "UI")[0]?.explanation.mode).toBe("literal");
    expect(store.search(demoId, "10%")).toHaveLength(1);
    expect(store.search(demoId, "%")).toHaveLength(1);
    expect(store.search(demoId, "_field")).toHaveLength(1);
    expect(store.search(demoId, '" OR *')).toEqual([]);
  });

  test("requires every search term and gives title matches higher relevance", () => {
    const store = open();
    const title = store.save({ ...input, title: "retry upload", content: "Resolved safely" });
    store.save({ ...input, title: "Other issue", content: "retry upload fixed" });
    store.save({ ...input, title: "retry alone", content: "another issue" });
    const results = store.search(demoId, "retry upload");
    expect(results).toHaveLength(2);
    expect(results[0]?.memory.id).toBe(title.id);
    expect(results[0]?.explanation.bm25).toBeLessThan(0);
  });

  test("rejects empty text, invalid types and invalid limits", () => {
    const store = open();
    for (const key of ["projectId", "title", "content"] as const) {
      expect(() => store.save({ ...input, [key]: " " })).toThrow();
    }
    expect(() => store.save({ ...input, type: "invalid" as "fact" })).toThrow();
    expect(() => store.search(demoId, " ")).toThrow();
    for (const limit of [0, -1, 101, 1.5, NaN]) expect(() => store.search(demoId, "SQLite", limit)).toThrow();
    expect(store.search(demoId, "SQLite")).toEqual([]);
  });

  test("rolls back content, history and FTS together if a revision write fails", () => {
    const path = database();
    const store = open(path);
    const saved = store.save({ ...input, topicKey: "database" });
    const connection = new Database(path);
    connection.exec(`CREATE TRIGGER fail_revision BEFORE INSERT ON memory_versions
      WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'forced revision failure'); END;`);
    connection.close();
    expect(() => store.save({ ...input, topicKey: "database", expectedVersion: 1, content: "PostgreSQL" })).toThrow();
    expect(store.get(demoId,saved.id)?.content).toBe("Use SQLite locally");
    expect(store.history(demoId,saved.id)).toHaveLength(1);
    expect(store.search(demoId,"SQLite")).toHaveLength(1);
    expect(store.search(demoId,"PostgreSQL")).toEqual([]);
  });

  test("refuses an unrelated SQLite database without adding memory tables", () => {
    const path = database();
    const connection = new Database(path);
    connection.exec("CREATE TABLE personal_data(value TEXT); INSERT INTO personal_data VALUES('keep');");
    expect(() => new MemoryStore(path)).toThrow();
    expect(connection.query("SELECT value FROM personal_data").get()).toEqual({value:"keep"});
    expect(connection.query("SELECT name FROM sqlite_master WHERE name='memories'").all()).toEqual([]);
    connection.close();
  });

  test("refuses a future database version", () => {
    const path = database();
    const store = open(path);
    store.save(input);
    store.close();
    const connection = new Database(path);
    connection.exec("PRAGMA user_version=99;");
    expect(() => new MemoryStore(path)).toThrow();
    expect(connection.query("PRAGMA user_version").get()).toEqual({user_version:99});
    connection.close();
  });
});
