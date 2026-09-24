import { MemoryError } from "../shared/errors";
import type { MemoryVersion, SaveInput } from "../modules/memory";
import type { PreviousSession, Session, SessionSaveOptions, SessionSaveResult } from "../modules/sessions";
import { MemoryStore } from "./memory-store";
import { applyIdentityFile, groupOf, publishIdentity, type IdentityNotice } from "./project-identity";
import { readProjectFile } from "../infrastructure/filesystem/project-identity-file";
import { canonicalProject, canonicalProjectForRead, identityRoot, runtimeProjectDirectory, bindingAvailable } from "../infrastructure/git/project-directory";
export { assertGitProjectDirectory } from "../infrastructure/git/project-directory";

export interface ProjectContext {
  projectId: string | null;
  directory: string;
  source: string;
  group?: { id: string; name: string };
  notices?: IdentityNotice[];
}

type ProjectMemoryInput = Omit<SaveInput,"projectId"|"scope">;
type Canonical = ReturnType<typeof canonicalProject>;

export function resolveProjectContext(store: MemoryStore, directory: string, create: boolean): ProjectContext {
  if (typeof create !== "boolean") throw new MemoryError("INVALID_INPUT","create debe ser booleano.");
  const canonical = canonicalProject(directory);
  return resolveCanonicalProjectContext(store, canonical, create, identityRoot(directory, canonical), create);
}

/** Read-mostly preload: never creates a project for an unbound folder, but keeps identity files in step. */
export function resolveStartupProjectContext(store: MemoryStore, directory: string): ProjectContext {
  const canonical = canonicalProjectForRead(directory);
  return resolveCanonicalProjectContext(store, canonical, false, identityRoot(directory, canonical), true);
}

function resolveCanonicalProjectContext(store: MemoryStore, canonical: Canonical, create: boolean, root: string | null, publish: boolean): ProjectContext {
  const fromFile = applyIdentityFile(store, canonical.directory, root);
  const notices = [...fromFile.notices];
  let projectId: string | null, source: string;
  if (fromFile.projectId !== null) { projectId = fromFile.projectId; source = "file"; }
  else {
    const resolved = store.resolveProjectDirectory(canonical.directory,canonical.name,create,bindingAvailable);
    projectId = resolved.project?.projectId ?? null;
    source = resolved.created ? "created" : resolved.project ? "binding" : "unbound";
    if (publish && resolved.project) notices.push(...publishIdentity(store, resolved.project, root, !resolved.created));
  }
  const group = groupOf(store, projectId);
  return { projectId, directory:canonical.directory, source, ...(group ? { group } : {}), ...(notices.length ? { notices } : {}) };
}

export function bindProjectContext(store: MemoryStore, directory: string, projectId: string): ProjectContext {
  const canonical = canonicalProject(directory);
  const root = identityRoot(directory, canonical);
  const file = root === null ? null : readProjectFile(root);
  if (file !== null && file.project.id !== projectId) {
    throw new MemoryError("PROJECT_FILE_CONFLICT","La carpeta ya declara otra identidad de proyecto en .forge614/project.json; bórralo o usa esa identidad.");
  }
  const project = store.bindProjectDirectory(canonical.directory,projectId);
  const notices = publishIdentity(store, project, root, false);
  const group = groupOf(store, project.projectId);
  return { projectId:project.projectId,directory:canonical.directory,source:"binding",...(group ? { group } : {}),...(notices.length ? { notices } : {}) };
}

export function saveProjectMemory(store: MemoryStore, directory: string, input: ProjectMemoryInput): MemoryVersion {
  const canonical = canonicalProject(directory);
  const root = identityRoot(directory, canonical);
  applyIdentityFile(store, canonical.directory, root);
  const saved = store.saveForProjectDirectory(canonical.directory,canonical.name,input,bindingAvailable);
  const project = saved.projectId === null ? null : store.getProject(saved.projectId);
  if (project) publishIdentity(store, project, root, false);
  return saved;
}

/** Like saveProjectMemoryWithSession, also reporting the identity notices (for example a base upgrade). */
export function saveProjectMemoryWithSessionAndNotices(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): { saved: SessionSaveResult; notices: IdentityNotice[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  const root = identityRoot(directory, canonical);
  const notices = [...applyIdentityFile(store, canonical.directory, root).notices];
  const saved = store.saveWithSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,input,options,bindingAvailable);
  const project = saved.memory.projectId === null ? null : store.getProject(saved.memory.projectId);
  if (project) notices.push(...publishIdentity(store, project, root, false));
  return { saved, notices };
}

export function saveProjectMemoryWithSession(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): SessionSaveResult {
  return saveProjectMemoryWithSessionAndNotices(store, directory, input, options).saved;
}

/** Like startProjectSession, also reporting the identity notices (for example the file just written) and,
 * for a session created by this call, the project's previously interrupted session (if any). */
export function startProjectSessionWithNotices(store: MemoryStore, directory: string, sessionId: string): { session: Session; notices: IdentityNotice[]; previous?: PreviousSession } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  const root = identityRoot(directory, canonical);
  const identity = applyIdentityFile(store, canonical.directory, root);
  const notices = [...identity.notices];
  // Level 11 only: whether this id already names a session, read before starting (a replay never reports `previous`).
  const known = store.intelligenceEnabled() ? (identity.projectId ?? store.projectForDirectory(canonical.directory)?.projectId ?? null) : null;
  const existed = known !== null && store.getSession(known, sessionId) !== null;
  const session = store.startSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,sessionId,bindingAvailable);
  const project = store.getProject(session.projectId);
  if (project) notices.push(...publishIdentity(store, project, root, true));
  const previous = store.intelligenceEnabled() && !existed ? store.previousInterrupted(session.projectId) : null;
  return { session, notices, ...(previous ? { previous } : {}) };
}

export function startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session {
  return startProjectSessionWithNotices(store, directory, sessionId).session;
}
