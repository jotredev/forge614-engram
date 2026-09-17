import { Database } from "bun:sqlite";
import { MemoryError } from "./domain";

const APPLICATION_ID = 1177956660;
const SCHEMA_VERSION = 3;
const SYNC_SCHEMA = `CREATE TABLE sync_checkpoints (
  replica TEXT PRIMARY KEY NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);`;
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
const expectedDefinitions = new Map<boolean,string>();
function validate(db: Database, sync = false): void {
  if (!expectedDefinitions.has(sync)) {
    const reference = new Database(":memory:");
    try { reference.exec(SCHEMA + (sync ? SYNC_SCHEMA : "")); expectedDefinitions.set(sync,definition(reference)); }
    finally { reference.close(); }
  }
  if (definition(db) !== expectedDefinitions.get(sync)) {
    throw new MemoryError("DATABASE_SCHEMA", "La estructura no es compatible. No se modificó ni reparó la base.");
  }
}

/** Explicit, additive enrollment; normal opens never migrate a local database. */
export function enableSynchronization(db: Database): void {
  db.transaction(() => {
    const { user_version } = db.query("PRAGMA user_version").get() as {user_version:number};
    if(user_version===4) { validate(db,true); return; }
    if(user_version!==3) throw new MemoryError("MIGRATION_REQUIRED","No se puede habilitar sincronización en este formato.");
    validate(db);
    db.exec(SYNC_SCHEMA);
    db.exec("PRAGMA user_version=4");
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
    if (version === SCHEMA_VERSION && app === APPLICATION_ID) { validate(db); return; }
    if (version === 4 && app === APPLICATION_ID) { validate(db,true); return; }
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
