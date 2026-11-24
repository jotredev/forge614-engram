/**
 * Mantiene sincronizada la identidad de un proyecto entre la base local y el archivo
 * `.forge614/project.json` (identidad portátil que viaja con el repositorio), y entre el
 * proyecto y el grupo (ecosistema) que declara pertenecer.
 */
import { declaredGroupId } from "../modules/ecosystem";
import { normalizeIdentityOrigin, type Project } from "../modules/projects";
import { MemoryError } from "../shared/errors";
import { readNodeEcosystem } from "../infrastructure/filesystem/node-file";
import { ensureProjectFile,readProjectFile,updateProjectFile,type ProjectFile,type ProjectFileGroup } from "../infrastructure/filesystem/project-identity-file";
import { identityRootsOfBinding } from "../infrastructure/git/project-directory";
import { ensureProjectIgnored, isTrackedProjectFile } from "../infrastructure/git/project-ignore";
import { readOriginRemote } from "../infrastructure/git/remote-origin";
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

export const TRACKED_PROJECT_FILE: IdentityNotice = {
  code: "PROJECT_FILE_TRACKED",
  message: "Git rastrea .forge614/project.json. Engram conservó el archivo y el índice.",
};

function checkProjectFileWrite(root: string, git: boolean): void {
  if (!git) return;
  const status = ensureProjectIgnored(root);
  if (status === "tracked") throw new MemoryError(TRACKED_PROJECT_FILE.code, TRACKED_PROJECT_FILE.message);
  if (status === "unavailable") {
    throw new MemoryError("PROJECT_FILE_NOT_WRITTEN", "No se pudo confirmar la exclusión de /.forge614/ en el .gitignore raíz. La identidad de SQLite sigue disponible.");
  }
}

function protectionNotice(error: unknown): IdentityNotice | null {
  return error instanceof MemoryError && (error.code === "PROJECT_FILE_TRACKED" || error.code === "PROJECT_FILE_NOT_WRITTEN")
    ? notice(error.code, error.message) : null;
}

/**
 * Escribe (o completa) `.forge614/project.json` en `root` con el proyecto y grupo dados.
 * @param project Identidad a escribir.
 * @param root Carpeta donde vive (o se crea) el archivo de identidad.
 * @param group Grupo a declarar en el archivo, o `null` si no pertenece a ninguno.
 * @param notices Lista a la que se añade un aviso si el archivo se creó por primera vez para
 * un proyecto que antes solo estaba ligado por ruta (`legacy`), o si no se pudo escribir.
 * @param legacy Si el proyecto ya existía por vínculo de ruta antes de tener este archivo.
 * Las operaciones ya confirmadas conservan su resultado aunque falle la publicación posterior.
 */
function writeIdentity(project: { projectId: string; name: string }, root: string, group: ProjectFileGroup | null, notices: IdentityNotice[], legacy: boolean, git: boolean): void {
  try {
    const result = ensureProjectFile(root, { projectId: project.projectId, name: project.name, ecosystem: group }, { fillGroup: group !== null, beforeWrite: () => checkProjectFileWrite(root, git) });
    if (result.status === "created" && legacy) notices.push(notice("PROJECT_FILE_CREATED", "Este proyecto ya estaba vinculado por ruta; se escribió su .forge614/project.json (identidad portátil)."));
  } catch (error) {
    notices.push(protectionNotice(error) ?? notice("PROJECT_FILE_NOT_WRITTEN", "No se pudo escribir .forge614/project.json en esta carpeta."));
  }
}

/** Publica en el árbol la identidad que ya se confirmó en SQLite. */
export function publishIdentity(store: MemoryStore, project: Project, root: string | null, legacy: boolean, git = false): IdentityNotice[] {
  if (root === null) return [];
  const notices: IdentityNotice[] = [];
  writeIdentity(project, root, groupOf(store, project.projectId) ?? null, notices, legacy, git);
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
export function updateIdentityFiles(store: MemoryStore, projectId: string, patch: { name?: string; group?: ProjectFileGroup | null }):
    { updated: number; skipped: number; notices?: IdentityNotice[] } {
  const project = store.getProject(projectId);
  const notices: IdentityNotice[] = [];
  let updated = 0, skipped = 0;
  for (const key of store.projectDirectories(projectId)) {
    const roots = identityRootsOfBinding(key);
    const raw = roots.some(item => item.git) ? readOriginRemote(key) : null;
    const hasUsableRemote = raw !== null && normalizeIdentityOrigin(raw) !== null;
    for (const { root, git } of roots) {
      try {
        const before = readProjectFile(root);
        const beforeWrite = () => checkProjectFileWrite(root, git);
        if (before === null) {
          if (patch.group === undefined || project === null || hasUsableRemote) continue;
          ensureProjectFile(root, { projectId, name: patch.name ?? project.name, ecosystem: patch.group }, { beforeWrite });
          updated++;
          continue;
        }
        if (git && isTrackedProjectFile(root)) {
          notices.push(TRACKED_PROJECT_FILE);
          skipped++;
          continue;
        }
        if (before.project.id !== projectId) continue;
        const after = updateProjectFile(root, {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.group === undefined ? {} : { ecosystem: patch.group }),
        }, beforeWrite, projectId);
        if (after !== null && JSON.stringify(after) !== JSON.stringify(before)) updated++;
      } catch (error) {
        skipped++;
        const warning = protectionNotice(error);
        if (warning) notices.push(warning);
      }
    }
  }
  return { updated, skipped, ...(notices.length ? { notices } : {}) };
}
