/**
 * Motor de búsqueda: arma la consulta SQL según el modo activo (búsqueda literal, FTS5
 * simple —FTS5 es el motor de búsqueda de texto completo integrado en SQLite—, FTS5 con
 * refuerzo por antigüedad y repetición, o híbrida por inteligencia, que combina un índice
 * de palabras y uno de trigramas —secuencias de tres caracteres— por fusión de rangos
 * recíprocos, ver hybrid.ts), y también lee versiones anteriores de una memoria, la línea
 * de tiempo de una sesión y el contexto (pinneados, recientes y resúmenes) que se entrega
 * al iniciar sesión.
 */
import type { Database } from "bun:sqlite";
import { marksFor,type Memory,type MemoryOwner,type MemoryVersion,type SearchResult,type SearchScope } from "../../modules/memory";
import {
  rankingFactors,MILLISECONDS_PER_DAY,RANKING_CONTENT_WEIGHT,RANKING_PINNED_WEIGHT,
  RANKING_RECENCY_DAYS,RANKING_RECENCY_WEIGHT,RANKING_STABILITY_BASE,RANKING_STABILITY_WEIGHT,
  RANKING_TITLE_WEIGHT,RANKING_TOPIC_WEIGHT,
} from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import type { ContextRow,MemoryPreview,TimelineRow } from "../../modules/search";
import { searchTerms,validateSearchLimit,type ContextInput,type ContextResult,type PreviewResult,type TimelineInput,type TimelineResult,type VersionRead } from "../../modules/search";
import { MemoryError } from "../../shared/errors";
import { reinforcementEnabled } from "./confirmations";
import { intelligenceEnabled } from "./intelligence";
import { readMeta,readMetas } from "./meta";
import { ecosystemEnabled,getGroup,groupOfProject } from "./ecosystem-groups";
import { hybridHits } from "./hybrid";
import { memory,ownerClause,required,type Row } from "./memory";
import { sessionsEnabled } from "./sessions";

/** Fragmento SQL de visibilidad ("qué filas puede ver esta búsqueda") y sus parámetros, listo para insertarse en un WHERE. */
type Selection = { sql: string; args: string[] };
/** Fila de vista previa: los mismos campos que una memoria completa pero con el contenido recortado a 300 caracteres. */
type PreviewRow = {
  id: string; projectId: string | null; groupId?: string | null; scope: Memory["scope"]; topic_key: string | null;
  type: Memory["type"]; title: string; preview: string; truncated: number; pinned: number;
  version: number; created_at: string; updated_at: string;
};

/**
 * Valida que un valor sea un entero seguro dentro de un rango, para parámetros que llegan
 * de fuera (límites, versiones, tamaños en bytes).
 * @param value valor recibido, sin tipar todavía.
 * @param field nombre del campo, para el mensaje de error.
 * @param min mínimo permitido (incluido).
 * @param max máximo permitido (incluido).
 * @returns el mismo valor, ya como number.
 * @throws MemoryError con código INVALID_INPUT si no es un entero seguro o queda fuera del rango.
 */
function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new MemoryError("INVALID_INPUT", `${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return value as number;
}
/**
 * El grupo (ecosistema) contra el que corre una búsqueda: el que se indique explícitamente,
 * o si no, el grupo al que pertenece el proyecto.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto que busca, o null si la búsqueda no parte de un proyecto.
 * @param groupId grupo explícito, si se indicó uno.
 * @returns id del grupo a usar, o null si no hay ninguno.
 */
function searchGroup(db: Database, projectId: string | null, groupId: string | null | undefined): string | null {
  if (groupId) return groupId;
  return projectId === null ? null : groupOfProject(db, projectId)?.group.id ?? null;
}
/**
 * Construye el fragmento SQL de visibilidad para un alcance (scope) de búsqueda dado.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto que busca, o null para buscar sin proyecto (solo scope shared).
 * @param scope alcance pedido: all, project, shared o ecosystem.
 * @param groupId grupo explícito para scope ecosystem, si aplica.
 * @returns el SQL y los parámetros listos para un WHERE.
 * @throws MemoryError INVALID_INPUT si el scope no es válido o falta projectId cuando se necesita;
 *   PROJECT_NOT_FOUND si el proyecto no existe; GROUP_REQUIRED si ecosystem no tiene grupo;
 *   GROUP_NOT_FOUND si el grupo indicado no existe.
 */
export function searchSelection(db: Database, projectId: string | null, scope: SearchScope, groupId?: string | null): Selection {
  if (!["all", "project", "shared", "ecosystem"].includes(scope)) throw new MemoryError("INVALID_INPUT", "Búsqueda: scope debe ser all, project, shared o ecosystem.");
  if (projectId !== null && !db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  if (scope === "shared") return { sql: "m.scope='shared'", args: [] };
  if (scope === "ecosystem") {
    const group = searchGroup(db, projectId, groupId);
    if (group === null) throw new MemoryError("GROUP_REQUIRED", "El proyecto no pertenece a un grupo: indica el grupo o vincula el proyecto a uno.");
    if (!getGroup(db, group)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    return { sql: "m.scope='ecosystem' AND m.groupId=?", args: [group] };
  }
  if (projectId === null) throw new MemoryError("INVALID_INPUT", "Sin projectId debes buscar explícitamente en scope shared.");
  if (scope === "project") return { sql: "m.scope='project' AND m.projectId=?", args: [projectId] };
  const group = searchGroup(db, projectId, groupId);
  // Sin grupo: el proyecto ve lo suyo, más lo compartido (shared) que no esté tapado por un
  // tema (topic_key) propio ya activo en el proyecto.
  if (group === null) return { sql: `(m.projectId=? OR (m.scope='shared' AND NOT EXISTS (
    SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project'
    AND p.state='active' AND p.topic_key=m.topic_key)))`, args: [projectId, projectId] };
  // Con grupo: mismo orden de prioridad cuando un tema (topic_key) se repite en varios
  // alcances: primero lo del proyecto, luego lo del ecosistema (si el proyecto no lo tapa),
  // y por último lo compartido (si ni el proyecto ni el ecosistema lo tapan).
  return { sql: `(m.projectId=?
    OR (m.scope='ecosystem' AND m.groupId=? AND NOT EXISTS (
      SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key))
    OR (m.scope='shared' AND NOT EXISTS (
      SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key)
      AND NOT EXISTS (
      SELECT 1 FROM memories e WHERE e.scope='ecosystem' AND e.groupId=? AND e.state='active' AND e.topic_key=m.topic_key)))`,
    args: [projectId, group, projectId, projectId, group] };
}
/** Traduce una fila SQL de vista previa a la forma pública `MemoryPreview`, agregando groupId solo si aplica. */
function preview(row: PreviewRow): MemoryPreview {
  return { id: row.id, projectId: row.projectId, scope: row.scope, topicKey: row.topic_key,
    type: row.type, title: row.title, preview: row.preview, truncated: row.truncated === 1,
    pinned: row.pinned === 1, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.scope === "ecosystem" && row.groupId ? { groupId: row.groupId } : {}) };
}
/**
 * Lista de columnas SQL para una vista previa, calculada según el nivel del esquema
 * (versión de la estructura de tablas): las bases por debajo del nivel de ecosistema no
 * tienen columna groupId, así que se omite para no romper la consulta.
 * @param db conexión abierta a la base SQLite.
 * @returns el fragmento de columnas para un SELECT.
 */
function previewColumns(db: Database): string {
  return `m.id,m.projectId,${ecosystemEnabled(db) ? "m.groupId," : ""}m.scope,m.topic_key,m.type,m.title,
  substr(m.content,1,300) AS preview,length(m.content)>300 AS truncated,m.pinned,m.version,m.created_at,m.updated_at`;
}

/**
 * Consulta para el modo literal (coincidencia exacta de texto, sin FTS5): filtra por
 * visibilidad y activa, y ordena por pinneado primero y luego por fecha. Usa las mismas
 * reglas de visibilidad, orden y desempate que `ftsQuery` para que las dos proyecciones
 * (memoria completa y vista previa) den resultados consistentes; el filtrado por el texto
 * exacto se hace después, en JavaScript, recorriendo el cursor (statement.iterate) para no
 * cargar todo el proyecto en memoria de una vez.
 * @param columns columnas SQL a proyectar.
 * @param selection SQL y parámetros de visibilidad ya armados.
 * @returns la consulta SQL completa (sin el LIMIT: el modo literal corta en JavaScript).
 */
function literalQuery(columns: string, selection: Selection): string {
  return `SELECT ${columns} FROM memories m WHERE ${selection.sql} AND m.state='active'
    ORDER BY m.pinned DESC,m.updated_at DESC,m.id ASC`;
}
/**
 * Consulta para el modo FTS5 simple (búsqueda de texto completo sin refuerzo): puntúa con
 * bm25 (qué tanto coincide el texto) y aplica un multiplicador fijo por pinneado y
 * antigüedad, sin datos de repetición ni confirmaciones.
 * @param columns columnas SQL a proyectar.
 * @param selection SQL y parámetros de visibilidad ya armados.
 * @returns la consulta SQL completa, con marcador `?` para el término de búsqueda y otro para el límite.
 */
function ftsQuery(columns: string, selection: Selection): string {
  return `SELECT ${columns},bm25(memories_fts,${RANKING_TITLE_WEIGHT},${RANKING_CONTENT_WEIGHT},${RANKING_TOPIC_WEIGHT}) AS bm25,
    (1 + 0.10*m.pinned + 0.06/(1+MAX(0,julianday('now')-julianday(m.updated_at))/30)) AS multiplier
    FROM memories_fts JOIN memories m ON m.rowid=memories_fts.rowid
    WHERE memories_fts MATCH ? AND ${selection.sql} AND m.state='active'
    ORDER BY bm25 * multiplier ASC,m.id ASC LIMIT ?`;
}

/**
 * Consulta para el modo FTS5 con refuerzo (nivel de esquema 7): igual que `ftsQuery`, pero
 * el multiplicador de orden también premia cuántas confirmaciones tiene la memoria
 * (duplicateCount: filas de `confirmations`, que se anotan cuando alguien vuelve a guardar
 * el mismo contenido sin cambios), cuántas versiones tiene (revisionCount) y qué tan
 * reciente fue su último guardado o confirmación (lastSeenAt), con el reloj de la petición fijo en una
 * CTE (common table expression: una subconsulta con nombre, aquí request_clock, que se
 * puede reutilizar como si fuera una tabla) para que todas las filas se comparen contra
 * el mismo instante.
 * @param columns columnas SQL a proyectar.
 * @param selection SQL y parámetros de visibilidad ya armados.
 * @returns la consulta SQL completa, con marcadores `?` para el reloj, el término de
 *   búsqueda y el límite, en ese orden.
 */
function reinforcedFtsQuery(columns: string, selection: Selection): string {
  // Fórmula del multiplicador: 1 más un empujón por pinneado, más un empujón por
  // recencia (que decae con la edad en milisegundos desde el último guardado o confirmación, leyendo los
  // milisegundos del ISO 8601 guardado en lastSeenAt), más un empujón por estabilidad que
  // crece con revisiones y confirmaciones pero con rendimientos decrecientes.
  const multiplier = `(1 + ${RANKING_PINNED_WEIGHT}*candidate.pinned
    + ${RANKING_RECENCY_WEIGHT}/(1+MAX(0,(request_clock.nowMs
      -(unixepoch(candidate.lastSeenAt)*1000+CAST(substr(candidate.lastSeenAt,21,3) AS INTEGER)))/${MILLISECONDS_PER_DAY}.0)/${RANKING_RECENCY_DAYS})
    + ${RANKING_STABILITY_WEIGHT}*(candidate.revisionCount+candidate.duplicateCount)
      /(candidate.revisionCount+candidate.duplicateCount+${RANKING_STABILITY_BASE}))`;
  return `WITH request_clock(nowMs) AS (VALUES (?)), candidate AS (
    SELECT ${columns},bm25(memories_fts,${RANKING_TITLE_WEIGHT},${RANKING_CONTENT_WEIGHT},${RANKING_TOPIC_WEIGHT}) AS bm25,
      m.version-1 AS revisionCount,
      (SELECT count(*) FROM confirmations c WHERE c.memoryId=m.id) AS duplicateCount,
      max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) AS lastSeenAt
    FROM memories_fts JOIN memories m ON m.rowid=memories_fts.rowid
    WHERE memories_fts MATCH ? AND ${selection.sql} AND m.state='active'
  ), ranked AS (
    SELECT candidate.*,${multiplier} AS multiplier FROM candidate CROSS JOIN request_clock
  )
  SELECT * FROM ranked ORDER BY bm25*multiplier ASC,id ASC LIMIT ?`;
}

/** Columnas propias del modo con refuerzo que trae `reinforcedFtsQuery`, además de las columnas comunes de la proyección. */
type ReinforcedSearchRow = {
  bm25:number; multiplier:number; revisionCount:number; duplicateCount:number; lastSeenAt:string; pinned:number;
};

/**
 * Arma la explicación pública del orden (por qué salió en esa posición) para una fila del
 * modo con refuerzo, recalculando los mismos factores en JavaScript con `rankingFactors`
 * (para que la explicación cuadre exacto con la fórmula SQL) pero descartando de ahí el
 * multiplicador ya calculado en SQL, que es el que de verdad se usa para ordenar.
 * @param row fila con bm25, multiplicador SQL y los datos crudos de repetición y antigüedad.
 * @param now instante de la petición en ISO 8601, para calcular la edad en días.
 * @returns la explicación con modo fts5, bm25, multiplicador, puntaje de orden y el desglose de refuerzo.
 */
function reinforcedExplanation(row: ReinforcedSearchRow, now: string): SearchResult["explanation"] {
  const {multiplier:_jsMultiplier,...reinforcement}=rankingFactors({
    revisionCount:row.revisionCount,
    duplicateCount:row.duplicateCount,
    lastSeenAt:row.lastSeenAt,
  },row.pinned===1,now);
  return {mode:"fts5",bm25:row.bm25,multiplier:row.multiplier,orderScore:row.bm25*row.multiplier,reinforcement};
}

/**
 * Modo híbrido (nivel de esquema 11): primero ordena ids con la búsqueda híbrida (que
 * combina, mediante fusión de rangos recíprocos, un índice de palabras con uno de
 * trigramas —secuencias de tres caracteres—; no usa nada vectorial ni de significado, ver
 * hybridHits en hybrid.ts), y ya con ese orden decidido, lee en una sola consulta la
 * proyección pedida (memoria completa o vista previa) y reordena las filas en JavaScript
 * según ese orden, porque un `IN (...)` de SQL no garantiza el orden de salida.
 * @param db conexión abierta a la base SQLite.
 * @param columns columnas SQL a proyectar.
 * @param selection SQL y parámetros de visibilidad ya armados.
 * @param query texto de búsqueda tal cual lo escribió quien busca.
 * @param limit máximo de resultados.
 * @returns cada fila proyectada junto con la explicación de por qué quedó en ese orden.
 */
function hybridRows<T extends { id: string }>(db: Database, columns: string, selection: Selection, query: string, limit: number):
    { row: T; explanation: SearchResult["explanation"] }[] {
  const hits = hybridHits(db, selection, query, limit);
  if (hits.length === 0) return [];
  const rows = db.query(`SELECT ${columns} FROM memories m WHERE m.id IN (${hits.map(() => "?").join(",")})`).all(...hits.map(hit => hit.id)) as T[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return hits.map(hit => ({ row: byId.get(hit.id)!, explanation: hit.explanation }));
}

/**
 * Lee vistas previas de memorias según el modo de búsqueda activo en esta base (híbrido,
 * literal, con refuerzo o FTS5 simple), probando los modos en ese orden de preferencia.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto que busca, o null.
 * @param query texto de búsqueda.
 * @param limit máximo de resultados.
 * @param scope alcance de la búsqueda.
 * @param groupId grupo explícito, si aplica.
 * @returns vistas previas con su explicación de orden.
 */
function readSearchPreviews(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all", groupId?: string | null): PreviewResult[] {
  const PREVIEW_COLUMNS = previewColumns(db);
  const selection = searchSelection(db, projectId, scope, groupId); const parsed = searchTerms(query); validateSearchLimit(limit);
  if (intelligenceEnabled(db)) return hybridRows<PreviewRow>(db, PREVIEW_COLUMNS, selection, query, limit)
    .map(({ row, explanation }) => ({ memory: preview(row), explanation }));
  if (parsed.literal) {
    // Coincidencia de texto exacto: se recorre con un cursor (statement.iterate) y se corta
    // en cuanto se junta el límite, para no traer de golpe todo el proyecto a memoria.
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
  if (reinforcementEnabled(db)) {
    const requestTime=new Date(),now=requestTime.toISOString();
    const rows=db.query(reinforcedFtsQuery(PREVIEW_COLUMNS,selection)).all(requestTime.getTime(),parsed.match,...selection.args,limit) as (PreviewRow&ReinforcedSearchRow)[];
    return rows.map(row=>({memory:preview(row),explanation:reinforcedExplanation(row,now)}));
  }
  const rows = db.query(ftsQuery(PREVIEW_COLUMNS, selection)).all(parsed.match, ...selection.args, limit) as (PreviewRow & {bm25:number;multiplier:number})[];
  return rows.map(row => ({ memory: preview(row), explanation: { mode: "fts5", bm25: row.bm25,
    multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
}

/**
 * Lee una versión concreta (o la actual) de una memoria a partir de su historial de
 * versiones (memory_versions), sin exponer versiones que el dueño no pueda ver.
 * @param db conexión abierta a la base SQLite.
 * @param owner dueño autorizado a leer (proyecto, grupo o null para shared).
 * @param id id de la memoria.
 * @param version número de versión pedido; si se omite, se usa la versión actual.
 * @returns la memoria en esa versión, la versión actual y el estado, o null si no existe o no es visible para ese dueño.
 * @throws MemoryError INVALID_INPUT si version no es un entero válido.
 */
function readGetVersion(db: Database, owner: MemoryOwner, id: string, version?: number): VersionRead | null {
  const memoryId = required(id, "id");
  const clause = ownerClause(db, owner);
  const current = db.query(`SELECT m.version,m.state FROM memories m WHERE ${clause.sql} AND m.id=?`).get(...clause.args, memoryId) as {version:number;state:Memory["state"]}|null;
  if (!current) return null;
  const selected = version === undefined ? current.version : integer(version, "version", 1, Number.MAX_SAFE_INTEGER);
  const row = db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(memoryId, selected) as {snapshot:string}|null;
  return row ? { memory: JSON.parse(row.snapshot) as MemoryVersion, currentVersion: current.version, state: current.state } : null;
}

/** Fila de vista previa reconstruida desde una foto (snapshot) de sesión, con la fecha en que se registró en la sesión. */
type TimelineSqlRow = PreviewRow & {recordedAt:string};
/** Envuelve una fila de línea de tiempo en la forma pública `TimelineRow`. */
function timelinePreview(row: TimelineSqlRow): TimelineRow {
  return { memory: preview(row), recordedAt: row.recordedAt };
}
/**
 * Columnas SQL para reconstruir una vista previa a partir del JSON guardado en una foto
 * (snapshot) de versión, en vez de leerlas de la tabla `memories` actual (la línea de
 * tiempo muestra el estado de cada memoria tal como era en ese momento de la sesión).
 * @param limit tope de caracteres del contenido a mostrar (más grande para el foco, más chico para alrededor).
 * @returns el fragmento de columnas para un SELECT.
 */
function snapshotColumns(limit: 150 | 500): string {
  return `json_extract(v.snapshot,'$.id') AS id,json_extract(v.snapshot,'$.projectId') AS projectId,json_extract(v.snapshot,'$.groupId') AS groupId,
    json_extract(v.snapshot,'$.scope') AS scope,json_extract(v.snapshot,'$.topicKey') AS topic_key,
    json_extract(v.snapshot,'$.type') AS type,json_extract(v.snapshot,'$.title') AS title,
    substr(json_extract(v.snapshot,'$.content'),1,${limit}) AS preview,
    length(json_extract(v.snapshot,'$.content'))>${limit} AS truncated,
    json_extract(v.snapshot,'$.pinned') AS pinned,json_extract(v.snapshot,'$.version') AS version,
    json_extract(v.snapshot,'$.createdAt') AS created_at,json_extract(v.snapshot,'$.updatedAt') AS updated_at,e.recordedAt`;
}
/**
 * Arma la línea de tiempo de una sesión alrededor de una memoria y versión concretas: la
 * propia entrada (foco) más algunas de antes y de después, en el orden en que se
 * registraron durante la sesión.
 * @param db conexión abierta a la base SQLite.
 * @param sessionsEnabled si el nivel de esquema (versión de la estructura de tablas) ya tiene sesiones.
 * @param projectId proyecto dueño de la sesión.
 * @param input sessionId, memoryId y version a enfocar, y cuántas entradas traer antes y después.
 * @returns la entrada de foco y las listas de antes/después, ya en orden cronológico.
 * @throws MemoryError MIGRATION_REQUIRED si el esquema no tiene sesiones; NO_SESSION_CONTEXT
 *   si la sesión no es del proyecto o la memoria no pertenece a esa sesión (o está archivada).
 */
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
    // Clave de orden (fecha de registro, memoria, versión) para ubicar el foco dentro de la
    // sesión y traer lo inmediatamente anterior y posterior con comparación de tuplas.
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
    // "prior" se trajo en orden descendente (lo más cercano al foco primero) para poder
    // limitarlo con LIMIT; se invierte aquí para dejarlo en orden cronológico ascendente.
    return { sessionId, focus: timelinePreview(focus), before: prior.reverse().map(timelinePreview), after: later.map(timelinePreview) };
  }).deferred();
}

/** Vista previa de contexto: igual que una vista previa normal, o sin el campo `preview` cuando se pide la forma compacta. */
function contextRow(row: PreviewRow, compact: boolean): ContextRow {
  const value = preview(row); if (!compact) return value;
  const { preview: _preview, ...rest } = value; return rest;
}
/**
 * Fragmento SQL de visibilidad para el contexto que se entrega al iniciar sesión: por
 * dueño explícito (proyecto o grupo), o el mismo criterio de "shared no tapado" que usa la
 * búsqueda cuando el dueño es un proyecto simple.
 * @param db conexión abierta a la base SQLite.
 * @param owner dueño del contexto: proyecto, grupo o null para shared.
 * @returns el SQL y los parámetros listos para un WHERE.
 */
function contextSelection(db: Database, owner: MemoryOwner): Selection {
  if (owner !== null && typeof owner === "object") return ownerClause(db, owner);
  return owner === null ? {sql:"m.scope='shared'",args:[]} : { sql: `(m.projectId=? OR (m.scope='shared' AND NOT EXISTS (
    SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key)))`, args:[owner,owner] };
}
/**
 * Fragmento SQL que excluye del resultado las filas (id, versión) ya elegidas en una
 * sección previa del contexto, para no repetir una misma memoria en pinneados, recientes y
 * resúmenes.
 * @param rows filas ya elegidas a excluir.
 * @param id columna SQL del id a comparar.
 * @param version columna SQL de la versión a comparar.
 * @returns un fragmento ` AND NOT (...)` (vacío si no hay nada que excluir) y sus parámetros.
 */
function excludeKeys(rows: ContextRow[], id = "m.id", version = "m.version"): {sql:string;args:(string|number)[]} {
  if (rows.length === 0) return {sql:"",args:[]};
  return { sql: ` AND NOT (${rows.map(() => `(${id}=? AND ${version}=?)`).join(" OR ")})`,
    args: rows.flatMap(row => [row.id,row.version]) };
}
/**
 * Arma el contexto que se entrega al iniciar sesión: memorias pinneadas, luego recientes
 * (sin repetir las ya pinneadas) y, si el proyecto tiene sesiones, resúmenes de sesiones
 * anteriores (sin repetir lo ya incluido); recorta secciones hasta caber en `maxBytes`.
 * @param db conexión abierta a la base SQLite.
 * @param sessionsEnabled si el nivel de esquema (versión de la estructura de tablas) ya tiene sesiones.
 * @param owner dueño del contexto: proyecto, grupo o null para shared.
 * @param input tamaño máximo en bytes y si se quiere la forma compacta (sin el texto de vista previa).
 * @returns pinneados, recientes, resúmenes, cuántos quedaron fuera de cada sección y si el resultado quedó recortado.
 * @throws MemoryError INVALID_INPUT si compact no es booleano, si maxBytes es inválido, si el
 *   proyecto no existe, o si maxBytes no alcanza ni para el resultado vacío.
 */
function readContext(db: Database, sessionsEnabled: boolean, owner: MemoryOwner, input: ContextInput = {}): ContextResult {
  const PREVIEW_COLUMNS = previewColumns(db);
  const projectId = typeof owner === "string" ? owner : null;
  if (input.compact !== undefined && typeof input.compact !== "boolean") throw new MemoryError("INVALID_INPUT", "compact debe ser booleano.");
  const maxBytes = integer(input.maxBytes ?? 16384, "maxBytes", 1024, 65536), compact = input.compact ?? false;
  if (projectId !== null && !db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado.");
  return db.transaction(() => {
    const selection = contextSelection(db, owner);
    // Se piden 21 filas (una más que el tope de 20), pero solo se usan las 20 primeras;
    // cuántas fijadas quedan fuera sale siempre del COUNT de la línea siguiente.
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
    // Los resúmenes de sesión solo existen por proyecto (no para shared ni grupo) y solo si
    // el esquema (versión de la estructura de tablas) ya tiene sesiones.
    if (projectId !== null && sessionsEnabled) {
      const withoutEarlier=excludeKeys([...pinned,...recent],"ss.memoryId","ss.version");
      summariesAll = db.query(`SELECT m.id,m.projectId,json_extract(v.snapshot,'$.groupId') AS groupId,m.scope,m.topic_key,m.type,m.title,
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
    // Si el JSON final pesa más que maxBytes, se recorta la sección menos prioritaria
    // primero (resúmenes, luego recientes, luego pinneados) quitando un elemento a la vez
    // hasta que quepa; cada elemento quitado suma uno a "omitted" de esa sección.
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

/**
 * Busca memorias completas por texto, en el modo que corresponda a esta base (híbrido,
 * literal, con refuerzo o FTS5 simple).
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto que busca, o null.
 * @param query texto de búsqueda.
 * @param limit máximo de resultados.
 * @param scope alcance de la búsqueda.
 * @param groupId grupo explícito, si aplica.
 * @returns memorias encontradas junto con la explicación de su orden.
 */
export function search(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all", groupId?: string | null): SearchResult[] {
    const identity = projectId === null ? null : projectIdentity(projectId);
    const selection = searchSelection(db, identity, scope, groupId);
    const parsed = searchTerms(query); validateSearchLimit(limit);
    if (intelligenceEnabled(db)) return hybridRows<Row>(db, "m.*", selection, query, limit)
      .map(({ row, explanation }) => ({ memory: memory(row), explanation }));
    if (parsed.literal) {
      // El LIKE de SQLite solo pasa a minúsculas el rango ASCII. Para que términos cortos
      // con acentos u otros caracteres Unicode funcionen igual, se recorren las filas ya
      // filtradas por alcance y se comparan en JavaScript con minúsculas Unicode; se usa un
      // cursor (iterate) para no cargar un proyecto grande entero en memoria RAM.
      const folded = parsed.terms.map(term => term.toLowerCase());
      const result: SearchResult[] = [];
      // Un statement recién preparado debe cerrarse (finalize) aunque el cursor se corte antes de terminar.
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
    if (reinforcementEnabled(db)) {
      const requestTime=new Date(),now=requestTime.toISOString();
      const rows=db.query(reinforcedFtsQuery("m.*",selection)).all(requestTime.getTime(),parsed.match,...selection.args,limit) as (Row&ReinforcedSearchRow)[];
      return rows.map(row=>({memory:memory(row),explanation:reinforcedExplanation(row,now)}));
    }
    const rows = db.query(ftsQuery("m.*", selection)).all(parsed.match,...selection.args,limit) as (Row & { bm25: number; multiplier: number })[];
    return rows.map(row => ({ memory: memory(row), explanation: { mode: "fts5", bm25: row.bm25,
      multiplier: row.multiplier, orderScore: row.bm25 * row.multiplier } }));
  }

/**
 * Busca vistas previas de memorias por texto y, si la inteligencia está activa, les agrega
 * los metadatos (meta) y las marcas calculadas a partir de ellos.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto que busca, o null.
 * @param query texto de búsqueda.
 * @param limit máximo de resultados.
 * @param scope alcance de la búsqueda.
 * @param groupId grupo explícito, si aplica.
 * @returns vistas previas con su explicación de orden y, si aplica, meta y marcas.
 */
export function searchPreviews(db: Database, projectId: string | null, query: string, limit = 10, scope: SearchScope = "all", groupId?: string | null): PreviewResult[] {
    const results = readSearchPreviews(db, projectId === null ? null : projectIdentity(projectId), query, limit, scope, groupId);
    if (!intelligenceEnabled(db)) return results;
    const metas = readMetas(db, results.map(result => result.memory.id)), now = new Date().toISOString();
    return results.map(result => {
      const meta = metas.get(result.memory.id) ?? null;
      return meta === null ? result : { ...result, meta, marks: marksFor(meta, now) };
    });
  }

/**
 * Lee una versión concreta (o la más reciente) de una memoria, con sus metadatos y marcas si la
 * memoria inteligente está activa.
 * @param db conexión abierta a la base SQLite.
 * @param owner dueño al que debe pertenecer la memoria.
 * @param id identificador de la memoria.
 * @param version número de versión a leer; si se omite, se lee la más reciente.
 * @returns la versión encontrada (con meta y marks si aplica), o null si no existe para ese dueño.
 */
export function getVersion(db: Database, owner: MemoryOwner, id: string, version?: number): VersionRead | null {
    const read = readGetVersion(db, owner, id, version);
    if (read === null || !intelligenceEnabled(db)) return read;
    const meta = readMeta(db, read.memory.id);
    return meta === null ? read : { ...read, meta, marks: marksFor(meta, new Date().toISOString()) };
  }

/**
 * Lee la línea de tiempo de un proyecto: las entradas que una sesión fue guardando, en orden.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto cuya línea de tiempo se lee.
 * @param input filtros de la consulta (por ejemplo, sesión y paginación).
 * @returns la línea de tiempo resultante.
 */
export function timeline(db: Database, projectId: string, input: TimelineInput): TimelineResult {
    return readTimeline(db, sessionsEnabled(db), projectIdentity(projectId), input);
  }

/**
 * Lee el contexto que se entrega al iniciar sesión: memorias fijadas (pinneadas), recientes y sus
 * resúmenes, para el dueño indicado.
 * @param db conexión abierta a la base SQLite.
 * @param owner dueño (proyecto, shared o grupo de ecosistema) del que se arma el contexto.
 * @param input filtros opcionales de la consulta.
 * @returns el contexto resultante.
 */
export function context(db: Database, owner: MemoryOwner, input?: ContextInput): ContextResult {
    return readContext(db, sessionsEnabled(db), owner !== null && typeof owner === "object" ? owner : owner === null ? null : projectIdentity(owner), input);
  }
