import { MemoryError } from "../shared/errors";
import { groupName,type Group,type GroupSummary } from "../modules/ecosystem";
import type { Memory } from "../modules/memory";
import type { Project } from "../modules/projects";
import { projectIdentity } from "../modules/projects";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryStore } from "./memory-store";
import { openWorkspaceDatabase } from "../infrastructure/sqlite/workspace-database";
import { updateIdentityFiles } from "./project-identity";

export interface IdentityFilesResult { updated: number; skipped: number }
export interface GroupBinding { group: Group; changed: boolean; identityFiles: IdentityFilesResult }
export interface GroupUnbinding { unbound: boolean; identityFiles: IdentityFilesResult }
export interface GroupRename { group: Group; identityFiles: IdentityFilesResult }
export interface MemoryMove { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null }; to: { scope: "ecosystem"; groupId: string } }
const NO_FILES: IdentityFilesResult = { updated: 0, skipped: 0 };

/** All projects and shared memories use this one workspace database. */
export class MemoryWorkspace {
  constructor(private readonly config = new WorkspaceConfig()) {}

  init(): void {
    this.config.repairExistingRoot();
    if (this.config.exists()) {
      const store = this.open(true);
      store.close();
      return;
    }
    this.config.prepare();
    const store = openWorkspaceDatabase(this.config.databasePath, true, false, (path, options) => new MemoryStore(path, options));
    try { this.config.save(); }
    finally { store.close(); }
  }

  open(readonly = false): MemoryStore {
    this.config.read();
    return openWorkspaceDatabase(this.config.databasePath, false, readonly, (path, options) => new MemoryStore(path, options));
  }

  createProject(name: string): Project {
    if (typeof name !== "string" || !name.trim() || name.includes("\0")) {
      throw new MemoryError("INVALID_INPUT", "El nombre del proyecto no puede estar vacío.");
    }
    this.init();
    const store = this.open();
    try { return store.createProject(name); } finally { store.close(); }
  }

  listProjects(): Project[] {
    if (!this.config.exists()) return [];
    const store = this.open(true);
    try { return store.listProjects(); } finally { store.close(); }
  }

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

  /** Ecosystem groups: related repositories that share memory. Creating the first one enrols the base. */
  createGroup(name: string): Group {
    const label = groupName(name);
    this.init();
    const store = this.open();
    try { store.enableEcosystem(); return store.createGroup(label); } finally { store.close(); }
  }

  listGroups(): GroupSummary[] {
    if (!this.config.exists()) return [];
    const store = this.open(true);
    try { return store.listGroups(); } finally { store.close(); }
  }

  /** `group` is a group identifier or a name that identifies exactly one group. */
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

  unbindProject(projectId: string): GroupUnbinding {
    const identity = projectIdentity(projectId);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) return { unbound: false, identityFiles: { ...NO_FILES } };
      const unbound = store.unbindProject(identity);
      return { unbound, identityFiles: unbound ? updateIdentityFiles(store, identity, { group: null }) : { ...NO_FILES } };
    } finally { store.close(); }
  }

  renameGroup(group: string, name: string): GroupRename {
    const label = groupName(name);
    const store = this.open();
    try {
      if (!store.ecosystemEnabled()) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const renamed = store.renameGroup(store.resolveGroup(group).id, label);
      const identityFiles = { updated: 0, skipped: 0 };
      for (const summary of store.listGroups().filter(item => item.id === renamed.id)) {
        for (const member of summary.projects) {
          const result = updateIdentityFiles(store, member.projectId, { group: { id: renamed.id, name: renamed.name } });
          identityFiles.updated += result.updated; identityFiles.skipped += result.skipped;
        }
      }
      return { group: renamed, identityFiles };
    } finally { store.close(); }
  }

  /** Explicit, recorded migration of one memory into a group. `from` is its project id, or null for shared. */
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
}
