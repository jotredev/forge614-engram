/**
 * Resuelve, liga y usa el proyecto asociado a una carpeta de trabajo: identifica el
 * proyecto (por archivo de identidad o por vínculo de carpeta), lo crea si hace falta y
 * se pidió, y ofrece las variantes de guardar memoria e iniciar sesión que además hacen
 * esa resolución. Mantiene sincronizado `.forge614/project.json` con la base local.
 */
import { MemoryError } from "../shared/errors";
import type { MemoryVersion, SaveInput } from "../modules/memory";
import type { ParallelSession, PreviousSession, Session, SessionSaveOptions, SessionSaveResult } from "../modules/sessions";
import { MemoryStore } from "./memory-store";
import { applyIdentityFile, groupOf, publishIdentity, type IdentityNotice } from "./project-identity";
import { readProjectFile } from "../infrastructure/filesystem/project-identity-file";
import { canonicalProject, canonicalProjectForRead, identityRoot, runtimeProjectDirectory, bindingAvailable } from "../infrastructure/git/project-directory";
import { readOriginRemote } from "../infrastructure/git/remote-origin";
export { assertGitProjectDirectory } from "../infrastructure/git/project-directory";

/** Resultado de identificar el proyecto de una carpeta. */
export interface ProjectContext {
  /** Identificador del proyecto identificado, o `null` si no se identificó ninguno. */
  projectId: string | null;
  /** Carpeta en su forma canónica (resuelta, por ejemplo, con `realpath`). */
  directory: string;
  /** Cómo se identificó: `"file"` (archivo de identidad), `"binding"` (vínculo ya registrado), `"created"` (proyecto nuevo) o `"unbound"` (no se identificó). */
  source: string;
  /** Grupo (ecosistema) al que pertenece el proyecto, si pertenece a alguno. */
  group?: { id: string; name: string };
  /** Avisos generados al registrar, ligar o publicar la identidad, si los hubo. */
  notices?: IdentityNotice[];
}

/** Campos de una memoria de proyecto sin `projectId` ni `scope`, que estas funciones resuelven a partir de la carpeta. */
type ProjectMemoryInput = Omit<SaveInput,"projectId"|"scope">;
/** Forma normalizada de una carpeta (ruta canónica y nombre) tal como la produce `canonicalProject`. */
type Canonical = ReturnType<typeof canonicalProject>;

/**
 * Resuelve el proyecto de una carpeta, creando uno nuevo si no existe y `create` es `true`.
 * @param store Base abierta desde la que se lee y, si aplica, se escribe.
 * @param directory Carpeta de trabajo cuyo proyecto se quiere resolver.
 * @param create Si se permite crear un proyecto nuevo cuando la carpeta no está ligada a ninguno.
 * @returns El contexto del proyecto resuelto (o creado).
 * @throws MemoryError con código `INVALID_INPUT` si `create` no es un valor booleano.
 */
export function resolveProjectContext(store: MemoryStore, directory: string, create: boolean): ProjectContext {
  if (typeof create !== "boolean") throw new MemoryError("INVALID_INPUT","create debe ser booleano.");
  const canonical = canonicalProject(directory);
  // D6 (T3b): el remoto solo hace falta cuando de verdad se puede crear un proyecto; con create=false
  // (la ruta más frecuente, en cada lectura) leerlo sería un archivo de disco de más sin ningún uso.
  const origin = create && canonical.git ? readOriginRemote(canonical.directory) : null;
  return resolveCanonicalProjectContext(store, canonical, create, identityRoot(directory, canonical), create, origin);
}

/** Precarga de solo lectura en su mayoría: nunca crea un proyecto para una carpeta sin vínculo, pero mantiene los archivos de identidad al día. Nunca lee el remoto de Git (D6): es una ruta de solo lectura. */
export function resolveStartupProjectContext(store: MemoryStore, directory: string): ProjectContext {
  const canonical = canonicalProjectForRead(directory);
  return resolveCanonicalProjectContext(store, canonical, false, identityRoot(directory, canonical), true, null);
}

/**
 * Núcleo común de la resolución: primero intenta identificar el proyecto por su archivo
 * de identidad; si no hay archivo (o no declara proyecto), cae al vínculo de carpeta
 * registrado en la base (creando el proyecto si `create` lo permite).
 * @param canonical Carpeta ya normalizada, con su nombre canónico.
 * @param create Si se permite crear un proyecto nuevo al caer al vínculo de carpeta.
 * @param root Carpeta desde la que se busca el archivo de identidad, o `null` si no aplica.
 * @param publish Si se debe reescribir el archivo de identidad tras resolver por vínculo de carpeta.
 * @param origin Remoto de Git crudo de `canonical.directory` (D6, T3b), o `null` si no aplica o no se leyó.
 */
function resolveCanonicalProjectContext(store: MemoryStore, canonical: Canonical, create: boolean, root: string | null, publish: boolean, origin: string | null): ProjectContext {
  const fromFile = applyIdentityFile(store, canonical.directory, root);
  const notices = [...fromFile.notices];
  let projectId: string | null, source: string;
  if (fromFile.projectId !== null) { projectId = fromFile.projectId; source = "file"; }
  else {
    const resolved = store.resolveProjectDirectory(canonical.directory,canonical.name,create,bindingAvailable,origin);
    projectId = resolved.project?.projectId ?? null;
    source = resolved.created ? "created" : resolved.project ? "binding" : "unbound";
    // Solo se publica (reescribe) el archivo de identidad cuando se pidió y de verdad se resolvió un proyecto por vínculo de carpeta.
    if (publish && resolved.project) notices.push(...publishIdentity(store, resolved.project, root, !resolved.created));
  }
  const group = groupOf(store, projectId);
  return { projectId, directory:canonical.directory, source, ...(group ? { group } : {}), ...(notices.length ? { notices } : {}) };
}

/**
 * Liga explícitamente una carpeta a un proyecto ya existente y publica su identidad.
 * @param store Base abierta desde la que se lee y a la que se escribe el vínculo.
 * @param directory Carpeta a ligar.
 * @param projectId Identificador del proyecto al que se liga la carpeta.
 * @returns El contexto resultante, con `source` siempre `"binding"`.
 * @throws MemoryError con código `PROJECT_FILE_CONFLICT` si la carpeta ya tiene un archivo
 * de identidad que declara un proyecto distinto al pedido.
 */
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

/**
 * Guarda una memoria de proyecto resolviendo el proyecto a partir de la carpeta (lo crea
 * si hace falta) y publicando su identidad después.
 * @param store Base abierta a la que se guarda.
 * @param directory Carpeta cuyo proyecto recibe la memoria.
 * @param input Campos de la memoria a guardar (sin `projectId` ni `scope`, que se resuelven aquí).
 * @returns La versión de la memoria recién guardada.
 */
export function saveProjectMemory(store: MemoryStore, directory: string, input: ProjectMemoryInput): MemoryVersion {
  const canonical = canonicalProject(directory);
  const root = identityRoot(directory, canonical);
  applyIdentityFile(store, canonical.directory, root);
  // D6 (T3b): esta ruta siempre puede crear el proyecto (writes.ts la llama con create=true), así que el remoto siempre es útil aquí.
  const origin = canonical.git ? readOriginRemote(canonical.directory) : null;
  const saved = store.saveForProjectDirectory(canonical.directory,canonical.name,input,bindingAvailable,origin);
  const project = saved.projectId === null ? null : store.getProject(saved.projectId);
  if (project) publishIdentity(store, project, root, false);
  return saved;
}

/**
 * Como `saveProjectMemoryWithSession`, pero además informa los avisos de identidad
 * (por ejemplo, una migración de la base) que se produjeron al resolver el proyecto.
 * @param store Base abierta a la que se guarda.
 * @param directory Carpeta cuyo proyecto recibe la memoria.
 * @param input Campos de la memoria a guardar.
 * @param options Opciones de guardado ligado a la sesión (por ejemplo, `sessionId`).
 * @returns El resultado del guardado y los avisos de identidad generados.
 */
export function saveProjectMemoryWithSessionAndNotices(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): { saved: SessionSaveResult; notices: IdentityNotice[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  const root = identityRoot(directory, canonical);
  const notices = [...applyIdentityFile(store, canonical.directory, root).notices];
  // D6 (T3b): esta ruta siempre puede crear el proyecto (writes.ts la llama con create=true), así que el remoto siempre es útil aquí.
  const origin = canonical.git ? readOriginRemote(canonical.directory) : null;
  const saved = store.saveWithSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,input,options,bindingAvailable,origin);
  const project = saved.memory.projectId === null ? null : store.getProject(saved.memory.projectId);
  if (project) notices.push(...publishIdentity(store, project, root, false));
  return { saved, notices };
}

/**
 * Como `saveProjectMemoryWithSessionAndNotices`, pero devuelve solo el resultado del
 * guardado, sin los avisos de identidad.
 * @param store Base abierta a la que se guarda.
 * @param directory Carpeta cuyo proyecto recibe la memoria.
 * @param input Campos de la memoria a guardar.
 * @param options Opciones de guardado ligado a la sesión.
 * @returns El resultado del guardado (memoria y, si aplica, datos de la sesión).
 */
export function saveProjectMemoryWithSession(store: MemoryStore, directory: string,
    input: ProjectMemoryInput, options: SessionSaveOptions = {}): SessionSaveResult {
  return saveProjectMemoryWithSessionAndNotices(store, directory, input, options).saved;
}

/**
 * Como `startProjectSession`, pero además informa los avisos de identidad (por ejemplo, el
 * archivo que se acaba de escribir) y, solo para una sesión creada por esta llamada (nunca
 * en una repetición con el mismo id): la sesión previa del proyecto que quedó abierta
 * durante PARALLEL_MINUTES o más (si la hay), y cualquier otra de sus sesiones en tiempo de
 * ejecución que siga abierta en paralelo con esta (si las hay, como máximo PARALLEL_LIMIT, 1.7.1).
 * @param store Base abierta desde la que se lee y a la que se escribe la sesión.
 * @param directory Carpeta cuyo proyecto inicia la sesión.
 * @param sessionId Identificador de la sesión a iniciar (o repetir, si ya existía).
 * @returns La sesión iniciada, los avisos de identidad y, cuando aplica, `previous` y `parallel`.
 */
export function startProjectSessionWithNotices(store: MemoryStore, directory: string, sessionId: string): { session: Session; notices: IdentityNotice[]; previous?: PreviousSession; parallel?: ParallelSession[] } {
  const canonical = canonicalProject(directory);
  const runtimeDirectory = runtimeProjectDirectory(directory,canonical);
  const root = identityRoot(directory, canonical);
  const identity = applyIdentityFile(store, canonical.directory, root);
  const notices = [...identity.notices];
  // Solo con el nivel 11: si este id ya nombra una sesión, se comprueba antes de iniciarla (una repetición nunca informa `previous`/`parallel`).
  const known = store.intelligenceEnabled() ? (identity.projectId ?? store.projectForDirectory(canonical.directory)?.projectId ?? null) : null;
  const existed = known !== null && store.getSession(known, sessionId) !== null;
  // D6 (T3b): esta ruta siempre puede crear el proyecto (writes.ts la llama con create=true), así que el remoto siempre es útil aquí.
  const origin = canonical.git ? readOriginRemote(canonical.directory) : null;
  const session = store.startSessionForProjectDirectory(canonical.directory,canonical.name,runtimeDirectory,sessionId,bindingAvailable,origin);
  const project = store.getProject(session.projectId);
  if (project) notices.push(...publishIdentity(store, project, root, true));
  const previous = store.intelligenceEnabled() && !existed ? store.previousInterrupted(session.projectId) : null;
  const parallel = store.intelligenceEnabled() && !existed ? store.parallelSessions(session.projectId, sessionId) : null;
  return { session, notices, ...(previous ? { previous } : {}), ...(parallel && parallel.length ? { parallel } : {}) };
}

/**
 * Como `startProjectSessionWithNotices`, pero devuelve solo la sesión, sin avisos ni datos
 * de sesión previa o paralela.
 * @param store Base abierta desde la que se lee y a la que se escribe la sesión.
 * @param directory Carpeta cuyo proyecto inicia la sesión.
 * @param sessionId Identificador de la sesión a iniciar.
 * @returns La sesión iniciada (o la existente, si `sessionId` ya se había usado).
 */
export function startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session {
  return startProjectSessionWithNotices(store, directory, sessionId).session;
}
