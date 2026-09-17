import type { Database } from "bun:sqlite";
import { assertExtension, emptySnapshot, snapshotHash, syncError, validateSnapshot, type SyncSnapshot } from "./sync-snapshot";
import type { Memory } from "./domain";

export function exportSnapshot(db: Database): SyncSnapshot {
  return db.transaction(() => {
    const projects = db.query("SELECT * FROM projects ORDER BY projectId").all() as SyncSnapshot["projects"];
    const rows = db.query(`SELECT id,projectId,scope,topic_key AS topicKey,type,title,content,pinned,version,state,
      created_at AS createdAt,updated_at AS updatedAt FROM memories ORDER BY id`).all() as (Omit<Memory,"pinned"> & {pinned:number})[];
    const memories = rows.map(row => ({
      memory:{...row,pinned:row.pinned===1},
      versions:(db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? ORDER BY version").all(row.id) as {snapshot:string}[]).map(r=>JSON.parse(r.snapshot)),
      requests:db.query("SELECT request_key,payload_hash,version FROM requests WHERE memory_id=? ORDER BY request_key").all(row.id),
      events:db.query("SELECT action,version,created_at FROM events WHERE memory_id=? ORDER BY id").all(row.id),
    }));
    const enabled=(db.query("PRAGMA user_version").get() as {user_version:number}).user_version===6;
    const snapshot = enabled ? {format:2,projects,memories,
      sessions:db.query("SELECT sessionId,projectId,kind,startedAt,endedAt FROM sessions ORDER BY sessionId").all(),
      sessionEntries:db.query("SELECT sessionId,memoryId,version,recordedAt FROM session_entries ORDER BY memoryId,version").all(),
      sessionSummaries:db.query("SELECT sessionId,memoryId,version FROM session_summaries ORDER BY sessionId").all(),
    } : {format:1,projects,memories};validateSnapshot(snapshot);return snapshot;
  }).deferred();
}

export function checkpoint(db: Database, replica: string): SyncSnapshot {
  const row=db.query("SELECT snapshot FROM sync_checkpoints WHERE replica=?").get(replica) as {snapshot:string}|null;
  if(row&&Buffer.byteLength(row.snapshot)>8*1024*1024) syncError("SYNC_TOO_LARGE");
  const value:unknown=row?JSON.parse(row.snapshot):emptySnapshot();validateSnapshot(value);return value;
}

export function applySnapshot(db: Database, expected:SyncSnapshot, next:SyncSnapshot, replica:string):void {
  validateSnapshot(next);
  db.transaction(()=>{
    const current=exportSnapshot(db);
    if(next.format===2&&current.format!==2) syncError("SESSIONS_REQUIRED");
    if(snapshotHash(current)!==snapshotHash(expected)) syncError("SYNC_LOCAL_CHANGED");
    // Sync cannot delete or rewrite history. Refuse divergent prefixes even if
    // the caller skipped reconciliation, before any SQLite statement mutates data.
    assertExtension(current,next);
    for(const p of next.projects) db.query(`INSERT INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)
      ON CONFLICT(projectId) DO UPDATE SET name=excluded.name,updatedAt=excluded.updatedAt`).run(p.projectId,p.name,p.createdAt,p.updatedAt);
    const old=new Map(current.memories.map(b=>[b.memory.id,b]));
    for(const b of next.memories) {
      const m=b.memory;
      db.query(`INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,
        content=excluded.content,pinned=excluded.pinned,version=excluded.version,state=excluded.state,updated_at=excluded.updated_at`)
        .run(m.id,m.projectId,m.scope,m.topicKey,m.type,m.title,m.content,Number(m.pinned),m.version,m.state,m.createdAt,m.updatedAt);
      const previous=old.get(m.id);
      for(const v of b.versions.slice(previous?.versions.length??0)) db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(m.id,v.version,JSON.stringify(v));
      for(const r of b.requests) if(!previous?.requests.some(p=>p.request_key===r.request_key)) db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?,?)").run(m.projectId,m.scope,r.request_key,r.payload_hash,m.id,r.version);
      for(const e of b.events.slice(previous?.events.length??0)) db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,?,?,?)").run(m.id,e.action,e.version,e.created_at);
    }
    if(next.format===2) {
      for(const s of next.sessions) db.query(`INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET endedAt=excluded.endedAt`).run(s.sessionId,s.projectId,s.kind,s.startedAt,s.endedAt);
      for(const e of next.sessionEntries) db.query(`INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)
        ON CONFLICT(memoryId,version) DO NOTHING`).run(e.sessionId,e.memoryId,e.version,e.recordedAt);
      for(const s of next.sessionSummaries) db.query(`INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET memoryId=excluded.memoryId,version=excluded.version`).run(s.sessionId,s.memoryId,s.version);
    }
    db.query("INSERT INTO sync_checkpoints(replica,snapshot) VALUES(?,?) ON CONFLICT(replica) DO UPDATE SET snapshot=excluded.snapshot").run(replica,JSON.stringify(next));
  }).immediate();
}
