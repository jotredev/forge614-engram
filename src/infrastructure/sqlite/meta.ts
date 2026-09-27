/**
 * Acceso a la tabla `memory_meta`: guarda y lee la metadata (metadatos, datos sobre la memoria que
 * no forman parte de su contenido) que vive fuera de las versiones de una memoria, como su resumen
 * corto (short), la fecha en que debe revisarse de nuevo (reviewAfter), qué memoria la reemplaza
 * (supersededBy) y a qué proyectos afecta (affects). Existe desde el nivel de esquema 11
 * (intelligence, "inteligencia") y lo usan writes.ts y search.ts para leer o actualizar esos datos
 * cuando se guarda o se consulta una memoria.
 * Piezas principales: MetaRow (forma de una fila de la tabla), fromRow() (fila -> MemoryMeta) y
 * readMeta()/readMetas()/upsertMeta() (las operaciones expuestas).
 */
import type { Database } from "bun:sqlite";
import type { MemoryMeta } from "../../modules/memory";

/** Forma exacta de una fila de la tabla `memory_meta` tal como la entrega SQLite: `memory_id`
 * (identificador de la memoria dueña), `short` (resumen corto, o null si no tiene), `review_after`
 * (fecha de revisión, o null si nunca vence), `superseded_by` (id de la memoria que la reemplazó, o
 * null) y `affects` (lista de proyectos afectados, guardada como texto JSON, o null). */
type MetaRow = { memory_id: string; short: string | null; review_after: string | null; superseded_by: string | null; affects: string | null };

/**
 * Convierte una fila cruda de la tabla (MetaRow) al objeto de dominio MemoryMeta, decodificando
 * `affects` de su forma JSON de vuelta a una lista de textos.
 * @param row fila leída de la tabla `memory_meta`.
 * @returns la metadata en su forma de dominio.
 */
function fromRow(row: MetaRow): MemoryMeta {
  return { short: row.short, reviewAfter: row.review_after, supersededBy: row.superseded_by, affects: row.affects === null ? null : JSON.parse(row.affects) as string[] };
}

/**
 * Lee la metadata de una sola memoria.
 * @param db base de datos SQLite abierta.
 * @param memoryId id de la memoria.
 * @returns la metadata, o null si la memoria no tiene ninguna fila de metadata todavía.
 */
export function readMeta(db: Database, memoryId: string): MemoryMeta | null {
  const row = db.query("SELECT * FROM memory_meta WHERE memory_id=?").get(memoryId) as MetaRow | null;
  return row ? fromRow(row) : null;
}

/**
 * Lee la metadata de varias memorias a la vez, en una sola consulta.
 * @param db base de datos SQLite abierta.
 * @param ids ids de las memorias a consultar.
 * @returns un mapa de id de memoria a su metadata; las memorias sin metadata simplemente no
 * aparecen en el mapa.
 */
export function readMetas(db: Database, ids: readonly string[]): Map<string, MemoryMeta> {
  const result = new Map<string, MemoryMeta>();
  // Sin ids no hay nada que consultar, y una consulta SQL con una lista vacía sería inválida.
  if (ids.length === 0) return result;
  // Arma un signo de interrogación "?" por cada id, para la cláusula IN(...) de la consulta.
  const rows = db.query(`SELECT * FROM memory_meta WHERE memory_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as MetaRow[];
  for (const row of rows) result.set(row.memory_id, fromRow(row));
  return result;
}

/**
 * Combina (merge) un parche (patch, los campos que cambian) sobre la metadata ya guardada de una
 * memoria, creando la fila si todavía no existía. Los campos que no vienen en el parche conservan
 * su valor anterior.
 * @param db base de datos SQLite abierta.
 * @param memoryId id de la memoria dueña de la metadata.
 * @param patch campos a cambiar; los que falten se dejan como estaban.
 * @param now marca de tiempo (timestamp) a grabar como fecha de última actualización.
 */
export function upsertMeta(db: Database, memoryId: string, patch: Partial<MemoryMeta>, now: string): void {
  // Si no había metadata todavía, se parte de una fila "vacía" con todo en null.
  const current = readMeta(db, memoryId) ?? { short: null, reviewAfter: null, supersededBy: null, affects: null };
  // El parche se combina sobre lo anterior: lo que no viene en patch conserva su valor previo.
  const next = { ...current, ...patch };
  // INSERT con ON CONFLICT: si la fila ya existía (mismo memory_id) se actualiza en vez de duplicarse.
  db.query(`INSERT INTO memory_meta(memory_id,short,review_after,superseded_by,affects,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(memory_id) DO UPDATE SET short=excluded.short,review_after=excluded.review_after,
    superseded_by=excluded.superseded_by,affects=excluded.affects,updated_at=excluded.updated_at`)
    .run(memoryId, next.short, next.reviewAfter, next.supersededBy, next.affects === null ? null : JSON.stringify(next.affects), now);
}
