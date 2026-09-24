import type { Database } from "bun:sqlite";
import type { MemoryScope,SimilarCandidate } from "../../modules/memory";
import { buildQuery,HYBRID_CANDIDATES,similarity,SIMILAR_LIMIT,SIMILAR_MIN_SCORE,termsOf } from "../../modules/search";

type CandidateRow = { id: string; title: string; content: string; version: number };

/** Active memories of the same scope and owner whose words look like the given text; session summaries excluded. */
export function similarTo(db: Database, input: { scope: MemoryScope; ownerColumn: "projectId" | "groupId"; ownerId: string | null;
    title: string; content: string; excludeId: string }): SimilarCandidate[] {
  const text = `${input.title}\n${input.content}`, plan = buildQuery(text);
  if (plan.words === null) return [];
  const rows = db.query(`SELECT m.id,m.title,m.content,m.version FROM memories_words JOIN memories m ON m.rowid=memories_words.rowid
    WHERE memories_words MATCH ? AND m.scope=? AND m.${input.ownerColumn} IS ? AND m.state='active' AND m.id<>?
    AND (m.topic_key IS NULL OR m.topic_key NOT GLOB 'session/*/summary')
    ORDER BY bm25(memories_words) ASC,m.id ASC LIMIT ?`)
    .all(plan.words, input.scope, input.ownerId, input.excludeId, HYBRID_CANDIDATES) as CandidateRow[];
  const mine = termsOf(text);
  return rows
    .map(row => ({ id: row.id, title: row.title, version: row.version, score: similarity(mine, termsOf(`${row.title}\n${row.content}`)) }))
    .filter(candidate => candidate.score >= SIMILAR_MIN_SCORE)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, SIMILAR_LIMIT);
}
