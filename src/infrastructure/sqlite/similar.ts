/**
 * Busca "parecidos" (memorias que comparten palabras con un texto dado, calculado con
 * una fórmula de similitud, no con búsqueda de texto completo) para avisar de posibles
 * duplicados al guardar.
 */
import type { Database } from "bun:sqlite";
import type { MemoryScope,SimilarCandidate } from "../../modules/memory";
import { buildQuery,HYBRID_CANDIDATES,similarity,SIMILAR_LIMIT,SIMILAR_MIN_SCORE,termsOf } from "../../modules/search";

/** Fila cruda que devuelve la consulta SQL antes de calcularle el puntaje de similitud. */
type CandidateRow = { id: string; title: string; content: string; version: number };

/**
 * Busca memorias activas del mismo alcance (scope) y dueño cuyas palabras se parezcan al
 * título y contenido dados; excluye la propia memoria y los resúmenes de sesión.
 * @param db conexión abierta a la base SQLite.
 * @param input alcance, columna de dueño (proyecto o grupo) y valor de esa columna, título
 *   y contenido a comparar, y el id que debe quedar fuera del resultado.
 * @returns hasta `SIMILAR_LIMIT` candidatos ordenados de más a menos parecidos, con puntaje
 *   `>= SIMILAR_MIN_SCORE`.
 */
export function similarTo(db: Database, input: { scope: MemoryScope; ownerColumn: "projectId" | "groupId"; ownerId: string | null;
    title: string; content: string; excludeId: string }): SimilarCandidate[] {
  const text = `${input.title}\n${input.content}`, plan = buildQuery(text);
  // Sin palabras utilizables (por ejemplo, texto vacío o solo símbolos) no hay nada que comparar.
  if (plan.words === null) return [];
  // Primer filtro barato en SQL: candidatos que comparten al menos una palabra, ordenados por
  // relevancia de FTS5 (bm25) para no traer más de HYBRID_CANDIDATES filas a memoria.
  const rows = db.query(`SELECT m.id,m.title,m.content,m.version FROM memories_words JOIN memories m ON m.rowid=memories_words.rowid
    WHERE memories_words MATCH ? AND m.scope=? AND m.${input.ownerColumn} IS ? AND m.state='active' AND m.id<>?
    AND (m.topic_key IS NULL OR m.topic_key NOT GLOB 'session/*/summary')
    ORDER BY bm25(memories_words) ASC,m.id ASC LIMIT ?`)
    .all(plan.words, input.scope, input.ownerId, input.excludeId, HYBRID_CANDIDATES) as CandidateRow[];
  const mine = termsOf(text);
  // Segundo filtro, ya en memoria: calcula el puntaje real de similitud, descarta lo que
  // queda por debajo del mínimo, ordena de mayor a menor puntaje (con el id como desempate
  // estable) y se queda solo con los primeros SIMILAR_LIMIT.
  return rows
    .map(row => ({ id: row.id, title: row.title, version: row.version, score: similarity(mine, termsOf(`${row.title}\n${row.content}`)) }))
    .filter(candidate => candidate.score >= SIMILAR_MIN_SCORE)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, SIMILAR_LIMIT);
}
