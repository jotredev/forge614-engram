import type { Database } from "bun:sqlite";
import { ECOSYSTEM_STATUS_TOPIC } from "../../modules/ecosystem";
import { marksFor } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { renderStartupBlock, type StartupBlock, type StartupItem } from "../../modules/search";
import { previousInterrupted } from "./activity";
import { groupOfProject } from "./ecosystem-groups";
import { intelligenceEnabled } from "./intelligence";
import { readMetas } from "./meta";

// More candidates than any block can show; the counts below still cover every candidate.
const CANDIDATES = 200;
type Row = { id: string; scope: StartupItem["scope"]; title: string };

/**
 * The startup block (format 2) for a project, or for an unbound directory when `projectId` is null. Read-only.
 * Essentials: active pinned memories (shared, then the group's board with its status note first, then the project).
 * Index: active unpinned memories of the board and the project, alternating one of each (newest first within each),
 * so neither drawer can crowd the other out; session summaries are left out.
 * At level 11 superseded memories are left out, `short` replaces the title in essentials and an interrupted
 * previous session is included; below level 11 the block is built from the same sources without those extras.
 */
export function startupBlock(db: Database, projectId: string | null, now: string = new Date().toISOString()): StartupBlock {
  const project = projectId === null ? null : projectIdentity(projectId);
  return db.transaction(() => {
    const groupId = project === null ? null : groupOfProject(db, project)?.group.id ?? null;
    const intelligence = intelligenceEnabled(db);
    const owners: string[] = [], args: string[] = [];
    // Board first: the index alternates in this order.
    if (groupId !== null) { owners.push("(m.scope='ecosystem' AND m.groupId=?)"); args.push(groupId); }
    if (project !== null) { owners.push("(m.scope='project' AND m.projectId=?)"); args.push(project); }
    const live = `m.state='active'${intelligence ? " AND NOT EXISTS (SELECT 1 FROM memory_meta mm WHERE mm.memory_id=m.id AND mm.superseded_by IS NOT NULL)" : ""}`;
    // A project memory on the same topic hides the shared one, as in context().
    const shared = project === null ? { sql: "m.scope='shared'", args: [] as string[] }
      : { sql: "(m.scope='shared' AND NOT EXISTS (SELECT 1 FROM memories p WHERE p.projectId=? AND p.scope='project' AND p.state='active' AND p.topic_key=m.topic_key))", args: [project] };
    const pinnedFrom = `FROM memories m WHERE ${live} AND m.pinned=1 AND (${[shared.sql, ...owners].join(" OR ")})`;
    const essentials = db.query(`SELECT m.id,m.scope,m.title ${pinnedFrom}
      ORDER BY CASE m.scope WHEN 'shared' THEN 0 WHEN 'ecosystem' THEN 1 ELSE 2 END,m.topic_key IS ? DESC,m.updated_at DESC,m.id ASC LIMIT ${CANDIDATES}`)
      .all(...shared.args, ...args, ECOSYSTEM_STATUS_TOPIC) as Row[];
    const essentialsTotal = (db.query(`SELECT count(*) AS n ${pinnedFrom}`).get(...shared.args, ...args) as { n: number }).n;
    const drawers = owners.map((owner, n) => {
      const from = `FROM memories m WHERE ${live} AND m.pinned=0 AND (m.topic_key IS NULL OR m.topic_key NOT GLOB 'session/*/summary') AND ${owner}`;
      return { rows: db.query(`SELECT m.id,m.scope,m.title ${from} ORDER BY m.updated_at DESC,m.id ASC LIMIT ${CANDIDATES}`).all(args[n]!) as Row[],
        total: (db.query(`SELECT count(*) AS n ${from}`).get(args[n]!) as { n: number }).n };
    });
    const index: Row[] = [];
    for (let n = 0; n < CANDIDATES; n++) for (const drawer of drawers) if (drawer.rows[n]) index.push(drawer.rows[n]!);
    const indexTotal = drawers.reduce((sum, drawer) => sum + drawer.total, 0);
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
