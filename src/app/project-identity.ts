import { declaredGroupId } from "../modules/ecosystem";
import type { Project } from "../modules/projects";
import { MemoryError } from "../shared/errors";
import { readNodeEcosystem } from "../infrastructure/filesystem/node-file";
import { ensureProjectFile,readProjectFile,updateProjectFile,type ProjectFile,type ProjectFileGroup } from "../infrastructure/filesystem/project-identity-file";
import { rootOfBinding } from "../infrastructure/git/project-directory";
import type { MemoryStore } from "./memory-store";

export interface IdentityNotice { code: string; message: string }

function notice(code: string, message: string): IdentityNotice { return { code, message }; }

/** Group declared for a repository, in the acta's order: the node file first, then the identity file. Never inferred. */
function declaredGroup(store: MemoryStore, projectId: string, root: string, file: ProjectFile | null): ProjectFileGroup | null {
  const named = readNodeEcosystem(root);
  if (named !== null) {
    store.enableEcosystem();
    const group = store.ensureGroup(declaredGroupId(named), named).group;
    store.bindProjectToGroup(projectId, group.id, "node-file");
    return { id: group.id, name: group.name };
  }
  if (file?.ecosystem) {
    store.enableEcosystem();
    const group = store.ensureGroup(file.ecosystem.id, file.ecosystem.name).group;
    store.bindProjectToGroup(projectId, group.id, "project-file");
    return { id: group.id, name: group.name };
  }
  // Removing the section from a file that established the membership removes the membership.
  if (file !== null && store.groupOfProject(projectId)?.source === "project-file") store.unbindProject(projectId);
  return null;
}

/**
 * The identity file travels with the repository, so it wins over the local path binding: register the
 * project by its id when unknown, re-bind the folder when the base disagrees, and join the declared group.
 */
export function applyIdentityFile(store: MemoryStore, key: string, root: string | null): { projectId: string | null; notices: IdentityNotice[] } {
  if (root === null) return { projectId: null, notices: [] };
  const file = readProjectFile(root);
  if (file === null) return { projectId: null, notices: [] };
  const id = file.project.id, notices: IdentityNotice[] = [];
  // Read the folder binding first: a base that cannot bind folders must refuse before registering anything.
  const bound = store.projectForDirectory(key);
  store.registerProject(id, file.project.name);
  if (!bound) store.bindProjectDirectory(key, id);
  else if (bound.projectId !== id) {
    store.enableEcosystem();
    store.rebindProjectDirectory(key, id);
    notices.push(notice("PROJECT_REBOUND_FROM_FILE", "La carpeta se vinculó al proyecto que declara .forge614/project.json; el archivo no se modificó."));
  }
  const group = declaredGroup(store, id, root, file);
  // Only a missing section, or a null one that a node file now fills, is ever completed.
  if (file.ecosystem === undefined || (file.ecosystem === null && group !== null)) writeIdentity({ projectId: id, name: file.project.name }, root, group, notices, false);
  return { projectId: id, notices };
}

function writeIdentity(project: { projectId: string; name: string }, root: string, group: ProjectFileGroup | null, notices: IdentityNotice[], legacy: boolean): void {
  try {
    const result = ensureProjectFile(root, { projectId: project.projectId, name: project.name, ecosystem: group }, { fillGroup: group !== null });
    if (result.status === "created" && legacy) notices.push(notice("PROJECT_FILE_CREATED", "Este proyecto ya estaba vinculado por ruta; se escribió su .forge614/project.json (identidad portátil)."));
  } catch (error) {
    if (error instanceof MemoryError && error.code === "PROJECT_FILE_INVALID") throw error;
    notices.push(notice("PROJECT_FILE_NOT_WRITTEN", "No se pudo escribir .forge614/project.json en esta carpeta."));
  }
}

/** Publishes the identity of a project that was resolved by path (legacy) or just created or bound. */
export function publishIdentity(store: MemoryStore, project: Project, root: string | null, legacy: boolean): IdentityNotice[] {
  if (root === null) return [];
  const notices: IdentityNotice[] = [];
  const file = readProjectFile(root);
  const group = declaredGroup(store, project.projectId, root, file) ?? (() => {
    const member = store.groupOfProject(project.projectId);
    return member ? { id: member.group.id, name: member.group.name } : null;
  })();
  writeIdentity(project, root, group, notices, legacy);
  return notices;
}

export function groupOf(store: MemoryStore, projectId: string | null): { id: string; name: string } | undefined {
  if (projectId === null) return undefined;
  const member = store.groupOfProject(projectId);
  return member ? { id: member.group.id, name: member.group.name } : undefined;
}

/**
 * Keeps the identity file of every folder bound to this project in step after a rename or a group
 * change. Only files that declare this very project are touched; a broken file is skipped, never
 * repaired. A missing file is created only for a group change.
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
