import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reinforcementEnabled } from "./confirmations";
import { requireProjectBindings } from "./projects";
import { sessionsEnabled } from "./sessions";
import { exportSnapshot } from "./snapshots";
import { enableEcosystem, enableProjectBindings, enableSearchReinforcement, enableSessionLifecycle, enableSynchronization, initialize, schemaState } from "./schema";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/v1.5.3");
const temporary: string[] = [];
afterEach(() => { while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true }); });

function fixture(name: "schema-5.db" | "schema-7.db"): { db: Database; file: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "engram-eco-"));
  temporary.push(directory);
  const file = join(directory, "engram.db");
  copyFileSync(join(FIXTURES, name), file);
  const db = new Database(file, { strict: true });
  initialize(db, false, false);
  return { db, file, directory };
}

const ORIGINAL_COLUMNS: Record<string, string> = {
  projects: "*",
  memories: "rowid,id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at",
  memory_versions: "*",
  requests: "projectId,scope,request_key,payload_hash,memory_id,version",
  events: "*",
  project_bindings: "*",
  sessions: "*", session_entries: "*", session_summaries: "*", local_session_bindings: "*", local_manual_sessions: "*",
  confirmations: "*", confirmation_requests: "*", sync_checkpoints: "*",
};
// Logical content of every pre-existing table, restricted to the columns that existed before.
function logicalDump(db: Database): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [table, columns] of Object.entries(ORIGINAL_COLUMNS)) {
    const exists = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    result[table] = db.query(`SELECT ${columns} FROM ${table}`).all().map(row => JSON.stringify(row)).sort();
  }
  return result;
}
const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;

test("schema state decodes ecosystem variants without implying sessions or reinforcement", () => {
  const { db } = fixture("schema-5.db");
  try {
    expect(schemaState(db)).toEqual({ base: 5, ecosystem: false });
    enableEcosystem(db);
    expect(version(db)).toBe(8);
    expect(schemaState(db)).toEqual({ base: 5, ecosystem: true });
    // The chosen level never gains sessions or reinforcement just because ecosystem was enabled.
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('sessions','confirmations')").all()).toEqual([]);
    enableSessionLifecycle(db);
    expect(version(db)).toBe(9);
    enableSearchReinforcement(db);
    expect(version(db)).toBe(10);
    expect(schemaState(db)).toEqual({ base: 7, ecosystem: true });
  } finally { db.close(); }
});

test("migrating a v1.5.3 schema-7 database preserves every row and search", () => {
  const { db } = fixture("schema-7.db");
  try {
    const before = logicalDump(db);
    expect(before.memories!.length).toBe(7);
    const found = db.query("SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH 'canción'").get();
    enableEcosystem(db);
    expect(version(db)).toBe(10);
    expect(logicalDump(db)).toEqual(before);
    expect(db.query("SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH 'canción'").get()).toEqual(found);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('integrity-check')");
    // New rows go through the recreated triggers into the FTS index.
    db.exec("INSERT INTO projects VALUES ('p-new','New','now','now')");
    db.exec("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('m-new','p-new','project',NULL,'fact','Nuevo','zanahoria única',0,1,'active','now','now')");
    expect(db.query("SELECT id FROM memories m JOIN memories_fts f ON f.rowid=m.rowid WHERE memories_fts MATCH 'zanahoria'").all()).toEqual([{ id: "m-new" }]);
  } finally { db.close(); }
});

test("the widened scope check accepts ecosystem rows and keeps the ownership invariants", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    db.exec("INSERT INTO ecosystem_groups VALUES ('g1','tienda','now')");
    const insert = (scope: string, projectId: string | null, groupId: string | null, topic: string) => db.query(
      `INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at,groupId)
       VALUES (?,?,?,?, 'fact','t','c',0,1,'active','now','now',?)`).run(`id-${scope}-${topic}`, projectId, scope, topic, groupId);
    insert("ecosystem", null, "g1", "eco-ok");
    expect(() => insert("ecosystem", null, null, "eco-no-group")).toThrow();
    expect(() => insert("ecosystem", "does-not-matter", "g1", "eco-with-project")).toThrow();
    expect(() => insert("shared", null, "g1", "shared-with-group")).toThrow();
    expect(() => insert("galaxy", null, "g1", "unknown-scope")).toThrow();
    // One topic per group, independent from the shared and project namespaces.
    expect(() => insert("ecosystem", null, "g1", "eco-ok")).toThrow();
    insert("shared", null, null, "eco-ok");
  } finally { db.close(); }
});

test("group names follow the stable pattern and a project belongs to at most one group", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    const group = (id: string, name: string) => db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES (?,?,'now')").run(id, name);
    group("g1", "forge614"); group("g2", "mi-tienda-2");
    for (const bad of ["", "Forge", "a b", "a_b", "-a", "a-", "a--b", "ñu", "x".repeat(65)]) expect(() => group(`bad-${bad.length}`, bad)).toThrow();
    // Names are for people: two groups may share one, identity is the id.
    group("g3", "forge614");
    expect(() => group("g1", "otro")).toThrow();
    const project = db.query("SELECT projectId FROM projects LIMIT 1").get() as { projectId: string };
    const bind = (groupId: string) => db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES (?,?,'now','command')").run(project.projectId, groupId);
    bind("g1");
    expect(() => bind("g2")).toThrow();
    expect(() => db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES ('nope','g1','now','command')").run()).toThrow();
  } finally { db.close(); }
});

test("enabling ecosystem twice changes nothing and writes a single backup", () => {
  const { db, directory } = fixture("schema-7.db");
  try {
    enableEcosystem(db);
    const snapshot = JSON.stringify(db.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all());
    const dump = logicalDump(db);
    const backups = () => readdirSync(directory).filter(name => name.includes("pre-ecosystem"));
    expect(backups().length).toBe(1);
    enableEcosystem(db);
    enableEcosystem(db);
    expect(JSON.stringify(db.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all())).toBe(snapshot);
    expect(logicalDump(db)).toEqual(dump);
    expect(backups().length).toBe(1);
    expect(version(db)).toBe(10);
  } finally { db.close(); }
});

test("the automatic backup is a private, complete copy of the pre-migration database", () => {
  const { db, directory } = fixture("schema-7.db");
  try {
    const before = logicalDump(db);
    enableEcosystem(db);
    const name = readdirSync(directory).find(entry => entry.includes("pre-ecosystem"))!;
    expect(name).toContain("v7");
    const path = join(directory, name);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const backup = new Database(path, { readonly: true });
    try {
      expect(version(backup)).toBe(7);
      expect(logicalDump(backup)).toEqual(before);
    } finally { backup.close(); }
  } finally { db.close(); }
});

test("a migration whose copy loses a row fails verification and rolls everything back", () => {
  const { db, directory } = fixture("schema-7.db");
  try {
    const before = logicalDump(db);
    const definitions = JSON.stringify(db.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all());
    const execute = db.exec.bind(db);
    Object.defineProperty(db, "exec", { value: (sql: string) => execute(sql.includes("INSERT INTO memories_new")
      ? sql.replace("ORDER BY rowid", "WHERE rowid > 1 ORDER BY rowid") : sql) });
    expect(() => enableEcosystem(db)).toThrow(expect.objectContaining({ code: "MIGRATION_VERIFY_FAILED" }));
    expect(version(db)).toBe(7);
    expect(logicalDump(db)).toEqual(before);
    expect(JSON.stringify(db.query("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all())).toBe(definitions);
    // Foreign keys are restored even when the migration fails, and the backup taken before it remains.
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(readdirSync(directory).some(entry => entry.includes("pre-ecosystem"))).toBe(true);
  } finally { db.close(); }
});

test("a database with foreign objects or a damaged structure is refused, not repaired", () => {
  const { db } = fixture("schema-7.db");
  try {
    db.exec("DROP INDEX confirmations_memory_time");
    expect(() => enableEcosystem(db)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
    expect(version(db)).toBe(7);
  } finally { db.close(); }
});

test("initialization validates every ecosystem level exactly and rejects future versions", () => {
  const { db, file } = fixture("schema-5.db");
  try {
    enableEcosystem(db); initialize(db);
    enableSessionLifecycle(db); initialize(db);
    enableSearchReinforcement(db); initialize(db);
    db.exec("DROP INDEX memories_ecosystem_topic");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
    db.exec("PRAGMA user_version=11");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_VERSION" }));
  } finally { db.close(); }
  expect(existsSync(file)).toBe(true);
});

test("synchronization and binding enrolment are no-ops on ecosystem databases", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    enableSynchronization(db); enableProjectBindings(db);
    expect(version(db)).toBe(8);
  } finally { db.close(); }
});

test("older schemas reach ecosystem through the binding step without enabling sessions", () => {
  const db = new Database(":memory:", { strict: true });
  try {
    initialize(db);
    expect(version(db)).toBe(3);
    enableEcosystem(db);
    expect(version(db)).toBe(8);
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('project_bindings','sync_checkpoints')").all().length).toBe(2);
  } finally { db.close(); }
});

test("migrates 50,000 memories quickly and verifies the whole content", () => {
  const directory = mkdtempSync(join(tmpdir(), "engram-eco-perf-"));
  temporary.push(directory);
  const file = join(directory, "engram.db");
  const db = new Database(file, { create: true, strict: true });
  try {
    initialize(db);
    enableSearchReinforcement(db);
    db.exec("INSERT INTO projects VALUES ('perf','Perf','now','now')");
    db.transaction(() => {
      const memory = db.prepare(`INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at)
        VALUES (?, 'perf','project',?, 'fact',?,?,0,1,'active','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
      const versions = db.prepare("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES (?,1,?)");
      for (let index = 0; index < 50_000; index++) {
        memory.run(`m-${index}`, `topic/${index}`, `Título ${index}`, `Contenido de prueba número ${index} con algo de texto para indexar`);
        versions.run(`m-${index}`, JSON.stringify({ id: `m-${index}` }));
      }
    }).immediate();
    const before = db.query("SELECT count(*) AS n FROM memories").get();
    const started = performance.now();
    enableEcosystem(db);
    const elapsed = performance.now() - started;
    console.log(`ecosystem migration of 50000 memories (incl. backup and verification): ${Math.round(elapsed)} ms`);
    expect(db.query("SELECT count(*) AS n FROM memories").get()).toEqual(before);
    expect(db.query("SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH 'número'").get()).toEqual({ n: 50_000 });
    expect(elapsed).toBeLessThan(10_000);
  } finally { db.close(); }
}, 60_000);

test("feature gates follow the feature level, not the raw version number", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    expect(() => requireProjectBindings(db)).not.toThrow();
    expect(sessionsEnabled(db)).toBe(false);
    expect(reinforcementEnabled(db)).toBe(false);
    enableSessionLifecycle(db);
    expect(sessionsEnabled(db)).toBe(true);
    expect(reinforcementEnabled(db)).toBe(false);
    enableSearchReinforcement(db);
    expect(sessionsEnabled(db)).toBe(true);
    expect(reinforcementEnabled(db)).toBe(true);
    expect(exportSnapshot(db).format).toBe(3);
  } finally { db.close(); }
});
