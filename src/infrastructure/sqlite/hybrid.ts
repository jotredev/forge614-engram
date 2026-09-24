import type { Database } from "bun:sqlite";
import { rankingFactors,RANKING_CONTENT_WEIGHT,RANKING_TITLE_WEIGHT,RANKING_TOPIC_WEIGHT,type SearchExplanation } from "../../modules/memory";
import { buildQuery,HYBRID_CANDIDATES,matchedTerms,MIN_MATCHED_TERMS,RRF_K } from "../../modules/search";

type Selection = { sql: string; args: string[] };
type IndexRow = { id: string; bm25: number };
type CandidateRow = { id: string; title: string; content: string; topic_key: string | null; pinned: number;
  revisionCount: number; duplicateCount: number; lastSeenAt: string };
export interface HybridHit { id: string; explanation: SearchExplanation }

function indexHits(db: Database, index: "memories_words" | "memories_fts", match: string, selection: Selection): IndexRow[] {
  return db.query(`SELECT m.id AS id,bm25(${index},${RANKING_TITLE_WEIGHT},${RANKING_CONTENT_WEIGHT},${RANKING_TOPIC_WEIGHT}) AS bm25
    FROM ${index} JOIN memories m ON m.rowid=${index}.rowid
    WHERE ${index} MATCH ? AND ${selection.sql} AND m.state='active' ORDER BY bm25 ASC,m.id ASC LIMIT ?`)
    .all(match, ...selection.args, HYBRID_CANDIDATES) as IndexRow[];
}

/** Level-11 search: word and trigram indexes fused by rank, filtered by matched terms, weighted by reinforcement. */
export function hybridHits(db: Database, selection: Selection, query: string, limit: number, now = new Date().toISOString()): HybridHit[] {
  const plan = buildQuery(query);
  const fused = new Map<string, { rrf: number; bm25: number | null }>();
  const lists = [plan.words === null ? [] : indexHits(db, "memories_words", plan.words, selection),
    plan.trigram === null ? [] : indexHits(db, "memories_fts", plan.trigram, selection)];
  for (const list of lists) list.forEach((row, index) => {
    const current = fused.get(row.id) ?? { rrf: 0, bm25: null };
    fused.set(row.id, { rrf: current.rrf + 1 / (RRF_K + index + 1), bm25: current.bm25 ?? row.bm25 });
  });
  if (fused.size === 0) return [];
  const ids = [...fused.keys()];
  const rows = db.query(`SELECT m.id,m.title,m.content,m.topic_key,m.pinned,m.version-1 AS revisionCount,
      (SELECT count(*) FROM confirmations c WHERE c.memoryId=m.id) AS duplicateCount,
      max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) AS lastSeenAt
    FROM memories m WHERE m.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as CandidateRow[];
  const needed = Math.min(MIN_MATCHED_TERMS, plan.terms.length);
  return rows
    .filter(row => matchedTerms(plan.terms, `${row.title}\n${row.content}\n${row.topic_key ?? ""}`) >= needed)
    .map(row => {
      const { rrf, bm25 } = fused.get(row.id)!;
      const { multiplier, ...reinforcement } = rankingFactors({ revisionCount: row.revisionCount,
        duplicateCount: row.duplicateCount, lastSeenAt: row.lastSeenAt }, row.pinned === 1, now);
      return { id: row.id, explanation: { mode: "hybrid" as const, bm25, multiplier, orderScore: -(rrf * multiplier), reinforcement } };
    })
    .sort((a, b) => a.explanation.orderScore! - b.explanation.orderScore! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}
