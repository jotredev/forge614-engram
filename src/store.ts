import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { MemoryError, memoryTypes, type Memory, type MemoryVersion, type SaveInput, type SearchResult } from "./domain";
import { initialize } from "./schema";

interface Row {
  id: string; project: string; topic_key: string | null; type: Memory["type"];
  title: string; content: string; pinned: number; version: number;
  state: Memory["state"]; created_at: string; updated_at: string;
}
function memory(row: Row): Memory {
  return { id: row.id, project: row.project, topicKey: row.topic_key, type: row.type,
    title: row.title, content: row.content, pinned: row.pinned === 1,
    version: row.version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at };
}
function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);
  }
  return value.trim();
}
function projectName(value: string): string { return required(value, "project").toLowerCase(); }

export class MemoryStore {
  private readonly db: Database;
  private closed = false;

  constructor(path: string) {
    required(path, "path");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    try { initialize(this.db); }
    catch (error) { this.db.close(); throw error; }
  }

  save(input: SaveInput): MemoryVersion {
    const project = projectName(input.project);
    const title = required(input.title, "title");
    const content = required(input.content, "content");
    if (!memoryTypes.includes(input.type)) throw new MemoryError("INVALID_INPUT", "Tipo de recuerdo no válido.");
    if (input.pinned !== undefined && typeof input.pinned !== "boolean") throw new MemoryError("INVALID_INPUT", "pinned debe ser booleano.");
    const topic = input.topicKey === undefined ? null : required(input.topicKey, "topicKey");
    const request = input.requestKey === undefined ? null : required(input.requestKey, "requestKey");
    const expected = input.expectedVersion ?? null;
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1 || !topic)) {
      throw new MemoryError("INVALID_INPUT", "expectedVersion requiere un tema y un entero positivo.");
    }
    const pinned = input.pinned ?? false;
    const hash = createHash("sha256").update(JSON.stringify([project,title,content,input.type,topic,pinned,expected])).digest("hex");
    return this.db.transaction(() => {
      if (request !== null) {
        const previous = this.db.query("SELECT * FROM requests WHERE project=? AND request_key=?").get(project,request) as
          { payload_hash: string; memory_id: string; version: number } | null;
        if (previous) {
          if (previous.payload_hash !== hash) throw new MemoryError("REQUEST_CONFLICT", "La clave de petición ya corresponde a otro contenido.");
          const row = this.db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(previous.memory_id,previous.version) as { snapshot: string };
          return JSON.parse(row.snapshot) as MemoryVersion;
        }
      }
      const existing = topic === null ? null : this.db.query("SELECT * FROM memories WHERE project=? AND topic_key=?").get(project,topic) as Row | null;
      if (existing?.state === "archived") throw new MemoryError("ARCHIVED", "Restaura el recuerdo antes de actualizar su tema.");
      if (existing ? existing.version !== expected : expected !== null) {
        throw new MemoryError("VERSION_CONFLICT", "La versión esperada no coincide. Lee el tema antes de actualizarlo.");
      }
      const now = new Date().toISOString();
      const id = existing?.id ?? crypto.randomUUID();
      const version = (existing?.version ?? 0) + 1;
      const snapshot: MemoryVersion = { id, project, topicKey: topic, type: input.type, title, content, pinned, version,
        createdAt: existing?.created_at ?? now, updatedAt: now };
      if (existing) {
        this.db.query("UPDATE memories SET type=?,title=?,content=?,pinned=?,version=?,updated_at=? WHERE id=?").run(input.type,title,content,Number(pinned),version,now,id);
      } else {
        this.db.query("INSERT INTO memories(id,project,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?)")
          .run(id,project,topic,input.type,title,content,Number(pinned),version,now,now);
      }
      this.db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(id,version,JSON.stringify(snapshot));
      this.db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(id,version,now);
      if (request !== null) this.db.query("INSERT INTO requests(project,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?)").run(project,request,hash,id,version);
      return snapshot;
    }).immediate();
  }

  get(project: string, id: string): Memory | null {
    const row = this.db.query("SELECT * FROM memories WHERE project=? AND id=?").get(projectName(project),required(id,"id")) as Row | null;
    return row ? memory(row) : null;
  }

  history(project: string, id: string): MemoryVersion[] {
    const rows = this.db.query("SELECT v.snapshot FROM memory_versions v JOIN memories m ON m.id=v.memory_id WHERE m.project=? AND m.id=? ORDER BY v.version")
      .all(projectName(project),required(id,"id")) as { snapshot: string }[];
    return rows.map(row => JSON.parse(row.snapshot) as MemoryVersion);
  }

  search(project: string, query: string, limit = 10): SearchResult[] {
    const scope = projectName(project);
    const terms = required(query,"query").split(/\s+/u);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MemoryError("INVALID_INPUT", "limit debe ser un entero entre 1 y 100.");
    if (terms.some(term => Array.from(term).length < 3)) {
      // SQLite LIKE folds ASCII only. Scan scoped rows with Unicode lowercase
      // for short terms; iterate so a large project is not loaded into RAM.
      const folded = terms.map(term => term.toLowerCase());
      const result: SearchResult[] = [];
      // A fresh statement must be finalized even when the iterator stops early.
      const statement = this.db.prepare("SELECT * FROM memories WHERE project=? AND state='active' ORDER BY pinned DESC,updated_at DESC,id ASC");
      try {
        for (const row of statement.iterate(scope) as Iterable<Row>) {
          const fields = [row.title,row.content,row.topic_key ?? ""].map(field => field.toLowerCase());
          if (!folded.every(term => fields.some(field => field.includes(term)))) continue;
          result.push({ memory: memory(row), explanation: { mode: "literal", bm25: null, multiplier: 1, orderScore: null } });
          if (result.length === limit) break;
        }
      } finally {
        statement.finalize();
      }
      return result;
    }
    const match = terms.map(term => `"${term.replaceAll('"','""')}"`).join(" AND ");
    const rows = this.db.query(`
      SELECT m.*, bm25(memories_fts,5.0,1.0,3.0) AS bm25,
        (1 + 0.10*m.pinned + 0.06/(1+MAX(0,julianday('now')-julianday(m.updated_at))/30)) AS multiplier
      FROM memories_fts JOIN memories m ON m.rowid=memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.project=? AND m.state='active'
      ORDER BY bm25 * multiplier ASC,m.id ASC LIMIT ?
    `).all(match,scope,limit) as (Row & { bm25: number; multiplier: number })[];
    return rows.map(row => ({ memory: memory(row), explanation: { mode: "fts5", bm25: row.bm25,
      multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
  }

  archive(project: string, id: string): Memory { return this.setState(project,id,"archived"); }
  restore(project: string, id: string): Memory { return this.setState(project,id,"active"); }

  private setState(project: string, id: string, state: Memory["state"]): Memory {
    return this.db.transaction(() => {
      const current = this.get(project,id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en este proyecto.");
      if (current.state === state) return current;
      this.db.query("UPDATE memories SET state=? WHERE id=?").run(state,current.id);
      this.db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,?,?,?)")
        .run(current.id,state === "active" ? "restore" : "archive",current.version,new Date().toISOString());
      return { ...current,state };
    }).immediate();
  }

  close(): void {
    if (!this.closed) { this.db.close(); this.closed = true; }
  }
}
