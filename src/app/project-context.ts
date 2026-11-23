/** Resuelve la identidad local a partir de los vínculos, del catálogo Git y de los archivos legados. */
import { MemoryError } from "../shared/errors";
import type { MemoryVersion, SaveInput } from "../modules/memory";
import { normalizeIdentityOrigin, projectIdentity, type Project } from "../modules/projects";
import type { ParallelSession, PreviousSession, Session, SessionSaveOptions, SessionSaveResult } from "../modules/sessions";
import { MemoryStore, projectIdentityFor } from "./memory-store";
import { applyDeclaredGroup, declaredGroupChanges, enrollEcosystem, groupOf, publishIdentity, readDeclaredGroup, type IdentityNotice } from "./project-identity";
import { readProjectFile, type ProjectFile } from "../infrastructure/filesystem/project-identity-file";
import { canonicalProject, canonicalProjectForRead, identityRoot, runtimeProjectDirectory, bindingAvailable } from "../infrastructure/git/project-directory";
import { readOriginRemote } from "../infrastructure/git/remote-origin";
import type { ProjectBindingCorrection } from "../infrastructure/sqlite/project-catalog";
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

function allowsEvidence(correction: ProjectBindingCorrection, evidence: FolderEvidence, candidates: string[]): boolean {
  const fileId = evidence.file?.project.id;
  const otherCandidates = candidates.filter(id => id !== correction.projectId);
  return (!fileId || fileId === correction.projectId || fileId === correction.legacyProjectId)
    && (otherCandidates.length === 0 || (evidence.origin === correction.origin && otherCandidates.every(id => correction.candidates.includes(id))));
}

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
      const correction = identity.correction(evidence.directory);
      if (correction?.projectId === binding.projectId && allowsEvidence(correction, evidence, ids)) {
        return { status: "known", projectId: binding.projectId, source: "binding" };
      }
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
  const identity = projectIdentityFor(store);
  const previous = identity.confirmedOrigin(projectId);
  const correction = previous !== null && previous !== evidence.origin ? identity.correction(evidence.directory) : null;
  if (correction?.projectId === projectId && correction.origin === evidence.origin) return [];
  return previous !== null && previous !== evidence.origin
    ? [{ code: "PROJECT_ORIGIN_CONFIRMATION_REQUIRED", message: "Confirma el remoto actual con project-bind --accept-origin para reconocer futuros clones." }]
    : [];
}

function acceptsGroupDeclaration(store: MemoryStore, directory: string, projectId: string): boolean {
  const identity = projectIdentityFor(store);
  return !identity.hasExplicitGroupPolicy(projectId) && identity.correction(directory)?.projectId !== projectId;
}

function publishResolved(store: MemoryStore, evidence: FolderEvidence, project: Project, legacy: boolean): IdentityNotice[] {
  if (evidence.file && evidence.file.project.id !== project.projectId) return [];
  return publishIdentity(store, project, evidence.root, legacy);
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
  const prepared = migrated ? decideProject(store, evidence) : initial;
  requireDecision(prepared);
  const notices: IdentityNotice[] = [];
  if (group && !store.ecosystemEnabled()
      && (prepared.status === "unbound" || acceptsGroupDeclaration(store, evidence.directory, prepared.projectId))) enrollEcosystem(store, notices);

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
    if ((group || evidence.file) && acceptsGroupDeclaration(store, evidence.directory, project.projectId)) {
      applyDeclaredGroup(store, project.projectId, group, evidence.file);
    }
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
  const needsImport = !store.projectForDirectory(evidence.directory)
    || (acceptsGroupDeclaration(store, evidence.directory, projectId) && declaredGroupChanges(store, projectId, group, evidence.file));
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
    notices.push(...publishResolved(store, evidence, project, file === null));
  }
  return context(store, evidence, project.projectId, written?.source ?? source, notices);
}

export function resolveProjectContext(store: MemoryStore, directory: string, create: boolean): ProjectContext {
  if (typeof create !== "boolean") throw new MemoryError("INVALID_INPUT", "create debe ser booleano.");
  const evidence = folderEvidence(directory, canonicalProject(directory));
  if (!create) return readFolder(store, evidence, false);
  const result = writeProject(store, evidence, project => project);
  const notices = [...result.notices, ...publishResolved(store, evidence, result.project, result.source !== "created" && result.source !== "file")];
  return context(store, evidence, result.project.projectId, result.source, notices);
}

export function resolveStartupProjectContext(store: MemoryStore, directory: string): ProjectContext {
  return readFolder(store, folderEvidence(directory, canonicalProjectForRead(directory)), true);
}

interface CreateProjectOptions { name: string; replaceFrom?: string }
interface BindProjectOptions { replaceFrom?: string; acceptOrigin?: boolean }

function correctionMismatch(): never {
  throw new MemoryError("PROJECT_BINDING_CONFLICT", "El vínculo actual no coincide con --replace-from. Revisa el UUID de la carpeta antes de corregirlo.");
}

function displacedFile(evidence: FolderEvidence, projectId: string): string | null {
  const declared = evidence.file?.project.id;
  return declared && declared !== projectId ? declared : null;
}

function explicitContext(store: MemoryStore, evidence: FolderEvidence, project: Project, source: "created" | "binding",
    notices: IdentityNotice[]): ProjectContext {
  const legacy = displacedFile(evidence, project.projectId);
  if (legacy !== null) notices.push({
    code: "PROJECT_FILE_DISPLACED", message: `El vínculo local conserva el proyecto elegido y deja intacta la identidad legada ${legacy}.`,
  });
  notices.push(...publishResolved(store, evidence, project, false));
  return context(store, evidence, project.projectId, source, notices);
}

export function createProjectContext(store: MemoryStore, directory: string, options: CreateProjectOptions): ProjectContext {
  const evidence = folderEvidence(directory, canonicalProject(directory));
  const replaceFrom = options.replaceFrom === undefined ? null : projectIdentity(options.replaceFrom);
  const identity = projectIdentityFor(store);
  identity.ensureSchema();

  const project = identity.write(() => {
    const binding = store.projectForDirectory(evidence.directory);
    const candidates = evidence.origin === null ? [] : identity.candidates(evidence.origin).map(item => item.project.projectId);
    if (binding) {
      const latest = identity.correction(evidence.directory);
      if (latest?.cause === "create" && latest.projectId === binding.projectId && latest.previousProjectId === replaceFrom
          && latest.origin === evidence.origin && binding.name === options.name.trim() && allowsEvidence(latest, evidence, candidates)) return binding;
    }
    if ((binding?.projectId ?? null) !== replaceFrom) correctionMismatch();
    const created = store.createProject(options.name);
    identity.useExplicitGroupPolicy(created.projectId);
    if (!binding && evidence.file === null && evidence.origin !== null && candidates.length === 0 && identity.catalogReady()) {
      identity.confirmOrigin(created.projectId, evidence.origin);
    }
    identity.replaceBinding(evidence.directory, created.projectId);
    identity.recordCorrection(evidence.directory, {
      projectId: created.projectId, previousProjectId: binding?.projectId ?? null, legacyProjectId: displacedFile(evidence, created.projectId),
      origin: evidence.origin, candidates, cause: "create",
    });
    return created;
  });

  return explicitContext(store, evidence, project, "created", []);
}

export function bindProjectContext(store: MemoryStore, directory: string, rawProjectId: string, options: BindProjectOptions = {}): ProjectContext {
  const evidence = folderEvidence(directory, canonicalProject(directory));
  const projectId = projectIdentity(rawProjectId);
  const replaceFrom = options.replaceFrom === undefined ? null : projectIdentity(options.replaceFrom);
  const legacy = displacedFile(evidence, projectId);
  if (legacy && replaceFrom === null) {
    throw new MemoryError("PROJECT_FILE_CONFLICT", "La carpeta declara otra identidad de proyecto en .forge614/project.json. Usa --replace-from para confirmar el UUID anterior.");
  }

  const identity = projectIdentityFor(store);
  if (replaceFrom || evidence.origin !== null || options.acceptOrigin) identity.ensureSchema();
  const cause = options.acceptOrigin ? "bind-origin" : "bind";
  const notices: IdentityNotice[] = [];
  const group = replaceFrom === null ? readDeclaredGroup(evidence.root, evidence.file) : null;
  const hasOtherOrigin = () => evidence.origin !== null && identity.candidates(evidence.origin).some(item => item.project.projectId !== projectId);
  if (group && !store.ecosystemEnabled() && acceptsGroupDeclaration(store, evidence.directory, projectId) && !hasOtherOrigin()) {
    enrollEcosystem(store, notices);
  }

  const project = identity.write(() => {
    const selected = requireProject(store, projectId);
    const binding = store.projectForDirectory(evidence.directory);
    const candidates = evidence.origin === null ? [] : identity.candidates(evidence.origin).map(item => item.project.projectId);
    const latest = binding?.projectId === projectId && replaceFrom ? identity.correction(evidence.directory) : null;
    const replay = latest !== null && latest.cause === cause && (latest.previousProjectId ?? latest.legacyProjectId) === replaceFrom
      && latest.origin === evidence.origin && allowsEvidence(latest, evidence, candidates);
    if (replay) return selected;
    if (replaceFrom !== null ? replaceFrom !== (binding?.projectId ?? legacy)
        : binding !== null && binding.projectId !== projectId) correctionMismatch();
    const otherCandidates = candidates.filter(id => id !== projectId);
    if (options.acceptOrigin) {
      if (evidence.origin === null) throw new MemoryError("PROJECT_BINDING_REQUIRED", "Configura un remoto origin de Git utilizable antes de confirmarlo.");
      if (!identity.catalogReady()) throw new MemoryError("PROJECT_BINDING_REQUIRED", bindingRequired("cloud-pending").message);
      if (otherCandidates.length) throw new MemoryError("PROJECT_BINDING_REQUIRED", "Ese remoto está asociado a otro proyecto.");
      identity.confirmOrigin(projectId, evidence.origin);
    }
    identity.replaceBinding(evidence.directory, projectId);
    const correction = replaceFrom !== null || otherCandidates.length > 0;
    if (correction) identity.recordCorrection(evidence.directory, {
      projectId, previousProjectId: binding?.projectId ?? null, legacyProjectId: legacy, origin: evidence.origin,
      candidates, cause,
    });
    else if ((group || evidence.file) && acceptsGroupDeclaration(store, evidence.directory, projectId)) {
      applyDeclaredGroup(store, projectId, group, evidence.file);
    }
    return selected;
  });

  return explicitContext(store, evidence, project, "binding", notices);
}

export function saveProjectMemory(store: MemoryStore, directory: string, input: ProjectMemoryInput): MemoryVersion {
  const evidence = folderEvidence(directory, canonicalProject(directory));
  const result = writeProject(store, evidence, project => store.save({ ...input, scope: "project", projectId: project.projectId }));
  publishResolved(store, evidence, result.project, false);
  return result.value;
}

export function saveProjectMemoryWithSessionAndNotices(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): { saved: SessionSaveResult; notices: IdentityNotice[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory, canonical);
  const evidence = folderEvidence(directory, canonical, runtimeDirectory);
  const result = writeProject(store, evidence, project => store.saveWithSession({ ...input, scope: "project", projectId: project.projectId },
    { ...options, runtimeDirectory }));
  return { saved: result.value, notices: [...result.notices, ...publishResolved(store, evidence, result.project, false)] };
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
  return { session, notices: [...result.notices, ...publishResolved(store, evidence, result.project, true)],
    ...(previous ? { previous } : {}), ...(parallel?.length ? { parallel } : {}) };
}

export function startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session {
  return startProjectSessionWithNotices(store, directory, sessionId).session;
}
