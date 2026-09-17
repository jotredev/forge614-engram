import { Database } from "bun:sqlite";
import { MemoryError } from "./domain";

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

// Compare SQLite's canonical schema, including constraints, triggers and indexes.
// Unknown objects are rejected, never repaired. This is not an integrity audit.
function definition(db: Database): string {
  return JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all());
}
const expectedDefinitions = new Map<number,string>();
function schemaFor(version: 3 | 4 | 5 | 6): string {
  return SCHEMA + (version >= 4 ? SYNC_SCHEMA : "") + (version >= 5 ? BINDING_SCHEMA : "") + (version >= 6 ? SESSION_SCHEMA : "");
}
function validate(db: Database, version: 3 | 4 | 5 | 6): void {
  if (!expectedDefinitions.has(version)) {
    const reference = new Database(":memory:");
    try { reference.exec(schemaFor(version)); expectedDefinitions.set(version,definition(reference)); }
    finally { reference.close(); }
  }
  if (definition(db) !== expectedDefinitions.get(version)) {
    throw new MemoryError("DATABASE_SCHEMA", "La estructura no es compatible. No se modificó ni reparó la base.");
  }
}

/** Explicit, additive enrollment; normal opens never migrate a local database. */
export function enableSynchronization(db: Database): void {
  db.transaction(() => {
    const { user_version } = db.query("PRAGMA user_version").get() as {user_version:number};
    if(user_version===6) { validate(db,6); return; }
    if(user_version===5) { validate(db,5); return; }
    if(user_version===4) { validate(db,4); return; }
    if(user_version!==3) throw new MemoryError("MIGRATION_REQUIRED","No se puede habilitar sincronización en este formato.");
    validate(db,3);
    db.exec(SYNC_SCHEMA);
    db.exec("PRAGMA user_version=4");
  }).immediate();
}

/** Explicit enrollment for assistant integration and machine-local project bindings. */
export function enableAssistantIntegration(db: Database): void {
  db.transaction(() => {
    const { user_version } = db.query("PRAGMA user_version").get() as {user_version:number};
    if (user_version === 6) { validate(db,6); return; }
    if (user_version === 5) { validate(db,5); return; }
    if (user_version === 4) {
      validate(db,4); db.exec(BINDING_SCHEMA); db.exec("PRAGMA user_version=5"); return;
    }
    if (user_version !== 3) throw new MemoryError("MIGRATION_REQUIRED","No se puede habilitar la integración de asistentes en este formato.");
    validate(db,3);
    db.exec(SYNC_SCHEMA + BINDING_SCHEMA);
    db.exec("PRAGMA user_version=5");
  }).immediate();
}

/** Explicit enrollment for the additive session lifecycle schema. */
export function enableSessionLifecycle(db: Database): void {
  db.transaction(() => {
    const { user_version } = db.query("PRAGMA user_version").get() as {user_version:number};
    if (user_version === 6) { validate(db,6); return; }
    if (user_version === 5) {
      validate(db,5); db.exec(SESSION_SCHEMA); db.exec("PRAGMA user_version=6"); return;
    }
    if (user_version === 4) {
      validate(db,4); db.exec(BINDING_SCHEMA + SESSION_SCHEMA); db.exec("PRAGMA user_version=6"); return;
    }
    if (user_version !== 3) throw new MemoryError("MIGRATION_REQUIRED","No se puede habilitar sesiones en este formato.");
    validate(db,3);
    db.exec(SYNC_SCHEMA + BINDING_SCHEMA + SESSION_SCHEMA);
    db.exec("PRAGMA user_version=6");
  }).immediate();
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
    if (version === SCHEMA_VERSION && app === APPLICATION_ID) { validate(db,3); return; }
    if (version === 4 && app === APPLICATION_ID) { validate(db,4); return; }
    if (version === 5 && app === APPLICATION_ID) { validate(db,5); return; }
    if (version === 6 && app === APPLICATION_ID) { validate(db,6); return; }
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
