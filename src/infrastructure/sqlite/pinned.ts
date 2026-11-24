import type { Database } from "bun:sqlite";
import { ECOSYSTEM_STATUS_TOPIC } from "../../modules/ecosystem";
import { marksFor } from "../../modules/memory";
import { PINNED_SCOPES, pinnedReservedCount, pinnedText, type PinnedScope, type StartupItem } from "../../modules/search";
import { MemoryError } from "../../shared/errors";
import { intelligenceEnabled } from "./intelligence";
import { readMetas } from "./meta";

export interface PinnedView {
  projectId: string | null;
  groupId: string | null;
  scope?: PinnedScope;
}

export interface PinnedPageOptions { cursor?: number; maxBytes?: number }
const PAGE_SIZE = 50;

/** Lee fijadas activas y visibles. Pasar el proyecto permite ocultar temas personales que este reemplaza. */
export function readPinned(db: Database, view: PinnedView, limit: number, offset = 0, now = new Date().toISOString()): { items: StartupItem[]; total: number } {
  const intelligence = intelligenceEnabled(db);
  const owners: string[] = [];
  const args: string[] = [];
  for (const scope of view.scope ? [view.scope] : PINNED_SCOPES) {
    if (scope === "shared") {
      owners.push(view.projectId === null ? "m.scope='shared'" : `(m.scope='shared' AND NOT EXISTS (
        SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key))`);
      if (view.projectId !== null) args.push(view.projectId);
    } else {
      const owner = scope === "project" ? view.projectId : view.groupId;
      if (owner === null) continue;
      owners.push(scope === "project" ? "(m.scope='project' AND m.projectId=?)" : "(m.scope='ecosystem' AND m.groupId=?)");
      args.push(owner);
    }
  }
  if (!owners.length) return { items: [], total: 0 };
  const live = intelligence ? "AND NOT EXISTS (SELECT 1 FROM memory_meta mm WHERE mm.memory_id=m.id AND mm.superseded_by IS NOT NULL)" : "";
  const from = `FROM memories m WHERE m.state='active' AND m.pinned=1 ${live} AND (${owners.join(" OR ")})`;
  const rows = db.query(`SELECT m.id,m.scope,m.title ${from}
    ORDER BY CASE m.scope WHEN 'project' THEN 0 WHEN 'ecosystem' THEN 1 ELSE 2 END,
    (m.scope='ecosystem' AND m.topic_key IS ?) DESC,m.updated_at DESC,m.id ASC LIMIT ? OFFSET ?`)
    .all(...args, ECOSYSTEM_STATUS_TOPIC, limit, offset) as Pick<StartupItem, "id" | "scope" | "title">[];
  const total = (db.query(`SELECT count(*) AS n ${from}`).get(...args) as { n: number }).n;
  const metas = intelligence ? readMetas(db, rows.map(row => row.id)) : new Map();
  return { total, items: rows.map(row => {
    const meta = metas.get(row.id) ?? null;
    return { ...row, short: meta?.short ?? null, marks: marksFor(meta, now) };
  }) };
}

/** El resultado completo, incluidas las notas, debe caber en el presupuesto pedido. */
export function readPinnedPage(db: Database, view: PinnedView, { cursor = 0, maxBytes = 16384 }: PinnedPageOptions, notes: object) {
  return db.transaction(() => {
    const { items, total } = readPinned(db, view, PAGE_SIZE, cursor);
    const pinned = items.map(item => ({ id: item.id, scope: item.scope, short: pinnedText(item), marks: item.marks }));
    for (;;) {
      const next = cursor + pinned.length;
      const result = { ...notes, format: 1 as const, pinned, total, nextCursor: next < total ? next : null };
      if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes && (pinned.length > 0 || next >= total)) return result;
      if (pinned.length <= 1) throw new MemoryError("INVALID_INPUT", "maxBytes no alcanza para devolver la siguiente fijada. Amplía el límite.");
      pinned.pop();
    }
  }).deferred();
}

export function countPinsOutsideReservation(db: Database, view: PinnedView & { scope: PinnedScope }): number {
  const { total, items } = readPinned(db, view, PAGE_SIZE);
  return total - pinnedReservedCount(items, view.scope);
}
