import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { MemoryError, memoryTypes, type Memory, type MemoryVersion, type SaveInput, type SearchResult, type Project, type SearchScope } from "./domain";
import { initialize } from "./schema";
import { defaultDatabasePath } from "./paths";
import { projectIdentity } from "./identity";

interface Row {
  id: string; projectId: string | null; scope: Memory["scope"]; topic_key: string | null; type: Memory["type"];
  title: string; content: string; pinned: number; version: number;
  state: Memory["state"]; created_at: string; updated_at: string;
}
function memory(row: Row): Memory {
  return { id: row.id, projectId: row.projectId, scope: row.scope, topicKey: row.topic_key, type: row.type,
    title: row.title, content: row.content, pinned: row.pinned === 1,
    version: row.version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at };
}
function owner(projectId: string | null): string | null {
  return projectId === null ? null : projectIdentity(projectId);
}
function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);
  }
  return value.trim();
}

export class MemoryStore {
  private readonly db: Database;
  private closed = false;

  constructor(path: string = defaultDatabasePath(), options: { create?: boolean; readonly?: boolean } = {}) {
    required(path, "path");
    const create = options.create ?? !options.readonly;
    if (create && path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create, readwrite: !options.readonly, readonly: options.readonly ?? false, strict: true });
    try { initialize(this.db, create, options.readonly ?? false); }
    catch (error) { this.db.close(); throw error; }
  }

  createProject(name: string): Project {
    const displayName = required(name, "name");
    const now = new Date().toISOString();
    const project: Project = { projectId: crypto.randomUUID(), name: displayName, createdAt: now, updatedAt: now };
    this.db.query("INSERT INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)")
      .run(project.projectId,project.name,now,now);
    return project;
  }

  getProject(projectId: string): Project | null {
    return this.db.query("SELECT * FROM projects WHERE projectId=?").get(projectIdentity(projectId)) as Project | null;
  }

  listProjects(): Project[] {
    return this.db.query("SELECT * FROM projects ORDER BY name,projectId").all() as Project[];
  }

  renameProject(projectId: string, name: string): Project {
    const identity = projectIdentity(projectId);
    const displayName = required(name, "name");
    return this.db.transaction(() => {
      if (!this.getProject(identity)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
      this.db.query("UPDATE projects SET name=?,updatedAt=? WHERE projectId=?")
        .run(displayName,new Date().toISOString(),identity);
      return this.getProject(identity)!;
    }).immediate();
  }

  save(input: SaveInput): MemoryVersion {
    const scope = input.scope === undefined ? "project" : input.scope;
    if (scope !== "project" && scope !== "shared") throw new MemoryError("INVALID_INPUT", "scope debe ser project o shared.");
    if (scope === "shared" && input.projectId !== null) throw new MemoryError("INVALID_INPUT", "Un recuerdo shared no pertenece a un proyecto: projectId debe ser null.");
    const projectId = scope === "shared" ? null : projectIdentity(input.projectId);
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
    const hash = createHash("sha256").update(JSON.stringify([scope,projectId,title,content,input.type,topic,pinned,expected])).digest("hex");
    return this.db.transaction(() => {
      if (projectId !== null && !this.getProject(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Crea el proyecto antes de guardar.");
      if (request !== null) {
        const previous = this.db.query("SELECT * FROM requests WHERE scope=? AND projectId IS ? AND request_key=?").get(scope,projectId,request) as
          { payload_hash: string; memory_id: string; version: number } | null;
        if (previous) {
          if (previous.payload_hash !== hash) throw new MemoryError("REQUEST_CONFLICT", "La clave de petición ya corresponde a otro contenido.");
          const row = this.db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(previous.memory_id,previous.version) as { snapshot: string };
          return JSON.parse(row.snapshot) as MemoryVersion;
        }
      }
      const existing = topic === null ? null : this.db.query("SELECT * FROM memories WHERE scope=? AND projectId IS ? AND topic_key=?").get(scope,projectId,topic) as Row | null;
      if (existing?.state === "archived") throw new MemoryError("ARCHIVED", "Restaura el recuerdo antes de actualizar su tema.");
      if (existing ? existing.version !== expected : expected !== null) {
        throw new MemoryError("VERSION_CONFLICT", "La versión esperada no coincide. Lee el tema antes de actualizarlo.");
      }
      const now = new Date().toISOString();
      const id = existing?.id ?? crypto.randomUUID();
      const version = (existing?.version ?? 0) + 1;
      const snapshot: MemoryVersion = { id, projectId, scope, topicKey: topic, type: input.type, title, content, pinned, version,
        createdAt: existing?.created_at ?? now, updatedAt: now };
      if (existing) {
        this.db.query("UPDATE memories SET type=?,title=?,content=?,pinned=?,version=?,updated_at=? WHERE id=?").run(input.type,title,content,Number(pinned),version,now,id);
      } else {
        this.db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)")
          .run(id,projectId,scope,topic,input.type,title,content,Number(pinned),version,now,now);
      }
      this.db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(id,version,JSON.stringify(snapshot));
      this.db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(id,version,now);
      if (request !== null) this.db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?,?)").run(projectId,scope,request,hash,id,version);
      return snapshot;
    }).immediate();
  }

  get(projectId: string | null, id: string): Memory | null {
    const row = this.db.query("SELECT * FROM memories WHERE projectId IS ? AND id=?").get(owner(projectId),required(id,"id")) as Row | null;
    return row ? memory(row) : null;
  }

  history(projectId: string | null, id: string): MemoryVersion[] {
    const rows = this.db.query("SELECT v.snapshot FROM memory_versions v JOIN memories m ON m.id=v.memory_id WHERE m.projectId IS ? AND m.id=? ORDER BY v.version")
      .all(owner(projectId),required(id,"id")) as { snapshot: string }[];
    return rows.map(row => JSON.parse(row.snapshot) as MemoryVersion);
  }

  private searchSelection(projectId: string | null, scope: SearchScope): { sql: string; args: string[] } {
    if (!["all", "project", "shared"].includes(scope)) throw new MemoryError("INVALID_INPUT", "Búsqueda: scope debe ser all, project o shared.");
    if (projectId !== null && !this.getProject(projectIdentity(projectId))) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
    if (scope === "shared") return { sql: "m.scope='shared'", args: [] };
    if (projectId === null) throw new MemoryError("INVALID_INPUT", "Sin projectId debes buscar explícitamente en scope shared.");
    if (scope === "project") return { sql: "m.scope='project' AND m.projectId=?", args: [projectId] };
    return { sql: `(m.projectId=? OR (m.scope='shared' AND NOT EXISTS (
      SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project'
      AND p.state='active' AND p.topic_key=m.topic_key)))`, args: [projectId, projectId] };
  }

  search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[] {
    const selection = this.searchSelection(projectId, scope);
    const terms = required(query,"query").split(/\s+/u);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MemoryError("INVALID_INPUT", "limit debe ser un entero entre 1 y 100.");
    if (terms.some(term => Array.from(term).length < 3)) {
      // SQLite LIKE folds ASCII only. Scan scoped rows with Unicode lowercase
      // for short terms; iterate so a large project is not loaded into RAM.
      const folded = terms.map(term => term.toLowerCase());
      const result: SearchResult[] = [];
      // A fresh statement must be finalized even when the iterator stops early.
      const statement = this.db.prepare(`SELECT m.* FROM memories m WHERE ${selection.sql} AND m.state='active' ORDER BY m.pinned DESC,m.updated_at DESC,m.id ASC`);
      try {
        for (const row of statement.iterate(...selection.args) as Iterable<Row>) {
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
      WHERE memories_fts MATCH ? AND ${selection.sql} AND m.state='active'
      ORDER BY bm25 * multiplier ASC,m.id ASC LIMIT ?
    `).all(match,...selection.args,limit) as (Row & { bm25: number; multiplier: number })[];
    return rows.map(row => ({ memory: memory(row), explanation: { mode: "fts5", bm25: row.bm25,
      multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
  }

  archive(projectId: string | null, id: string): Memory { return this.setState(projectId,id,"archived"); }
  restore(projectId: string | null, id: string): Memory { return this.setState(projectId,id,"active"); }

  private setState(projectId: string | null, id: string, state: Memory["state"]): Memory {
    return this.db.transaction(() => {
      const current = this.get(projectId,id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el alcance seleccionado.");
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
