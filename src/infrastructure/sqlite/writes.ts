import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { boardTypeAllowed,ECOSYSTEM_AFFECTS_MIN,ECOSYSTEM_BOARD_LIMIT,ECOSYSTEM_STATUS_MAX,ECOSYSTEM_STATUS_TOPIC,groupIdentity } from "../../modules/ecosystem";
import { findSecret,memoryTypes,normalizeAffects,normalizeShort,reviewAfterFor,sameConfirmationPayload,type Memory,type MemoryMeta,type MemoryOwner,type MemoryVersion,type SaveInput } from "../../modules/memory";
import { projectIdentity,type Project } from "../../modules/projects";
import { sessionIdentity,summaryContent,type Session,type SessionSaveOptions,type SessionSaveResult,type SummaryFields } from "../../modules/sessions";
import { MemoryError } from "../../shared/errors";
import { touchSession } from "./activity";
import { confirmationCandidate,confirmationRequest,reinforcementEnabled } from "./confirmations";
import { intelligenceEnabled } from "./intelligence";
import { readMeta,upsertMeta } from "./meta";
import { similarTo } from "./similar";
import { getGroup,recordIdentityEvent,requireEcosystem } from "./ecosystem-groups";
import { groupSource } from "./board";
import { get,required,type Row } from "./memory";
import { getProject,projectForDirectory,requireProjectBindings,resolveProjectDirectory as resolveProjectDirectoryInTransaction } from "./projects";
import { endRuntimeSession,inferredSessions,manualSession,requireSessions,sessionsEnabled,startRuntimeSession,validateSelectedSession } from "./sessions";

// Composite local writes own their outer transaction here. Leaf helpers use the same connection.
export function resolveProjectDirectory(db: Database, directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean): { project: Project | null; created: boolean } {
  requireProjectBindings(db);
  const path = required(directory,"directory"), displayName = required(name,"name");
  const operation = () => resolveProjectDirectoryInTransaction(db,path,displayName,create,bindingAvailable);
  return create ? db.transaction(operation).immediate() : operation();
}

export function renameProject(db: Database, projectId: string, name: string): Project {
    const identity = projectIdentity(projectId);
    const displayName = required(name, "name");
    return db.transaction(() => {
      if (!getProject(db, identity)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
      db.query("UPDATE projects SET name=?,updatedAt=? WHERE projectId=?")
        .run(displayName,new Date().toISOString(),identity);
      return getProject(db, identity)!;
    }).immediate();
  }

export function startSession(db: Database, projectId: string, sessionId: string, runtimeDirectory?: string): Session {
    requireSessions(db);
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const directory = runtimeDirectory === undefined ? undefined : required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => startRuntimeSession(db,project,id,directory)).immediate();
  }

export function endSession(db: Database, projectId: string, sessionId: string): Session {
    requireSessions(db);
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    return db.transaction(() => endRuntimeSession(db,project,id)).immediate();
  }

export function startSessionForProjectDirectory(db: Database, directory: string, name: string, runtimeDirectory: string, sessionId: string, bindingAvailable?: (directory:string)=>boolean): Session {
    requireSessions(db);
    const id = sessionIdentity(sessionId); const runtime = required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable);
      return startRuntimeSession(db,context.project!.projectId,id,runtime);
    }).immediate();
  }

export function bindProjectDirectory(db: Database, directory: string, projectId: string): Project {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const identity = projectIdentity(projectId);
    return db.transaction(() => {
      const project = getProject(db, identity);
      if (!project) throw new MemoryError("PROJECT_NOT_FOUND","Proyecto no encontrado en esta base.");
      const bound = projectForDirectory(db, path);
      if (bound && bound.projectId !== identity) {
        throw new MemoryError("PROJECT_BINDING_CONFLICT","La carpeta ya está vinculada a otro proyecto.");
      }
      if (!bound) db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
        .run(path,identity,new Date().toISOString());
      return project;
    }).immediate();
  }

/** The identity file wins over a path binding: move the folder to the file's project and record the event. */
export function rebindProjectDirectory(db: Database, directory: string, projectId: string): { previousProjectId: string | null } {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const identity = projectIdentity(projectId);
    return db.transaction(() => {
      if (!getProject(db, identity)) throw new MemoryError("PROJECT_NOT_FOUND","Proyecto no encontrado en esta base.");
      const bound = projectForDirectory(db, path);
      if (bound?.projectId === identity) return { previousProjectId: null };
      if (bound) requireEcosystem(db);
      if (bound) db.query("DELETE FROM project_bindings WHERE directory=?").run(path);
      db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)").run(path,identity,new Date().toISOString());
      if (bound) recordIdentityEvent(db, { action: "PROJECT_REBOUND_FROM_FILE", projectId: identity, previousProjectId: bound.projectId, directory: path });
      return { previousProjectId: bound?.projectId ?? null };
    }).immediate();
  }

export function saveForProjectDirectory(db: Database, directory: string, name: string, input: Omit<SaveInput,"projectId"|"scope">, bindingAvailable?: (directory:string)=>boolean): MemoryVersion {
    requireProjectBindings(db);
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable);
      return saveCore(db, { ...input, scope:"project", projectId:context.project!.projectId },{},new Date().toISOString()).memory;
    }).immediate();
  }

export function saveWithSessionForProjectDirectory(db: Database, directory: string, name: string, runtimeDirectory: string, input: Omit<SaveInput,"projectId"|"scope">, options: SessionSaveOptions = {}, bindingAvailable?: (directory:string)=>boolean): SessionSaveResult {
    requireProjectBindings(db);
    const runtime = required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable);
      return saveCore(db, { ...input, scope:"project", projectId:context.project!.projectId },
        { ...options, runtimeDirectory:runtime },new Date().toISOString());
    }).immediate();
  }

export function save(db: Database, input: SaveInput): MemoryVersion {
    return db.transaction(() => saveCore(db, input,{},new Date().toISOString()).memory).immediate();
  }

export function saveWithSession(db: Database, input: SaveInput, options: SessionSaveOptions = {}): SessionSaveResult {
    return db.transaction(() => saveCore(db, input,options,new Date().toISOString())).immediate();
  }

export function saveSessionSummary(db: Database, projectId: string, sessionId: string, fields: SummaryFields, request: {requestKey:string;expectedVersion?:number}, groupId?: string): SessionSaveResult {
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const group = groupId === undefined ? null : groupIdentity(groupId);
    const requestKey = required(request?.requestKey,"requestKey");
    if (request.expectedVersion !== undefined && (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)) {
      throw new MemoryError("INVALID_INPUT","expectedVersion debe ser un entero positivo.");
    }
    const content = summaryContent(fields); const topicKey = `session/${id}/summary`;
    return db.transaction(() => {
      requireSessions(db);
      const pointer = db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(id) as
        {memoryId:string;version:number}|null;
      if (group !== null) { requireEcosystem(db); if (!getGroup(db, group)) throw new MemoryError("GROUP_NOT_FOUND","Grupo no encontrado en esta base."); }
      const occupied = (group === null
        ? db.query("SELECT id FROM memories WHERE scope='project' AND projectId=? AND topic_key=?").get(project,topicKey)
        : db.query("SELECT id FROM memories WHERE scope='ecosystem' AND groupId=? AND topic_key=?").get(group,topicKey)) as {id:string}|null;
      if (occupied && (!pointer || occupied.id !== pointer.memoryId)) {
        throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El tema reservado ya pertenece a otro recuerdo.");
      }
      const replay = (group === null
        ? db.query("SELECT 1 FROM requests WHERE scope='project' AND projectId=? AND request_key=?").get(project,requestKey)
        : db.query("SELECT 1 FROM requests WHERE scope='ecosystem' AND groupId=? AND request_key=?").get(group,requestKey)) !== null
        || (reinforcementEnabled(db) && confirmationRequest(db,group===null?"project":"ecosystem",group===null?project:group,requestKey)!==null);
      const summaryInput = {title:`Session summary: ${id}`,content,type:"procedure" as const,topicKey,
        requestKey,...(request.expectedVersion === undefined ? {} : {expectedVersion:request.expectedVersion})};
      const result = group === null
        ? saveCore(db, {projectId:project,...summaryInput},{sessionId:id},new Date().toISOString(),true)
        : saveCore(db, {scope:"ecosystem",projectId:null,groupId:group,...summaryInput},{sessionId:id,projectId:project},new Date().toISOString(),true);
      if (replay) return result;
      if (pointer?.memoryId === result.memory.id && pointer.version === result.memory.version) return result;
      if (pointer && pointer.memoryId !== result.memory.id) throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El resumen no coincide con su puntero.");
      db.query(`INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET memoryId=excluded.memoryId,version=excluded.version`)
        .run(id,result.memory.id,result.memory.version);
      return result;
    }).immediate();
  }

function requestReplay(db: Database, input: {
  scope:Memory["scope"];projectId:string|null;groupId:string|null;request:string;hash:string;explicit:string|null;optionProject:string|null;
}): SessionSaveResult|null {
  const column=input.scope==="ecosystem" ? "groupId" : "projectId";
  const ownerId=input.scope==="ecosystem" ? input.groupId : input.projectId;
  const previous=db.query(`SELECT payload_hash,memory_id,version FROM requests WHERE scope=? AND ${column} IS ? AND request_key=?`)
    .get(input.scope,ownerId,input.request) as {payload_hash:string;memory_id:string;version:number}|null;
  const confirmed=reinforcementEnabled(db) ? confirmationRequest(db,input.scope,ownerId,input.request) : null;
  if(previous && confirmed) throw new MemoryError("REQUEST_CONFLICT","La clave de petición tiene registros incompatibles.");
  if(previous) {
    if(previous.payload_hash!==input.hash) throw new MemoryError("REQUEST_CONFLICT","La clave de petición ya corresponde a otro contenido.");
    const row=db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(previous.memory_id,previous.version) as {snapshot:string};
    const memory=JSON.parse(row.snapshot) as MemoryVersion;
    const origin=sessionsEnabled(db) ? db.query(`SELECT e.sessionId,s.kind,s.projectId FROM session_entries e
      JOIN sessions s ON s.sessionId=e.sessionId WHERE e.memoryId=? AND e.version=?`).get(previous.memory_id,previous.version) as
      {sessionId:string;kind:Session["kind"];projectId:string}|null : null;
    if(input.explicit!==null && origin?.sessionId!==input.explicit) throw new MemoryError("REQUEST_CONFLICT","La petición ya tiene otra asociación de sesión.");
    if(input.explicit!==null) validateSelectedSession(db,input.explicit,input.scope,input.projectId,input.optionProject,false);
    const visible=input.scope==="project" || input.explicit!==null || (input.optionProject!==null && origin?.projectId===input.optionProject);
    return {memory,sessionId:visible ? origin?.sessionId??null:null,
      sessionSource:visible && origin ? (input.explicit ? "explicit" : origin.kind==="manual" ? "manual" : "inferred") : null};
  }
  if(!confirmed) return null;
  if(confirmed.payloadHash!==input.hash) throw new MemoryError("REQUEST_CONFLICT","La clave de petición ya corresponde a otro contenido.");
  const stored=confirmed.response;
  if(input.explicit!==null && stored.sessionId!==input.explicit) throw new MemoryError("REQUEST_CONFLICT","La petición ya tiene otra asociación de sesión.");
  if(input.explicit!==null) validateSelectedSession(db,input.explicit,input.scope,input.projectId,input.optionProject,false);
  const origin=stored.sessionId===null ? null : db.query("SELECT projectId FROM sessions WHERE sessionId=?").get(stored.sessionId) as {projectId:string}|null;
  const visible=input.scope==="project" || input.explicit!==null || (input.optionProject!==null && origin?.projectId===input.optionProject);
  return {...stored,sessionId:visible?stored.sessionId:null,sessionSource:visible?stored.sessionSource:null};
}

// Level-11 metadata for a save. The replaced memory must be active and in the same scope and owner.
function applySaveMeta(db: Database, input: { id: string; type: SaveInput["type"]; now: string; newVersion: boolean; contentChanged: boolean;
    short: string | undefined; affects: string[] | undefined; supersedes: string | null; scope: Memory["scope"]; ownerColumn: string; ownerId: string | null }): void {
  if (input.supersedes !== null) {
    if (input.supersedes === input.id) throw new MemoryError("INVALID_INPUT", "Un recuerdo no puede reemplazarse a sí mismo.");
    const target = db.query(`SELECT id FROM memories WHERE scope=? AND ${input.ownerColumn} IS ? AND id=? AND state='active'`)
      .get(input.scope, input.ownerId, input.supersedes) as { id: string } | null;
    if (!target) throw new MemoryError("SUPERSEDES_NOT_FOUND", "El recuerdo a reemplazar no existe o no es del mismo alcance.");
  }
  const previous = readMeta(db, input.id);
  const patch: Partial<MemoryMeta> = {};
  if (input.newVersion) {
    const reviewAfter = reviewAfterFor(input.type, input.now);
    if (reviewAfter !== null || previous?.reviewAfter) patch.reviewAfter = reviewAfter;
    if (input.short === undefined && input.contentChanged && previous?.short) patch.short = null;
  }
  if (input.short !== undefined) patch.short = input.short;
  if (input.affects !== undefined) patch.affects = input.affects;
  if (Object.keys(patch).length > 0) upsertMeta(db, input.id, patch, input.now);
  if (input.supersedes !== null) upsertMeta(db, input.supersedes, { supersededBy: input.id }, input.now);
}

function saveCore(db: Database, input: SaveInput, options: SessionSaveOptions, requestNow: string, summary = false): SessionSaveResult {
    const scope = input.scope === undefined ? "project" : input.scope;
    if (scope !== "project" && scope !== "shared" && scope !== "ecosystem") throw new MemoryError("INVALID_INPUT", "scope debe ser project o shared.");
    if (scope === "shared" && input.projectId !== null) throw new MemoryError("INVALID_INPUT", "Un recuerdo shared no pertenece a un proyecto: projectId debe ser null.");
    if (scope === "ecosystem" && input.projectId !== null) throw new MemoryError("INVALID_INPUT", "Un recuerdo ecosystem pertenece a un grupo: projectId debe ser null.");
    const projectId = scope !== "project" ? null : projectIdentity(input.projectId);
    const groupId = scope === "ecosystem" ? groupIdentity((input as { groupId: unknown }).groupId) : null;
    const ownerColumn = scope === "ecosystem" ? "groupId" : "projectId";
    const ownerId = scope === "ecosystem" ? groupId : projectId;
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
    const secret = findSecret([title, content, topic ?? "", typeof input.short === "string" ? input.short : "",
      ...(Array.isArray(input.affects) ? input.affects.filter(name => typeof name === "string") : [])].join("\n"));
    if (secret !== null) throw new MemoryError("SECRET_REJECTED", `El recuerdo parece contener un secreto (${secret}); guárdalo sin el valor.`);
    const wantsMeta = input.short !== undefined || input.supersedes !== undefined || input.affects !== undefined;
    if (wantsMeta && !intelligenceEnabled(db)) throw new MemoryError("INTELLIGENCE_REQUIRED", "short, supersedes y affects requieren la memoria inteligente (forge614-engram intelligence-enable).");
    const short = input.short === undefined ? undefined : normalizeShort(input.short);
    const affects = input.affects === undefined ? undefined : normalizeAffects(input.affects);
    const supersedes = input.supersedes === undefined ? null : required(input.supersedes, "supersedes");
    let pinned = input.pinned ?? false;
    if (scope === "ecosystem" && intelligenceEnabled(db) && topic === ECOSYSTEM_STATUS_TOPIC) pinned = true;
    let hash = createHash("sha256").update(JSON.stringify([scope,ownerId,title,content,input.type,topic,pinned,expected])).digest("hex");
    if (options.mode !== undefined && options.mode !== "independent" && options.mode !== "assistant") throw new MemoryError("INVALID_INPUT","mode no válido.");
    const explicit = options.sessionId === undefined ? null : sessionIdentity(options.sessionId);
    const optionProject = options.projectId === undefined ? null : projectIdentity(options.projectId);
    const runtimeDirectory = options.runtimeDirectory === undefined ? null : required(options.runtimeDirectory,"runtimeDirectory");
      if (projectId !== null && !getProject(db, projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Crea el proyecto antes de guardar.");
      if (groupId !== null) {
        requireEcosystem(db);
        if (!getGroup(db, groupId)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      }
      if (request !== null) {
        const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
        if(replay) return replay;
      }
      let selected: string|null = null;
      let source: SessionSaveResult["sessionSource"] = null;
      if (explicit !== null) {
        requireSessions(db); validateSelectedSession(db, explicit,scope,projectId,optionProject,true);
        selected=explicit; source="explicit";
      } else if (sessionsEnabled(db) && scope === "project") {
        if ((options.mode ?? "independent") === "assistant") {
          const candidates = runtimeDirectory === null ? [] : inferredSessions(db, projectId!,runtimeDirectory,requestNow);
          if (candidates.length > 1) throw new MemoryError("AMBIGUOUS_SESSION",`AMBIGUOUS_SESSION: indica sessionId (${candidates.join(", ")}).`);
          if (candidates.length === 1) { selected=candidates[0]!; source="inferred"; }
        }
        if (selected === null) { selected=manualSession(db, projectId!,requestNow); source="manual"; }
      } else if (scope !== "project" && explicit === null) {
        selected=null; source=null;
      }
      if (!summary && topic !== null && sessionsEnabled(db)) {
        const reserved = db.query(`SELECT 1 FROM sessions s WHERE s.projectId IS ? AND ?=('session/'||s.sessionId||'/summary') LIMIT 1`)
          .get(projectId,topic);
        if (reserved) throw new MemoryError("SUMMARY_TOPIC_RESERVED","El tema está reservado para un resumen de sesión.");
      }
      const existing = topic === null
        ? (reinforcementEnabled(db) ? confirmationCandidate(db,{scope,projectId,groupId,title,content,type:input.type,topicKey:topic,pinned},requestNow) : null)
        : db.query(`SELECT * FROM memories WHERE scope=? AND ${ownerColumn} IS ? AND topic_key=?`).get(scope,ownerId,topic) as Row | null;
      if (existing?.state === "archived") throw new MemoryError("ARCHIVED", "Restaura el recuerdo antes de actualizar su tema.");
      if (topic!==null && (existing ? existing.version !== expected : expected !== null)) {
        throw new MemoryError("VERSION_CONFLICT", "La versión esperada no coincide. Lee el tema antes de actualizarlo.");
      }
      if (scope === "ecosystem" && intelligenceEnabled(db) && !summary) {
        const status = topic === ECOSYSTEM_STATUS_TOPIC;
        if (status) {
          const source = groupSource(db, groupId!);
          const from = (input as { fromProjectId?: string }).fromProjectId;
          if (!source || !from || source.projectId !== from || db.query("SELECT 1 FROM ecosystem_memberships WHERE groupId=? AND projectId=?").get(groupId, from) === null) {
            throw new MemoryError("ECOSYSTEM_STATUS_FORBIDDEN", "Solo el proyecto fuente del grupo puede guardar la nota de estado.");
          }
          if (!boardTypeAllowed(input.type, topic)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
          if (Array.from(content).length > ECOSYSTEM_STATUS_MAX) throw new MemoryError("ECOSYSTEM_STATUS_TOO_LONG", "La nota de estado no puede superar 600 caracteres.");
          pinned = true;
        } else {
          if (!boardTypeAllowed(input.type, topic)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
          const previous = existing ? readMeta(db, existing.id)?.affects : null;
          const effective = affects ?? previous;
          if (!effective || effective.length < ECOSYSTEM_AFFECTS_MIN) throw new MemoryError("ECOSYSTEM_AFFECTS_REQUIRED", "El tablero requiere al menos dos proyectos afectados.");
          const names = db.query("SELECT p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId WHERE m.groupId=?").all(groupId) as { name: string }[];
          const valid = new Set(names.map(row => row.name)); const unknown = effective.filter(name => !valid.has(name));
          if (unknown.length) throw new MemoryError("ECOSYSTEM_AFFECTS_UNKNOWN", `Proyectos desconocidos: ${unknown.join(", ")}. Válidos: ${names.map(row => row.name).sort().join(", ")}.`);
          if (!existing) {
            const board = db.query("SELECT title FROM memories WHERE scope='ecosystem' AND groupId=? AND state='active' AND (topic_key IS NULL OR (topic_key<>? AND topic_key NOT GLOB 'session/*/summary')) ORDER BY title,id").all(groupId, ECOSYSTEM_STATUS_TOPIC) as { title: string }[];
            if (board.length >= ECOSYSTEM_BOARD_LIMIT) throw new MemoryError("ECOSYSTEM_BOARD_FULL", `El tablero tiene ${board.length} recuerdos activos: ${board.map(row => row.title).join(" · ")}. Consolida o baja uno.`);
          }
        }
      }
      hash = createHash("sha256").update(JSON.stringify([scope,ownerId,title,content,input.type,topic,pinned,expected])).digest("hex");
      const now = requestNow;
      if (reinforcementEnabled(db) && existing) {
        const versionRow=db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(existing.id,existing.version) as {snapshot:string};
        const confirmed=JSON.parse(versionRow.snapshot) as MemoryVersion;
        if(sameConfirmationPayload(confirmed,{title,content,type:input.type,topicKey:topic,pinned})) {
          if(Date.parse(now)<Date.parse(confirmed.updatedAt)) {
            throw new MemoryError("CLOCK_SKEW","El reloj local es anterior a la versión confirmada; corrige la hora antes de registrar la confirmación.");
          }
          if(request!==null) {
            const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
            if(replay) return replay;
          }
          const confirmationId=crypto.randomUUID();
          const response:SessionSaveResult={memory:confirmed,sessionId:selected,sessionSource:source};
          db.query("INSERT INTO confirmations(confirmationId,memoryId,version,recordedAt,sessionId) VALUES(?,?,?,?,?)")
            .run(confirmationId,confirmed.id,confirmed.version,now,selected);
          if (selected !== null && source !== "manual") touchSession(db, selected, now);
          if(request!==null) db.query(`INSERT INTO confirmation_requests(memoryId,requestKey,payloadHash,expectedVersion,confirmationId,response)
            VALUES(?,?,?,?,?,?)`).run(confirmed.id,request,hash,expected,confirmationId,JSON.stringify(response));
          if (intelligenceEnabled(db) && wantsMeta) applySaveMeta(db, { id: confirmed.id, type: input.type, now, newVersion: false, contentChanged: false,
            short, affects, supersedes, scope, ownerColumn, ownerId });
          return response;
        }
      }
      const id = existing?.id ?? crypto.randomUUID();
      const version = (existing?.version ?? 0) + 1;
      const snapshot: MemoryVersion = { id, projectId, scope, topicKey: topic, type: input.type, title, content, pinned, version,
        createdAt: existing?.created_at ?? now, updatedAt: now, ...(groupId !== null ? { groupId } : {}) };
      if(request!==null) {
        const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
        if(replay) return replay;
      }
      if (existing) {
        db.query("UPDATE memories SET type=?,title=?,content=?,pinned=?,version=?,updated_at=? WHERE id=?").run(input.type,title,content,Number(pinned),version,now,id);
      } else if (groupId !== null) {
        db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at,groupId) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,?)")
          .run(id,projectId,scope,topic,input.type,title,content,Number(pinned),version,now,now,groupId);
      } else {
        db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)")
          .run(id,projectId,scope,topic,input.type,title,content,Number(pinned),version,now,now);
      }
      db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(id,version,JSON.stringify(snapshot));
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(id,version,now);
      if (request !== null) {
        if (groupId !== null) db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version,groupId) VALUES(?,?,?,?,?,?,?)").run(projectId,scope,request,hash,id,version,groupId);
        else db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?,?)").run(projectId,scope,request,hash,id,version);
      }
      if (selected !== null) db.query("INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)")
        .run(selected,id,version,now);
      if (selected !== null && source !== "manual") touchSession(db, selected, now);
      if (intelligenceEnabled(db)) applySaveMeta(db, { id, type: input.type, now, newVersion: true, contentChanged: existing?.content !== content,
        short, affects, supersedes, scope, ownerColumn, ownerId });
      // A brand-new memory without a topic reports up to three look-alikes so the caller can merge or supersede.
      const similar = intelligenceEnabled(db) && !existing && topic === null
        ? similarTo(db, { scope, ownerColumn, ownerId, title, content, excludeId: id }) : [];
      return {memory:snapshot,sessionId:selected,sessionSource:source,...(similar.length > 0 ? { similar } : {})};
  }

export function archive(db: Database, owner: MemoryOwner, id: string): Memory { return setState(db, owner,id,"archived"); }

export function restore(db: Database, owner: MemoryOwner, id: string): Memory { return setState(db, owner,id,"active"); }

function setState(db: Database, owner: MemoryOwner, id: string, state: Memory["state"]): Memory {
    return db.transaction(() => {
      const current = get(db, owner,id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el alcance seleccionado.");
      if (current.state === state) return current;
      db.query("UPDATE memories SET state=? WHERE id=?").run(state,current.id);
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,?,?,?)")
        .run(current.id,state === "active" ? "restore" : "archive",current.version,new Date().toISOString());
      return { ...current,state };
    }).immediate();
  }

/**
 * Explicit, recorded re-scoping into an ecosystem group. The memory keeps its id and every previous
 * version; a new version records the scope change. Nothing is copied, overwritten or deleted.
 */
export function moveMemoryToGroup(db: Database, from: string | null, id: string, groupId: string):
    { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null } } {
    const identity = groupIdentity(groupId);
    requireEcosystem(db);
    return db.transaction(() => {
      if (!getGroup(db, identity)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const current = get(db, from, id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el alcance seleccionado.");
      const reserved = sessionsEnabled(db) && db.query("SELECT 1 FROM session_summaries WHERE memoryId=?").get(current.id);
      if (reserved) throw new MemoryError("SUMMARY_TOPIC_RESERVED", "Un resumen de sesión pertenece a su proyecto y no puede moverse.");
      if (intelligenceEnabled(db)) {
        if (current.topicKey === ECOSYSTEM_STATUS_TOPIC) throw new MemoryError("ECOSYSTEM_STATUS_FORBIDDEN", "La nota de estado no puede moverse al tablero.");
        if (!boardTypeAllowed(current.type, current.topicKey)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
        const affects = readMeta(db, current.id)?.affects;
        if (!affects || affects.length < ECOSYSTEM_AFFECTS_MIN) throw new MemoryError("ECOSYSTEM_AFFECTS_REQUIRED", "El tablero requiere al menos dos proyectos afectados.");
        const names = db.query("SELECT p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId WHERE m.groupId=?").all(identity) as { name: string }[];
        const valid = new Set(names.map(row => row.name)); const unknown = affects.filter(name => !valid.has(name));
        if (unknown.length) throw new MemoryError("ECOSYSTEM_AFFECTS_UNKNOWN", `Proyectos desconocidos: ${unknown.join(", ")}. Válidos: ${names.map(row => row.name).sort().join(", ")}.`);
        const board = db.query("SELECT title FROM memories WHERE scope='ecosystem' AND groupId=? AND state='active' AND (topic_key IS NULL OR (topic_key<>? AND topic_key NOT GLOB 'session/*/summary')) ORDER BY title,id").all(identity, ECOSYSTEM_STATUS_TOPIC) as { title: string }[];
        if (board.length >= ECOSYSTEM_BOARD_LIMIT) throw new MemoryError("ECOSYSTEM_BOARD_FULL", `El tablero tiene ${board.length} recuerdos activos: ${board.map(row => row.title).join(" · ")}. Consolida o baja uno.`);
      }
      if (current.topicKey !== null && db.query("SELECT 1 FROM memories WHERE scope='ecosystem' AND groupId=? AND topic_key=?").get(identity, current.topicKey)) {
        throw new MemoryError("TOPIC_CONFLICT", "El grupo ya tiene un recuerdo con ese tema; no se sobrescribe. Archívalo o cambia el tema primero.");
      }
      const collision = db.query(`SELECT r.request_key FROM requests r WHERE r.memory_id=? AND EXISTS (
        SELECT 1 FROM requests x WHERE x.scope='ecosystem' AND x.groupId=? AND x.request_key=r.request_key) LIMIT 1`).get(current.id, identity);
      if (collision) throw new MemoryError("REQUEST_CONFLICT", "Una clave de petición del recuerdo ya existe en el grupo.");
      const now = new Date().toISOString(), version = current.version + 1;
      const snapshot: MemoryVersion = { id: current.id, projectId: null, scope: "ecosystem", topicKey: current.topicKey, type: current.type,
        title: current.title, content: current.content, pinned: current.pinned, version, createdAt: current.createdAt, updatedAt: now, groupId: identity };
      db.query("UPDATE memories SET scope='ecosystem',projectId=NULL,groupId=?,version=?,updated_at=? WHERE id=?").run(identity, version, now, current.id);
      db.query("UPDATE requests SET scope='ecosystem',projectId=NULL,groupId=? WHERE memory_id=?").run(identity, current.id);
      db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(current.id, version, JSON.stringify(snapshot));
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(current.id, version, now);
      recordIdentityEvent(db, { action: "MEMORY_MOVED", memoryId: current.id, projectId: null, previousProjectId: from, groupId: identity });
      return { memory: { ...snapshot, state: current.state }, from: { scope: from === null ? "shared" as const : "project" as const, projectId: from } };
    }).immediate();
  }
