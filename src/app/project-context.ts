/** Resuelve la identidad local a partir de los vínculos, del catálogo Git y de los archivos legados. */
import { MemoryError } from "../shared/errors";
import type { MemoryVersion, SaveInput } from "../modules/memory";
import { normalizeIdentityOrigin, type Project } from "../modules/projects";
import type { ParallelSession, PreviousSession, Session, SessionSaveOptions, SessionSaveResult } from "../modules/sessions";
import { MemoryStore, projectIdentityFor } from "./memory-store";
import { applyDeclaredGroup, declaredGroupChanges, enrollEcosystem, groupOf, publishIdentity, readDeclaredGroup, type IdentityNotice } from "./project-identity";
import { readProjectFile, type ProjectFile } from "../infrastructure/filesystem/project-identity-file";
import { canonicalProject, canonicalProjectForRead, identityRoot, runtimeProjectDirectory, bindingAvailable } from "../infrastructure/git/project-directory";
import { readOriginRemote } from "../infrastructure/git/remote-origin";
export { assertGitProjectDirectory } from "../infrastructure/git/project-directory";

export interface ProjectContext {
  projectId: string | null;
  directory: string;
  source: string;
  group?: { id: string; name: string };
  notices?: IdentityNotice[];
}

type ProjectMemoryInput = Omit<SaveInput, "projectId" | "scope">;
type Canonical = ReturnType<typeof canonicalProject>;
type FolderEvidence = { directory: string; name: string; root: string | null; origin: string | null; file: ProjectFile | null };
type PendingReason = "ambiguous" | "conflict" | "unverified-origin" | "cloud-pending";
type ProjectDecision =
  | { status: "known"; projectId: string; source: "binding" | "file" | "remote" }
  | { status: "unbound" }
  | { status: "pending"; reason: PendingReason; candidates: string[] };

function folderEvidence(directory: string, canonical: Canonical, root = identityRoot(directory, canonical)): FolderEvidence {
  const raw = canonical.git ? readOriginRemote(canonical.directory) : null;
  return {
    directory: canonical.directory,
    name: canonical.name,
    root,
    origin: raw === null ? null : normalizeIdentityOrigin(raw),
    file: root === null ? null : readProjectFile(root),
  };
}

function decideProject(store: MemoryStore, evidence: FolderEvidence): ProjectDecision {
  const identity = projectIdentityFor(store);
  const binding = store.projectForDirectory(evidence.directory);
  const fileId = evidence.file?.project.id;
  if (!binding && (fileId || evidence.origin) && !identity.catalogReady()) {
    return { status: "pending", reason: "cloud-pending", candidates: [] };
  }
  const candidates = evidence.origin === null ? [] : identity.candidates(evidence.origin);
  const ids = candidates.map(candidate => candidate.project.projectId);
  if (binding) {
    if ((fileId && fileId !== binding.projectId) || ids.some(id => id !== binding.projectId)) {
      return { status: "pending", reason: "conflict", candidates: [...new Set([binding.projectId, ...ids, ...(fileId ? [fileId] : [])])].sort() };
    }
    return { status: "known", projectId: binding.projectId, source: fileId ? "file" : "binding" };
  }
  const [candidate] = candidates;
  if (candidate) {
    if (candidates.length > 1) return { status: "pending", reason: "ambiguous", candidates: ids };
    const projectId = candidate.project.projectId;
    if (fileId && fileId !== projectId) return { status: "pending", reason: "conflict", candidates: [fileId, projectId].sort() };
    if (!candidate.verified) return { status: "pending", reason: "unverified-origin", candidates: ids };
    return { status: "known", projectId, source: "remote" };
  }
  if (fileId && evidence.origin !== null) {
    const confirmed = identity.confirmedOrigin(fileId);
    if (confirmed !== null && confirmed !== evidence.origin) return { status: "pending", reason: "conflict", candidates: [fileId] };
  }
  return fileId ? { status: "known", projectId: fileId, source: "file" } : { status: "unbound" };
}

function bindingRequired(reason: PendingReason): IdentityNotice {
  const message = reason === "cloud-pending"
    ? "Engram necesita sincronizar el catálogo antes de vincular esta carpeta. Ejecuta sync o elige el proyecto con project-bind."
    : "Engram necesita confirmar la identidad de esta carpeta. Usa project-bind para resolver el vínculo.";
  return { code: "PROJECT_BINDING_REQUIRED", message };
}

function requireDecision(decision: ProjectDecision): asserts decision is Exclude<ProjectDecision, { status: "pending" }> {
  if (decision.status === "pending") throw new MemoryError("PROJECT_BINDING_REQUIRED", bindingRequired(decision.reason).message);
}

function originNotice(store: MemoryStore, evidence: FolderEvidence, projectId: string): IdentityNotice[] {
  if (evidence.origin === null) return [];
  const previous = projectIdentityFor(store).confirmedOrigin(projectId);
  return previous !== null && previous !== evidence.origin
    ? [{ code: "PROJECT_ORIGIN_CONFIRMATION_REQUIRED", message: "Confirma el remoto actual con project-bind --accept-origin para reconocer futuros clones." }]
    : [];
}

function context(store: MemoryStore, evidence: FolderEvidence, projectId: string | null, source: string, notices: IdentityNotice[] = []): ProjectContext {
  const group = groupOf(store, projectId);
  return { projectId, directory: evidence.directory, source, ...(group ? { group } : {}), ...(notices.length ? { notices } : {}) };
}

function requireProject(store: MemoryStore, projectId: string): Project {
  const project = store.getProject(projectId);
  if (!project) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
  return project;
}

/** Confirma los datos de SQLite dentro de la operación que los necesita. */
function writeProject<T>(store: MemoryStore, evidence: FolderEvidence, use: (project: Project) => T,
    legacyImport = false, group = readDeclaredGroup(evidence.root, evidence.file)) {
  const identity = projectIdentityFor(store);
  const initial = decideProject(store, evidence);
  const canMigrate = initial.status !== "pending" || initial.reason === "unverified-origin" || initial.reason === "ambiguous";
  const migrated = !legacyImport && evidence.origin !== null && canMigrate && identity.ensureSchema();
  requireDecision(migrated ? decideProject(store, evidence) : initial);
  const notices: IdentityNotice[] = [];
  if (group && !store.ecosystemEnabled()) enrollEcosystem(store, notices);

  return identity.write(() => {
    const decision = decideProject(store, evidence);
    requireDecision(decision);
    let project: Project;
    let source: string;
    if (decision.status === "unbound") {
      const resolved = identity.resolveUnbound(evidence.directory, evidence.name, bindingAvailable, evidence.origin);
      project = resolved.project!;
      source = resolved.created ? "created" : "remote";
    } else {
      const file = evidence.file;
      project = decision.source === "file" && file
        ? store.registerProject(decision.projectId, file.project.name).project
        : requireProject(store, decision.projectId);
      store.bindProjectDirectory(evidence.directory, project.projectId);
      source = decision.source;
    }
    applyDeclaredGroup(store, project.projectId, group, evidence.file);
    notices.push(...originNotice(store, evidence, project.projectId));
    return { value: use(project), project, source, notices };
  });
}

/** Las coincidencias por remoto son lecturas puras. Los archivos legados compatibles siguen importándose. */
function readFolder(store: MemoryStore, evidence: FolderEvidence, publishLegacy: boolean): ProjectContext {
  const decision = decideProject(store, evidence);
  if (decision.status === "pending") return context(store, evidence, null, "unbound", [bindingRequired(decision.reason)]);
  if (decision.status === "unbound") return context(store, evidence, null, "unbound");
  const { projectId, source } = decision;
  if (source === "remote" || (source === "binding" && !publishLegacy)) {
    return context(store, evidence, projectId, source, originNotice(store, evidence, projectId));
  }

  const group = readDeclaredGroup(evidence.root, evidence.file);
  const needsImport = !store.projectForDirectory(evidence.directory) || declaredGroupChanges(store, projectId, group, evidence.file);
  let written;
  try { written = needsImport ? writeProject(store, evidence, project => project, true, group) : null; }
  catch (error) {
    if (!(error instanceof MemoryError) || error.code !== "PROJECT_BINDING_REQUIRED") throw error;
    return context(store, evidence, null, "unbound", [{ code: error.code, message: error.message }]);
  }
  const project = written?.project ?? requireProject(store, projectId);
  const notices = written?.notices ?? originNotice(store, evidence, projectId);
  const file = evidence.file;
  if (file === null || file.ecosystem === undefined || (file.ecosystem === null && group !== null)) {
    notices.push(...publishIdentity(store, project, evidence.root, file === null));
  }
  return context(store, evidence, project.projectId, written?.source ?? source, notices);
}

export function resolveProjectContext(store: MemoryStore, directory: string, create: boolean): ProjectContext {
  if (typeof create !== "boolean") throw new MemoryError("INVALID_INPUT", "create debe ser booleano.");
  const evidence = folderEvidence(directory, canonicalProject(directory));
  if (!create) return readFolder(store, evidence, false);
  const result = writeProject(store, evidence, project => project);
  const notices = [...result.notices, ...publishIdentity(store, result.project, evidence.root, result.source !== "created" && result.source !== "file")];
  return context(store, evidence, result.project.projectId, result.source, notices);
}

export function resolveStartupProjectContext(store: MemoryStore, directory: string): ProjectContext {
  return readFolder(store, folderEvidence(directory, canonicalProjectForRead(directory)), true);
}

export function bindProjectContext(store: MemoryStore, directory: string, projectId: string): ProjectContext {
  const evidence = folderEvidence(directory, canonicalProject(directory));
  if (evidence.file !== null && evidence.file.project.id !== projectId) {
    throw new MemoryError("PROJECT_FILE_CONFLICT", "La carpeta ya declara otra identidad de proyecto en .forge614/project.json; bórralo o usa esa identidad.");
  }
  const notices: IdentityNotice[] = [];
  const group = readDeclaredGroup(evidence.root, evidence.file);
  if (group && !store.ecosystemEnabled()) enrollEcosystem(store, notices);
  const project = projectIdentityFor(store).write(() => {
    const bound = store.bindProjectDirectory(evidence.directory, projectId);
    applyDeclaredGroup(store, bound.projectId, group, evidence.file);
    return bound;
  });
  notices.push(...publishIdentity(store, project, evidence.root, false));
  return context(store, evidence, project.projectId, "binding", notices);
}

export function saveProjectMemory(store: MemoryStore, directory: string, input: ProjectMemoryInput): MemoryVersion {
  const evidence = folderEvidence(directory, canonicalProject(directory));
  const result = writeProject(store, evidence, project => store.save({ ...input, scope: "project", projectId: project.projectId }));
  publishIdentity(store, result.project, evidence.root, false);
  return result.value;
}

export function saveProjectMemoryWithSessionAndNotices(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): { saved: SessionSaveResult; notices: IdentityNotice[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory, canonical);
  const evidence = folderEvidence(directory, canonical, runtimeDirectory);
  const result = writeProject(store, evidence, project => store.saveWithSession({ ...input, scope: "project", projectId: project.projectId },
    { ...options, runtimeDirectory }));
  return { saved: result.value, notices: [...result.notices, ...publishIdentity(store, result.project, evidence.root, false)] };
}

export function saveProjectMemoryWithSession(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): SessionSaveResult {
  return saveProjectMemoryWithSessionAndNotices(store, directory, input, options).saved;
}

export function startProjectSessionWithNotices(store: MemoryStore, directory: string, sessionId: string):
    { session: Session; notices: IdentityNotice[]; previous?: PreviousSession; parallel?: ParallelSession[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory, canonical);
  const evidence = folderEvidence(directory, canonical, runtimeDirectory);
  const intelligence = store.intelligenceEnabled();
  const result = writeProject(store, evidence, project => {
    const existed = intelligence && store.getSession(project.projectId, sessionId) !== null;
    return { existed, session: store.startSession(project.projectId, sessionId, runtimeDirectory) };
  });
  const { session, existed } = result.value;
  const previous = intelligence && !existed ? store.previousInterrupted(session.projectId) : null;
  const parallel = intelligence && !existed ? store.parallelSessions(session.projectId, sessionId) : null;
  return { session, notices: [...result.notices, ...publishIdentity(store, result.project, evidence.root, true)],
    ...(previous ? { previous } : {}), ...(parallel?.length ? { parallel } : {}) };
}

export function startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session {
  return startProjectSessionWithNotices(store, directory, sessionId).session;
}
