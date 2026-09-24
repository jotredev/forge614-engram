import type { Database } from "bun:sqlite";
import type { GroupSource } from "../../modules/ecosystem";
import type { Memory, MemoryVersion } from "../../modules/memory";
import { MemoryError } from "../../shared/errors";
import { getGroup, groupOfProject, recordIdentityEvent } from "./ecosystem-groups";
import { intelligenceEnabled } from "./intelligence";
import { get, required } from "./memory";
import { getProject } from "./projects";

function requireIntelligence(db: Database): void {
  if (!intelligenceEnabled(db)) throw new MemoryError("INTELLIGENCE_REQUIRED", "Esta operación requiere la memoria inteligente (forge614-engram intelligence-enable).");
}

export function groupSource(db: Database, groupId: string): GroupSource | null {
  requireIntelligence(db);
  return db.query("SELECT groupId,projectId,setAt FROM ecosystem_sources WHERE groupId=?").get(required(groupId, "groupId")) as GroupSource | null;
}

export function setGroupSource(db: Database, groupId: string, projectId: string): GroupSource {
  requireIntelligence(db);
  return db.transaction(() => {
    const group = getGroup(db, groupId);
    if (!group) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    if (!getProject(db, projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    if (groupOfProject(db, projectId)?.group.id !== group.id) throw new MemoryError("GROUP_REQUIRED", "El proyecto debe pertenecer al grupo.");
    const source: GroupSource = { groupId: group.id, projectId, setAt: new Date().toISOString() };
    db.query("INSERT INTO ecosystem_sources(groupId,projectId,setAt) VALUES(?,?,?) ON CONFLICT(groupId) DO UPDATE SET projectId=excluded.projectId,setAt=excluded.setAt")
      .run(source.groupId, source.projectId, source.setAt);
    recordIdentityEvent(db, { action: "GROUP_SOURCE_SET", groupId: group.id, projectId });
    return source;
  }).immediate();
}

export function demoteMemory(db: Database, projectId: string, id: string):
    { memory: Memory; from: { scope: "ecosystem"; groupId: string }; to: { scope: "project"; projectId: string } } {
  requireIntelligence(db);
  return db.transaction(() => {
    const membership = groupOfProject(db, projectId);
    if (!membership) throw new MemoryError("GROUP_REQUIRED", "El proyecto no pertenece a un grupo.");
    const current = get(db, { groupId: membership.group.id }, id);
    if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el tablero del grupo.");
    if (current.topicKey !== null && db.query("SELECT 1 FROM memories WHERE scope='project' AND projectId=? AND topic_key=?").get(projectId, current.topicKey)) throw new MemoryError("TOPIC_CONFLICT", "El proyecto ya tiene un recuerdo con ese tema.");
    const collision = db.query("SELECT 1 FROM requests r WHERE r.memory_id=? AND EXISTS (SELECT 1 FROM requests x WHERE x.scope='project' AND x.projectId=? AND x.request_key=r.request_key)").get(current.id, projectId);
    if (collision) throw new MemoryError("REQUEST_CONFLICT", "Una clave de petición del recuerdo ya existe en el proyecto.");
    const now = new Date().toISOString(), version = current.version + 1;
    const snapshot: MemoryVersion = { id: current.id, projectId, scope: "project", topicKey: current.topicKey, type: current.type, title: current.title, content: current.content, pinned: current.pinned, version, createdAt: current.createdAt, updatedAt: now };
    db.query("UPDATE memories SET scope='project',projectId=?,groupId=NULL,version=?,updated_at=? WHERE id=?").run(projectId, version, now, current.id);
    db.query("UPDATE requests SET scope='project',projectId=?,groupId=NULL WHERE memory_id=?").run(projectId, current.id);
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(current.id, version, JSON.stringify(snapshot));
    db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(current.id, version, now);
    recordIdentityEvent(db, { action: "MEMORY_DEMOTED", memoryId: current.id, projectId, groupId: membership.group.id });
    return { memory: { ...snapshot, state: current.state }, from: { scope: "ecosystem" as const, groupId: membership.group.id }, to: { scope: "project" as const, projectId } };
  }).immediate();
}
