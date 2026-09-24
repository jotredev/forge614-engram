import type { Database } from "bun:sqlite";
import type { MemoryMeta } from "../../modules/memory";

type MetaRow = { memory_id: string; short: string | null; review_after: string | null; superseded_by: string | null; affects: string | null };

function fromRow(row: MetaRow): MemoryMeta {
  return { short: row.short, reviewAfter: row.review_after, supersededBy: row.superseded_by, affects: row.affects === null ? null : JSON.parse(row.affects) as string[] };
}

export function readMeta(db: Database, memoryId: string): MemoryMeta | null {
  const row = db.query("SELECT * FROM memory_meta WHERE memory_id=?").get(memoryId) as MetaRow | null;
  return row ? fromRow(row) : null;
}

export function readMetas(db: Database, ids: readonly string[]): Map<string, MemoryMeta> {
  const result = new Map<string, MemoryMeta>();
  if (ids.length === 0) return result;
  const rows = db.query(`SELECT * FROM memory_meta WHERE memory_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as MetaRow[];
  for (const row of rows) result.set(row.memory_id, fromRow(row));
  return result;
}

/** Merge a patch into the memory's metadata row, creating it when missing. */
export function upsertMeta(db: Database, memoryId: string, patch: Partial<MemoryMeta>, now: string): void {
  const current = readMeta(db, memoryId) ?? { short: null, reviewAfter: null, supersededBy: null, affects: null };
  const next = { ...current, ...patch };
  db.query(`INSERT INTO memory_meta(memory_id,short,review_after,superseded_by,affects,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(memory_id) DO UPDATE SET short=excluded.short,review_after=excluded.review_after,
    superseded_by=excluded.superseded_by,affects=excluded.affects,updated_at=excluded.updated_at`)
    .run(memoryId, next.short, next.reviewAfter, next.supersededBy, next.affects === null ? null : JSON.stringify(next.affects), now);
}
