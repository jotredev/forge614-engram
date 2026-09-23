import type { Database } from "bun:sqlite";
import { groupIdentity } from "../../modules/ecosystem";
import { type Memory,type MemoryOwner,type MemoryVersion } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { requireEcosystem } from "./ecosystem-groups";

export interface Row {
  id: string; projectId: string | null; scope: Memory["scope"]; topic_key: string | null; type: Memory["type"];
  title: string; content: string; pinned: number; version: number;
  state: Memory["state"]; created_at: string; updated_at: string; groupId?: string | null;
}
export function memory(row: Row): Memory {
  return { id: row.id, projectId: row.projectId, scope: row.scope, topicKey: row.topic_key, type: row.type,
    title: row.title, content: row.content, pinned: row.pinned === 1,
    version: row.version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.scope === "ecosystem" && row.groupId ? { groupId: row.groupId } : {}) };
}
/** SQL that selects the memories of one owner: a project, shared (null) or an ecosystem group. */
export function ownerClause(db: Database, owner: MemoryOwner, alias = "m."): { sql: string; args: string[] } {
  if (owner !== null && typeof owner === "object") {
    requireEcosystem(db);
    return { sql: `${alias}scope='ecosystem' AND ${alias}groupId=?`, args: [groupIdentity(owner.groupId)] };
  }
  if (owner === null) return { sql: `${alias}scope='shared'`, args: [] };
  return { sql: `${alias}scope='project' AND ${alias}projectId=?`, args: [projectIdentity(owner)] };
}
export function owner(projectId: string | null): string | null {
  return projectId === null ? null : projectIdentity(projectId);
}
export function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);
  }
  return value.trim();
}

export function get(db: Database, owner: MemoryOwner, id: string): Memory | null {
    const clause = ownerClause(db, owner);
    const row = db.query(`SELECT * FROM memories m WHERE ${clause.sql} AND m.id=?`).get(...clause.args,required(id,"id")) as Row | null;
    return row ? memory(row) : null;
  }

export function getByTopic(db: Database, owner: MemoryOwner, topicKey: string): Memory | null {
    const clause = ownerClause(db, owner);
    const row = db.query(`SELECT * FROM memories m WHERE ${clause.sql} AND m.topic_key=?`).get(...clause.args,required(topicKey,"topicKey")) as Row | null;
    return row ? memory(row) : null;
  }

export function history(db: Database, owner: MemoryOwner, id: string): MemoryVersion[] {
    const clause = ownerClause(db, owner);
    const rows = db.query(`SELECT v.snapshot FROM memory_versions v JOIN memories m ON m.id=v.memory_id WHERE ${clause.sql} AND m.id=? ORDER BY v.version`)
      .all(...clause.args,required(id,"id")) as { snapshot: string }[];
    return rows.map(row => JSON.parse(row.snapshot) as MemoryVersion);
  }
