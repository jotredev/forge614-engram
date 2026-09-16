import type { Database } from "bun:sqlite";
import { MemoryError } from "./domain";

const APPLICATION_ID = 1177956660;

export function initialize(db: Database): void {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.transaction(() => {
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const app = (db.query("PRAGMA application_id").get() as { application_id: number }).application_id;
    if (version > 1 || (app !== 0 && app !== APPLICATION_ID)) {
      throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
    }
    if (version === 1) {
      if (app !== APPLICATION_ID) throw new MemoryError("DATABASE_OWNER", "Esta base no pertenece a Forge614.");
      return;
    }
    const existing = db.query("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { n: number };
    if (existing.n !== 0) throw new MemoryError("DATABASE_OWNER", "La base ya contiene tablas ajenas; elige otro archivo.");
    db.exec(`
      CREATE TABLE memories (
        rowid INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        project TEXT NOT NULL,
        topic_key TEXT,
        type TEXT NOT NULL CHECK(type IN ('fact','decision','procedure','warning','preference')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
        version INTEGER NOT NULL CHECK(version >= 1),
        state TEXT NOT NULL CHECK(state IN ('active','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project, topic_key)
      );
      CREATE INDEX memories_project_state ON memories(project,state);
      CREATE TABLE memory_versions (
        memory_id TEXT NOT NULL REFERENCES memories(id),
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
        PRIMARY KEY(memory_id,version)
      );
      CREATE TABLE requests (
        project TEXT NOT NULL,
        request_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        PRIMARY KEY(project,request_key),
        FOREIGN KEY(memory_id,version) REFERENCES memory_versions(memory_id,version)
      );
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
      PRAGMA application_id=${APPLICATION_ID};
      PRAGMA user_version=1;
    `);
  }).immediate();
  db.exec("PRAGMA journal_mode=WAL;");
}
