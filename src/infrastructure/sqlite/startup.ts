/**
 * Bloque de arranque (startup block) de una sesión: arma el resumen de memorias que se muestra al empezar
 * a trabajar en un proyecto, o en una carpeta sin proyecto ligado cuando `projectId` es null. Lo arma
 * `startupBlock`, que junta las memorias esenciales (fijadas/pinned), el índice (memorias sin fijar) y el
 * aviso de sesión previa interrumpida, y delega el texto final en `renderStartupBlock` del módulo `search`.
 * Es de solo lectura: no cambia nada en la base de datos.
 */
import type { Database } from "bun:sqlite";
import { ECOSYSTEM_STATUS_TOPIC } from "../../modules/ecosystem";
import { marksFor } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { renderStartupBlock, type StartupBlock, type StartupItem } from "../../modules/search";
import { previousInterrupted } from "./activity";
import { groupOfProject } from "./ecosystem-groups";
import { intelligenceEnabled } from "./intelligence";
import { readMetas } from "./meta";

// Hay más candidatas de las que cualquier bloque puede mostrar; los conteos de abajo igual cubren a todas.
const CANDIDATES = 200;
/** Una fila mínima de memoria (identificador, ámbito/scope y título) tal como sale de las consultas SQL de este archivo. */
type Row = { id: string; scope: StartupItem["scope"]; title: string };

/**
 * Arma el bloque de arranque (formato 2) de un proyecto, o de una carpeta sin proyecto ligado cuando
 * `projectId` es null. Es de solo lectura.
 * Esenciales: memorias fijadas (pinned) activas (primero las compartidas, luego el tablero (board) del
 * grupo con su nota de estado primero, y después las del proyecto).
 * Índice: memorias sin fijar activas del tablero y del proyecto, alternando una de cada uno (de la más
 * reciente a la más antigua dentro de cada uno), para que ninguno de los dos cajones (drawers) se coma el
 * espacio del otro; los resúmenes de sesión quedan fuera.
 * En nivel 11 las memorias sustituidas (superseded) quedan fuera, `short` reemplaza el título en esenciales
 * y se incluye la sesión previa dejada abierta por PARALLEL_MINUTES o más; por debajo de nivel 11 el bloque
 * se arma con las mismas fuentes pero sin esos extras.
 * El bloque nunca lista sesiones abiertas ahora mismo en paralelo: se arma antes de que exista la sesión
 * nueva (todavía no hay nada con qué comparar la actividad) y se vuelve a inyectar después de la
 * compactación, donde una línea de "en paralelo" solo nombraría a la sesión actual; memory_session_start
 * informa las sesiones en paralelo por separado (1.7.1).
 * @param db Conexión abierta a la base SQLite.
 * @param projectId Identificador del proyecto, o null para una carpeta sin proyecto ligado.
 * @param now Marca de tiempo ISO usada para decidir qué cuenta como sesión previa interrumpida; por defecto, el momento actual.
 * @returns El bloque de arranque ya renderizado (texto, secciones y conteos).
 */
export function startupBlock(db: Database, projectId: string | null, now: string = new Date().toISOString()): StartupBlock {
  const project = projectId === null ? null : projectIdentity(projectId);
  // .deferred() (al final de la llamada) abre la transacción sin tomar el candado de escritura;
  // aquí solo se lee, así que nunca hace falta tomarlo.
  return db.transaction(() => {
    const groupId = project === null ? null : groupOfProject(db, project)?.group.id ?? null;
    const intelligence = intelligenceEnabled(db);
    const owners: string[] = [], args: string[] = [];
    // El tablero (board) va primero: el índice alterna respetando este mismo orden.
    if (groupId !== null) { owners.push("(m.scope='ecosystem' AND m.groupId=?)"); args.push(groupId); }
    if (project !== null) { owners.push("(m.scope='project' AND m.projectId=?)"); args.push(project); }
    // Una memoria cuenta como "viva" si está activa y, con inteligencia (intelligence) encendida, si
    // ninguna otra la sustituyó (no tiene superseded_by en memory_meta).
    const live = `m.state='active'${intelligence ? " AND NOT EXISTS (SELECT 1 FROM memory_meta mm WHERE mm.memory_id=m.id AND mm.superseded_by IS NOT NULL)" : ""}`;
    // Una memoria de proyecto sobre el mismo tema oculta a la compartida (shared), igual que en context().
    const shared = project === null ? { sql: "m.scope='shared'", args: [] as string[] }
      : { sql: "(m.scope='shared' AND NOT EXISTS (SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key))", args: [project] };
    const pinnedFrom = `FROM memories m WHERE ${live} AND m.pinned=1 AND (${[shared.sql, ...owners].join(" OR ")})`;
    // Orden: compartida primero, luego ecosistema, luego el resto; dentro del grupo ecosistema, la nota
    // de estado (ECOSYSTEM_STATUS_TOPIC) se antepone; después, la más reciente primero.
    const essentials = db.query(`SELECT m.id,m.scope,m.title ${pinnedFrom}
      ORDER BY CASE m.scope WHEN 'shared' THEN 0 WHEN 'ecosystem' THEN 1 ELSE 2 END,m.topic_key IS ? DESC,m.updated_at DESC,m.id ASC LIMIT ${CANDIDATES}`)
      .all(...shared.args, ...args, ECOSYSTEM_STATUS_TOPIC) as Row[];
    // Cuenta cuántas esenciales hay en total, aunque solo se hayan traído CANDIDATES filas arriba.
    const essentialsTotal = (db.query(`SELECT count(*) AS n ${pinnedFrom}`).get(...shared.args, ...args) as { n: number }).n;
    const drawers = owners.map((owner, n) => {
      // Cada cajón (drawer) es el conjunto de memorias sin fijar de un dueño (tablero o proyecto),
      // dejando fuera los resúmenes de sesión (topic_key con forma session/*/summary).
      const from = `FROM memories m WHERE ${live} AND m.pinned=0 AND (m.topic_key IS NULL OR m.topic_key NOT GLOB 'session/*/summary') AND ${owner}`;
      return { rows: db.query(`SELECT m.id,m.scope,m.title ${from} ORDER BY m.updated_at DESC,m.id ASC LIMIT ${CANDIDATES}`).all(args[n]!) as Row[],
        total: (db.query(`SELECT count(*) AS n ${from}`).get(args[n]!) as { n: number }).n };
    });
    const index: Row[] = [];
    // Alterna una fila de cada cajón (tablero, luego proyecto) hasta agotar el más largo, para que ninguno
    // acapare todo el índice.
    for (let n = 0; n < CANDIDATES; n++) for (const drawer of drawers) if (drawer.rows[n]) index.push(drawer.rows[n]!);
    const indexTotal = drawers.reduce((sum, drawer) => sum + drawer.total, 0);
    // Los metadatos (short, marcas de vigencia) solo se calculan con la inteligencia encendida; si no,
    // el bloque usa el título completo y sin marcas.
    const metas = intelligence ? readMetas(db, [...essentials, ...index].map(row => row.id)) : new Map();
    const item = (row: Row): StartupItem => {
      const meta = metas.get(row.id) ?? null;
      return { id: row.id, scope: row.scope, title: row.title, short: meta?.short ?? null, marks: marksFor(meta, now) };
    };
    const previous = project === null ? null : previousInterrupted(db, project, now);
    return renderStartupBlock({
      essentials: essentials.map(item), essentialsTotal,
      previous: previous === null ? null : { sessionId: previous.sessionId, interruptedAt: previous.interruptedAt,
        summary: previous.summary === null ? null : { id: previous.summary.id, version: previous.summary.version, content: previous.summary.content } },
      index: index.map(item), indexTotal,
    });
  }).deferred();
}
