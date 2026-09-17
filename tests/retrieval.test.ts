import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryError, MemoryStore } from "../src/index";

const directories: string[] = [];
function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "forge614-retrieval-"));
  directories.push(directory);
  return join(directory, "memory.sqlite");
}
afterEach(() => {
  setSystemTime();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("preview is code-point bounded and full read remains exact", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Unicode");
    for (const size of [299, 300, 301]) {
      const content = "😀".repeat(size);
      store.save({ projectId, title: `Unicode ${size}`, content, type: "decision" });
    }
    const previews = store.searchPreviews(projectId, "Unicode");
    const byTitle = new Map(previews.map(row => [row.memory.title, row.memory]));
    expect(Array.from(byTitle.get("Unicode 299")!.preview)).toHaveLength(299);
    expect(Array.from(byTitle.get("Unicode 300")!.preview)).toHaveLength(300);
    expect(Array.from(byTitle.get("Unicode 301")!.preview)).toHaveLength(300);
    expect(byTitle.get("Unicode 301")!.truncated).toBe(true);
    expect(byTitle.get("Unicode 300")!.truncated).toBe(false);
    expect(byTitle.get("Unicode 301")!).not.toHaveProperty("content");
    expect(store.getVersion(projectId, byTitle.get("Unicode 301")!.id)?.memory.content).toBe("😀".repeat(301));
  } finally { store.close(); }
});

test("literal previews preserve Unicode matching and full-search order", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Literal");
    store.save({ projectId, title: "後🙂", content: "e\u0301 punctuation!", type: "fact", pinned: false });
    store.save({ projectId, title: "先🙂", content: "後 e\u0301 punctuation!", type: "fact", pinned: true });
    for (const query of ["🙂", "後 🙂", "e\u0301", "!"]) {
      expect(store.searchPreviews(projectId, query).map(row => row.memory.id))
        .toEqual(store.search(projectId, query).map(row => row.memory.id));
    }
  } finally { store.close(); }
});

test("FTS preview ordering and explanations exactly match full search", () => {
  setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Rank");
    store.save({ projectId, title: "SQLite ranking alpha", content: "SQLite ranking body", type: "fact" });
    store.save({ projectId, title: "SQLite ranking beta", content: "SQLite ranking SQLite ranking", type: "decision", pinned: true });
    const full = store.search(projectId, "SQLite ranking");
    const previews = store.searchPreviews(projectId, "SQLite ranking");
    expect(previews.map(row => row.memory.id)).toEqual(full.map(row => row.memory.id));
    for (const [index,row] of previews.entries()) {
      expect(row.explanation.mode).toBe(full[index]!.explanation.mode);
      expect(row.explanation.bm25).toBe(full[index]!.explanation.bm25);
      expect(row.explanation.multiplier).toBeCloseTo(full[index]!.explanation.multiplier,8);
      expect(row.explanation.orderScore).toBeCloseTo(full[index]!.explanation.orderScore!,12);
    }
  } finally { store.close(); }
});

test("version reads are exact, report current state, and enforce ownership", () => {
  const store = new MemoryStore(":memory:");
  try {
    const one = store.createProject("One"), two = store.createProject("Two");
    const v1 = store.save({ projectId: one.projectId, title: "First", content: "original", type: "fact", topicKey: "topic" });
    store.save({ projectId: one.projectId, title: "Second", content: "current", type: "decision", topicKey: "topic", expectedVersion: 1 });
    store.archive(one.projectId, v1.id);
    expect(store.getVersion(one.projectId, v1.id, 1)).toMatchObject({ memory: v1, currentVersion: 2, state: "archived" });
    expect(store.getVersion(one.projectId, `  ${v1.id}  `, 1)).toMatchObject({ memory: v1, currentVersion: 2, state: "archived" });
    expect(store.getVersion(two.projectId, `  ${v1.id}  `, 1)).toBeNull();
    expect(store.getVersion(one.projectId, v1.id, 99)).toBeNull();
    expect(store.getVersion(two.projectId, v1.id, 1)).toBeNull();
  } finally { store.close(); }
});

test("timeline keeps the exact historical focus and deterministic same-time neighbors", () => {
  const path = database(); const store = new MemoryStore(path);
  try {
    store.enableSessions(); const { projectId } = store.createProject("Timeline");
    store.startSession(projectId, "chat");
    const a = store.saveWithSession({ projectId, title: "A", content: "a".repeat(200), type: "fact", topicKey: "a" }, { sessionId: "chat" }).memory;
    const b1 = store.saveWithSession({ projectId, title: "B1", content: "old".repeat(200), type: "decision", topicKey: "b" }, { sessionId: "chat" }).memory;
    const c = store.saveWithSession({ projectId, title: "C", content: "c".repeat(200), type: "warning" }, { sessionId: "chat" }).memory;
    store.saveWithSession({ projectId, title: "B2", content: "new", type: "decision", topicKey: "b", expectedVersion: 1 }, { sessionId: "chat" });
    const db = new Database(path);
    db.query("UPDATE session_entries SET recordedAt='2026-01-01T00:00:00.000Z' WHERE memoryId IN (?,?,?)").run(a.id, b1.id, c.id);
    db.close();
    const timeline = store.timeline(projectId, { sessionId: "chat", memoryId: b1.id, version: 1, before: 20, after: 20 });
    expect(timeline.focus.memory.version).toBe(1);
    expect(timeline.focus.memory.preview).toBe(b1.content.slice(0, 500));
    expect([...timeline.before, timeline.focus, ...timeline.after].map(row => row.memory.id))
      .toEqual([{id:a.id,version:1},{id:b1.id,version:1},{id:b1.id,version:2},{id:c.id,version:1}]
        .sort((left,right) => left.id.localeCompare(right.id) || left.version-right.version).map(row=>row.id));
    expect(timeline.before.every(row => Array.from(row.memory.preview).length <= 150)).toBe(true);
  } finally { store.close(); }
});

test("timeline requires session enrollment and never exposes another owner or an unassociated memory", () => {
  const store = new MemoryStore(":memory:");
  try {
    const one = store.createProject("One"), two = store.createProject("Two");
    const old = store.save({ projectId: one.projectId, title: "Old", content: "body", type: "fact" });
    expect(() => store.timeline(one.projectId, { sessionId: "none", memoryId: old.id, version: 1 })).toThrow("Habilita");
    store.enableSessions(); store.startSession(one.projectId, "chat");
    expect(() => store.timeline(one.projectId, { sessionId: "chat", memoryId: old.id, version: 1 })).toThrow("NO_SESSION_CONTEXT");
    expect(() => store.timeline(two.projectId, { sessionId: "chat", memoryId: old.id, version: 1 })).toThrow();
  } finally { store.close(); }
});

test("context honors overrides, section caps, compact mode, and whole-JSON byte budgets", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Context");
    store.save({ scope: "shared", projectId: null, title: "Shared old", content: "shared", type: "fact", topicKey: "same", pinned: true });
    const replacement = store.save({ projectId, title: "Local override", content: "é".repeat(400), type: "fact", topicKey: "same", pinned: true });
    for (let i = 0; i < 22; i++) store.save({ projectId, title: `Pinned ${i}`, content: "p", type: "fact", pinned: true });
    for (let i = 0; i < 22; i++) store.save({ projectId, title: `Recent ${i}`, content: "r", type: "fact" });
    const roomy = store.context(projectId, { maxBytes: 65536 });
    expect(roomy.pinned).toHaveLength(20); expect(roomy.recent).toHaveLength(20);
    expect(roomy.pinned.some(row => row.title === "Shared old")).toBe(false);
    expect(roomy.omitted).toEqual({ pinned: 3, recent: 5, summaries: 0 });
    const compact = store.context(projectId, { compact: true, maxBytes: 1024 });
    expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThanOrEqual(1024);
    expect([...compact.pinned, ...compact.recent].every(row => !("preview" in row))).toBe(true);
    expect(compact.truncated).toBe(true);
    expect(store.getVersion(projectId, replacement.id)?.memory.content).toBe("é".repeat(400));
  } finally { store.close(); }
});

test("shared context is shared-only and excludes private summaries", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions(); const { projectId } = store.createProject("Private"); store.startSession(projectId, "chat");
    store.saveSessionSummary(projectId, "chat", { goal: "secret", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: "summary" });
    const shared = store.save({ scope: "shared", projectId: null, title: "Global", content: "visible", type: "fact", pinned: true });
    const context = store.context(null);
    expect(context.summaries).toEqual([]);
    expect(context.pinned.map(row => row.id)).toEqual([shared.id]);
  } finally { store.close(); }
});

test("retrieval through a readonly facade does not mutate timestamps or events", () => {
  const path = database(); const writer = new MemoryStore(path);
  const { projectId } = writer.createProject("Readonly");
  const saved = writer.save({ projectId, title: "Read only", content: "unchanged", type: "fact" }); writer.close();
  const before = new Database(path, { readonly: true });
  const events = before.query("SELECT * FROM events ORDER BY id").all(); before.close();
  const reader = new MemoryStore(path, { readonly: true });
  try {
    expect(reader.searchPreviews(projectId, "Read only")).toHaveLength(1);
    expect(reader.getVersion(projectId, saved.id)?.memory).toEqual(saved);
    expect(reader.context(projectId).recent[0]?.id).toBe(saved.id);
  } finally { reader.close(); }
  const after = new Database(path, { readonly: true });
  expect(after.query("SELECT * FROM events ORDER BY id").all()).toEqual(events); after.close();
});

test("pinned overflow remains eligible for the recent stream without duplicate counting", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Pinned spill");
    for (let i = 0; i < 25; i++) store.save({ projectId, title: `Pinned ${i}`, content: `${i}`, type: "fact", pinned: true });
    const result = store.context(projectId, { compact: true, maxBytes: 65536 });
    expect(result.pinned).toHaveLength(20);
    expect(result.recent).toHaveLength(5);
    expect(new Set([...result.pinned, ...result.recent].map(row => `${row.id}/${row.version}`)).size).toBe(25);
    expect(result.omitted).toEqual({ pinned: 5, recent: 0, summaries: 0 });
  } finally { store.close(); }
});

test("timeline honors zero neighbors, default five-per-side, and archive visibility", () => {
  const path = database(); const store = new MemoryStore(path);
  try {
    store.enableSessions(); const { projectId } = store.createProject("Bounds"); store.startSession(projectId, "chat");
    const saved = Array.from({ length: 13 }, (_, i) => store.saveWithSession({
      projectId, title: `Entry ${String(i).padStart(2, "0")}`, content: `body-${i}`, type: "fact",
    }, { sessionId: "chat" }).memory);
    const db = new Database(path);
    saved.forEach((memory, i) => db.query("UPDATE session_entries SET recordedAt=? WHERE memoryId=? AND version=1")
      .run(`2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`, memory.id));
    db.close();
    const zero = store.timeline(projectId, { sessionId: "chat", memoryId: saved[6]!.id, version: 1, before: 0, after: 0 });
    expect(zero.before).toEqual([]); expect(zero.after).toEqual([]);
    const defaults = store.timeline(projectId, { sessionId: "chat", memoryId: saved[6]!.id, version: 1 });
    expect(defaults.before).toHaveLength(5); expect(defaults.after).toHaveLength(5);
    store.archive(projectId, saved[5]!.id); store.archive(projectId, saved[7]!.id);
    const withoutArchivedNeighbors = store.timeline(projectId, { sessionId: "chat", memoryId: saved[6]!.id, version: 1 });
    expect([...withoutArchivedNeighbors.before, ...withoutArchivedNeighbors.after].map(row => row.memory.id))
      .not.toContain(saved[5]!.id);
    expect([...withoutArchivedNeighbors.before, ...withoutArchivedNeighbors.after].map(row => row.memory.id))
      .not.toContain(saved[7]!.id);
    store.archive(projectId, saved[6]!.id);
    expect(() => store.timeline(projectId, { sessionId: "chat", memoryId: saved[6]!.id, version: 1 })).toThrow("NO_SESSION_CONTEXT");
  } finally { store.close(); }
});

test("timeline permits a shared focus only through its private owner session", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions(); const owner = store.createProject("Owner"), stranger = store.createProject("Stranger");
    store.startSession(owner.projectId, "owner-chat");
    const shared = store.saveWithSession({ scope: "shared", projectId: null, title: "Shared", content: "origin", type: "fact" },
      { sessionId: "owner-chat", projectId: owner.projectId }).memory;
    expect(store.timeline(owner.projectId, { sessionId: "owner-chat", memoryId: shared.id, version: 1 }).focus.memory.id).toBe(shared.id);
    expect(() => store.timeline(stranger.projectId, { sessionId: "owner-chat", memoryId: shared.id, version: 1 })).toThrow("NO_SESSION_CONTEXT");
  } finally { store.close(); }
});

test("context orders summaries by session start and de-duplicates earlier exact rows", () => {
  const path = database(); const store = new MemoryStore(path);
  try {
    store.enableSessions(); const { projectId } = store.createProject("Summaries");
    for (let i = 0; i < 2; i++) {
      store.startSession(projectId, `chat-${i}`);
      store.saveSessionSummary(projectId, `chat-${i}`, { goal: `goal-${i}`, instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: `summary-${i}` });
    }
    for (let i = 0; i < 20; i++) store.save({ projectId, title: `New ${i}`, content: "new", type: "fact" });
    const db = new Database(path);
    db.query("UPDATE sessions SET startedAt=? WHERE sessionId=?").run("2026-01-01T00:00:00.000Z", "chat-0");
    db.query("UPDATE sessions SET startedAt=? WHERE sessionId=?").run("2026-02-01T00:00:00.000Z", "chat-1");
    db.query("UPDATE memories SET updated_at='2099-01-01T00:00:00.000Z' WHERE title LIKE 'New %'").run(); db.close();
    const result = store.context(projectId, { maxBytes: 65536 });
    expect(result.summaries.map(row => row.title)).toEqual(["Session summary: chat-1", "Session summary: chat-0"]);
    const keys = [...result.pinned, ...result.recent, ...result.summaries].map(row => `${row.id}/${row.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result.omitted.summaries).toBe(0);
  } finally { store.close(); }
});

test("context excludes an intentional summary duplicate without counting it as omitted", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions(); const { projectId } = store.createProject("Summary duplicate");
    store.startSession(projectId, "chat");
    const summary = store.saveSessionSummary(projectId, "chat", {
      goal: "Only once", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [],
    }, { requestKey: "summary" }).memory;
    const result = store.context(projectId, { maxBytes: 65536 });
    const key = `${summary.id}/${summary.version}`;
    expect(result.recent.map(row => `${row.id}/${row.version}`)).toContain(key);
    expect(result.summaries.map(row => `${row.id}/${row.version}`)).not.toContain(key);
    expect([...result.pinned, ...result.recent, ...result.summaries]
      .filter(row => `${row.id}/${row.version}` === key)).toHaveLength(1);
    expect(result.omitted.summaries).toBe(0);
  } finally { store.close(); }
});

test("context archive and restore update active candidates without changing content", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Active");
    const saved = store.save({ projectId, title: "Candidate", content: "preserved", type: "fact", pinned: true });
    expect(store.context(projectId).pinned.map(row => row.id)).toContain(saved.id);
    store.archive(projectId, saved.id); expect(store.context(projectId).pinned.map(row => row.id)).not.toContain(saved.id);
    store.restore(projectId, saved.id); expect(store.context(projectId).pinned.map(row => row.id)).toContain(saved.id);
    expect(store.getVersion(projectId, saved.id)?.memory.content).toBe("preserved");
  } finally { store.close(); }
});

test("context drops huge titles and noncompact multibyte previews to fit the complete JSON budget", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Bytes");
    store.save({ projectId, title: "界".repeat(2000), content: "界".repeat(300), type: "fact", pinned: true });
    const huge = store.context(projectId, { compact: true, maxBytes: 1024 });
    expect(huge.pinned).toEqual([]); expect(huge.omitted.pinned).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(huge), "utf8")).toBeLessThanOrEqual(1024);
    store.save({ projectId, title: "Small", content: "😀".repeat(300), type: "fact" });
    const multibyte = store.context(projectId, { compact: false, maxBytes: 1024 });
    expect(Buffer.byteLength(JSON.stringify(multibyte), "utf8")).toBeLessThanOrEqual(1024);
    expect(multibyte.truncated).toBe(true);
  } finally { store.close(); }
});
