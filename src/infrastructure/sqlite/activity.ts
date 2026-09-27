/**
 * Sigue la actividad (uso reciente) de las sesiones de ejecución (runtime) para saber cuándo una sesión
 * anterior se quedó abierta sin cerrarse y cuáles otras siguen abiertas al mismo tiempo (en paralelo).
 * Lo usan el aviso de sesión al arrancar y la inferencia de sesiones activas (sessions.ts).
 */
import type { Database } from "bun:sqlite";
import type { MemoryVersion } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { INACTIVITY_HOURS,PARALLEL_MINUTES,type ParallelSession,type PreviousSession } from "../../modules/sessions";
import { intelligenceEnabled } from "./intelligence";

/**
 * Registra la actividad de una sesión (guarda la hora de su último uso) y borra cualquier marca de
 * interrupción anterior; no hace nada si el nivel de inteligencia (intelligence, el conjunto de funciones
 * que infieren sesiones y resúmenes) todavía no está habilitado.
 * @param db conexión abierta a la base SQLite.
 * @param sessionId identificador de la sesión cuya actividad se registra.
 * @param at instante (ISO) que se guarda como última actividad.
 * @returns nada; solo actualiza la fila de actividad de la sesión.
 */
export function touchSession(db: Database, sessionId: string, at: string): void {
  if (!intelligenceEnabled(db)) return;
  db.query(`INSERT INTO session_activity(sessionId,lastActivityAt,interruptedAt) VALUES(?,?,NULL)
    ON CONFLICT(sessionId) DO UPDATE SET lastActivityAt=excluded.lastActivityAt,interruptedAt=NULL`)
    .run(sessionId, at);
}

// La última actividad de una sesión: la actividad explícita que registró touchSession; si no hay,
// su entrada guardada más reciente; si tampoco, el momento en que empezó. La usan todas las consultas
// de abajo que clasifican sesiones abiertas.
const LAST_ACTIVITY = "coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)";

/**
 * Calcula el instante (ISO) que queda INACTIVITY_HOURS horas antes de `now`. Solo lo usa la inferencia
 * de sesiones (inferredSessions) para decidir si una sesión sin actividad reciente ya cuenta como cerrada.
 * @param now instante de referencia (ISO).
 * @returns el instante ISO resultante de restarle INACTIVITY_HOURS horas a `now`.
 */
export function inactivityThreshold(now: string): string {
  return new Date(Date.parse(now) - INACTIVITY_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Calcula el instante (ISO) que queda PARALLEL_MINUTES minutos antes de `now`. Una sesión de ejecución
 * abierta cuya última actividad sea igual o posterior a este instante cuenta como abierta en paralelo;
 * si es estrictamente anterior, la sesión cuenta como dejada abierta (1.7.1, nivel de esquema 11).
 * @param now instante de referencia (ISO).
 * @returns el instante ISO resultante de restarle PARALLEL_MINUTES minutos a `now`.
 */
export function parallelThreshold(now: string): string {
  return new Date(Date.parse(now) - PARALLEL_MINUTES * 60 * 1000).toISOString();
}

/**
 * Devuelve la sesión de ejecución abierta más recientemente activa del proyecto que quedó abierta (su
 * última actividad es estrictamente anterior a parallelThreshold(now)), o null si ninguna califica; null
 * también por debajo del nivel de esquema 11. La clasificación se basa solo en el tiempo transcurrido:
 * cualquier marca `interruptedAt` que dejara la interrupción al iniciar sesión de la versión 1.7.0 se
 * ignora por completo (1.7.1).
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto.
 * @param now instante de referencia (ISO); por defecto, el momento actual.
 * @returns la sesión dejada abierta con su resumen (summary), o null si ninguna califica.
 */
export function previousInterrupted(db: Database, projectId: string, now: string = new Date().toISOString()): PreviousSession | null {
  const project = projectIdentity(projectId);
  if (!intelligenceEnabled(db)) return null;
  const threshold = parallelThreshold(now);
  // Busca la sesión de ejecución abierta con última actividad más antigua que el umbral, la de
  // actividad más reciente entre las que califican (y en empate, la de menor sessionId).
  const row = db.query(`SELECT s.sessionId AS sessionId,${LAST_ACTIVITY} AS lastActivity
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL AND ${LAST_ACTIVITY} < ?
    ORDER BY lastActivity DESC,s.sessionId ASC LIMIT 1`).get(project, threshold) as
    { sessionId: string; lastActivity: string } | null;
  if (!row) return null;
  // Si esa sesión guardó un resumen, busca el puntero a su versión guardada.
  const pointer = db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(row.sessionId) as
    { memoryId: string; version: number } | null;
  // Con el puntero, carga la foto (snapshot) guardada de esa versión y la interpreta como JSON.
  const summary = pointer === null ? null : (JSON.parse((db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?")
    .get(pointer.memoryId, pointer.version) as { snapshot: string }).snapshot) as MemoryVersion);
  return { sessionId: row.sessionId, interruptedAt: row.lastActivity, summary };
}

// Como mucho se informan estas sesiones abiertas en paralelo.
const PARALLEL_LIMIT = 3;

/**
 * Devuelve hasta PARALLEL_LIMIT sesiones de ejecución del proyecto que están abiertas en paralelo (al
 * mismo tiempo) con `sessionId` (su última actividad es igual o posterior a parallelThreshold(now)),
 * ordenadas de actividad más reciente a más antigua y, en empate, por sessionId ascendente; devuelve []
 * por debajo del nivel de esquema 11 (1.7.1).
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto.
 * @param sessionId sesión que se excluye de la lista (la propia).
 * @param now instante de referencia (ISO); por defecto, el momento actual.
 * @returns hasta PARALLEL_LIMIT sesiones abiertas en paralelo, de la más reciente a la más antigua.
 */
export function parallelSessions(db: Database, projectId: string, sessionId: string, now: string = new Date().toISOString()): ParallelSession[] {
  const project = projectIdentity(projectId);
  if (!intelligenceEnabled(db)) return [];
  const threshold = parallelThreshold(now);
  // Busca sesiones de ejecución abiertas, distintas de la propia, con actividad igual o posterior al umbral.
  return db.query(`SELECT s.sessionId AS sessionId,${LAST_ACTIVITY} AS lastActivityAt
    FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
    WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL AND s.sessionId<>? AND ${LAST_ACTIVITY} >= ?
    ORDER BY lastActivityAt DESC,s.sessionId ASC LIMIT ${PARALLEL_LIMIT}`)
    .all(project, sessionId, threshold) as ParallelSession[];
}
