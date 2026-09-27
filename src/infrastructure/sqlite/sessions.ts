/**
 * Este archivo maneja el ciclo de vida de las sesiones de trabajo guardadas en SQLite: sesiones "runtime"
 * (las que abre y cierra automáticamente el asistente mientras trabaja en un proyecto) y sesiones "manual"
 * (una única sesión estable por proyecto, para cuando el guardado no viene ligado a ninguna sesión de
 * ejecución). Existe para que el resto de la capa de infraestructura (por ejemplo, quien coordina el
 * guardado de memorias) pueda abrir, cerrar, validar e inferir sesiones sin repetir las mismas reglas de
 * negocio en cada lugar. Sus piezas principales son: lectura de una fila de sesión (sessionRow), apertura
 * y cierre de sesiones runtime (startRuntimeSession/endRuntimeSession), comprobación de si el nivel de
 * esquema (schema, la versión de la estructura de la base de datos) admite sesiones
 * (sessionsEnabled/requireSessions), lectura segura de una sesión de un proyecto (getSession), validación
 * de una sesión indicada explícitamente al guardar (validateSelectedSession), inferencia de sesiones
 * abiertas ligadas a una carpeta (inferredSessions) y la sesión manual única por proyecto (manualSession).
 */
import type { Database } from "bun:sqlite";
import { type Memory } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { sessionIdentity,type Session } from "../../modules/sessions";
import { MemoryError } from "../../shared/errors";
import { inactivityThreshold,touchSession } from "./activity";
import { intelligenceEnabled } from "./intelligence";
import { schemaFeatures } from "./schema";

/**
 * Busca en la base la fila cruda de una sesión por su identificador.
 * @param db conexión a la base de datos SQLite.
 * @param sessionId identificador de la sesión a buscar.
 * @returns la sesión encontrada, o null si no existe.
 */
export function sessionRow(db: Database, sessionId: string): Session | null {
  return db.query("SELECT sessionId,projectId,kind,startedAt,endedAt FROM sessions WHERE sessionId=?")
    .get(sessionId) as Session | null;
}

// Estas funciones auxiliares (helpers) deliberadamente no abren ni confirman (commit) transacciones:
// quien las llama es dueño de la transacción, para que la creación de proyecto, el vínculo local y los
// cambios de ciclo de vida se puedan combinar en una sola operación.
/**
 * Abre una sesión runtime (de ejecución) nueva, o reutiliza una ya existente compatible, y opcionalmente
 * la vincula a una carpeta local de trabajo.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto dueño de la sesión.
 * @param sessionId identificador de la sesión a abrir o reutilizar.
 * @param runtimeDirectory carpeta local desde la que se abre la sesión, si se conoce.
 * @returns la sesión ya abierta (nueva o reutilizada).
 * @throws MemoryError con código SESSION_CONFLICT si el identificador ya pertenece a otro proyecto,
 * es de tipo manual, o ya está cerrada.
 * @throws MemoryError con código PROJECT_NOT_FOUND si el proyecto no existe.
 */
export function startRuntimeSession(db: Database, projectId: string, sessionId: string, runtimeDirectory?: string): Session {
  const at = new Date().toISOString();
  const existing = sessionRow(db, sessionId);
  if (existing) {
    // Reutilizable solo si es la misma sesión: mismo proyecto, tipo runtime y todavía abierta (endedAt nulo).
    if (existing.projectId !== projectId || existing.kind !== "runtime" || existing.endedAt !== null) {
      throw new MemoryError("SESSION_CONFLICT", "El identificador de sesión no está disponible.");
    }
  } else {
    // El proyecto debe existir antes de poder abrirle una sesión.
    const project = db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId);
    if (!project) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    // Se crea la sesión runtime, todavía sin cerrar (endedAt en NULL).
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'runtime',?,NULL)")
      .run(sessionId, projectId, at);
  }
  if (runtimeDirectory !== undefined) {
    // INSERT OR IGNORE: si la carpeta ya estaba vinculada a esta sesión, no se duplica ni falla.
    db.query("INSERT OR IGNORE INTO local_session_bindings(sessionId,directory) VALUES(?,?)")
      .run(sessionId, runtimeDirectory);
  }
  // Abrir una sesión no le pone marca de actividad a ninguna otra: las demás sesiones runtime abiertas
  // del mismo proyecto conservan su propia actividad sin tocar (1.7.1). Si alguna de ellas cuenta como
  // dejada abierta se decide después, según el tiempo transcurrido, en previousInterrupted/parallelSessions.
  touchSession(db, sessionId, at);
  return sessionRow(db, sessionId)!;
}

/**
 * Cierra una sesión runtime (de ejecución) del proyecto indicado, marcando su hora de cierre. Si ya
 * estaba cerrada, no hace nada y devuelve la misma sesión (operación idempotente: repetirla no cambia
 * el resultado).
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto dueño de la sesión.
 * @param sessionId identificador de la sesión a cerrar.
 * @returns la sesión ya cerrada.
 * @throws MemoryError con código SESSION_NOT_FOUND si la sesión no existe o no pertenece a este proyecto.
 * @throws MemoryError con código SESSION_KIND si la sesión es de tipo manual (esas no se cierran así).
 */
export function endRuntimeSession(db: Database, projectId: string, sessionId: string): Session {
  const existing = sessionRow(db, sessionId);
  if (!existing || existing.projectId !== projectId) {
    throw new MemoryError("SESSION_NOT_FOUND", "Sesión no encontrada para este proyecto.");
  }
  if (existing.kind !== "runtime") throw new MemoryError("SESSION_KIND", "Una sesión manual no puede cerrarse.");
  if (existing.endedAt === null) {
    // Solo se actualiza si de verdad seguía abierta; si ya estaba cerrada, se deja tal cual.
    const at = new Date().toISOString();
    db.query("UPDATE sessions SET endedAt=? WHERE sessionId=? AND endedAt IS NULL")
      .run(at, sessionId);
    touchSession(db, sessionId, at);
  }
  return sessionRow(db, sessionId)!;
}

/**
 * Indica si el nivel de esquema (schema, la versión de la estructura de la base de datos) actual admite
 * sesiones.
 * @param db conexión a la base de datos SQLite.
 * @returns true si el nivel base del esquema es 6 o superior.
 */
export function sessionsEnabled(db: Database): boolean {
    return (schemaFeatures(db)?.base ?? 0)>=6;
  }

/**
 * Exige que el esquema admita sesiones antes de continuar.
 * @param db conexión a la base de datos SQLite.
 * @throws MemoryError con código MIGRATION_REQUIRED si el esquema todavía no admite sesiones.
 */
export function requireSessions(db: Database): void {
    if (!sessionsEnabled(db)) throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero las sesiones.");
  }

/**
 * Busca una sesión, exigiendo primero que las sesiones estén habilitadas y validando el formato de
 * projectId y sessionId, y solo la devuelve si en verdad pertenece al proyecto indicado.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto esperado como dueño.
 * @param sessionId identificador de la sesión a buscar.
 * @returns la sesión si existe y pertenece al proyecto, o null en caso contrario.
 * @throws MemoryError con código MIGRATION_REQUIRED si las sesiones no están habilitadas.
 * @throws MemoryError con código INVALID_INPUT si projectId o sessionId no tienen un formato válido.
 */
export function getSession(db: Database, projectId: string, sessionId: string): Session | null {
    requireSessions(db);
    // projectIdentity valida que sea un UUID de proyecto; sessionIdentity valida el formato del identificador de sesión.
    const project = projectIdentity(projectId); const row = sessionRow(db,sessionIdentity(sessionId));
    return row?.projectId === project ? row : null;
  }

/**
 * Valida una sesión indicada explícitamente por quien llama (por ejemplo, al guardar una memoria con un
 * sessionId dado a mano) contra las reglas de propiedad, tipo y estado que le correspondan según el
 * ámbito (scope) de la memoria.
 * @param db conexión a la base de datos SQLite.
 * @param sessionId identificador de la sesión a validar.
 * @param scope ámbito de la memoria ("project" u otro ámbito, por ejemplo "shared").
 * @param projectId proyecto dueño esperado cuando el ámbito es "project".
 * @param optionProject proyecto indicado por opción explícita, usado cuando el ámbito no es "project".
 * @param requireOpen si es true, exige que la sesión siga abierta (sin endedAt).
 * @returns la sesión validada.
 * @throws MemoryError con código SESSION_NOT_FOUND si la sesión no existe o no pertenece al dueño esperado.
 * @throws MemoryError con código INVALID_INPUT si el ámbito no es "project" y no se indicó optionProject.
 * @throws MemoryError con código SESSION_KIND si la sesión no es de tipo runtime.
 * @throws MemoryError con código SESSION_CLOSED si requireOpen es true y la sesión ya está cerrada.
 */
export function validateSelectedSession(db: Database, sessionId: string, scope: Memory["scope"], projectId: string|null, optionProject: string|null, requireOpen: boolean): Session {
    const row = sessionRow(db,sessionId);
    if (!row) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada.");
    // En ámbito "project" el dueño esperado es projectId; en cualquier otro ámbito (p. ej. "shared") lo es optionProject.
    const expectedOwner = scope === "project" ? projectId : optionProject;
    if (scope !== "project" && optionProject === null) throw new MemoryError("INVALID_INPUT","projectId es obligatorio para asociar shared.");
    if (row.projectId !== expectedOwner) throw new MemoryError("SESSION_NOT_FOUND","Sesión no encontrada para este proyecto.");
    if (row.kind !== "runtime") throw new MemoryError("SESSION_KIND","Una sesión manual no admite asociación explícita.");
    if (requireOpen && row.endedAt !== null) throw new MemoryError("SESSION_CLOSED","La sesión está cerrada.");
    return row;
  }

/**
 * Encuentra las sesiones runtime (de ejecución) abiertas del proyecto que están vinculadas a una carpeta
 * local dada, usando una regla de vigencia distinta según el nivel de esquema: con inteligencia
 * (intelligence, el nivel que registra actividad detallada) habilitada usa una ventana de inactividad en
 * horas y descarta las sesiones marcadas como interrumpidas; sin ella, usa una ventana fija de siete días
 * sobre la última actividad conocida.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto.
 * @param directory carpeta local desde la que se pregunta.
 * @param requestNow instante (ISO) tomado como "ahora" para calcular la ventana de vigencia.
 * @returns identificadores de sesión, ordenados, que se consideran inferibles para esa carpeta.
 */
export function inferredSessions(db: Database, projectId: string, directory: string, requestNow: string): string[] {
    // A partir del nivel 11, una sesión obsoleta (stale, sin actividad reciente), o una que todavía cargue una
    // marca dejada por la versión 1.7.0, nunca debe inferirse en silencio: la ventana de actividad de seis horas
    // (tabla session_activity) reemplaza a la ventana fija de siete días que se usa por debajo de ese nivel.
    if (intelligenceEnabled(db)) {
      const threshold = inactivityThreshold(requestNow);
      // El JOIN con session_activity descarta las sesiones marcadas como interrumpidas (interruptedAt no nulo)
      // y exige que la última actividad conocida (o, a falta de ella, la última entrada guardada, o el inicio
      // de la sesión) sea igual o posterior al umbral de inactividad.
      return (db.query(`SELECT s.sessionId FROM sessions s LEFT JOIN session_activity sa ON sa.sessionId=s.sessionId
        WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
        AND EXISTS (SELECT 1 FROM local_session_bindings b WHERE b.sessionId=s.sessionId AND b.directory=?)
        AND sa.interruptedAt IS NULL
        AND coalesce(sa.lastActivityAt,(SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt) >= ?
        ORDER BY s.sessionId`).all(projectId,directory,threshold) as {sessionId:string}[]).map(row=>row.sessionId);
    }
    // Sin inteligencia habilitada: ventana fija de siete días contada desde requestNow.
    const threshold = new Date(Date.parse(requestNow)-7*24*60*60*1000).toISOString();
    // Vigente si el inicio de la sesión o su última entrada guardada (lo que sea más reciente) cae dentro de la ventana.
    return (db.query(`SELECT s.sessionId FROM sessions s
      WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
      AND EXISTS (SELECT 1 FROM local_session_bindings b WHERE b.sessionId=s.sessionId AND b.directory=?)
      AND max(s.startedAt,coalesce((SELECT max(e.recordedAt) FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)) >= ?
      ORDER BY s.sessionId`).all(projectId,directory,threshold) as {sessionId:string}[]).map(row=>row.sessionId);
  }

/**
 * Obtiene la sesión manual del proyecto si ya existe, o crea una nueva y la registra como la única
 * sesión manual del proyecto (patrón "conseguir o crear": get-or-create).
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto.
 * @param now instante (ISO) a usar como fecha de inicio si se crea una sesión nueva.
 * @returns el identificador de la sesión manual (existente o recién creada).
 */
export function manualSession(db: Database, projectId: string, now: string): string {
    const existing = db.query("SELECT sessionId FROM local_manual_sessions WHERE projectId=?").get(projectId) as {sessionId:string}|null;
    if (existing) return existing.sessionId;
    // No existía todavía: se genera un identificador nuevo y se registra tanto en sessions como en local_manual_sessions.
    const id = crypto.randomUUID();
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'manual',?,NULL)").run(id,projectId,now);
    db.query("INSERT INTO local_manual_sessions(projectId,sessionId) VALUES(?,?)").run(projectId,id);
    return id;
  }
