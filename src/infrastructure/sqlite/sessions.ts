import type { Database } from "bun:sqlite";
import { type Memory } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { sessionIdentity,type Session } from "../../modules/sessions";
import { MemoryError } from "../../shared/errors";
import { inactivityThreshold,touchSession } from "./activity";
import { intelligenceEnabled } from "./intelligence";
import { schemaFeatures } from "./schema";

export function sessionRow(db: Database, sessionId: string): Session | null {
  return db.query("SELECT sessionId,projectId,kind,startedAt,endedAt FROM sessions WHERE sessionId=?")
    .get(sessionId) as Session | null;
}

// These helpers deliberately do not open or commit transactions. Their caller owns
// the transaction so project creation, local binding, and lifecycle changes compose.
export function startRuntimeSession(db: Database, projectId: string, sessionId: string, runtimeDirectory?: string): Session {
  const at = new Date().toISOString();
  const existing = sessionRow(db, sessionId);
  if (existing) {
    if (existing.projectId !== projectId || existing.kind !== "runtime" || existing.endedAt !== null) {
      throw new MemoryError("SESSION_CONFLICT", "El identificador de sesión no está disponible.");
    }
  } else {
    const project = db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId);
    if (!project) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'runtime',?,NULL)")
      .run(sessionId, projectId, at);
  }
  if (runtimeDirectory !== undefined) {
    db.query("INSERT OR IGNORE INTO local_session_bindings(sessionId,directory) VALUES(?,?)")
      .run(sessionId, runtimeDirectory);
  }
  // Opening a session marks nobody: other open runtime sessions of the project keep their own
  // activity untouched (1.7.1). Whether one of them counts as left open is decided later, by
  // elapsed time, in previousInterrupted/parallelSessions.
  touchSession(db, sessionId, at);
  return sessionRow(db, sessionId)!;
}

export function endRuntimeSession(db: Database, projectId: string, sessionId: string): Session {
  const existing = sessionRow(db, sessionId);
  if (!existing || existing.projectId !== projectId) {
    throw new MemoryError("SESSION_NOT_FOUND", "Sesión no encontrada para este proyecto.");
  }
  if (existing.kind !== "runtime") throw new MemoryError("SESSION_KIND", "Una sesión manual no puede cerrarse.");
  if (existing.endedAt === null) {
    const at = new Date().toISOString();
    db.query("UPDATE sessions SET endedAt=? WHERE sessionId=? AND endedAt IS NULL")
      .run(at, sessionId);
    touchSession(db, sessionId, at);
  }
  return sessionRow(db, sessionId)!;
}

export function sessionsEnabled(db: Database): boolean {
    return (schemaFeatures(db)?.base ?? 0)>=6;
  }

export function requireSessions(db: Database): void {
    if (!sessionsEnabled(db)) throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero las sesiones.");
  }

export function getSession(db: Database, projectId: string, sessionId: string): Session | null {
    requireSessions(db);
    const project = projectIdentity(projectId); const row = sessionRow(db,sessionIdentity(sessionId));
    return row?.projectId === project ? row : null;
  }

export function validateSelectedSession(db: Database, sessionId: string, scope: Memory["scope"], projectId: string|null, optionProject: string|null, requireOpen: boolean): Session {
    const row = sessionRow(db,sessionId);
    if (!row) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada.");
    const expectedOwner = scope === "project" ? projectId : optionProject;
    if (scope !== "project" && optionProject === null) throw new MemoryError("INVALID_INPUT","projectId es obligatorio para asociar shared.");
    if (row.projectId !== expectedOwner) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada para este proyecto.");
    if (row.kind !== "runtime") throw new MemoryError("SESSION_KIND","Una sesión manual no admite asociación explícita.");
    if (requireOpen && row.endedAt !== null) throw new MemoryError("SESSION_CLOSED","La sesión está cerrada.");
    return row;
  }

export function inferredSessions(db: Database, projectId: string, directory: string, requestNow: string): string[] {
    // At level 11 a stale session, or one still carrying a mark left by 1.7.0, must never be silently inferred: the six-hour
    // activity window (session_activity) replaces the plain seven-day window used below that level.
    if (intelligenceEnabled(db)) {
      const threshold = inactivityThreshold(requestNow);
      return (db.query(`SELECT s.sessionId FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
        WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
        AND EXISTS (SELECT 1 FROM local_session_bindings b WHERE b.sessionId=s.sessionId AND b.directory=?)
        AND sa.interruptedAt IS NULL
        AND coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt) >= ?
        ORDER BY s.sessionId`).all(projectId,directory,threshold) as {sessionId:string}[]).map(row=>row.sessionId);
    }
    const threshold = new Date(Date.parse(requestNow)-7*24*60*60*1000).toISOString();
    return (db.query(`SELECT s.sessionId FROM sessions s
      WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
      AND EXISTS (SELECT 1 FROM local_session_bindings b WHERE b.sessionId=s.sessionId AND b.directory=?)
      AND max(s.startedAt,coalesce((SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)) >= ?
      ORDER BY s.sessionId`).all(projectId,directory,threshold) as {sessionId:string}[]).map(row=>row.sessionId);
  }

export function manualSession(db: Database, projectId: string, now: string): string {
    const existing = db.query("SELECT sessionId FROM local_manual_sessions WHERE projectId=?").get(projectId) as {sessionId:string}|null;
    if (existing) return existing.sessionId;
    const id = crypto.randomUUID();
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'manual',?,NULL)").run(id,projectId,now);
    db.query("INSERT INTO local_manual_sessions(projectId,sessionId) VALUES(?,?)").run(projectId,id);
    return id;
  }
