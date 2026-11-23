/**
 * Mantiene sincronizada la identidad de un proyecto entre la base local y el archivo
 * `.forge614/project.json` (identidad portátil que viaja con el repositorio), y entre el
 * proyecto y el grupo (ecosistema) que declara pertenecer.
 */
import { declaredGroupId } from "../modules/ecosystem";
import type { Project } from "../modules/projects";
import { MemoryError } from "../shared/errors";
import { readNodeEcosystem } from "../infrastructure/filesystem/node-file";
import { ensureProjectFile,readProjectFile,updateProjectFile,type ProjectFile,type ProjectFileGroup } from "../infrastructure/filesystem/project-identity-file";
import { rootOfBinding } from "../infrastructure/git/project-directory";
import type { MemoryStore } from "./memory-store";

/** Aviso generado al registrar, ligar o publicar una identidad de proyecto, para que quien llama informe qué pasó. */
export interface IdentityNotice { code: string; message: string; backup?: string }

/** Construye un aviso sin respaldo (`backup`); ver `enrollEcosystem` para el caso con respaldo. */
function notice(code: string, message: string): IdentityNotice { return { code, message }; }

/** Activa el nivel de ecosistema en la base si aún no lo tenía; si eso exige migrarla, añade a `notices` el aviso con el nombre del respaldo (o sin respaldo si la base estaba vacía). */
export function enrollEcosystem(store: MemoryStore, notices: IdentityNotice[]): void {
  const enrolment = store.enableEcosystem();
  if (!enrolment.migrated) return;
  notices.push(enrolment.backup === null
    ? notice("DATABASE_MIGRATED", "La base se actualizó al nivel con ámbito de ecosistema (no había datos que respaldar).")
    : { ...notice("DATABASE_MIGRATED", `La base se actualizó al nivel con ámbito de ecosistema; el respaldo previo quedó en ${enrolment.backup}.`), backup: enrolment.backup });
}

type DeclaredGroup = ProjectFileGroup & { source: "node-file" | "project-file" };

/** El archivo de nodo tiene precedencia sobre la declaración de ecosistema del archivo de identidad. */
export function readDeclaredGroup(root: string | null, file: ProjectFile | null): DeclaredGroup | null {
  const named = root === null ? null : readNodeEcosystem(root);
  if (named !== null) return { id: declaredGroupId(named), name: named, source: "node-file" };
  return file?.ecosystem ? { ...file.ecosystem, source: "project-file" } : null;
}

/** Comprueba si una declaración compatible requiere modificar la membresía. */
export function declaredGroupChanges(store: MemoryStore, projectId: string, group: DeclaredGroup | null, file: ProjectFile | null): boolean {
  const current = store.groupOfProject(projectId);
  return group ? current?.group.id !== group.id : file !== null && current?.source === "project-file";
}

/** Aplica dentro de la transacción una declaración ya leída y validada. */
export function applyDeclaredGroup(store: MemoryStore, projectId: string, group: DeclaredGroup | null, file: ProjectFile | null): void {
  if (!declaredGroupChanges(store, projectId, group, file)) return;
  if (!group) { store.unbindProject(projectId); return; }
  store.ensureGroup(group.id, group.name);
  store.bindProjectToGroup(projectId, group.id, group.source);
}

/**
 * Escribe (o completa) `.forge614/project.json` en `root` con el proyecto y grupo dados.
 * @param project Identidad a escribir.
 * @param root Carpeta donde vive (o se crea) el archivo de identidad.
 * @param group Grupo a declarar en el archivo, o `null` si no pertenece a ninguno.
 * @param notices Lista a la que se añade un aviso si el archivo se creó por primera vez para
 * un proyecto que antes solo estaba ligado por ruta (`legacy`), o si no se pudo escribir.
 * @param legacy Si el proyecto ya existía por vínculo de ruta antes de tener este archivo.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` si el archivo existente no es válido
 * (se relanza tal cual; cualquier otro error se convierte en un aviso `PROJECT_FILE_NOT_WRITTEN`).
 */
function writeIdentity(project: { projectId: string; name: string }, root: string, group: ProjectFileGroup | null, notices: IdentityNotice[], legacy: boolean): void {
  try {
    const result = ensureProjectFile(root, { projectId: project.projectId, name: project.name, ecosystem: group }, { fillGroup: group !== null });
    if (result.status === "created" && legacy) notices.push(notice("PROJECT_FILE_CREATED", "Este proyecto ya estaba vinculado por ruta; se escribió su .forge614/project.json (identidad portátil)."));
  } catch (error) {
    if (error instanceof MemoryError && error.code === "PROJECT_FILE_INVALID") throw error;
    notices.push(notice("PROJECT_FILE_NOT_WRITTEN", "No se pudo escribir .forge614/project.json en esta carpeta."));
  }
}

/** Publica en el árbol la identidad que ya se confirmó en SQLite. */
export function publishIdentity(store: MemoryStore, project: Project, root: string | null, legacy: boolean): IdentityNotice[] {
  if (root === null) return [];
  const notices: IdentityNotice[] = [];
  writeIdentity(project, root, groupOf(store, project.projectId) ?? null, notices, legacy);
  return notices;
}

/**
 * Lee el grupo (id y nombre) al que pertenece un proyecto, si pertenece a alguno.
 * @param store Base abierta desde la que se lee.
 * @param projectId Identificador del proyecto, o `null` si no hay proyecto (siempre `undefined` en ese caso).
 * @returns El grupo, o `undefined` si no hay proyecto o no pertenece a ninguno.
 */
export function groupOf(store: MemoryStore, projectId: string | null): { id: string; name: string } | undefined {
  if (projectId === null) return undefined;
  const member = store.groupOfProject(projectId);
  return member ? { id: member.group.id, name: member.group.name } : undefined;
}

/**
 * Mantiene al día el archivo de identidad de cada carpeta ligada a este proyecto tras un
 * cambio de nombre o de grupo. Solo se tocan los archivos que declaran este mismo proyecto;
 * un archivo dañado se salta, nunca se repara. Un archivo ausente solo se crea si el cambio
 * es de grupo (un cambio de nombre por sí solo no crea archivos nuevos).
 * @param store Base abierta desde la que se leen las carpetas ligadas.
 * @param projectId Identificador del proyecto cuyos archivos se actualizan.
 * @param patch Campos a cambiar: `name` el nombre nuevo, `group` el grupo nuevo (`null` para quitarlo).
 * @returns Cuántos archivos se actualizaron y cuántos se saltaron por estar dañados.
 */
export function updateIdentityFiles(store: MemoryStore, projectId: string, patch: { name?: string; group?: ProjectFileGroup | null }): { updated: number; skipped: number } {
  const project = store.getProject(projectId);
  let updated = 0, skipped = 0;
  for (const key of store.projectDirectories(projectId)) {
    const root = rootOfBinding(key);
    if (root === null) continue;
    try {
      const before = readProjectFile(root);
      if (before === null) {
        if (patch.group === undefined || project === null) continue;
        ensureProjectFile(root, { projectId, name: patch.name ?? project.name, ecosystem: patch.group });
        updated++; continue;
      }
      if (before.project.id !== projectId) continue;
      const after = updateProjectFile(root, {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.group === undefined ? {} : { ecosystem: patch.group }),
      });
      if (JSON.stringify(after) !== JSON.stringify(before)) updated++;
    } catch { skipped++; }
  }
  return { updated, skipped };
}
