/**
 * Espacio de trabajo global: crea, abre y prepara la única base SQLite que comparten todos
 * los proyectos y las memorias compartidas, y ofrece las operaciones de proyectos y grupos
 * (ecosistema) que necesitan abrir esa base antes de actuar.
 */
import { existsSync } from "node:fs";
import { MemoryError } from "../shared/errors";
import { groupName,type Group,type GroupSource,type GroupSummary } from "../modules/ecosystem";
import type { Memory } from "../modules/memory";
import type { Project } from "../modules/projects";
import { projectIdentity } from "../modules/projects";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryStore } from "./memory-store";
import { openWorkspaceDatabase } from "../infrastructure/sqlite/workspace-database";
import { enrollEcosystem, updateIdentityFiles, type IdentityNotice } from "./project-identity";

/** Cuántos archivos de identidad se actualizaron y cuántos se saltaron por estar dañados, tras una operación que pudo tocar varios. */
export interface IdentityFilesResult { updated: number; skipped: number }
/** Resultado de ligar un proyecto a un grupo: el grupo, si el vínculo cambió de verdad, y qué pasó con sus archivos de identidad. */
export interface GroupBinding { group: Group; changed: boolean; identityFiles: IdentityFilesResult }
/** Resultado de quitar a un proyecto de su grupo: si estaba ligado de verdad, y qué pasó con sus archivos de identidad. */
export interface GroupUnbinding { unbound: boolean; identityFiles: IdentityFilesResult }
/** Resultado de renombrar un grupo: el grupo con su nombre nuevo, y qué pasó con los archivos de identidad de sus miembros. */
export interface GroupRename { group: Group; identityFiles: IdentityFilesResult }
/** Resultado de mover una memoria a un grupo: la memoria, de dónde salió y a qué grupo entró. */
export interface MemoryMove { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null }; to: { scope: "ecosystem"; groupId: string } }
/** Resultado a devolver cuando no había archivos de identidad que tocar (por ejemplo, el proyecto no estaba ligado a ningún grupo). */
const NO_FILES: IdentityFilesResult = { updated: 0, skipped: 0 };

/** Todos los proyectos y las memorias compartidas usan esta única base de espacio de trabajo. */
export class MemoryWorkspace {
  /** @param config Configuración del espacio de trabajo a usar; por defecto, la del disco. */
  constructor(private readonly config = new WorkspaceConfig()) {}

  /**
   * Prepara el espacio de trabajo para usarse: repara una configuración a medio escribir,
   * y si no existe la crea (con la base nueva ya en memoria inteligente, esquema 11, porque
   * no tiene nada que respaldar); si ya existe, solo la valida abriéndola y cerrándola.
   */
  init(): void {
    this.config.repairExistingRoot();
    if (this.config.exists()) {
      const store = this.open(true);
      store.close();
      return;
    }
    this.config.prepare();
    // Solo un archivo de base de datos creado justo aquí arranca con memoria inteligente (esquema 11): no tiene
    // nada que respaldar. Uno que ya estuviera en disco, aunque le faltara su configuración, nunca se migra aquí;
    // eso lo hace `enableIntelligence` por separado, de forma explícita.
    const brandNew = !existsSync(this.config.databasePath);
    const store = openWorkspaceDatabase(this.config.databasePath, true, false, (path, options) => new MemoryStore(path, options));
    try { if (brandNew) store.enableIntelligence(); this.config.save(); }
    finally { store.close(); }
  }

  /**
   * Abre la base del espacio de trabajo ya preparada.
   * @param readonly Si se abre sin permiso de escritura.
   * @returns La base abierta; quien llama es responsable de cerrarla.
   */
  open(readonly = false): MemoryStore {
    this.config.read();
    return openWorkspaceDatabase(this.config.databasePath, false, readonly, (path, options) => new MemoryStore(path, options));
  }

  /**
   * Prepara el espacio de trabajo si hacía falta y crea un proyecto nuevo con el nombre dado.
   * @throws MemoryError con código `INVALID_INPUT` si el nombre está vacío, no es texto o contiene un carácter nulo.
   */
  createProject(name: string): Project {
    if (typeof name !== "string" || !name.trim() || name.includes("\0")) {
      throw new MemoryError("INVALID_INPUT", "El nombre del proyecto no puede estar vacío.");
    }
    this.init();
    const store = this.open();
    try { return store.createProject(name); } finally { store.close(); }
  }

  /** Lista los proyectos del espacio de trabajo; una lista vacía si el espacio de trabajo ni siquiera existe todavía. */
  listProjects(): Project[] {
    if (!this.config.exists()) return [];
    const store = this.open(true);
    try { return store.listProjects(); } finally { store.close(); }
  }

  /**
   * Cambia el nombre de un proyecto y actualiza sus archivos de identidad para que coincidan.
   * @throws MemoryError con código `INVALID_INPUT` si `projectId` no es un UUID válido de
   * proyecto, o si el nombre nuevo está vacío, no es texto o contiene un carácter nulo.
   */
  renameProject(projectId: string, name: string): Project {
    projectIdentity(projectId);
    if (typeof name !== "string" || !name.trim() || name.includes("\0")) {
      throw new MemoryError("INVALID_INPUT", "El nombre del proyecto no puede estar vacío.");
    }
    const store = this.open();
    try {
      const renamed = store.renameProject(projectId, name);
      updateIdentityFiles(store, renamed.projectId, { name: renamed.name });
      return renamed;
    } finally { store.close(); }
  }

  /** Grupos de ecosistema: repositorios relacionados que comparten memoria. Crear el primero activa el nivel de ecosistema en la base. */
  createGroup(name: string): Group { return this.createGroupWithNotices(name).group; }

  /** Como `createGroup`; los avisos dicen si crear el primer grupo migró la base, y dónde quedó su respaldo. */
  createGroupWithNotices(name: string): { group: Group; notices: IdentityNotice[] } {
    const label = groupName(name);
    this.init();
    const store = this.open();
    try {
      const notices: IdentityNotice[] = [];
      enrollEcosystem(store, notices);
      return { group: store.createGroup(label), notices };
    } finally { store.close(); }
  }

  /** Lista los grupos con un resumen de cada uno; una lista vacía si el espacio de trabajo ni siquiera existe todavía. */
  listGroups(): GroupSummary[] {
    if (!this.config.exists()) return [];
    const store = this.open(true);
    try { return store.listGroups(); } finally { store.close(); }
  }

  /**
   * Liga un proyecto a un grupo por comando explícito, actualizando su archivo de identidad.
   * @param projectId Identificador (UUID) del proyecto a ligar.
   * @param group Identificador del grupo, o un nombre que identifique exactamente uno.
   * @throws MemoryError con código `GROUP_NOT_FOUND` si el ecosistema no está activado en esta base.
   */
  bindProjectToGroup(projectId: string, group: string): GroupBinding {
    const identity = projectIdentity(projectId);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const resolved = store.resolveGroup(group);
      const bound = store.bindProjectToGroup(identity, resolved.id, "command");
      const identityFiles = updateIdentityFiles(store, identity, { group: { id: resolved.id, name: resolved.name } });
      return { group: resolved, changed: bound.changed, identityFiles };
    } finally { store.close(); }
  }

  /** Quita a un proyecto de su grupo, si tenía uno; sin efecto (y sin avisos) si el ecosistema no está activado en esta base. */
  unbindProject(projectId: string): GroupUnbinding {
    const identity = projectIdentity(projectId);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) return { unbound: false, identityFiles: { ...NO_FILES } };
      const unbound = store.unbindProject(identity);
      return { unbound, identityFiles: unbound ? updateIdentityFiles(store, identity, { group: null }) : { ...NO_FILES } };
    } finally { store.close(); }
  }

  /**
   * Cambia el nombre de un grupo y actualiza el archivo de identidad de cada uno de sus proyectos miembro.
   * @throws MemoryError con código `GROUP_NOT_FOUND` si el ecosistema no está activado en esta base.
   */
  renameGroup(group: string, name: string): GroupRename {
    const label = groupName(name);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const renamed = store.renameGroup(store.resolveGroup(group).id, label);
      const identityFiles = { updated: 0, skipped: 0 };
      // Se recorren todos los proyectos que hoy son miembros del grupo renombrado, sumando cuántos archivos se actualizaron o se saltaron en cada uno.
      for (const summary of store.listGroups().filter(item => item.id === renamed.id)) {
        for (const member of summary.projects) {
          const result = updateIdentityFiles(store, member.projectId, { group: { id: renamed.id, name: renamed.name } });
          identityFiles.updated += result.updated; identityFiles.skipped += result.skipped;
        }
      }
      return { group: renamed, identityFiles };
    } finally { store.close(); }
  }

  /**
   * Migración explícita y registrada de una memoria a un grupo.
   * @param id Identificador de la memoria a mover.
   * @param from Id del proyecto dueño de la memoria, o `null` si era compartida (shared).
   * @param group Identificador del grupo destino, o un nombre que identifique exactamente uno.
   * @throws MemoryError con código `GROUP_NOT_FOUND` si el ecosistema no está activado en esta base.
   */
  moveMemory(id: string, from: string | null, group: string): MemoryMove {
    const source = from === null ? null : projectIdentity(from);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const target = store.resolveGroup(group);
      const moved = store.moveMemoryToGroup(source, id, target.id);
      return { ...moved, to: { scope: "ecosystem", groupId: target.id } };
    } finally { store.close(); }
  }

  /** Marca a un proyecto como la fuente (origen) de las reglas comunes de un grupo. */
  setGroupSource(group: string, projectId: string): GroupSource {
    const store = this.open(); try { return store.setGroupSource(store.resolveGroup(group).id, projectId); } finally { store.close(); }
  }

  /** Mueve una memoria de ecosistema (grupo) de vuelta a un proyecto concreto del grupo. */
  demoteMemory(id: string, projectId: string): { memory: Memory; from: { scope: "ecosystem"; groupId: string }; to: { scope: "project"; projectId: string } } {
    const store = this.open(); try { return store.demoteMemory(projectId, id); } finally { store.close(); }
  }
}
