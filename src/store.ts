import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { MemoryError, memoryTypes, type Memory, type MemoryVersion, type SaveInput, type SearchResult, type Project, type SearchScope } from "./domain";
import { initialize, enableAssistantIntegration, enableSessionLifecycle, enableSynchronization } from "./schema";
import { exportSnapshot, applySnapshot, checkpoint } from "./sync-local";
import type { SyncSnapshot } from "./sync-snapshot";
import { defaultDatabasePath } from "./paths";
import { projectIdentity } from "./identity";
import type { Session, SessionSaveOptions, SessionSaveResult, SummaryFields } from "./session-types";
import { endRuntimeSession, sessionIdentity, sessionRow, startRuntimeSession, summaryContent } from "./sessions";
import { context as readContext, getVersion as readVersion, searchPreviews as readPreviews, searchSelection, searchTerms, timeline as readTimeline, validateSearchLimit } from "./retrieval";
import type { ContextInput, ContextResult, PreviewResult, TimelineInput, TimelineResult, VersionRead } from "./retrieval-types";

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

  private requireAssistantIntegration(): void {
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== 5 && version !== 6) {
      throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero la integración de asistentes con integration-enable.");
    }
  }

  sessionsEnabled(): boolean {
    return (this.db.query("PRAGMA user_version").get() as {user_version:number}).user_version === 6;
  }

  enableSessions(): void { enableSessionLifecycle(this.db); }

  private requireSessions(): void {
    if (!this.sessionsEnabled()) throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero las sesiones.");
  }

  startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session {
    this.requireSessions();
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const directory = runtimeDirectory === undefined ? undefined : required(runtimeDirectory,"runtimeDirectory");
    return this.db.transaction(() => startRuntimeSession(this.db,project,id,directory)).immediate();
  }

  endSession(projectId: string, sessionId: string): Session {
    this.requireSessions();
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    return this.db.transaction(() => endRuntimeSession(this.db,project,id)).immediate();
  }

  getSession(projectId: string, sessionId: string): Session | null {
    this.requireSessions();
    const project = projectIdentity(projectId); const row = sessionRow(this.db,sessionIdentity(sessionId));
    return row?.projectId === project ? row : null;
  }

  startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string,
      bindingAvailable?: (directory:string)=>boolean): Session {
    this.requireSessions();
    const id = sessionIdentity(sessionId); const runtime = required(runtimeDirectory,"runtimeDirectory");
    return this.db.transaction(() => {
      const context = this.resolveProjectDirectory(directory,name,true,bindingAvailable);
      return startRuntimeSession(this.db,context.project!.projectId,id,runtime);
    }).immediate();
  }

  projectForDirectory(directory: string): Project | null {
    this.requireAssistantIntegration();
    const path = required(directory,"directory");
    return this.db.query(`SELECT p.* FROM project_bindings b JOIN projects p ON p.projectId=b.projectId
      WHERE b.directory=?`).get(path) as Project | null;
  }

  bindProjectDirectory(directory: string, projectId: string): Project {
    this.requireAssistantIntegration();
    const path = required(directory,"directory"); const identity = projectIdentity(projectId);
    return this.db.transaction(() => {
      const project = this.getProject(identity);
      if (!project) throw new MemoryError("PROJECT_NOT_FOUND","Proyecto no encontrado en esta base.");
      const bound = this.projectForDirectory(path);
      if (bound && bound.projectId !== identity) {
        throw new MemoryError("PROJECT_BINDING_CONFLICT","La carpeta ya está vinculada a otro proyecto.");
      }
      if (!bound) this.db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
        .run(path,identity,new Date().toISOString());
      return project;
    }).immediate();
  }

  resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean): { project: Project | null; created: boolean } {
    this.requireAssistantIntegration();
    const path = required(directory,"directory"); const displayName = required(name,"name");
    const operation = () => {
      const bound = this.projectForDirectory(path);
      if (bound || !create) return { project: bound, created: false };
      const collision = this.db.query("SELECT projectId FROM projects WHERE name=? LIMIT 1").get(displayName);
      if (collision) {
        throw new MemoryError("PROJECT_BINDING_REQUIRED","Existe un proyecto con el mismo nombre; se requiere vinculación explícita.");
      }
      if (bindingAvailable) {
        const bindings=this.db.query("SELECT projectId,directory FROM project_bindings").all() as {projectId:string;directory:string}[];
        const available=new Map<string,boolean>();
        for(const binding of bindings){
          let exists=false;try{exists=bindingAvailable(binding.directory);}catch{/* Unavailable is ambiguous. */}
          available.set(binding.projectId,(available.get(binding.projectId)??false)||exists);
        }
        if([...available.values()].some(exists=>!exists)) {
          throw new MemoryError("PROJECT_BINDING_REQUIRED","Hay proyectos cuyas carpetas registradas no están disponibles; se requiere vinculación explícita con project-bind.");
        }
      }
      const project = this.createProject(displayName);
      this.db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
        .run(path,project.projectId,new Date().toISOString());
      return { project, created: true };
    };
    return create ? this.db.transaction(operation).immediate() : operation();
  }

  saveForProjectDirectory(directory: string, name: string, input: Omit<SaveInput,"projectId"|"scope">, bindingAvailable?: (directory:string)=>boolean): MemoryVersion {
    this.requireAssistantIntegration();
    return this.db.transaction(() => {
      const context = this.resolveProjectDirectory(directory,name,true,bindingAvailable);
      return this.saveCore({ ...input, scope:"project", projectId:context.project!.projectId },{},new Date().toISOString()).memory;
    }).immediate();
  }

  saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string,
      input: Omit<SaveInput,"projectId"|"scope">, options: SessionSaveOptions = {},
      bindingAvailable?: (directory:string)=>boolean): SessionSaveResult {
    this.requireAssistantIntegration();
    const runtime = required(runtimeDirectory,"runtimeDirectory");
    return this.db.transaction(() => {
      const context = this.resolveProjectDirectory(directory,name,true,bindingAvailable);
      return this.saveCore({ ...input, scope:"project", projectId:context.project!.projectId },
        { ...options, runtimeDirectory:runtime },new Date().toISOString());
    }).immediate();
  }

  save(input: SaveInput): MemoryVersion {
    return this.db.transaction(() => this.saveCore(input,{},new Date().toISOString()).memory).immediate();
  }

  saveWithSession(input: SaveInput, options: SessionSaveOptions = {}): SessionSaveResult {
    return this.db.transaction(() => this.saveCore(input,options,new Date().toISOString())).immediate();
  }

  saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields,
      request: {requestKey:string;expectedVersion?:number}): SessionSaveResult {
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const requestKey = required(request?.requestKey,"requestKey");
    if (request.expectedVersion !== undefined && (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)) {
      throw new MemoryError("INVALID_INPUT","expectedVersion debe ser un entero positivo.");
    }
    const content = summaryContent(fields); const topicKey = `session/${id}/summary`;
    return this.db.transaction(() => {
      this.requireSessions();
      const pointer = this.db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(id) as
        {memoryId:string;version:number}|null;
      const occupied = this.db.query("SELECT id FROM memories WHERE scope='project' AND projectId=? AND topic_key=?").get(project,topicKey) as {id:string}|null;
      if (occupied && (!pointer || occupied.id !== pointer.memoryId)) {
        throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El tema reservado ya pertenece a otro recuerdo.");
      }
      const replay = this.db.query("SELECT 1 FROM requests WHERE scope='project' AND projectId=? AND request_key=?")
        .get(project,requestKey) !== null;
      const result = this.saveCore({projectId:project,title:`Session summary: ${id}`,content,type:"procedure",topicKey,
        requestKey,...(request.expectedVersion === undefined ? {} : {expectedVersion:request.expectedVersion})},
        {sessionId:id},new Date().toISOString(),true);
      if (replay) return result;
      if (pointer?.memoryId === result.memory.id && pointer.version === result.memory.version) return result;
      if (pointer && pointer.memoryId !== result.memory.id) throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El resumen no coincide con su puntero.");
      this.db.query(`INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET memoryId=excluded.memoryId,version=excluded.version`)
        .run(id,result.memory.id,result.memory.version);
      return result;
    }).immediate();
  }

  private saveCore(input: SaveInput, options: SessionSaveOptions, requestNow: string, summary = false): SessionSaveResult {
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
    if (options.mode !== undefined && options.mode !== "independent" && options.mode !== "assistant") throw new MemoryError("INVALID_INPUT","mode no válido.");
    const explicit = options.sessionId === undefined ? null : sessionIdentity(options.sessionId);
    const optionProject = options.projectId === undefined ? null : projectIdentity(options.projectId);
    const runtimeDirectory = options.runtimeDirectory === undefined ? null : required(options.runtimeDirectory,"runtimeDirectory");
      if (projectId !== null && !this.getProject(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Crea el proyecto antes de guardar.");
      if (request !== null) {
        const previous = this.db.query("SELECT * FROM requests WHERE scope=? AND projectId IS ? AND request_key=?").get(scope,projectId,request) as
          { payload_hash: string; memory_id: string; version: number } | null;
        if (previous) {
          if (previous.payload_hash !== hash) throw new MemoryError("REQUEST_CONFLICT", "La clave de petición ya corresponde a otro contenido.");
          const row = this.db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(previous.memory_id,previous.version) as { snapshot: string };
          const memory = JSON.parse(row.snapshot) as MemoryVersion;
          const origin = this.sessionsEnabled() ? this.db.query(`SELECT e.sessionId,s.kind,s.projectId FROM session_entries e
            JOIN sessions s ON s.sessionId=e.sessionId WHERE e.memoryId=? AND e.version=?`).get(previous.memory_id,previous.version) as
            {sessionId:string;kind:Session["kind"];projectId:string}|null : null;
          if (explicit !== null && origin?.sessionId !== explicit) throw new MemoryError("REQUEST_CONFLICT","La petición ya tiene otra asociación de sesión.");
          if (explicit !== null) this.validateSelectedSession(explicit,scope,projectId,optionProject,false);
          const visible = scope === "project" || explicit !== null || (optionProject !== null && origin?.projectId === optionProject);
          return {memory,sessionId:visible ? origin?.sessionId ?? null : null,
            sessionSource:visible && origin ? (explicit ? "explicit" : origin.kind === "manual" ? "manual" : "inferred") : null};
        }
      }
      let selected: string|null = null;
      let source: SessionSaveResult["sessionSource"] = null;
      if (explicit !== null) {
        this.requireSessions(); this.validateSelectedSession(explicit,scope,projectId,optionProject,true);
        selected=explicit; source="explicit";
      } else if (this.sessionsEnabled() && scope === "project") {
        if ((options.mode ?? "independent") === "assistant") {
          const candidates = runtimeDirectory === null ? [] : this.inferredSessions(projectId!,runtimeDirectory,requestNow);
          if (candidates.length > 1) throw new MemoryError("AMBIGUOUS_SESSION",`AMBIGUOUS_SESSION: indica sessionId (${candidates.join(", ")}).`);
          if (candidates.length === 1) { selected=candidates[0]!; source="inferred"; }
        }
        if (selected === null) { selected=this.manualSession(projectId!,requestNow); source="manual"; }
      } else if (scope === "shared" && explicit === null) {
        selected=null; source=null;
      }
      if (!summary && topic !== null && this.sessionsEnabled()) {
        const reserved = this.db.query(`SELECT 1 FROM sessions s WHERE s.projectId IS ? AND ?=('session/'||s.sessionId||'/summary') LIMIT 1`)
          .get(projectId,topic);
        if (reserved) throw new MemoryError("SUMMARY_TOPIC_RESERVED","El tema está reservado para un resumen de sesión.");
      }
      const existing = topic === null ? null : this.db.query("SELECT * FROM memories WHERE scope=? AND projectId IS ? AND topic_key=?").get(scope,projectId,topic) as Row | null;
      if (existing?.state === "archived") throw new MemoryError("ARCHIVED", "Restaura el recuerdo antes de actualizar su tema.");
      if (existing ? existing.version !== expected : expected !== null) {
        throw new MemoryError("VERSION_CONFLICT", "La versión esperada no coincide. Lee el tema antes de actualizarlo.");
      }
      const now = requestNow;
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
      if (selected !== null) this.db.query("INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)")
        .run(selected,id,version,now);
      return {memory:snapshot,sessionId:selected,sessionSource:source};
  }

  private validateSelectedSession(sessionId: string, scope: Memory["scope"], projectId: string|null,
      optionProject: string|null, requireOpen: boolean): Session {
    const row = sessionRow(this.db,sessionId);
    if (!row) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada.");
    const expectedOwner = scope === "project" ? projectId : optionProject;
    if (scope === "shared" && optionProject === null) throw new MemoryError("INVALID_INPUT","projectId es obligatorio para asociar shared.");
    if (row.projectId !== expectedOwner) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada para este proyecto.");
    if (row.kind !== "runtime") throw new MemoryError("SESSION_KIND","Una sesión manual no admite asociación explícita.");
    if (requireOpen && row.endedAt !== null) throw new MemoryError("SESSION_CLOSED","La sesión está cerrada.");
    return row;
  }

  private inferredSessions(projectId: string, directory: string, requestNow: string): string[] {
    const threshold = new Date(Date.parse(requestNow)-7*24*60*60*1000).toISOString();
    return (this.db.query(`SELECT s.sessionId FROM sessions s
      WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
      AND EXISTS (SELECT 1 FROM local_session_bindings b WHERE b.sessionId=s.sessionId AND b.directory=?)
      AND max(s.startedAt,coalesce((SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)) >= ?
      ORDER BY s.sessionId`).all(projectId,directory,threshold) as {sessionId:string}[]).map(row=>row.sessionId);
  }

  private manualSession(projectId: string, now: string): string {
    const existing = this.db.query("SELECT sessionId FROM local_manual_sessions WHERE projectId=?").get(projectId) as {sessionId:string}|null;
    if (existing) return existing.sessionId;
    const id = crypto.randomUUID();
    this.db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'manual',?,NULL)").run(id,projectId,now);
    this.db.query("INSERT INTO local_manual_sessions(projectId,sessionId) VALUES(?,?)").run(projectId,id);
    return id;
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

  search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[] {
    const identity = projectId === null ? null : projectIdentity(projectId);
    const selection = searchSelection(this.db, identity, scope);
    const parsed = searchTerms(query); validateSearchLimit(limit);
    if (parsed.literal) {
      // SQLite LIKE folds ASCII only. Scan scoped rows with Unicode lowercase
      // for short terms; iterate so a large project is not loaded into RAM.
      const folded = parsed.terms.map(term => term.toLowerCase());
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
    const rows = this.db.query(`
      SELECT m.*, bm25(memories_fts,5.0,1.0,3.0) AS bm25,
        (1 + 0.10*m.pinned + 0.06/(1+MAX(0,julianday('now')-julianday(m.updated_at))/30)) AS multiplier
      FROM memories_fts JOIN memories m ON m.rowid=memories_fts.rowid
      WHERE memories_fts MATCH ? AND ${selection.sql} AND m.state='active'
      ORDER BY bm25 * multiplier ASC,m.id ASC LIMIT ?
    `).all(parsed.match,...selection.args,limit) as (Row & { bm25: number; multiplier: number })[];
    return rows.map(row => ({ memory: memory(row), explanation: { mode: "fts5", bm25: row.bm25,
      multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
  }

  searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[] {
    return readPreviews(this.db, projectId === null ? null : projectIdentity(projectId), query, limit, scope);
  }

  getVersion(projectId: string | null, id: string, version?: number): VersionRead | null {
    return readVersion(this.db, owner(projectId), id, version);
  }

  timeline(projectId: string, input: TimelineInput): TimelineResult {
    return readTimeline(this.db, this.sessionsEnabled(), projectIdentity(projectId), input);
  }

  context(projectId: string | null, input?: ContextInput): ContextResult {
    return readContext(this.db, this.sessionsEnabled(), projectId === null ? null : projectIdentity(projectId), input);
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

  enableSync(): void { enableSynchronization(this.db); }
  enableAssistantIntegration(): void { enableAssistantIntegration(this.db); }
  syncSnapshot(): SyncSnapshot { return exportSnapshot(this.db); }
  syncCheckpoint(replica: string): SyncSnapshot { return checkpoint(this.db,replica); }
  applySync(expected: SyncSnapshot, next: SyncSnapshot, replica: string): void { applySnapshot(this.db,expected,next,replica); }
}
