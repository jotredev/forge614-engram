import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "./projects";
import { enableIntelligence, initialize, schemaState } from "./schema";
import { save } from "./writes";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures");
const temporary: string[] = [];
afterEach(() => { while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true }); });

function fixture(path: string, options: { readonly?: boolean } = {}): { db: Database; file: string; directory: string } {
  // SQLite reports the real path; on macOS tmpdir() is under /var, a symlink to /private/var.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "engram-intel-")));
  temporary.push(directory);
  const file = join(directory, "engram.db");
  copyFileSync(join(FIXTURES, path), file);
  const db = options.readonly ? new Database(file, { readonly: true }) : new Database(file, { strict: true });
  initialize(db, false, options.readonly === true);
  return { db, file, directory };
}

const TABLES = ["projects", "memories", "memory_versions", "requests", "events", "project_bindings", "sessions", "session_entries",
  "session_summaries", "local_session_bindings", "local_manual_sessions", "confirmations", "confirmation_requests",
  "ecosystem_groups", "ecosystem_memberships", "identity_events"];
function dump(db: Database): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of TABLES) {
    const exists = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (exists) out[table] = db.query(`SELECT * FROM ${table}`).all().map(row => JSON.stringify(row)).sort();
  }
  return out;
}
const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const words = (db: Database, match: string) =>
  (db.query("SELECT m.title FROM memories_words w JOIN memories m ON m.rowid = w.rowid WHERE memories_words MATCH ? ORDER BY m.title").all(match) as { title: string }[]).map(r => r.title);

test("level 10 base migrates to 11: every row kept, backup written, new structure empty and valid", () => {
  const { db, file, directory } = fixture("v1.6.0/schema-10.db");
  try {
    const before = dump(db);
    const result = enableIntelligence(db);
    expect(result.migrated).toBe(true);
    expect(result.backup).toStartWith(`${file}.v10-pre-intelligence-`);
    expect(statSync(result.backup!).mode & 0o777).toBe(0o600);
    expect(version(db)).toBe(11);
    expect(schemaState(db)).toEqual({ base: 7, ecosystem: true, intelligence: true });
    expect(dump(db)).toEqual(before);
    for (const table of ["memory_meta", "session_activity", "ecosystem_sources"]) {
      expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(readdirSync(directory).filter(name => name.endsWith(".bak"))).toHaveLength(1);
    initialize(db, false, false); // exact-schema validation of level 11 passes
  } finally { db.close(); }
});

test("the word index is accent-insensitive and covers existing rows after migration", () => {
  const { db } = fixture("v1.6.0/schema-10.db");
  try {
    enableIntelligence(db);
    expect(words(db, "decision")).toEqual(["Decisión de almacenamiento"]);
    expect(words(db, "respaldo")).toEqual(["Decisión de almacenamiento"]);
    expect(words(db, "explicacion")).toEqual(["Preferencia de explicación"]);
  } finally { db.close(); }
});

test("the word index follows inserts, updates and deletes through its triggers", () => {
  const { db } = fixture("v1.6.0/schema-10.db");
  try {
    enableIntelligence(db);
    const project = createProject(db, "Gamma");
    const saved = save(db, { projectId: project.projectId, type: "fact", title: "Configuración del índice", content: "palabra única zanahoria", topicKey: "gamma/index" });
    expect(words(db, "zanahoria")).toEqual(["Configuración del índice"]);
    save(db, { projectId: project.projectId, type: "fact", title: "Configuración del índice", content: "palabra única pepino", topicKey: "gamma/index", expectedVersion: 1 });
    expect(words(db, "zanahoria")).toEqual([]);
    expect(words(db, "pepino")).toEqual(["Configuración del índice"]);
    // Raw delete only to exercise the trigger; versions and events reference the row, so relax foreign keys here.
    db.exec("PRAGMA foreign_keys=OFF");
    db.query("DELETE FROM memories WHERE id = ?").run(saved.id);
    expect(words(db, "pepino")).toEqual([]);
  } finally { db.close(); }
});

test("enrolling twice is a no-op and never writes a second backup", () => {
  const { db, directory } = fixture("v1.6.0/schema-10.db");
  try {
    expect(enableIntelligence(db).migrated).toBe(true);
    expect(enableIntelligence(db)).toEqual({ migrated: false, backup: null });
    expect(readdirSync(directory).filter(name => name.endsWith(".bak"))).toHaveLength(1);
  } finally { db.close(); }
});

test("an older level chains every prerequisite and ends at 11 with its data", () => {
  const { db } = fixture("v1.5.3/schema-5.db");
  try {
    // Level 5 has no ecosystem column yet: compare counts and the original memory columns, not whole rows.
    const counts = (d: Database) => Object.fromEntries(TABLES.filter(t => d.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
      .map(t => [t, (d.query(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n]));
    const memories = (d: Database) => d.query("SELECT id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at FROM memories ORDER BY rowid").all();
    const countsBefore = counts(db), memoriesBefore = memories(db);
    enableIntelligence(db);
    expect(version(db)).toBe(11);
    const countsAfter = counts(db);
    for (const table of Object.keys(countsBefore)) expect(countsAfter[table]).toBe(countsBefore[table]);
    expect(memories(db)).toEqual(memoriesBefore);
  } finally { db.close(); }
});

test("a fresh empty base reaches 11 without writing a backup", () => {
  const db = new Database(":memory:");
  try {
    initialize(db);
    expect(enableIntelligence(db)).toEqual({ migrated: true, backup: null });
    expect(version(db)).toBe(11);
  } finally { db.close(); }
});

test("a read-only connection fails before leaving any backup behind", () => {
  const { db, directory } = fixture("v1.6.0/schema-10.db", { readonly: true });
  try {
    expect(() => enableIntelligence(db)).toThrow();
    expect(version(db)).toBe(10);
    expect(readdirSync(directory).filter(name => name.endsWith(".bak"))).toEqual([]);
  } finally { db.close(); }
});

test("a failure inside the migration rolls back to level 10 with no new objects", () => {
  const { db } = fixture("v1.6.0/schema-10.db");
  try {
    const execute = db.exec.bind(db);
    Object.defineProperty(db, "exec", { value: (sql: string) => execute(sql.includes("CREATE TABLE ecosystem_sources")
      ? sql.replace("CREATE TABLE ecosystem_sources", "THIS IS NOT SQL; CREATE TABLE ecosystem_sources") : sql) });
    expect(() => enableIntelligence(db)).toThrow();
    expect(version(db)).toBe(10);
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('memory_meta','session_activity','ecosystem_sources','memories_words')").all()).toEqual([]);
  } finally { db.close(); }
});

test("level 11 validates its exact structure and 12 stays an unknown future version", () => {
  const { db } = fixture("v1.6.0/schema-10.db");
  try {
    enableIntelligence(db);
    db.exec("DROP TRIGGER memory_words_update");
    expect(() => initialize(db, false, false)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
  } finally { db.close(); }
  const fresh = new Database(":memory:");
  try {
    initialize(fresh); enableIntelligence(fresh);
    fresh.exec("PRAGMA user_version=12");
    expect(() => initialize(fresh)).toThrow(expect.objectContaining({ code: "DATABASE_VERSION" }));
  } finally { fresh.close(); }
});
