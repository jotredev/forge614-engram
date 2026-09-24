import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { MemoryError } from "../../shared/errors";

const APPLICATION_ID = 1177956660;
const SCHEMA_VERSION = 3;
const SYNC_SCHEMA = `CREATE TABLE sync_checkpoints (
  replica TEXT PRIMARY KEY NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);`;
const BINDING_SCHEMA = `CREATE TABLE project_bindings (
  directory TEXT PRIMARY KEY NOT NULL CHECK(length(trim(directory)) > 0),
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  createdAt TEXT NOT NULL
);
CREATE INDEX project_bindings_project ON project_bindings(projectId);
`;
const SESSION_SCHEMA = `CREATE TABLE sessions (
  sessionId TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  kind TEXT NOT NULL CHECK(kind IN ('runtime','manual')),
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  CHECK(kind != 'manual' OR endedAt IS NULL)
);
CREATE INDEX sessions_project_started ON sessions(projectId,startedAt,sessionId);
CREATE TABLE session_entries (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  recordedAt TEXT NOT NULL,
  PRIMARY KEY(memoryId,version),
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX session_entries_timeline ON session_entries(sessionId,recordedAt,memoryId,version);
CREATE TABLE session_summaries (
  sessionId TEXT PRIMARY KEY NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE TABLE local_session_bindings (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  directory TEXT NOT NULL,
  PRIMARY KEY(sessionId,directory)
);
CREATE INDEX local_session_directory ON local_session_bindings(directory,sessionId);
CREATE TABLE local_manual_sessions (
  projectId TEXT PRIMARY KEY NOT NULL REFERENCES projects(projectId),
  sessionId TEXT UNIQUE NOT NULL REFERENCES sessions(sessionId)
);
`;
const CONFIRMATION_SCHEMA = `CREATE TABLE confirmations (
  confirmationId TEXT PRIMARY KEY NOT NULL,
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  recordedAt TEXT NOT NULL,
  sessionId TEXT REFERENCES sessions(sessionId),
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX confirmations_memory_time ON confirmations(memoryId,recordedAt,confirmationId);
CREATE TABLE confirmation_requests (
  memoryId TEXT NOT NULL REFERENCES memories(id),
  requestKey TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  expectedVersion INTEGER,
  confirmationId TEXT NOT NULL REFERENCES confirmations(confirmationId),
  response TEXT NOT NULL CHECK(json_valid(response)),
  PRIMARY KEY(memoryId,requestKey)
);
`;
const SCHEMA = `
CREATE TABLE projects (
  projectId TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE memories (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared')),
  topic_key TEXT,
  type TEXT NOT NULL CHECK(type IN ('fact','decision','procedure','warning','preference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
);
CREATE UNIQUE INDEX memories_project_topic ON memories(projectId,topic_key) WHERE scope='project';
CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
CREATE INDEX memories_project_state ON memories(projectId,state);
CREATE TABLE memory_versions (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  PRIMARY KEY(memory_id,version)
);
CREATE TABLE requests (
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared')),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL)),
  FOREIGN KEY(memory_id,version) REFERENCES memory_versions(memory_id,version)
);
CREATE UNIQUE INDEX requests_project_key ON requests(projectId,request_key) WHERE scope='project';
CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  action TEXT NOT NULL CHECK(action IN ('save','archive','restore')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, topic_key, content='memories', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
`;

// Ecosystem groups (schema levels 8-10 are levels 5-7 plus this structure). New tables
// only; the two ownership-bearing tables are recreated below to widen their scope check.
const ECOSYSTEM_SCHEMA = `CREATE TABLE ecosystem_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64 AND name NOT GLOB '*[^a-z0-9-]*'
    AND name NOT GLOB '-*' AND name NOT GLOB '*-' AND name NOT GLOB '*--*'),
  createdAt TEXT NOT NULL
);
CREATE INDEX ecosystem_groups_name ON ecosystem_groups(name,id);
CREATE TABLE ecosystem_memberships (
  projectId TEXT PRIMARY KEY NOT NULL REFERENCES projects(projectId),
  groupId TEXT NOT NULL REFERENCES ecosystem_groups(id),
  boundAt TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('command','node-file','project-file'))
);
CREATE INDEX ecosystem_memberships_group ON ecosystem_memberships(groupId,projectId);
CREATE TABLE identity_events (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK(length(trim(action)) > 0),
  projectId TEXT,
  groupId TEXT,
  previousGroupId TEXT,
  previousProjectId TEXT,
  memoryId TEXT,
  directory TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX identity_events_project ON identity_events(projectId,id);
`;
const OWNERSHIP_CHECK = `CHECK((scope='project' AND projectId IS NOT NULL AND groupId IS NULL)
    OR (scope='shared' AND projectId IS NULL AND groupId IS NULL)
    OR (scope='ecosystem' AND projectId IS NULL AND groupId IS NOT NULL))`;
const MEMORY_COLUMNS = "rowid,id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at";
const REQUEST_COLUMNS = "projectId,scope,request_key,payload_hash,memory_id,version";
const ECOSYSTEM_MEMORIES = `CREATE TABLE memories_new (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared','ecosystem')),
  topic_key TEXT,
  type TEXT NOT NULL CHECK(type IN ('fact','decision','procedure','warning','preference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  groupId TEXT REFERENCES ecosystem_groups(id),
  ${OWNERSHIP_CHECK}
);`;
const ECOSYSTEM_REQUESTS = `CREATE TABLE requests_new (
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared','ecosystem')),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  groupId TEXT REFERENCES ecosystem_groups(id),
  ${OWNERSHIP_CHECK},
  FOREIGN KEY(memory_id,version) REFERENCES memory_versions(memory_id,version)
);`;
const ECOSYSTEM_INDEXES = `CREATE UNIQUE INDEX memories_project_topic ON memories(projectId,topic_key) WHERE scope='project';
CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
CREATE UNIQUE INDEX memories_ecosystem_topic ON memories(groupId,topic_key) WHERE scope='ecosystem';
CREATE INDEX memories_project_state ON memories(projectId,state);
CREATE UNIQUE INDEX requests_project_key ON requests(projectId,request_key) WHERE scope='project';
CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
CREATE UNIQUE INDEX requests_ecosystem_key ON requests(groupId,request_key) WHERE scope='ecosystem';
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;`;

// Memory intelligence (schema level 11 = base 7 + ecosystem + this structure). Additive only:
// side tables keep new data out of memory_versions, whose snapshot keys replication validates exactly.
const INTELLIGENCE_SCHEMA = `CREATE TABLE memory_meta (
  memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id),
  short TEXT CHECK(short IS NULL OR length(short) BETWEEN 1 AND 300),
  review_after TEXT,
  superseded_by TEXT REFERENCES memories(id),
  affects TEXT CHECK(affects IS NULL OR json_valid(affects)),
  updated_at TEXT NOT NULL
);
CREATE INDEX memory_meta_superseded ON memory_meta(superseded_by);
CREATE TABLE session_activity (
  sessionId TEXT PRIMARY KEY NOT NULL REFERENCES sessions(sessionId),
  lastActivityAt TEXT NOT NULL,
  interruptedAt TEXT
);
CREATE TABLE ecosystem_sources (
  groupId TEXT PRIMARY KEY NOT NULL REFERENCES ecosystem_groups(id),
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  setAt TEXT NOT NULL
);
CREATE VIRTUAL TABLE memories_words USING fts5(
  title, content, topic_key, content='memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER memory_words_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_words(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_words_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_words(memories_words,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_words_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_words(memories_words,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_words(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
`;

type Base = 3 | 4 | 5 | 6 | 7;
export interface SchemaState { readonly base: Base; readonly ecosystem: boolean; readonly intelligence: boolean }
// Levels 3-7 are the linear feature chain. 8-10 are levels 5-7 with the ecosystem structure,
// so enabling ecosystem never silently enables sessions or search reinforcement.
// 11 is the only intelligence level: it requires base 7 and the ecosystem structure.
function decode(version: number): SchemaState | null {
  if (version >= 3 && version <= 7) return { base: version as Base, ecosystem: false, intelligence: false };
  if (version >= 8 && version <= 10) return { base: (version - 3) as Base, ecosystem: true, intelligence: false };
  if (version === 11) return { base: 7, ecosystem: true, intelligence: true };
  return null;
}
function encode(state: SchemaState): number {
  if (state.intelligence) return 11;
  return state.base + (state.ecosystem ? 3 : 0);
}
function currentVersion(db: Database): number { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; }
/** Feature level of the database, or null for a version this build does not know. Gates read this. */
export function schemaFeatures(db: Database): SchemaState | null { return decode(currentVersion(db)); }
export function schemaState(db: Database): SchemaState {
  const state = schemaFeatures(db);
  if (!state) throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
  return state;
}

// Compare SQLite's canonical schema, including constraints, triggers and indexes.
// Unknown objects are rejected, never repaired. This is not an integrity audit.
function definition(db: Database): string {
  return JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all());
}
const expectedDefinitions = new Map<number,string>();
const FEATURE_SQL: Record<5 | 6 | 7 | 4, string> = { 4: SYNC_SCHEMA, 5: BINDING_SCHEMA, 6: SESSION_SCHEMA, 7: CONFIRMATION_SCHEMA };
function featureSql(from: number, to: number): string {
  let sql = "";
  for (const level of [4, 5, 6, 7] as const) if (level > from && level <= to) sql += FEATURE_SQL[level];
  return sql;
}
function schemaFor(base: Base): string { return SCHEMA + featureSql(3, base); }
function validate(db: Database, version: number): void {
  if (!expectedDefinitions.has(version)) {
    const state = decode(version)!;
    const reference = new Database(":memory:");
    try {
      reference.exec(schemaFor(state.base));
      if (state.ecosystem) applyEcosystemStructure(reference);
      if (state.intelligence) reference.exec(INTELLIGENCE_SCHEMA);
      expectedDefinitions.set(version,definition(reference));
    } finally { reference.close(); }
  }
  if (definition(db) !== expectedDefinitions.get(version)) {
    throw new MemoryError("DATABASE_SCHEMA", "La estructura no es compatible. No se modificó ni reparó la base.");
  }
}

/** Advance the linear feature chain to `target`; a no-op (after validation) when already there. */
function upgradeTo(db: Database, target: 4 | 5 | 6 | 7, unsupported: string): void {
  db.transaction(() => {
    const version = currentVersion(db);
    const state = decode(version);
    if (!state) throw new MemoryError("MIGRATION_REQUIRED", unsupported);
    validate(db, version);
    if (state.base >= target) return;
    db.exec(featureSql(state.base, target));
    db.exec(`PRAGMA user_version=${encode({ base: target, ecosystem: state.ecosystem, intelligence: state.intelligence })}`);
  }).immediate();
}

/** Explicit, additive enrollment; normal opens never migrate a local database. */
export function enableSynchronization(db: Database): void {
  upgradeTo(db, 4, "No se puede habilitar sincronización en este formato.");
}

/** Enables machine-local project bindings required by MCP and project context. */
export function enableProjectBindings(db: Database): void {
  upgradeTo(db, 5, "No se pueden habilitar vínculos de proyecto en este formato.");
}

/** Explicit enrollment for the additive session lifecycle schema. */
export function enableSessionLifecycle(db: Database): void {
  upgradeTo(db, 6, "No se puede habilitar sesiones en este formato.");
}

/** Explicit enrollment for immutable search reinforcement confirmations. */
export function enableSearchReinforcement(db: Database): void {
  upgradeTo(db, 7, "No se puede habilitar el refuerzo de búsqueda en este formato.");
}

// SQLite's documented procedure for changing a CHECK constraint: create the replacement,
// copy every row, drop the original, rename, then recreate indexes, triggers and the FTS index.
// The caller owns the transaction and the foreign_keys pragma.
function applyEcosystemStructure(db: Database): void {
  db.exec(ECOSYSTEM_SCHEMA);
  db.exec(ECOSYSTEM_MEMORIES);
  db.exec(`INSERT INTO memories_new(${MEMORY_COLUMNS}) SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY rowid`);
  db.exec(ECOSYSTEM_REQUESTS);
  db.exec(`INSERT INTO requests_new(${REQUEST_COLUMNS}) SELECT ${REQUEST_COLUMNS} FROM requests ORDER BY rowid`);
  db.exec("DROP TABLE requests; DROP TABLE memories;");
  db.exec("ALTER TABLE memories_new RENAME TO memories; ALTER TABLE requests_new RENAME TO requests;");
  db.exec(ECOSYSTEM_INDEXES);
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
}

function contentDigest(db: Database, table: "memories" | "requests"): { count: number; digest: string } {
  const columns = table === "memories" ? MEMORY_COLUMNS : REQUEST_COLUMNS;
  const statement = db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${table === "memories" ? "rowid" : "scope,projectId,request_key"}`);
  const hash = createHash("sha256"); let count = 0;
  try {
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) { hash.update(JSON.stringify(Object.values(row))); count++; }
  } finally { statement.finalize(); }
  return { count, digest: hash.digest("hex") };
}

function foreignKeyViolations(db: Database): number { return db.query("PRAGMA foreign_key_check").all().length; }

function verificationFailed(): never {
  throw new MemoryError("MIGRATION_VERIFY_FAILED", "La verificación de la migración falló: el contenido copiado no coincide con el original. No se modificó la base; el respaldo automático se conserva.");
}

// VACUUM INTO writes a complete, consistent copy even while the database is in WAL mode.
function backupBeforeMigration(db: Database, version: number, label: "ecosystem" | "intelligence"): string | null {
  const main = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(entry => entry.name === "main");
  if (!main?.file) return null;
  // Nothing to lose in a database that holds no projects and no memories yet.
  const held = db.query("SELECT (SELECT count(*) FROM projects)+(SELECT count(*) FROM memories) AS n").get() as { n: number };
  if (held.n === 0) return null;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const target = `${main.file}.v${version}-pre-${label}-${stamp}-${randomUUID().slice(0, 8)}.bak`;
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  chmodSync(target, 0o600);
  return target;
}

export interface EcosystemEnrolment { readonly migrated: boolean; readonly backup: string | null }

/**
 * Explicit, additive enrollment for the ecosystem scope: new group tables plus a widened scope
 * check on memories and requests. Backs up first, verifies row counts and content checksums
 * inside the same transaction and rolls back on any difference.
 */
export function enableEcosystem(db: Database): EcosystemEnrolment {
  // Version and structure are read in one snapshot: another process may commit the migration at any moment,
  // and reading them separately could pair the old version with the new structure.
  const seen = db.transaction(() => {
    const current = currentVersion(db), decoded = decode(current);
    if (!decoded) throw new MemoryError("MIGRATION_REQUIRED", "No se puede habilitar el ámbito ecosystem en este formato.");
    validate(db, current);
    return { current, decoded };
  }).deferred();
  let version = seen.current;
  let state = seen.decoded;
  if (state.ecosystem) return { migrated: false, backup: null };
  if (state.base < 5) { enableProjectBindings(db); version = currentVersion(db); state = decode(version)!; }
  // A connection that cannot write must fail before it leaves a useless backup behind.
  // Separate statements on purpose: a multi-statement exec does not surface a read-only error.
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(`PRAGMA user_version=${version + 100}`); } finally { db.exec("ROLLBACK"); }
  const backup = backupBeforeMigration(db, version, "ecosystem");
  let migrated = false;
  const foreignKeys = (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    db.transaction(() => {
      const inside = currentVersion(db);
      const insideState = decode(inside)!;
      if (insideState.ecosystem) { validate(db, inside); return; }
      validate(db, inside);
      const violationsBefore = foreignKeyViolations(db);
      const memoriesBefore = contentDigest(db, "memories");
      const requestsBefore = contentDigest(db, "requests");
      applyEcosystemStructure(db);
      const memoriesAfter = contentDigest(db, "memories");
      const requestsAfter = contentDigest(db, "requests");
      if (memoriesAfter.count !== memoriesBefore.count || memoriesAfter.digest !== memoriesBefore.digest
        || requestsAfter.count !== requestsBefore.count || requestsAfter.digest !== requestsBefore.digest
        || foreignKeyViolations(db) > violationsBefore) verificationFailed();
      try { db.exec("INSERT INTO memories_fts(memories_fts) VALUES('integrity-check')"); } catch { verificationFailed(); }
      db.exec(`PRAGMA user_version=${encode({ base: insideState.base, ecosystem: true, intelligence: false })}`);
      migrated = true;
    }).immediate();
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
  return { migrated, backup: migrated ? backup : null };
}

export interface IntelligenceEnrolment { readonly migrated: boolean; readonly backup: string | null }

function ftsIntegrity(db: Database, table: "memories_fts" | "memories_words"): void {
  try { db.exec(`INSERT INTO ${table}(${table}) VALUES('integrity-check')`); } catch { verificationFailed(); }
}

/**
 * Explicit, additive enrollment for memory intelligence (level 11). Chains the prerequisites
 * (ecosystem structure, sessions, reinforcement), then adds side tables and the word index in one
 * transaction, verifying that no existing row changed. The MCP server never calls this.
 */
export function enableIntelligence(db: Database): IntelligenceEnrolment {
  const seen = db.transaction(() => {
    const current = currentVersion(db), decoded = decode(current);
    if (!decoded) throw new MemoryError("MIGRATION_REQUIRED", "No se puede habilitar la memoria inteligente en este formato.");
    validate(db, current);
    return decoded;
  }).deferred();
  if (seen.intelligence) return { migrated: false, backup: null };
  if (!seen.ecosystem) enableEcosystem(db);
  enableSessionLifecycle(db);
  enableSearchReinforcement(db);
  const version = currentVersion(db);
  // A connection that cannot write must fail before it leaves a useless backup behind.
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(`PRAGMA user_version=${version + 100}`); } finally { db.exec("ROLLBACK"); }
  const backup = backupBeforeMigration(db, version, "intelligence");
  let migrated = false;
  db.transaction(() => {
    const inside = currentVersion(db);
    const insideState = decode(inside)!;
    validate(db, inside);
    if (insideState.intelligence) return;
    const memoriesBefore = contentDigest(db, "memories");
    const requestsBefore = contentDigest(db, "requests");
    db.exec(INTELLIGENCE_SCHEMA);
    db.exec("INSERT INTO memories_words(memories_words) VALUES('rebuild')");
    const memoriesAfter = contentDigest(db, "memories");
    const requestsAfter = contentDigest(db, "requests");
    if (memoriesAfter.count !== memoriesBefore.count || memoriesAfter.digest !== memoriesBefore.digest
      || requestsAfter.count !== requestsBefore.count || requestsAfter.digest !== requestsBefore.digest) verificationFailed();
    ftsIntegrity(db, "memories_fts");
    ftsIntegrity(db, "memories_words");
    db.exec(`PRAGMA user_version=${encode({ base: 7, ecosystem: true, intelligence: true })}`);
    migrated = true;
  }).immediate();
  return { migrated, backup: migrated ? backup : null };
}

export function initialize(db: Database, allowCreate = true, readonly = false): void {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  let created = false;
  const check = db.transaction(() => {
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const app = (db.query("PRAGMA application_id").get() as { application_id: number }).application_id;
    if ((version === 1 || version === 2) && app === APPLICATION_ID) {
      throw new MemoryError("MIGRATION_REQUIRED", "Formato anterior detectado. Conserva el archivo: no se modificó la base y se necesita una migración explícita, aún no disponible.");
    }
    if (decode(version) && app === APPLICATION_ID) { validate(db, version); return; }
    if (version !== 0 || app !== 0) throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
    const objects = db.query("SELECT count(*) AS n FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").get() as { n: number };
    if (objects.n !== 0) throw new MemoryError("DATABASE_OWNER", "La base contiene una estructura ajena; usa una base vacía y dedicada.");
    if (!allowCreate || readonly) throw new MemoryError("DATABASE_UNINITIALIZED", "La base no está inicializada. Conectar no crea tablas.");
    db.exec(SCHEMA);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
    created = true;
  });
  if (readonly) check.deferred(); else check.immediate();
  // Materialize WAL bookkeeping on the initializing writable connection. Bun's
  // SQLite on macOS cannot open a never-used WAL database read-only otherwise.
  if (created) db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; COMMIT;");
}
