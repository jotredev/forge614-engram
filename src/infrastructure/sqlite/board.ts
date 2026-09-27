/**
 * Maneja el "tablero" (board) de un grupo del ecosistema (ecosystem, el conjunto de proyectos de una
 * misma persona que comparten recuerdos entre sí): quién es el proyecto "fuente" del grupo (el único
 * autorizado a escribir su nota de estado) y cómo se "degrada" (demote) un recuerdo del tablero para
 * que vuelva a ser un recuerdo normal de un solo proyecto. Lo usan los comandos del ecosistema y
 * writes.ts al guardar recuerdos con alcance (scope) "ecosystem". Estas operaciones solo existen a
 * partir del nivel de memoria inteligente (intelligence): por debajo de ese nivel, todas lanzan
 * INTELLIGENCE_REQUIRED.
 */
import type { Database } from "bun:sqlite";
import type { GroupSource } from "../../modules/ecosystem";
import type { Memory, MemoryVersion } from "../../modules/memory";
import { MemoryError } from "../../shared/errors";
import { getGroup, groupOfProject, recordIdentityEvent } from "./ecosystem-groups";
import { intelligenceEnabled } from "./intelligence";
import { get, required } from "./memory";
import { getProject } from "./projects";

/**
 * Comprueba que la base tenga habilitado el nivel de memoria inteligente; si no, corta la operación
 * de raíz. La usan todas las funciones exportadas de este archivo, porque el tablero del ecosistema
 * es una función exclusiva de ese nivel.
 * @param db conexión abierta a la base SQLite.
 * @throws MemoryError con código INTELLIGENCE_REQUIRED si la inteligencia no está habilitada.
 */
function requireIntelligence(db: Database): void {
  if (!intelligenceEnabled(db)) throw new MemoryError("INTELLIGENCE_REQUIRED", "Esta operación requiere la memoria inteligente (forge614-engram intelligence-enable).");
}

/**
 * Devuelve el proyecto fuente configurado para un grupo (el único que puede escribir su nota de
 * estado), o null si el grupo todavía no tiene uno asignado.
 * @param db conexión abierta a la base SQLite.
 * @param groupId identificador del grupo.
 * @returns el registro de fuente del grupo, o null si no existe.
 * @throws MemoryError con código INTELLIGENCE_REQUIRED si la inteligencia no está habilitada.
 */
export function groupSource(db: Database, groupId: string): GroupSource | null {
  requireIntelligence(db);
  return db.query("SELECT groupId,projectId,setAt FROM ecosystem_sources WHERE groupId=?").get(required(groupId, "groupId")) as GroupSource | null;
}

/**
 * Fija (o reemplaza) el proyecto fuente de un grupo: el único proyecto autorizado a escribir la nota
 * de estado del grupo. Deja constancia del cambio como evento de identidad (identity event, un
 * registro de auditoría de cambios de pertenencia y configuración del ecosistema).
 * @param db conexión abierta a la base SQLite.
 * @param groupId identificador del grupo.
 * @param projectId identificador del proyecto que se vuelve la fuente; debe pertenecer al grupo.
 * @returns el registro de fuente recién guardado.
 * @throws MemoryError con código INTELLIGENCE_REQUIRED si la inteligencia no está habilitada,
 * GROUP_NOT_FOUND si el grupo no existe, PROJECT_NOT_FOUND si el proyecto no existe, o
 * GROUP_REQUIRED si el proyecto no pertenece a ese grupo.
 */
export function setGroupSource(db: Database, groupId: string, projectId: string): GroupSource {
  requireIntelligence(db);
  return db.transaction(() => {
    const group = getGroup(db, groupId);
    if (!group) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    if (!getProject(db, projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    // El proyecto debe ser miembro de este mismo grupo, no de otro.
    if (groupOfProject(db, projectId)?.group.id !== group.id) throw new MemoryError("GROUP_REQUIRED", "El proyecto debe pertenecer al grupo.");
    const source: GroupSource = { groupId: group.id, projectId, setAt: new Date().toISOString() };
    // Inserta la fuente del grupo, o la reemplaza si el grupo ya tenía una (upsert, insertar-o-actualizar).
    db.query("INSERT INTO ecosystem_sources(groupId,projectId,setAt) VALUES(?,?,?) ON CONFLICT(groupId) DO UPDATE SET projectId=excluded.projectId,setAt=excluded.setAt")
      .run(source.groupId, source.projectId, source.setAt);
    recordIdentityEvent(db, { action: "GROUP_SOURCE_SET", groupId: group.id, projectId });
    return source;
  }).immediate();
}

/**
 * Degrada (demote) un recuerdo del tablero de un grupo para devolverlo a un proyecto miembro: el
 * recuerdo deja el alcance "ecosystem" y pasa a "project", conservando su identificador, su historial
 * de versiones y sus metadatos (afectados, etc.: se guardan aparte, por id de recuerdo, y esta función
 * no los toca, así que sobreviven al cambio de alcance sin copiarlos). Se rechaza si el
 * proyecto ya tiene un recuerdo con el mismo tema (topic key) o si alguna de las claves de petición
 * (request key, la huella que evita guardar dos veces la misma petición) del recuerdo chocaría con una
 * ya existente en el proyecto.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto que recibe el recuerdo; debe pertenecer al grupo dueño del tablero.
 * @param id identificador del recuerdo a degradar.
 * @returns el recuerdo ya degradado, junto con su alcance de origen (ecosystem) y de destino (project).
 * @throws MemoryError con código INTELLIGENCE_REQUIRED si la inteligencia no está habilitada,
 * GROUP_REQUIRED si el proyecto no pertenece a un grupo, NOT_FOUND si el recuerdo no está en el
 * tablero del grupo, TOPIC_CONFLICT si el proyecto ya tiene un recuerdo con ese tema, o
 * REQUEST_CONFLICT si una clave de petición del recuerdo ya existe en el proyecto.
 */
export function demoteMemory(db: Database, projectId: string, id: string):
    { memory: Memory; from: { scope: "ecosystem"; groupId: string }; to: { scope: "project"; projectId: string } } {
  requireIntelligence(db);
  return db.transaction(() => {
    // El proyecto debe pertenecer a algún grupo: ese grupo es el dueño del tablero de origen.
    const membership = groupOfProject(db, projectId);
    if (!membership) throw new MemoryError("GROUP_REQUIRED", "El proyecto no pertenece a un grupo.");
    // Busca el recuerdo dentro del tablero de ese grupo (no en cualquier alcance).
    const current = get(db, { groupId: membership.group.id }, id);
    if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el tablero del grupo.");
    // Si el recuerdo tiene tema, el proyecto destino no puede ya tener uno propio con el mismo tema.
    if (current.topicKey !== null && db.query("SELECT 1 FROM memories WHERE scope='project' AND projectId=? AND topic_key=?").get(projectId, current.topicKey)) throw new MemoryError("TOPIC_CONFLICT", "El proyecto ya tiene un recuerdo con ese tema.");
    // Tampoco puede chocar ninguna clave de petición del recuerdo con una que el proyecto ya tenga.
    const collision = db.query("SELECT 1 FROM requests r WHERE r.memory_id=? AND EXISTS (SELECT 1 FROM requests x WHERE x.scope='project' AND x.projectId=? AND x.request_key=r.request_key)").get(current.id, projectId);
    if (collision) throw new MemoryError("REQUEST_CONFLICT", "Una clave de petición del recuerdo ya existe en el proyecto.");
    const now = new Date().toISOString(), version = current.version + 1;
    // Arma la foto (snapshot) de la nueva versión, ya con el alcance y el proyecto de destino.
    const snapshot: MemoryVersion = { id: current.id, projectId, scope: "project", topicKey: current.topicKey, type: current.type, title: current.title, content: current.content, pinned: current.pinned, version, createdAt: current.createdAt, updatedAt: now };
    // Mueve el recuerdo mismo: cambia su alcance, su proyecto y quita el grupo.
    db.query("UPDATE memories SET scope='project',projectId=?,groupId=NULL,version=?,updated_at=? WHERE id=?").run(projectId, version, now, current.id);
    // Mueve también sus claves de petición, para que sigan protegiendo contra duplicados en el nuevo alcance.
    db.query("UPDATE requests SET scope='project',projectId=?,groupId=NULL WHERE memory_id=?").run(projectId, current.id);
    // Deja la foto de esta nueva versión en el historial.
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(current.id, version, JSON.stringify(snapshot));
    // Registra el movimiento como un evento más de guardado ("save") en la bitácora de eventos.
    db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(current.id, version, now);
    recordIdentityEvent(db, { action: "MEMORY_DEMOTED", memoryId: current.id, projectId, groupId: membership.group.id });
    return { memory: { ...snapshot, state: current.state }, from: { scope: "ecosystem" as const, groupId: membership.group.id }, to: { scope: "project" as const, projectId } };
  }).immediate();
}
