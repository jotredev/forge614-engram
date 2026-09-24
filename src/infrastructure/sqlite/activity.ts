import type { Database } from "bun:sqlite";
import type { MemoryVersion } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { INACTIVITY_HOURS, type PreviousSession } from "../../modules/sessions";
import { intelligenceEnabled } from "./intelligence";

/** Records session activity and clears any interruption mark; a no-op before intelligence is enabled. */
export function touchSession(db: Database, sessionId: string, at: string): void {
  if (!intelligenceEnabled(db)) return;
  db.query(`INSERT INTO session_activity(sessionId,lastActivityAt,interruptedAt) VALUES(?,?,NULL)
    ON CONFLICT(sessionId) DO UPDATE SET lastActivityAt=excluded.lastActivityAt,interruptedAt=NULL`)
    .run(sessionId, at);
}

/** Marks every other open runtime session of the project as interrupted at `at`, keeping any earlier mark. */
export function interruptOtherSessions(db: Database, projectId: string, sessionId: string, at: string): void {
  if (!intelligenceEnabled(db)) return;
  db.query(`INSERT INTO session_activity(sessionId,lastActivityAt,interruptedAt)
    SELECT s.sessionId,
      coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt),
      ?
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL AND s.sessionId<>?
    ON CONFLICT(sessionId) DO UPDATE SET interruptedAt=excluded.interruptedAt WHERE interruptedAt IS NULL`)
    .run(at, projectId, sessionId);
}

/** now minus INACTIVITY_HOURS, ISO. */
export function inactivityThreshold(now: string): string {
  return new Date(Date.parse(now) - INACTIVITY_HOURS * 60 * 60 * 1000).toISOString();
}

/** The project's most recently active marked-or-idle open runtime session, or null; null below level 11. */
export function previousInterrupted(db: Database, projectId: string, now: string = new Date().toISOString()): PreviousSession | null {
  const project = projectIdentity(projectId);
  if (!intelligenceEnabled(db)) return null;
  const threshold = inactivityThreshold(now);
  const row = db.query(`SELECT s.sessionId AS sessionId,
      coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt) AS lastActivity,
      sa.interruptedAt AS interruptedAt
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
      AND (sa.interruptedAt IS NOT NULL OR
        coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt) < ?)
    ORDER BY lastActivity DESC,s.sessionId ASC LIMIT 1`).get(project, threshold) as
    { sessionId: string; lastActivity: string; interruptedAt: string | null } | null;
  if (!row) return null;
  const interruptedAt = row.interruptedAt ?? new Date(Date.parse(row.lastActivity) + INACTIVITY_HOURS * 60 * 60 * 1000).toISOString();
  const pointer = db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(row.sessionId) as
    { memoryId: string; version: number } | null;
  const summary = pointer === null ? null : (JSON.parse((db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?")
    .get(pointer.memoryId, pointer.version) as { snapshot: string }).snapshot) as MemoryVersion);
  return { sessionId: row.sessionId, interruptedAt, summary };
}
