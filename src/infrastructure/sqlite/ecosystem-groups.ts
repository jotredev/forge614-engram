/**
 * Maneja los grupos del ecosistema (ecosystem, el conjunto de proyectos que comparten memorias entre
 * sí) y su membresía: crear, nombrar, unir o quitar un proyecto de un grupo, y consultar a qué grupo
 * pertenece cada proyecto. Cada cambio se registra además como un evento de identidad (un rastro para
 * poder auditarlo después).
 */
import type { Database } from "bun:sqlite";
import { FORGE614_GROUP_NAME,declaredGroupId,groupIdentity,groupName,type Group,type GroupSummary,type IdentityEvent,type MembershipSource,type ProjectGroup } from "../../modules/ecosystem";
import { projectIdentity } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { schemaFeatures } from "./schema";

/**
 * Indica si la base tiene habilitado el nivel de esquema que activa los grupos del ecosistema.
 * @param db conexión abierta a la base SQLite.
 * @returns true si el ámbito ecosystem está disponible en esta base.
 */
export function ecosystemEnabled(db: Database): boolean { return schemaFeatures(db)?.ecosystem === true; }
/**
 * Exige que el ámbito ecosystem esté habilitado; si no lo está, lanza un error para que quien llama
 * sepa que primero hay que migrar la base.
 * @param db conexión abierta a la base SQLite.
 * @returns nada; solo lanza si el ámbito no está habilitado.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ámbito ecosystem no está habilitado.
 */
export function requireEcosystem(db: Database): void {
  if (!ecosystemEnabled(db)) throw new MemoryError("MIGRATION_REQUIRED", "Habilita el ámbito ecosystem con group-create o init para usar grupos.");
}
// Las operaciones compuestas (varias escrituras que deben aplicarse juntas) se unen a la transacción
// (grupo de cambios que se guarda completo o no se guarda) de quien llama, si ya hay una abierta.
/**
 * Ejecuta `operation` dentro de una transacción: reutiliza la del que llama si ya hay una abierta, o
 * abre una nueva e inmediata si no la hay.
 * @param db conexión abierta a la base SQLite.
 * @param operation la operación a ejecutar de forma atómica.
 * @returns el resultado de `operation`.
 */
function atomic<T>(db: Database, operation: () => T): T { return db.inTransaction ? operation() : db.transaction(operation).immediate(); }

/**
 * Guarda un evento de identidad: un registro de auditoría de un cambio de grupo, de proyecto o del
 * vínculo entre ambos.
 * @param db conexión abierta a la base SQLite.
 * @param event los datos del evento; los campos ausentes se guardan como null.
 * @returns nada; solo inserta la fila.
 */
export function recordIdentityEvent(db: Database, event: { action: string; projectId?: string | null; groupId?: string | null;
    previousGroupId?: string | null; previousProjectId?: string | null; memoryId?: string | null; directory?: string | null }): void {
  db.query(`INSERT INTO identity_events(action,projectId,groupId,previousGroupId,previousProjectId,memoryId,directory,createdAt)
    VALUES(?,?,?,?,?,?,?,?)`).run(event.action, event.projectId ?? null, event.groupId ?? null, event.previousGroupId ?? null,
    event.previousProjectId ?? null, event.memoryId ?? null, event.directory ?? null, new Date().toISOString());
}

/**
 * Lista los eventos de identidad guardados, en el orden en que se insertaron; si se da `projectId`,
 * solo los de ese proyecto.
 * @param db conexión abierta a la base SQLite.
 * @param projectId si se indica, filtra los eventos a los de este proyecto.
 * @returns los eventos de identidad encontrados.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ámbito ecosystem no está habilitado.
 */
export function identityEvents(db: Database, projectId?: string): IdentityEvent[] {
  requireEcosystem(db);
  return (projectId === undefined
    ? db.query("SELECT * FROM identity_events ORDER BY id").all()
    : db.query("SELECT * FROM identity_events WHERE projectId=? ORDER BY id").all(projectId)) as IdentityEvent[];
}

/**
 * Busca un grupo por su identificador exacto.
 * @param db conexión abierta a la base SQLite.
 * @param id identificador del grupo.
 * @returns el grupo si existe, o null si no existe o el ámbito ecosystem no está habilitado.
 */
export function getGroup(db: Database, id: string): Group | null {
  if (!ecosystemEnabled(db)) return null;
  return db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE id=?").get(groupIdentity(id)) as Group | null;
}
/**
 * Busca los grupos que tienen exactamente ese nombre, del más antiguo al más nuevo.
 * @param db conexión abierta a la base SQLite.
 * @param name nombre del grupo a buscar.
 * @returns los grupos con ese nombre (puede haber más de uno), o [] si el ámbito no está habilitado.
 */
export function findGroupsByName(db: Database, name: string): Group[] {
  if (!ecosystemEnabled(db)) return [];
  return db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE name=? ORDER BY createdAt,id").all(groupName(name)) as Group[];
}

/**
 * Crea un grupo nuevo con el nombre dado, validándolo y rechazando nombres repetidos.
 * @param db conexión abierta a la base SQLite.
 * @param name nombre propuesto para el grupo.
 * @returns el grupo recién creado.
 * @throws MemoryError con código GROUP_EXISTS si ya existe un grupo con ese nombre.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ámbito ecosystem no está habilitado.
 */
export function createGroup(db: Database, name: string): Group {
  const label = groupName(name);
  requireEcosystem(db);
  return atomic(db, () => {
    if (findGroupsByName(db, label).length > 0) throw new MemoryError("GROUP_EXISTS", "Ya existe un grupo con ese nombre.");
    // El nombre que declara cada nodo de Forge614 conserva una sola identidad en cualquier máquina.
    const id = label === FORGE614_GROUP_NAME ? declaredGroupId(label) : crypto.randomUUID();
    const group: Group = { id, name: label, createdAt: new Date().toISOString() };
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run(group.id, group.name, group.createdAt);
    recordIdentityEvent(db, { action: "GROUP_CREATED", groupId: group.id });
    return group;
  });
}

/**
 * Registra un grupo que llega con su propia identidad (de un clon o de un archivo de nodo). La
 * identidad manda sobre el nombre: si el identificador ya existe, no se crea de nuevo aunque llegue
 * con otro nombre.
 * @param db conexión abierta a la base SQLite.
 * @param id identificador del grupo.
 * @param name nombre a usar si el grupo se crea en esta llamada.
 * @returns el grupo (existente o recién creado) y si se creó en esta llamada.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ámbito ecosystem no está habilitado.
 */
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

/**
 * Cambia el nombre de un grupo existente, conservando su identificador.
 * @param db conexión abierta a la base SQLite.
 * @param id identificador del grupo a renombrar.
 * @param name nuevo nombre para el grupo.
 * @returns el grupo con el nombre actualizado.
 * @throws MemoryError con código GROUP_NOT_FOUND si el grupo no existe.
 */
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

/**
 * Lista todos los grupos junto con los proyectos que contiene cada uno, ordenados por nombre.
 * @param db conexión abierta a la base SQLite.
 * @returns cada grupo con sus proyectos miembro, o [] si el ámbito ecosystem no está habilitado.
 */
export function listGroups(db: Database): GroupSummary[] {
  if (!ecosystemEnabled(db)) return [];
  return db.transaction(() => {
    const groups = db.query("SELECT id,name,createdAt FROM ecosystem_groups ORDER BY name,createdAt,id").all() as Group[];
    // Los proyectos miembro se buscan aparte, en una sola consulta, y luego se agrupan por grupo.
    const members = db.query(`SELECT m.groupId,p.projectId,p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId
      ORDER BY p.name,p.projectId`).all() as { groupId: string; projectId: string; name: string }[];
    return groups.map(group => ({ ...group, projects: members.filter(member => member.groupId === group.id).map(({ projectId, name }) => ({ projectId, name })) }));
  }).deferred();
}

/**
 * Busca a qué grupo pertenece un proyecto y de dónde vino ese vínculo.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto.
 * @returns el grupo y el origen del vínculo, o null si el proyecto no pertenece a ninguno o el ámbito
 * no está habilitado.
 */
export function groupOfProject(db: Database, projectId: string): ProjectGroup | null {
  if (!ecosystemEnabled(db)) return null;
  const row = db.query(`SELECT g.id,g.name,g.createdAt,m.source FROM ecosystem_memberships m JOIN ecosystem_groups g ON g.id=m.groupId
    WHERE m.projectId=?`).get(projectIdentity(projectId)) as (Group & { source: MembershipSource }) | null;
  return row ? { group: { id: row.id, name: row.name, createdAt: row.createdAt }, source: row.source } : null;
}

/**
 * Une un proyecto a un grupo, o lo cambia si ya pertenecía a otro; no hace nada si ya está unido al
 * mismo grupo. Registra el cambio como evento de identidad.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto.
 * @param groupId identificador del grupo destino.
 * @param source origen del vínculo (quién lo pidió: un comando, un archivo de proyecto, etc.).
 * @returns el grupo y si el vínculo cambió de verdad.
 * @throws MemoryError con código PROJECT_NOT_FOUND si el proyecto no existe.
 * @throws MemoryError con código GROUP_NOT_FOUND si el grupo no existe.
 */
export function bindProjectToGroup(db: Database, projectId: string, groupId: string, source: MembershipSource): { group: Group; changed: boolean } {
  const project = projectIdentity(projectId), identity = groupIdentity(groupId);
  requireEcosystem(db);
  return atomic(db, () => {
    // El proyecto y el grupo destino deben existir de verdad antes de tocar la membresía.
    if (!db.query("SELECT 1 FROM projects WHERE projectId=?").get(project)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    const group = getGroup(db, identity);
    if (!group) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
    const current = groupOfProject(db, project);
    // Ya está en ese grupo: repetir la llamada no debe escribir nada ni generar otro evento.
    if (current?.group.id === identity) return { group, changed: false };
    const now = new Date().toISOString();
    // Si ya tenía un grupo se actualiza la fila de membresía; si no tenía, se inserta una nueva.
    if (current) db.query("UPDATE ecosystem_memberships SET groupId=?,boundAt=?,source=? WHERE projectId=?").run(identity, now, source, project);
    else db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES(?,?,?,?)").run(project, identity, now, source);
    // El evento distingue si es el primer vínculo (GROUP_BOUND) o un cambio de grupo (GROUP_CHANGED).
    recordIdentityEvent(db, { action: current ? "GROUP_CHANGED" : "GROUP_BOUND", projectId: project, groupId: identity, previousGroupId: current?.group.id ?? null });
    return { group, changed: true };
  });
}

/**
 * Quita a un proyecto de su grupo actual, si tenía uno. Registra el cambio como evento de identidad.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto.
 * @returns true si tenía un grupo y se le quitó; false si ya no pertenecía a ninguno.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ámbito ecosystem no está habilitado.
 */
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

/**
 * Resuelve una referencia a un grupo: primero prueba si es un identificador exacto; si no, la trata
 * como nombre y exige que identifique a un único grupo.
 * @param db conexión abierta a la base SQLite.
 * @param reference identificador o nombre del grupo.
 * @returns el grupo resuelto.
 * @throws MemoryError con código GROUP_NOT_FOUND si no hay ningún grupo con esa referencia.
 * @throws MemoryError con código GROUP_AMBIGUOUS si el nombre identifica a más de un grupo.
 */
export function resolveGroup(db: Database, reference: string): Group {
  const label = groupName(reference); // valida el formato como nombre, aunque también se use para probar como identificador
  if (!ecosystemEnabled(db)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
  const byId = db.query("SELECT id,name,createdAt FROM ecosystem_groups WHERE id=?").get(label) as Group | null; // primero intenta como identificador exacto
  if (byId) return byId;
  const named = findGroupsByName(db, label); // si no coincide con un identificador, se trata como nombre
  if (named.length === 0) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
  if (named.length > 1) throw new MemoryError("GROUP_AMBIGUOUS", "Hay varios grupos con ese nombre; indica su identificador (group-list los muestra).");
  return named[0]!;
}
