import { MemoryError } from "../shared/errors";
import type { Project } from "../modules/projects";
import { projectIdentity } from "../modules/projects";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryStore } from "./memory-store";
import { openWorkspaceDatabase } from "../infrastructure/sqlite/workspace-database";

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
    try { return store.renameProject(projectId, name); } finally { store.close(); }
  }
}
