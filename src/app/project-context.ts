import { MemoryError } from "../shared/errors";
import type { MemoryVersion, SaveInput } from "../modules/memory";
import type { Session, SessionSaveOptions, SessionSaveResult } from "../modules/sessions";
import { MemoryStore } from "./memory-store";
import { canonicalProject, canonicalProjectForRead, runtimeProjectDirectory, bindingAvailable } from "../infrastructure/git/project-directory";
export { assertGitProjectDirectory } from "../infrastructure/git/project-directory";

export interface ProjectContext {
  projectId: string | null;
  directory: string;
  source: string;
}

type ProjectMemoryInput = Omit<SaveInput,"projectId"|"scope">;
export function resolveProjectContext(store: MemoryStore, directory: string, create: boolean): ProjectContext {
  if (typeof create !== "boolean") throw new MemoryError("INVALID_INPUT","create debe ser booleano.");
  const canonical = canonicalProject(directory);
  return resolveCanonicalProjectContext(store, canonical, create);
}

export function resolveStartupProjectContext(store: MemoryStore, directory: string): ProjectContext {
  return resolveCanonicalProjectContext(store, canonicalProjectForRead(directory), false);
}

function resolveCanonicalProjectContext(store: MemoryStore, canonical: ReturnType<typeof canonicalProject>, create: boolean): ProjectContext {
  const resolved = store.resolveProjectDirectory(canonical.directory,canonical.name,create,bindingAvailable);
  return { projectId:resolved.project?.projectId ?? null, directory:canonical.directory,
    source:resolved.created ? "created" : resolved.project ? "binding" : "unbound" };
}

export function bindProjectContext(store: MemoryStore, directory: string, projectId: string): ProjectContext {
  const canonical = canonicalProject(directory);
  const project = store.bindProjectDirectory(canonical.directory,projectId);
  return { projectId:project.projectId,directory:canonical.directory,source:"binding" };
}

export function saveProjectMemory(store: MemoryStore, directory: string, input: ProjectMemoryInput): MemoryVersion {
  const canonical = canonicalProject(directory);
  return store.saveForProjectDirectory(canonical.directory,canonical.name,input,bindingAvailable);
}

export function saveProjectMemoryWithSession(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): SessionSaveResult {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  return store.saveWithSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,input,options,bindingAvailable);
}

export function startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  return store.startSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,sessionId,bindingAvailable);
}
