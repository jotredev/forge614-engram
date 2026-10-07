/**
 * Prueba la migración que activa el ámbito de ecosistema (enableEcosystem, niveles de esquema 8-10):
 * que conserve cada fila y el buscador de texto, respalde y verifique antes de confirmar, deshaga todo
 * si algo falla, y active las reglas de propiedad y de nombres de los grupos que comparte varios proyectos.
 */
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { reinforcementEnabled } from "./confirmations";
import { requireProjectBindings } from "./projects";
import { sessionsEnabled } from "./sessions";
import { exportSnapshot } from "./snapshots";
import { enableEcosystem, enableProjectBindings, enableSearchReinforcement, enableSessionLifecycle, enableSynchronization, initialize, schemaState } from "./schema";
import { expectPosixMode } from "../__test-support__/permissions";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/v1.5.3");
const temporary: string[] = [];
const databases: Database[] = [];
afterEach(() => {
  while (databases.length) databases.pop()!.close();
  while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true });
});

function fixture(name: "schema-5.db" | "schema-7.db"): { db: Database; file: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "engram-eco-"));
  temporary.push(directory);
  const file = join(directory, "engram.db");
  copyFileSync(join(FIXTURES, name), file);
  const db = new Database(file, { strict: true }); databases.push(db);
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
// Contenido lógico de cada tabla ya existente, limitado a las columnas que ya existían antes de migrar.
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

// Comprueba que activar el ecosistema en cada nivel base (5, 6 o 7) suma solo la estructura de
// ecosistema, sin activar de regalo las sesiones ni el refuerzo de búsqueda.
test("schema state decodes ecosystem variants without implying sessions or reinforcement", () => {
  const { db } = fixture("schema-5.db");
  try {
    expect(schemaState(db)).toEqual({ base: 5, ecosystem: false, intelligence: false, cloud: false });
    enableEcosystem(db);
    expect(version(db)).toBe(8);
    expect(schemaState(db)).toEqual({ base: 5, ecosystem: true, intelligence: false, cloud: false });
    // El nivel elegido nunca gana sesiones ni refuerzo de búsqueda solo por activar el ecosistema.
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('sessions','confirmations')").all()).toEqual([]);
    enableSessionLifecycle(db);
    expect(version(db)).toBe(9);
    enableSearchReinforcement(db);
    expect(version(db)).toBe(10);
    expect(schemaState(db)).toEqual({ base: 7, ecosystem: true, intelligence: false, cloud: false });
  } finally { db.close(); }
});

// Comprueba que migrar una base real ya existente (fijada, o "fixture") conserva cada fila, el buscador
// de texto completo (FTS, por sus siglas en inglés) y su integridad, y que las tablas recreadas siguen indexando filas nuevas.
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
    // Las filas nuevas pasan por los disparadores recreados hacia el índice de texto completo (FTS).
    db.exec("INSERT INTO projects VALUES ('p-new','New','now','now')");
    db.exec("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('m-new','p-new','project',NULL,'fact','Nuevo','zanahoria única',0,1,'active','now','now')");
    expect(db.query("SELECT id FROM memories m JOIN memories_fts f ON f.rowid=m.rowid WHERE memories_fts MATCH 'zanahoria'").all()).toEqual([{ id: "m-new" }]);
  } finally { db.close(); }
});

// Comprueba que la restricción de ámbito ampliada acepta filas de ecosistema y sigue exigiendo que
// cada recuerdo tenga un solo dueño (proyecto o grupo, nunca los dos ni ninguno) y un tema (topic) único dentro de ese ámbito.
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
    // Un tema por grupo, independiente de los espacios de nombres de proyecto y compartido (shared).
    expect(() => insert("ecosystem", null, "g1", "eco-ok")).toThrow();
    insert("shared", null, null, "eco-ok");
  } finally { db.close(); }
});

// Comprueba el patrón fijo de nombres de grupo (minúsculas, dígitos y guiones simples), que el nombre
// no es único (solo el id lo es) y que un proyecto no puede pertenecer a dos grupos a la vez.
test("group names follow the stable pattern and a project belongs to at most one group", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    const group = (id: string, name: string) => db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES (?,?,'now')").run(id, name);
    group("g1", "forge614"); group("g2", "mi-tienda-2");
    for (const bad of ["", "Forge", "a b", "a_b", "-a", "a-", "a--b", "ñu", "x".repeat(65)]) expect(() => group(`bad-${bad.length}`, bad)).toThrow();
    // Los nombres son para las personas: dos grupos pueden compartir uno, la identidad es el id.
    group("g3", "forge614");
    expect(() => group("g1", "otro")).toThrow();
    const project = db.query("SELECT projectId FROM projects LIMIT 1").get() as { projectId: string };
    const bind = (groupId: string) => db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES (?,?,'now','command')").run(project.projectId, groupId);
    bind("g1");
    expect(() => bind("g2")).toThrow();
    expect(() => db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES ('nope','g1','now','command')").run()).toThrow();
  } finally { db.close(); }
});

// Comprueba que activar el ecosistema dos veces seguidas no cambia nada más y que solo se escribe
// una copia de respaldo (backup) la primera vez, no en las repeticiones.
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

/** Comprueba que el respaldo automático es completo, conserva la versión de origen y es privado en POSIX. */
test("the automatic backup is a private, complete copy of the pre-migration database", () => {
  const { db, directory } = fixture("schema-7.db");
  try {
    const before = logicalDump(db);
    enableEcosystem(db);
    const name = readdirSync(directory).find(entry => entry.includes("pre-ecosystem"))!;
    expect(name).toContain("v7");
    const path = join(directory, name);
    expectPosixMode(path, 0o600);
    const backup = new Database(path, { readonly: true });
    try {
      expect(version(backup)).toBe(7);
      expect(logicalDump(backup)).toEqual(before);
    } finally { backup.close(); }
  } finally { db.close(); }
});

// Comprueba que si la copia de filas durante la migración pierde alguna, la comprobación posterior lo
// detecta y deshace (rollback) todos los cambios, dejando la base exactamente como estaba y el respaldo intacto.
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
    // Las llaves foráneas (foreign keys: la restricción que exige que una fila referida exista) se
    // restauran incluso cuando la migración falla, y el respaldo tomado antes sigue ahí.
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(readdirSync(directory).some(entry => entry.includes("pre-ecosystem"))).toBe(true);
  } finally { db.close(); }
});

// Comprueba que una base con la estructura dañada (por ejemplo, un índice esperado que falta) se
// rechaza con un error de estructura en vez de intentar repararla.
test("a database with foreign objects or a damaged structure is refused, not repaired", () => {
  const { db } = fixture("schema-7.db");
  try {
    db.exec("DROP INDEX confirmations_memory_time");
    expect(() => enableEcosystem(db)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
    expect(version(db)).toBe(7);
  } finally { db.close(); }
});

// Comprueba que abrir la base (initialize) valida la estructura exacta de cada nivel de ecosistema
// que se va alcanzando, y que rechaza un número de versión futuro que esta compilación todavía no conoce.
test("initialization validates every ecosystem level exactly and rejects future versions", () => {
  const { db, file } = fixture("schema-5.db");
  try {
    enableEcosystem(db); initialize(db);
    enableSessionLifecycle(db); initialize(db);
    enableSearchReinforcement(db); initialize(db);
    db.exec("DROP INDEX memories_ecosystem_topic");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
    // El 12 ahora es el nivel de la nube (T1); el 13 es la siguiente versión futura desconocida.
    db.exec("PRAGMA user_version=13");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_VERSION" }));
  } finally { db.close(); }
  expect(existsSync(file)).toBe(true);
});

// Comprueba que sobre una base con ecosistema, activar la sincronización o los vínculos de proyecto no hace nada (son requisitos ya cubiertos).
test("synchronization and binding enrolment are no-ops on ecosystem databases", () => {
  const { db } = fixture("schema-5.db");
  try {
    enableEcosystem(db);
    enableSynchronization(db); enableProjectBindings(db);
    expect(version(db)).toBe(8);
  } finally { db.close(); }
});

// Comprueba que una base muy antigua llega al ecosistema pasando por el paso de vínculos de proyecto
// (project bindings), sin activar de paso las sesiones.
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

// Comprueba que migrar una base grande (50,000 recuerdos) sigue siendo rápida y que el respaldo y la
// verificación de contenido no pierden ni cambian ninguna fila.
test("migrates 50,000 memories quickly and verifies the whole content", () => {
  const directory = mkdtempSync(join(tmpdir(), "engram-eco-perf-"));
  temporary.push(directory);
  const file = join(directory, "engram.db");
  const db = new Database(file, { create: true, strict: true }); databases.push(db);
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

// Comprueba que las funciones que solo leen (gates: comprobaciones de si una función está activa) se
// fijan según el nivel de funciones, no según el número crudo de versión.
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

// Comprueba que una conexión de solo lectura se rechaza antes de tomar ningún respaldo, sin cambiar la versión.
test("a read-only connection is refused before any backup is taken", () => {
  const { file, directory, db } = fixture("schema-7.db");
  db.close();
  const readonly = new Database(file, { readonly: true, strict: true });
  try {
    expect(() => enableEcosystem(readonly)).toThrow();
    expect(readdirSync(directory).filter(name => name.includes("pre-ecosystem"))).toEqual([]);
    expect(version(readonly)).toBe(7);
  } finally { readonly.close(); }
});

// Comprueba que el resultado de activar el ecosistema informa si migró de verdad y dónde quedó el
// respaldo, y que una base ya en ese nivel (o una vacía sin nada que perder) no genera uno.
test("enrolment reports whether it migrated and where the backup went", () => {
  const { db, directory } = fixture("schema-7.db");
  try {
    const first = enableEcosystem(db);
    expect(first.migrated).toBe(true);
    expect(basename(first.backup!)).toBe(readdirSync(directory).find(name => name.includes("pre-ecosystem"))!);
    expect(enableEcosystem(db)).toEqual({ migrated: false, backup: null });
  } finally { db.close(); }
  const empty = new Database(":memory:", { strict: true });
  try {
    initialize(empty);
    expect(enableEcosystem(empty)).toEqual({ migrated: true, backup: null });
  } finally { empty.close(); }
});
