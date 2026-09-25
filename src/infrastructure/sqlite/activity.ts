import type { Database } from "bun:sqlite";
import type { MemoryVersion } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { INACTIVITY_HOURS,PARALLEL_MINUTES,type ParallelSession,type PreviousSession } from "../../modules/sessions";
import { intelligenceEnabled } from "./intelligence";

/** Records session activity and clears any interruption mark; a no-op before intelligence is enabled. */
export function touchSession(db: Database, sessionId: string, at: string): void {
  if (!intelligenceEnabled(db)) return;
  db.query(`INSERT INTO session_activity(sessionId,lastActivityAt,interruptedAt) VALUES(?,?,NULL)
    ON CONFLICT(sessionId) DO UPDATE SET lastActivityAt=excluded.lastActivityAt,interruptedAt=NULL`)
    .run(sessionId, at);
}

// A session's last activity: explicit activity recorded by touchSession, else its most recently
// recorded entry, else when it started. Shared by every query below that classifies open sessions.
const LAST_ACTIVITY = "coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)";

/** now minus INACTIVITY_HOURS, ISO. Used only by session inference (inferredSessions). */
export function inactivityThreshold(now: string): string {
  return new Date(Date.parse(now) - INACTIVITY_HOURS * 60 * 60 * 1000).toISOString();
}

/** now minus PARALLEL_MINUTES, ISO: an open runtime session whose last activity is at or after this instant
 * counts as open in parallel; strictly before it, the session counts as left open (1.7.1, level 11). */
export function parallelThreshold(now: string): string {
  return new Date(Date.parse(now) - PARALLEL_MINUTES * 60 * 1000).toISOString();
}

/**
 * The project's most recently active open runtime session left open (its last activity strictly before
 * parallelThreshold(now)), or null; null below level 11. Classification is by elapsed time alone: any
 * interruptedAt mark left by 1.7.0's start-time interruption is ignored entirely (1.7.1).
 */
export function previousInterrupted(db: Database, projectId: string, now: string = new Date().toISOString()): PreviousSession | null {
  const project = projectIdentity(projectId);
  if (!intelligenceEnabled(db)) return null;
  const threshold = parallelThreshold(now);
  const row = db.query(`SELECT s.sessionId AS sessionId,${LAST_ACTIVITY} AS lastActivity
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL AND ${LAST_ACTIVITY} < ?
    ORDER BY lastActivity DESC,s.sessionId ASC LIMIT 1`).get(project, threshold) as
    { sessionId: string; lastActivity: string } | null;
  if (!row) return null;
  const pointer = db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(row.sessionId) as
    { memoryId: string; version: number } | null;
  const summary = pointer === null ? null : (JSON.parse((db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?")
    .get(pointer.memoryId, pointer.version) as { snapshot: string }).snapshot) as MemoryVersion);
  return { sessionId: row.sessionId, interruptedAt: row.lastActivity, summary };
}

// At most this many parallel sessions are ever reported.
const PARALLEL_LIMIT = 3;

/**
 * Up to PARALLEL_LIMIT of the project's other open runtime sessions currently open in parallel with
 * `sessionId` (their last activity at or after parallelThreshold(now)), newest activity first, ties by
 * sessionId ascending; [] below level 11 (1.7.1).
 */
export function parallelSessions(db: Database, projectId: string, sessionId: string, now: string = new Date().toISOString()): ParallelSession[] {
  const project = projectIdentity(projectId);
  if (!intelligenceEnabled(db)) return [];
  const threshold = parallelThreshold(now);
  return db.query(`SELECT s.sessionId AS sessionId,${LAST_ACTIVITY} AS lastActivityAt
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL AND s.sessionId<>? AND ${LAST_ACTIVITY} >= ?
    ORDER BY lastActivityAt DESC,s.sessionId ASC LIMIT ${PARALLEL_LIMIT}`)
    .all(project, sessionId, threshold) as ParallelSession[];
}
