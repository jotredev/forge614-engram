import type { Database } from "../infrastructure/sqlite/connection";
import type { ChangeRow } from "../infrastructure/postgres/replica";
import { travelingTableColumns } from "../infrastructure/sqlite/schema";
import { findSecret } from "../modules/memory";

export interface ApplyResult { readonly applied: number; readonly skipped: number; readonly conflicts: number; readonly lastAppliedId: number }

type Row = Record<string, unknown>;
type Outcome = "applied" | "skipped" | "conflict" | "own";

// Natural key per traveling table (D6-D9): the column(s) that identify a row across installations.
const NATURAL_KEY: Record<string, readonly string[]> = {
  projects: ["projectId"],
  ecosystem_groups: ["id"],
  ecosystem_memberships: ["projectId"],
  ecosystem_sources: ["groupId"],
  memories: ["id"],
  memory_versions: ["memory_id", "version"],
  memory_meta: ["memory_id"],
  sessions: ["sessionId"],
  session_entries: ["memoryId", "version"],
  session_summaries: ["sessionId"],
  confirmations: ["confirmationId"],
  confirmation_requests: ["memoryId", "requestKey"],
};
// Tables where the freshest row wins by this date column (tie broken by canonical JSON, D6).
const DATED_COLUMN: Record<string, string> = {
  projects: "updatedAt",
  ecosystem_memberships: "boundAt",
  ecosystem_sources: "setAt",
  memory_meta: "updated_at",
  session_entries: "recordedAt",
  confirmations: "recordedAt",
};
// Tables where the incoming row column points at a memory_versions row and must be
// translated through cloud_version_map before it is written locally (D9).
const VERSION_COLUMN: Record<string, string> = {
  memories: "version",
  session_entries: "version",
  session_summaries: "version",
  confirmations: "version",
};
const MEMORY_ID_COLUMN: Record<string, string> = {
  memories: "id",
  session_entries: "memoryId",
  session_summaries: "memoryId",
  confirmations: "memoryId",
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Row).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Row)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** true when `a` (dated `aDate`) should win over `b` (dated `bDate`): later date, ties by canonical JSON. */
function laterWins(aDate: string, aCanon: string, bDate: string, bCanon: string): boolean {
  if (aDate !== bDate) return aDate > bDate;
  return aCanon > bCanon;
}

function validPayload(payload: unknown, columns: readonly string[]): payload is Row {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload as Row);
  if (keys.length !== columns.length) return false;
  const set = new Set(columns);
  return keys.every(key => set.has(key));
}

function naturalKeyOf(kind: string, payload: Row): string {
  return (NATURAL_KEY[kind] ?? []).map(column => String(payload[column])).join("|");
}

function notice(db: Database, code: string, payload: unknown): void {
  db.query("INSERT INTO cloud_notices(code,payload) VALUES(?,?)").run(code, JSON.stringify(payload));
}

/** Field named for a secret rejection: the natural key of the offending row, per D5. */
function secretPatternOf(kind: string, payload: Row): string | null {
  const check = (text: unknown): string | null => (typeof text === "string" ? findSecret(text) : null);
  if (kind === "memories") return check(payload.title) ?? check(payload.content) ?? check(payload.topic_key);
  if (kind === "projects") return check(payload.name);
  if (kind === "memory_meta") {
    const short = check(payload.short);
    if (short) return short;
    if (typeof payload.affects === "string") {
      try {
        const list = JSON.parse(payload.affects);
        if (Array.isArray(list)) for (const entry of list) { const hit = check(entry); if (hit) return hit; }
      } catch { /* not JSON: affects is validated elsewhere, nothing to scan here */ }
    }
    return null;
  }
  if (kind === "memory_versions") {
    try {
      const snapshot = JSON.parse(String(payload.snapshot));
      return check(snapshot.title) ?? check(snapshot.content) ?? check(snapshot.topicKey);
    } catch { return null; }
  }
  return null;
}

function mappedVersion(db: Database, memoryId: string, installationId: string, remoteVersion: number): number {
  const row = db.query("SELECT local_version FROM cloud_version_map WHERE memory_id=? AND installation_id=? AND remote_version=?")
    .get(memoryId, installationId, remoteVersion) as { local_version: number } | null;
  return row ? row.local_version : remoteVersion;
}

function insertRow(db: Database, table: string, columns: readonly string[], payload: Row): void {
  const placeholders = columns.map(() => "?").join(",");
  db.query(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`).run(...columns.map(column => payload[column] as never));
}

function updateRow(db: Database, table: string, columns: readonly string[], keyColumns: readonly string[], payload: Row): void {
  const setColumns = columns.filter(column => !keyColumns.includes(column));
  if (setColumns.length === 0) return;
  const set = setColumns.map(column => `${column}=?`).join(",");
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  db.query(`UPDATE ${table} SET ${set} WHERE ${where}`)
    .run(...setColumns.map(column => payload[column] as never), ...keyColumns.map(column => payload[column] as never));
}

function existingRow(db: Database, table: string, keyColumns: readonly string[], payload: Row): Row | null {
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  return db.query(`SELECT * FROM ${table} WHERE ${where}`).get(...keyColumns.map(column => payload[column] as never)) as Row | null;
}

/** Generic upsert for tables whose freshest row wins by a date column (D6). */
function upsertDated(db: Database, kind: string, columns: readonly string[], payload: Row): void {
  const keyColumns = NATURAL_KEY[kind]!, dateColumn = DATED_COLUMN[kind]!;
  const current = existingRow(db, kind, keyColumns, payload);
  if (!current) { insertRow(db, kind, columns, payload); return; }
  const localCanon = canonicalJson(pick(current, columns)), remoteCanon = canonicalJson(payload);
  if (laterWins(String(payload[dateColumn]), remoteCanon, String(current[dateColumn]), localCanon)) {
    updateRow(db, kind, columns, keyColumns, payload);
  }
}

/** Generic upsert for tables with no date column: the incoming row always overwrites (D6). */
function upsertOverwrite(db: Database, kind: string, columns: readonly string[], payload: Row): void {
  const keyColumns = NATURAL_KEY[kind]!;
  const current = existingRow(db, kind, keyColumns, payload);
  if (!current) insertRow(db, kind, columns, payload); else updateRow(db, kind, columns, keyColumns, payload);
}

function pick(row: Row, columns: readonly string[]): Row {
  const out: Row = {};
  for (const column of columns) out[column] = row[column];
  return out;
}

function applySessions(db: Database, columns: readonly string[], payload: Row): void {
  const current = existingRow(db, "sessions", ["sessionId"], payload);
  const merged: Row = { ...payload };
  if (current && current.endedAt !== null && payload.endedAt === null) merged.endedAt = current.endedAt;
  if (!current) insertRow(db, "sessions", columns, merged); else updateRow(db, "sessions", columns, ["sessionId"], merged);
}

/** D9: translate an incoming memory_versions row through cloud_version_map, inserting/reassigning as needed. */
function applyMemoryVersion(db: Database, row: ChangeRow, payload: Row): Outcome {
  const memoryId = String(payload.memory_id), remoteVersion = Number(payload.version);
  const known = db.query("SELECT local_version FROM cloud_version_map WHERE memory_id=? AND installation_id=? AND remote_version=?")
    .get(memoryId, row.installationId, remoteVersion) as { local_version: number } | null;
  if (known) return "applied";
  const local = db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(memoryId, remoteVersion) as { snapshot: string } | null;
  const recordEquivalence = (localVersion: number) =>
    db.query("INSERT INTO cloud_version_map(memory_id,installation_id,remote_version,local_version) VALUES(?,?,?,?)")
      .run(memoryId, row.installationId, remoteVersion, localVersion);
  if (!local) {
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(memoryId, remoteVersion, String(payload.snapshot));
    recordEquivalence(remoteVersion);
    return "applied";
  }
  const withoutVersion = (snapshot: string): string => { const parsed = JSON.parse(snapshot); delete parsed.version; return canonicalJson(parsed); };
  if (withoutVersion(local.snapshot) === withoutVersion(String(payload.snapshot))) {
    recordEquivalence(remoteVersion);
    return "applied";
  }
  const max = db.query("SELECT MAX(version) AS v FROM memory_versions WHERE memory_id=?").get(memoryId) as { v: number };
  const localVersion = max.v + 1;
  const snapshot = JSON.parse(String(payload.snapshot));
  snapshot.version = localVersion;
  db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(memoryId, localVersion, JSON.stringify(snapshot));
  recordEquivalence(localVersion);
  // The memories row for this save may have already landed (D9: memories is queued before its
  // version by saveCore) pointing at the raw remote version; correct it only when that row is the
  // incoming one (it won by date), never when the local version stayed active.
  db.query("UPDATE memories SET version=? WHERE id=? AND version=? AND title=? AND content=? AND updated_at=?")
    .run(localVersion, memoryId, remoteVersion, String(snapshot.title), String(snapshot.content), String(snapshot.updatedAt));
  notice(db, "CLOUD_CONFLICT", { memoryId, remoteVersion, localVersion });
  return "conflict";
}

/**
 * D8: before writing `candidate`'s topic_key, resolve a collision with whichever other memory id
 * already holds it (the topic_key unique index is immediate, so the loser must be cleared first).
 * Returns the topic_key `candidate` may actually be written with (possibly nulled).
 */
function resolveTopicConflict(db: Database, candidate: Row, scope: string, ownerColumn: string, ownerId: string | null): string | null {
  const topicKey = candidate.topic_key as string | null;
  if (topicKey === null) return null;
  const other = db.query(`SELECT * FROM memories WHERE scope=? AND ${ownerColumn} IS ? AND topic_key=? AND id<>?`)
    .get(scope, ownerId, topicKey, candidate.id as string) as Row | null;
  if (!other) return topicKey;
  const candidateWins = laterWins(String(candidate.updated_at), canonicalJson(candidate), String(other.updated_at), canonicalJson(other));
  if (candidateWins) {
    db.query("UPDATE memories SET topic_key=NULL WHERE id=?").run(other.id as string);
    notice(db, "CLOUD_TOPIC_CONFLICT", { keptMemoryId: candidate.id, clearedMemoryId: other.id });
    return topicKey;
  }
  notice(db, "CLOUD_TOPIC_CONFLICT", { keptMemoryId: other.id, clearedMemoryId: candidate.id });
  return null;
}

function applyMemories(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const id = String(payload.id);
  const version = mappedVersion(db, id, row.installationId, Number(payload.version));
  const remote: Row = { ...payload, version };
  const scope = String(payload.scope);
  const ownerColumn = scope === "ecosystem" ? "groupId" : "projectId";
  const ownerId = (remote[ownerColumn] as string | null) ?? null;
  const current = existingRow(db, "memories", ["id"], remote);
  if (!current) {
    remote.topic_key = resolveTopicConflict(db, remote, scope, ownerColumn, ownerId);
    insertRow(db, "memories", columns, remote);
    return "applied";
  }
  const localCanon = canonicalJson(pick(current, columns)), remoteCanon = canonicalJson(remote);
  if (laterWins(String(remote.updated_at), remoteCanon, String(current.updated_at), localCanon)) {
    remote.topic_key = resolveTopicConflict(db, remote, scope, ownerColumn, ownerId);
    updateRow(db, "memories", columns, ["id"], remote);
  }
  return "applied";
}

function applyUpsert(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const kind = row.kind;
  if (kind === "memories") return applyMemories(db, row, columns, payload);
  if (kind === "memory_versions") return applyMemoryVersion(db, row, payload);
  const remapped: Row = VERSION_COLUMN[kind]
    ? { ...payload, [VERSION_COLUMN[kind]!]: mappedVersion(db, String(payload[MEMORY_ID_COLUMN[kind]!]), row.installationId, Number(payload[VERSION_COLUMN[kind]!])) }
    : payload;
  if (kind === "sessions") { applySessions(db, columns, remapped); return "applied"; }
  if (DATED_COLUMN[kind]) { upsertDated(db, kind, columns, remapped); return "applied"; }
  upsertOverwrite(db, kind, columns, remapped);
  return "applied";
}

function applyDelete(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const kind = row.kind;
  const remapped: Row = VERSION_COLUMN[kind] && kind !== "memories"
    ? { ...payload, [VERSION_COLUMN[kind]!]: mappedVersion(db, String(payload[MEMORY_ID_COLUMN[kind]!]), row.installationId, Number(payload[VERSION_COLUMN[kind]!])) }
    : payload;
  const keyColumns = kind === "memory_versions" ? ["memory_id", "version"] : NATURAL_KEY[kind]!;
  const keyPayload = kind === "memory_versions"
    ? { memory_id: payload.memory_id, version: mappedVersion(db, String(payload.memory_id), row.installationId, Number(payload.version)) }
    : remapped;
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  db.query(`DELETE FROM ${kind} WHERE ${where}`).run(...keyColumns.map(column => keyPayload[column] as never));
  return "applied";
}

function applyRow(db: Database, row: ChangeRow, installationId: string, columnsByKind: ReadonlyMap<string, readonly string[]>): Outcome {
  const columns = columnsByKind.get(row.kind);
  if (row.installationId === installationId) return "own";
  if (!columns) { notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason: "UNKNOWN_KIND" }); return "skipped"; }
  if (!validPayload(row.payload, columns)) { notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason: "INVALID_PAYLOAD" }); return "skipped"; }
  const payload = row.payload;
  const pattern = secretPatternOf(row.kind, payload);
  if (pattern) { notice(db, "SECRET_REJECTED", { id: row.id, kind: row.kind, key: naturalKeyOf(row.kind, payload), pattern }); return "skipped"; }
  if (row.op === "delete") return applyDelete(db, row, columns, payload);
  return applyUpsert(db, row, columns, payload);
}

/**
 * Applies rows pulled from Neon inside one transaction (D2): the apply guard is raised before the
 * first row and lowered in a `finally` inside that same transaction, so an uncaught error rolls the
 * whole thing back — guard included — and local triggers resume queuing on the next save (Review
 * Focus #1). Each row runs in its own SAVEPOINT (D2); a row that fails validation, a secret check or
 * a foreign key is skipped with a `CLOUD_ROW_SKIPPED` notice and the rest of the batch still applies
 * (Review Focus #2). Rows from this installation only advance `last_applied_id`.
 */
export function applyCloudChanges(db: Database, rows: readonly ChangeRow[], installationId: string): ApplyResult {
  const columnsByKind = travelingTableColumns();
  let applied = 0, skipped = 0, conflicts = 0;
  let lastAppliedId = (db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id;
  db.transaction(() => {
    db.query("UPDATE cloud_state SET apply_guard=1 WHERE id=1").run();
    try {
      for (const row of rows) {
        db.exec("SAVEPOINT cloud_apply_row");
        try {
          const outcome = applyRow(db, row, installationId, columnsByKind);
          if (outcome === "applied") applied++;
          else if (outcome === "conflict") { applied++; conflicts++; }
          else if (outcome === "skipped") skipped++;
          db.exec("RELEASE cloud_apply_row");
        } catch (error) {
          db.exec("ROLLBACK TO cloud_apply_row");
          db.exec("RELEASE cloud_apply_row");
          const message = error instanceof Error ? error.message : String(error);
          const reason = message.includes("FOREIGN KEY") ? "FOREIGN_KEY" : "APPLY_ERROR";
          notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason });
          skipped++;
        }
        lastAppliedId = row.id;
        db.query("UPDATE cloud_state SET last_applied_id=? WHERE id=1").run(lastAppliedId);
      }
    } finally {
      db.query("UPDATE cloud_state SET apply_guard=0 WHERE id=1").run();
    }
  }).immediate();
  return { applied, skipped, conflicts, lastAppliedId };
}
