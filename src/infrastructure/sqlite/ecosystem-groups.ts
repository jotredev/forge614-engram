import type { Database } from "bun:sqlite";
import { FORGE614_GROUP_NAME,declaredGroupId,groupIdentity,groupName,type Group,type GroupSummary,type IdentityEvent,type MembershipSource,type ProjectGroup } from "../../modules/ecosystem";
import { projectIdentity } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { schemaFeatures } from "./schema";

export function ecosystemEnabled(db: Database): boolean { return schemaFeatures(db)?.ecosystem === true; }
export function requireEcosystem(db: Database): void {
  if (!ecosystemEnabled(db)) throw new MemoryError("MIGRATION_REQUIRED", "Habilita el ámbito ecosystem con group-create o init para usar grupos.");
}
// Composite operations join the caller's transaction when there is one.
function atomic<T>(db: Database, operation: () => T): T { return db.inTransaction ? operation() : db.transaction(operation).immediate(); }

export function recordIdentityEvent(db: Database, event: { action: string; projectId?: string | null; groupId?: string | null;
    previousGroupId?: string | null; previousProjectId?: string | null; memoryId?: string | null; directory?: string | null }): void {
  db.query(`INSERT INTO identity_events(action,projectId,groupId,previousGroupId,previousProjectId,memoryId,directory,createdAt)
    VALUES(?,?,?,?,?,?,?,?)`).run(event.action, event.projectId ?? null, event.groupId ?? null, event.previousGroupId ?? null,
    event.previousProjectId ?? null, event.memoryId ?? null, event.directory ?? null, new Date().toISOString());
}

export function identityEvents(db: Database, projectId?: string): IdentityEvent[] {
  requireEcosystem(db);
  return (projectId === undefined
    ? db.query("SELECT * FROM identity_events ORDER BY id").all()
    : db.query("SELECT * FROM identity_events WHERE projectId=? ORDER BY id").all(projectId)) as IdentityEvent[];
}

export function getGroup(db: Database, id: string): Group | null {
  if (!ecosystemEnabled(db)) return null;
  return db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE id=?").get(groupIdentity(id)) as Group | null;
}
export function findGroupsByName(db: Database, name: string): Group[] {
  if (!ecosystemEnabled(db)) return [];
  return db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE name=? ORDER BY createdAt,id").all(groupName(name)) as Group[];
}

export function createGroup(db: Database, name: string): Group {
  const label = groupName(name);
  requireEcosystem(db);
  return atomic(db, () => {
    if (findGroupsByName(db, label).length > 0) throw new MemoryError("GROUP_EXISTS", "Ya existe un grupo con ese nombre.");
    // The name every Forge614 node declares keeps one identity on every machine.
    const id = label === FORGE614_GROUP_NAME ? declaredGroupId(label) : crypto.randomUUID();
    const group: Group = { id, name: label, createdAt: new Date().toISOString() };
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run(group.id, group.name, group.createdAt);
    recordIdentityEvent(db, { action: "GROUP_CREATED", groupId: group.id });
    return group;
  });
}

/** Registers a group that arrives with its own identity (a clone or a node file). Identity wins over name. */
export function ensureGroup(db: Database, id: string, name: string): { group: Group; created: boolean } {
  const identity = groupIdentity(id), label = groupName(name);
  requireEcosystem(db);
  return atomic(db, () => {
    const existing = getGroup(db, identity);
    if (existing) return { group: existing, created: false };
    const group: Group = { id: identity, name: label, createdAt: new Date().toISOString() };
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run(group.id, group.name, group.createdAt);
    recordIdentityEvent(db, { action: "GROUP_CREATED", groupId: group.id });
    return { group, created: true };
  });
}

export function renameGroup(db: Database, id: string, name: string): Group {
  const identity = groupIdentity(id), label = groupName(name);
  requireEcosystem(db);
  return atomic(db, () => {
    const current = getGroup(db, identity);
    if (!current) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    if (current.name === label) return current;
    db.query("UPDATE ecosystem_groups SET name=? WHERE id=?").run(label, identity);
    recordIdentityEvent(db, { action: "GROUP_RENAMED", groupId: identity });
    return { ...current, name: label };
  });
}

export function listGroups(db: Database): GroupSummary[] {
  if (!ecosystemEnabled(db)) return [];
  return db.transaction(() => {
    const groups = db.query("SELECT id,name,createdAt FROM ecosystem_groups ORDER BY name,createdAt,id").all() as Group[];
    const members = db.query(`SELECT m.groupId,p.projectId,p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId
      ORDER BY p.name,p.projectId`).all() as { groupId: string; projectId: string; name: string }[];
    return groups.map(group => ({ ...group, projects: members.filter(member => member.groupId === group.id).map(({ projectId, name }) => ({ projectId, name })) }));
  }).deferred();
}

export function groupOfProject(db: Database, projectId: string): ProjectGroup | null {
  if (!ecosystemEnabled(db)) return null;
  const row = db.query(`SELECT g.id,g.name,g.createdAt,m.source FROM ecosystem_memberships m JOIN ecosystem_groups g ON g.id=m.groupId
    WHERE m.projectId=?`).get(projectIdentity(projectId)) as (Group & { source: MembershipSource }) | null;
  return row ? { group: { id: row.id, name: row.name, createdAt: row.createdAt }, source: row.source } : null;
}

export function bindProjectToGroup(db: Database, projectId: string, groupId: string, source: MembershipSource): { group: Group; changed: boolean } {
  const project = projectIdentity(projectId), identity = groupIdentity(groupId);
  requireEcosystem(db);
  return atomic(db, () => {
    if (!db.query("SELECT 1 FROM projects WHERE projectId=?").get(project)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    const group = getGroup(db, identity);
    if (!group) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    const current = groupOfProject(db, project);
    if (current?.group.id === identity) return { group, changed: false };
    const now = new Date().toISOString();
    if (current) db.query("UPDATE ecosystem_memberships SET groupId=?,boundAt=?,source=? WHERE projectId=?").run(identity, now, source, project);
    else db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES(?,?,?,?)").run(project, identity, now, source);
    recordIdentityEvent(db, { action: current ? "GROUP_CHANGED" : "GROUP_BOUND", projectId: project, groupId: identity, previousGroupId: current?.group.id ?? null });
    return { group, changed: true };
  });
}

export function unbindProject(db: Database, projectId: string): boolean {
  const project = projectIdentity(projectId);
  requireEcosystem(db);
  return atomic(db, () => {
    const current = groupOfProject(db, project);
    if (!current) return false;
    db.query("DELETE FROM ecosystem_memberships WHERE projectId=?").run(project);
    recordIdentityEvent(db, { action: "GROUP_UNBOUND", projectId: project, previousGroupId: current.group.id });
    return true;
  });
}

/** A group reference is an identity (exact match) or a name that must identify exactly one group. */
export function resolveGroup(db: Database, reference: string): Group {
  const label = groupName(reference);
  if (!ecosystemEnabled(db)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
  const byId = db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE id=?").get(label) as Group | null;
  if (byId) return byId;
  const named = findGroupsByName(db, label);
  if (named.length === 0) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
  if (named.length > 1) throw new MemoryError("GROUP_AMBIGUOUS", "Hay varios grupos con ese nombre; indica su identificador (group-list los muestra).");
  return named[0]!;
}
