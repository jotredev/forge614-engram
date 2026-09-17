import type { Database } from "bun:sqlite";
import { type Memory,type MemoryVersion,type SearchResult,type SearchScope } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import type { ContextRow,MemoryPreview,TimelineRow } from "../../modules/search";
import { searchTerms,validateSearchLimit,type ContextInput,type ContextResult,type PreviewResult,type TimelineInput,type TimelineResult,type VersionRead } from "../../modules/search";
import { MemoryError } from "../../shared/errors";
import { memory,owner,required,type Row } from "./memory";
import { sessionsEnabled } from "./sessions";

type Selection = { sql: string; args: string[] };
type PreviewRow = {
  id: string; projectId: string | null; scope: Memory["scope"]; topic_key: string | null;
  type: Memory["type"]; title: string; preview: string; truncated: number; pinned: number;
  version: number; created_at: string; updated_at: string;
};

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new MemoryError("INVALID_INPUT", `${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return value as number;
}
export function searchSelection(db: Database, projectId: string | null, scope: SearchScope): Selection {
  if (!["all", "project", "shared"].includes(scope)) throw new MemoryError("INVALID_INPUT", "Búsqueda: scope debe ser all, project o shared.");
  if (projectId !== null && !db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  if (scope === "shared") return { sql: "m.scope='shared'", args: [] };
  if (projectId === null) throw new MemoryError("INVALID_INPUT", "Sin projectId debes buscar explícitamente en scope shared.");
  if (scope === "project") return { sql: "m.scope='project' AND m.projectId=?", args: [projectId] };
  return { sql: `(m.projectId=? OR (m.scope='shared' AND NOT EXISTS (
    SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project'
    AND p.state='active' AND p.topic_key=m.topic_key)))`, args: [projectId, projectId] };
}
function preview(row: PreviewRow): MemoryPreview {
  return { id: row.id, projectId: row.projectId, scope: row.scope, topicKey: row.topic_key,
    type: row.type, title: row.title, preview: row.preview, truncated: row.truncated === 1,
    pinned: row.pinned === 1, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
const PREVIEW_COLUMNS = `m.id,m.projectId,m.scope,m.topic_key,m.type,m.title,
  substr(m.content,1,300) AS preview,length(m.content)>300 AS truncated,m.pinned,m.version,m.created_at,m.updated_at`;

// Both projections use identical visibility, scoring and tie breakers. Keep the
// preview projection bounded in SQL and the literal scan streaming.
function literalQuery(columns: string, selection: Selection): string {
  return `SELECT ${columns} FROM memories m WHERE ${selection.sql} AND m.state='active'
    ORDER BY m.pinned DESC,m.updated_at DESC,m.id ASC`;
}
function ftsQuery(columns: string, selection: Selection): string {
  return `SELECT ${columns},bm25(memories_fts,5.0,1.0,3.0) AS bm25,
    (1 + 0.10*m.pinned + 0.06/(1+MAX(0,julianday('now')-julianday(m.updated_at))/30)) AS multiplier
    FROM memories_fts JOIN memories m ON m.rowid=memories_fts.rowid
    WHERE memories_fts MATCH ? AND ${selection.sql} AND m.state='active'
    ORDER BY bm25 * multiplier ASC,m.id ASC LIMIT ?`;
}

function readSearchPreviews(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[] {
  const selection = searchSelection(db, projectId, scope); const parsed = searchTerms(query); validateSearchLimit(limit);
  if (parsed.literal) {
    const folded = parsed.terms.map(term => term.toLowerCase()); const result: PreviewResult[] = [];
    const statement = db.prepare(literalQuery(`${PREVIEW_COLUMNS},m.content`, selection));
    try {
      for (const row of statement.iterate(...selection.args) as Iterable<PreviewRow & {content:string}>) {
        const fields = [row.title, row.content, row.topic_key ?? ""].map(field => field.toLowerCase());
        if (!folded.every(term => fields.some(field => field.includes(term)))) continue;
        result.push({ memory: preview(row), explanation: { mode: "literal", bm25: null, multiplier: 1, orderScore: null } });
        if (result.length === limit) break;
      }
    } finally { statement.finalize(); }
    return result;
  }
  const rows = db.query(ftsQuery(PREVIEW_COLUMNS, selection)).all(parsed.match, ...selection.args, limit) as (PreviewRow & {bm25:number;multiplier:number})[];
  return rows.map(row => ({ memory: preview(row), explanation: { mode: "fts5", bm25: row.bm25,
    multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
}

function readGetVersion(db: Database, projectId: string | null, id: string, version?: number): VersionRead | null {
  const memoryId = required(id, "id");
  const current = db.query("SELECT version,state FROM memories WHERE projectId IS ? AND id=?").get(projectId, memoryId) as {version:number;state:Memory["state"]}|null;
  if (!current) return null;
  const selected = version === undefined ? current.version : integer(version, "version", 1, Number.MAX_SAFE_INTEGER);
  const row = db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(memoryId, selected) as {snapshot:string}|null;
  return row ? { memory: JSON.parse(row.snapshot) as MemoryVersion, currentVersion: current.version, state: current.state } : null;
}

type TimelineSqlRow = PreviewRow & {recordedAt:string};
function timelinePreview(row: TimelineSqlRow): TimelineRow {
  return { memory: preview(row), recordedAt: row.recordedAt };
}
function snapshotColumns(limit: 150 | 500): string {
  return `json_extract(v.snapshot,'$.id') AS id,json_extract(v.snapshot,'$.projectId') AS projectId,
    json_extract(v.snapshot,'$.scope') AS scope,json_extract(v.snapshot,'$.topicKey') AS topic_key,
    json_extract(v.snapshot,'$.type') AS type,json_extract(v.snapshot,'$.title') AS title,
    substr(json_extract(v.snapshot,'$.content'),1,${limit}) AS preview,
    length(json_extract(v.snapshot,'$.content'))>${limit} AS truncated,
    json_extract(v.snapshot,'$.pinned') AS pinned,json_extract(v.snapshot,'$.version') AS version,
    json_extract(v.snapshot,'$.createdAt') AS created_at,json_extract(v.snapshot,'$.updatedAt') AS updated_at,e.recordedAt`;
}
function readTimeline(db: Database, sessionsEnabled: boolean, projectId: string, input: TimelineInput): TimelineResult {
  if (!sessionsEnabled) throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero las sesiones.");
  const sessionId = required(input?.sessionId, "sessionId"), memoryId = required(input?.memoryId, "memoryId");
  const version = integer(input?.version, "version", 1, Number.MAX_SAFE_INTEGER);
  const before = integer(input.before ?? 5, "before", 0, 20), after = integer(input.after ?? 5, "after", 0, 20);
  return db.transaction(() => {
    const session = db.query("SELECT 1 FROM sessions WHERE sessionId=? AND projectId=?").get(sessionId, projectId);
    if (!session) throw new MemoryError("NO_SESSION_CONTEXT", "NO_SESSION_CONTEXT: no existe contexto de sesión para este proyecto.");
    const focus = db.query(`SELECT ${snapshotColumns(500)} FROM session_entries e
      JOIN memory_versions v ON v.memory_id=e.memoryId AND v.version=e.version
      JOIN memories m ON m.id=e.memoryId AND m.state='active'
      WHERE e.sessionId=? AND e.memoryId=? AND e.version=?`).get(sessionId, memoryId, version) as TimelineSqlRow|null;
    if (!focus) throw new MemoryError("NO_SESSION_CONTEXT", "NO_SESSION_CONTEXT: el recuerdo no pertenece a esta sesión o está archivado.");
    const key = [focus.recordedAt, memoryId, version];
    const prior = db.query(`SELECT ${snapshotColumns(150)} FROM session_entries e
      JOIN memory_versions v ON v.memory_id=e.memoryId AND v.version=e.version
      JOIN memories m ON m.id=e.memoryId AND m.state='active'
      WHERE e.sessionId=? AND (e.recordedAt,e.memoryId,e.version) < (?,?,?)
      ORDER BY e.recordedAt DESC,e.memoryId DESC,e.version DESC LIMIT ?`).all(sessionId, ...key, before) as TimelineSqlRow[];
    const later = db.query(`SELECT ${snapshotColumns(150)} FROM session_entries e
      JOIN memory_versions v ON v.memory_id=e.memoryId AND v.version=e.version
      JOIN memories m ON m.id=e.memoryId AND m.state='active'
      WHERE e.sessionId=? AND (e.recordedAt,e.memoryId,e.version) > (?,?,?)
      ORDER BY e.recordedAt,e.memoryId,e.version LIMIT ?`).all(sessionId, ...key, after) as TimelineSqlRow[];
    return { sessionId, focus: timelinePreview(focus), before: prior.reverse().map(timelinePreview), after: later.map(timelinePreview) };
  }).deferred();
}

function contextRow(row: PreviewRow, compact: boolean): ContextRow {
  const value = preview(row); if (!compact) return value;
  const { preview: _preview, ...rest } = value; return rest;
}
function contextSelection(projectId: string | null): Selection {
  return projectId === null ? {sql:"m.scope='shared'",args:[]} : { sql: `(m.projectId=? OR (m.scope='shared' AND NOT EXISTS (
    SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key)))`, args:[projectId,projectId] };
}
function excludeKeys(rows: ContextRow[], id = "m.id", version = "m.version"): {sql:string;args:(string|number)[]} {
  if (rows.length === 0) return {sql:"",args:[]};
  return { sql: ` AND NOT (${rows.map(() => `(${id}=? AND ${version}=?)`).join(" OR ")})`,
    args: rows.flatMap(row => [row.id,row.version]) };
}
function readContext(db: Database, sessionsEnabled: boolean, projectId: string | null, input: ContextInput = {}): ContextResult {
  if (input.compact !== undefined && typeof input.compact !== "boolean") throw new MemoryError("INVALID_INPUT", "compact debe ser booleano.");
  const maxBytes = integer(input.maxBytes ?? 16384, "maxBytes", 1024, 65536), compact = input.compact ?? false;
  if (projectId !== null && !db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  return db.transaction(() => {
    const selection = contextSelection(projectId);
    const pinnedAll = db.query(`SELECT ${PREVIEW_COLUMNS} FROM memories m WHERE ${selection.sql} AND m.state='active' AND m.pinned=1
      ORDER BY m.updated_at DESC,m.id ASC LIMIT 21`).all(...selection.args) as PreviewRow[];
    const pinnedCount = (db.query(`SELECT count(*) AS n FROM memories m WHERE ${selection.sql} AND m.state='active' AND m.pinned=1`).get(...selection.args) as {n:number}).n;
    const pinned = pinnedAll.slice(0,20).map(row=>contextRow(row,compact));
    const withoutPinned=excludeKeys(pinned);
    const recentAll = db.query(`SELECT ${PREVIEW_COLUMNS} FROM memories m WHERE ${selection.sql} AND m.state='active'${withoutPinned.sql}
      ORDER BY m.updated_at DESC,m.id ASC LIMIT 21`).all(...selection.args,...withoutPinned.args) as PreviewRow[];
    const recentCount = (db.query(`SELECT count(*) AS n FROM memories m WHERE ${selection.sql} AND m.state='active'${withoutPinned.sql}`).get(...selection.args,...withoutPinned.args) as {n:number}).n;
    const recent=recentAll.slice(0,20).map(row=>contextRow(row,compact));
    let summariesAll: PreviewRow[] = [], summariesCount = 0;
    if (projectId !== null && sessionsEnabled) {
      const withoutEarlier=excludeKeys([...pinned,...recent],"ss.memoryId","ss.version");
      summariesAll = db.query(`SELECT m.id,m.projectId,m.scope,m.topic_key,m.type,m.title,
        substr(json_extract(v.snapshot,'$.content'),1,300) AS preview,
        length(json_extract(v.snapshot,'$.content'))>300 AS truncated,
        json_extract(v.snapshot,'$.pinned') AS pinned,ss.version,
        json_extract(v.snapshot,'$.createdAt') AS created_at,json_extract(v.snapshot,'$.updatedAt') AS updated_at
        FROM session_summaries ss JOIN sessions s ON s.sessionId=ss.sessionId
        JOIN memory_versions v ON v.memory_id=ss.memoryId AND v.version=ss.version
        JOIN memories m ON m.id=ss.memoryId AND m.state='active'
        WHERE s.projectId=?${withoutEarlier.sql} ORDER BY s.startedAt DESC,s.sessionId ASC LIMIT 6`).all(projectId,...withoutEarlier.args) as PreviewRow[];
      summariesCount = (db.query(`SELECT count(*) AS n FROM session_summaries ss JOIN sessions s ON s.sessionId=ss.sessionId
        JOIN memories m ON m.id=ss.memoryId AND m.state='active' WHERE s.projectId=?${withoutEarlier.sql}`).get(projectId,...withoutEarlier.args) as {n:number}).n;
    }
    const summaries=summariesAll.slice(0,5).map(row=>contextRow(row,compact));
    const result: ContextResult = {format:1,pinned,recent,summaries,omitted:{pinned:Math.max(0,pinnedCount-pinned.length),recent:Math.max(0,recentCount-recent.length),summaries:Math.max(0,summariesCount-summaries.length)},truncated:false};
    const sections = ["summaries","recent","pinned"] as const;
    for (;;) {
      result.truncated = result.omitted.pinned + result.omitted.recent + result.omitted.summaries > 0;
      if (Buffer.byteLength(JSON.stringify(result),"utf8") <= maxBytes) return result;
      const section = sections.find(name => result[name].length > 0);
      if (!section) throw new MemoryError("INVALID_INPUT", "maxBytes no puede contener ni siquiera el resultado vacío.");
      result[section].pop(); result.omitted[section]++;
    }
  }).deferred();
}

export function search(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[] {
    const identity = projectId === null ? null : projectIdentity(projectId);
    const selection = searchSelection(db, identity, scope);
    const parsed = searchTerms(query); validateSearchLimit(limit);
    if (parsed.literal) {
      // SQLite LIKE folds ASCII only. Scan scoped rows with Unicode lowercase
      // for short terms; iterate so a large project is not loaded into RAM.
      const folded = parsed.terms.map(term => term.toLowerCase());
      const result: SearchResult[] = [];
      // A fresh statement must be finalized even when the iterator stops early.
      const statement = db.prepare(literalQuery("m.*", selection));
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
    const rows = db.query(ftsQuery("m.*", selection)).all(parsed.match,...selection.args,limit) as (Row & { bm25: number; multiplier: number })[];
    return rows.map(row => ({ memory: memory(row), explanation: { mode: "fts5", bm25: row.bm25,
      multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
  }

export function searchPreviews(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[] {
    return readSearchPreviews(db, projectId === null ? null : projectIdentity(projectId), query, limit, scope);
  }

export function getVersion(db: Database, projectId: string | null, id: string, version?: number): VersionRead | null {
    return readGetVersion(db, owner(projectId), id, version);
  }

export function timeline(db: Database, projectId: string, input: TimelineInput): TimelineResult {
    return readTimeline(db, sessionsEnabled(db), projectIdentity(projectId), input);
  }

export function context(db: Database, projectId: string | null, input?: ContextInput): ContextResult {
    return readContext(db, sessionsEnabled(db), projectId === null ? null : projectIdentity(projectId), input);
  }
