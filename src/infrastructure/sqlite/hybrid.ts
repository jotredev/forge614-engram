/**
 * Búsqueda híbrida: junta los resultados del índice de palabras y del índice de trigramas (un
 * trigrama es un fragmento de tres caracteres seguidos usado para hallar coincidencias parciales),
 * los combina con la fórmula RRF (fusión recíproca de rangos, un método que junta varias listas
 * ordenadas en una sola sin necesitar que sus puntajes sean comparables) y aplica el refuerzo de
 * confirmaciones. Lo usa `search.ts` cuando la memoria inteligente está activa.
 * Piezas principales: `indexHits` (consulta cada índice), `hybridHits` (combina, filtra y ordena).
 */
import type { Database } from "bun:sqlite";
import { rankingFactors,RANKING_CONTENT_WEIGHT,RANKING_TITLE_WEIGHT,RANKING_TOPIC_WEIGHT,type SearchExplanation } from "../../modules/memory";
import { buildQuery,HYBRID_CANDIDATES,matchedTerms,MIN_MATCHED_TERMS,RRF_K } from "../../modules/search";

/** Fragmento de SQL para filtrar por alcance (scope) y dueño, con sus argumentos posicionales. */
type Selection = { sql: string; args: string[] };
/** Fila que devuelve una consulta a un índice: id de la memoria y su puntaje bm25 (fórmula estándar de relevancia de texto; más bajo es mejor coincidencia aquí). */
type IndexRow = { id: string; bm25: number };
/** Fila cruda de una memoria candidata, con los datos crudos que necesita el cálculo de refuerzo (reinforcement) antes de resumirlos en un puntaje final. */
type CandidateRow = { id: string; title: string; content: string; topic_key: string | null; pinned: number;
  revisionCount: number; duplicateCount: number; lastSeenAt: string };
/**
 * Resultado de la búsqueda híbrida para una memoria candidata.
 * `id`: identificador de la memoria encontrada.
 * `explanation`: desglose del cálculo de puntaje (modo, bm25, multiplicador, orden y refuerzo) que explica por qué apareció y en qué posición.
 */
export interface HybridHit { id: string; explanation: SearchExplanation }

/**
 * Consulta un índice de búsqueda (de palabras completas o de trigramas, un trigrama es un
 * fragmento de tres caracteres seguidos usado para hallar coincidencias parciales) y
 * devuelve los ids de memoria que calzan, ordenados por su puntaje bm25.
 * @param db conexión abierta a la base SQLite.
 * @param index tabla virtual de índice a consultar: `memories_words` (palabras) o `memories_fts` (trigramas).
 * @param match expresión de coincidencia ya armada para la cláusula MATCH del índice.
 * @param selection filtro de alcance/dueño en SQL con sus argumentos.
 * @returns hasta HYBRID_CANDIDATES filas con el id y su puntaje bm25, de mejor a peor coincidencia.
 */
function indexHits(db: Database, index: "memories_words" | "memories_fts", match: string, selection: Selection): IndexRow[] {
  return db.query(`SELECT m.id AS id,bm25(${index},${RANKING_TITLE_WEIGHT},${RANKING_CONTENT_WEIGHT},${RANKING_TOPIC_WEIGHT}) AS bm25
    FROM ${index} JOIN memories m ON m.rowid=${index}.rowid
    WHERE ${index} MATCH ? AND ${selection.sql} AND m.state='active' ORDER BY bm25 ASC,m.id ASC LIMIT ?`)
    .all(match, ...selection.args, HYBRID_CANDIDATES) as IndexRow[];
}

/**
 * Búsqueda híbrida de nivel 11 (versión de esquema): combina el índice de palabras y el de
 * trigramas fusionando su orden con RRF (Reciprocal Rank Fusion, fórmula que combina varios
 * rankings sumando el inverso de la posición de cada uno), filtra por cuántos términos de la
 * consulta aparecen realmente en el texto, y pesa el resultado con el multiplicador de
 * refuerzo (que premia memorias fijadas, revisadas, confirmadas varias veces o vistas hace poco).
 * @param db conexión abierta a la base SQLite.
 * @param selection filtro de alcance/dueño en SQL con sus argumentos.
 * @param query texto de búsqueda en lenguaje natural escrito por la persona.
 * @param limit cuántos resultados devolver como máximo.
 * @param now instante usado para calcular el refuerzo por recencia; por defecto, el momento actual.
 * @returns hasta `limit` resultados ordenados del mejor al peor, cada uno con su explicación de puntaje.
 */
export function hybridHits(db: Database, selection: Selection, query: string, limit: number, now = new Date().toISOString()): HybridHit[] {
  // Convierte el texto libre en un plan de consulta: qué buscar por palabras, qué por trigramas y la lista de términos a exigir.
  const plan = buildQuery(query);
  // Mapa id de memoria -> puntaje RRF acumulado y el primer bm25 visto (para mostrarlo luego en la explicación).
  const fused = new Map<string, { rrf: number; bm25: number | null }>();
  // Consulta cada índice solo si el plan generó una expresión de coincidencia para él; si no, no aporta candidatos.
  const lists = [plan.words === null ? [] : indexHits(db, "memories_words", plan.words, selection),
    plan.trigram === null ? [] : indexHits(db, "memories_fts", plan.trigram, selection)];
  // Recorre cada lista de resultados (palabras y luego trigramas) sumando su aporte de RRF por posición.
  for (const list of lists) list.forEach((row, index) => {
    // RRF sube cuanto mejor es el rank, es decir cuanto más chico es `index` (0 = primer lugar).
    const current = fused.get(row.id) ?? { rrf: 0, bm25: null };
    fused.set(row.id, { rrf: current.rrf + 1 / (RRF_K + index + 1), bm25: current.bm25 ?? row.bm25 });
  });
  // Ningún índice encontró candidatos: no hay nada que puntuar ni devolver.
  if (fused.size === 0) return [];
  // Ids únicos que pasaron el primer filtro, para traer sus datos completos de una sola vez.
  const ids = [...fused.keys()];
  // Trae título, contenido y las señales de refuerzo (revisiones, confirmaciones de duplicado y última vez vista) de cada candidato.
  const rows = db.query(`SELECT m.id,m.title,m.content,m.topic_key,m.pinned,m.version-1 AS revisionCount,
      (SELECT count(*) FROM confirmations c WHERE c.memoryId=m.id) AS duplicateCount,
      max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) AS lastSeenAt
    FROM memories m WHERE m.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as CandidateRow[];
  // Exige como mínimo MIN_MATCHED_TERMS términos coincidentes, pero nunca más de los que realmente tiene la consulta.
  const needed = Math.min(MIN_MATCHED_TERMS, plan.terms.length);
  return rows
    // Descarta candidatos que no repiten suficientes términos de la consulta en título, contenido o clave de tema (topic_key).
    .filter(row => matchedTerms(plan.terms, `${row.title}\n${row.content}\n${row.topic_key ?? ""}`) >= needed)
    .map(row => {
      const { rrf, bm25 } = fused.get(row.id)!;
      // Calcula el multiplicador de refuerzo y separa sus componentes (revisión, duplicado, recencia, fijado) para poder explicarlos.
      const { multiplier, ...reinforcement } = rankingFactors({ revisionCount: row.revisionCount,
        duplicateCount: row.duplicateCount, lastSeenAt: row.lastSeenAt }, row.pinned === 1, now);
      // El orden final es RRF por multiplicador, en negativo, para que ordenar ascendente equivalga a "mejor primero".
      return { id: row.id, explanation: { mode: "hybrid" as const, bm25, multiplier, orderScore: -(rrf * multiplier), reinforcement } };
    })
    // Empata por id (orden estable) cuando dos resultados quedan con el mismo puntaje.
    .sort((a, b) => a.explanation.orderScore! - b.explanation.orderScore! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
