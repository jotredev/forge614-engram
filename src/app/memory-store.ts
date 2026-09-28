/**
 * Fachada (facade) única de la capa de aplicación sobre la base SQLite: cada método
 * delega en un módulo de infraestructura (`memory`, `projects`, `writes`, `search`,
 * `sessions`, `groups`, etc.) y expone la base como un solo objeto, sin que quien la usa
 * necesite saber en qué módulo vive cada operación ni tocar la base de datos directamente.
 */
import { parallelSessions,previousInterrupted } from "../infrastructure/sqlite/activity";
import { closeDatabase,defaultDatabasePath,openDatabase } from "../infrastructure/sqlite/connection";
import * as groups from "../infrastructure/sqlite/ecosystem-groups";
import * as memory from "../infrastructure/sqlite/memory";
import * as projects from "../infrastructure/sqlite/projects";
import * as confirmations from "../infrastructure/sqlite/confirmations";
import { intelligenceEnabled } from "../infrastructure/sqlite/intelligence";
import * as board from "../infrastructure/sqlite/board";
import { enableEcosystem,type EcosystemEnrolment,enableIntelligence,type IntelligenceEnrolment,enableProjectBindings,enableSearchReinforcement,enableSessionLifecycle,enableSynchronization } from "../infrastructure/sqlite/schema";
import * as search from "../infrastructure/sqlite/search";
import * as sessions from "../infrastructure/sqlite/sessions";
import { startupBlock } from "../infrastructure/sqlite/startup";
import { applySnapshot,checkpoint,exportSnapshot } from "../infrastructure/sqlite/snapshots";
import * as writes from "../infrastructure/sqlite/writes";
import type { Group,GroupSource,GroupSummary,IdentityEvent,MembershipSource,ProjectGroup } from "../modules/ecosystem";
import { type Memory,type MemoryVersion,type SaveInput,type SearchResult,type SearchScope } from "../modules/memory";
import { type Project } from "../modules/projects";
import { type ContextInput,type ContextResult,type PreviewResult,type StartupBlock,type TimelineInput,type TimelineResult,type VersionRead } from "../modules/search";
import { type ParallelSession,type PreviousSession,type Session,type SessionSaveOptions,type SessionSaveResult,type SummaryFields } from "../modules/sessions";
import type { SyncSnapshot } from "../modules/synchronization";

/** Fachada de acceso a una base SQLite de Engram: proyectos, memorias, sesiones, sincronización, ecosistema (grupos) e inteligencia. */
export class MemoryStore {
  private readonly db: ReturnType<typeof openDatabase>;
  private closed = false;
  /**
   * Abre (o crea) la base SQLite en `path`.
   * @param path Ruta del archivo de base de datos; por defecto, la ruta estándar de Engram.
   * @param options `create` permite crear el archivo si no existe; `readonly` abre sin permiso de escritura.
   */
  constructor(path: string = defaultDatabasePath(), options: { create?: boolean; readonly?: boolean } = {}) {
    this.db = openDatabase(path, options);
  }
  /** Crea un proyecto nuevo con el nombre dado y devuelve su registro. */
  createProject(name: string): Project { return projects.createProject(this.db, name); }
  /** Lee un proyecto por su id, o `null` si no existe. */
  getProject(projectId: string): Project | null { return projects.getProject(this.db, projectId); }
  /** Lista las carpetas que hoy están ligadas a este proyecto. */
  projectDirectories(projectId: string): string[] { return projects.projectDirectories(this.db, projectId); }
  /** Mueve una memoria de un proyecto (o de compartidas, si `from` es `null`) al ecosistema (grupo) dado. */
  moveMemoryToGroup(from: string | null, id: string, groupId: string): { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null } } { return writes.moveMemoryToGroup(this.db, from, id, groupId); }
  /** Guarda el resumen de una sesión de proyecto, pero anotado como perteneciente al grupo `groupId` en vez de al proyecto. */
  saveSessionSummaryInGroup(projectId: string, sessionId: string, groupId: string, fields: SummaryFields,
      request: {requestKey:string;expectedVersion?:number}): SessionSaveResult { return writes.saveSessionSummary(this.db, projectId, sessionId, fields, request, groupId); }
  /** Registra un proyecto con un id ya conocido (por ejemplo, el declarado en un archivo de identidad), creándolo si no existía. */
  registerProject(projectId: string, name: string): { project: Project; created: boolean } { return projects.registerProject(this.db, projectId, name); }
  /** Cambia el proyecto al que está ligada una carpeta ya ligada a otro, devolviendo el proyecto anterior. */
  rebindProjectDirectory(directory: string, projectId: string): { previousProjectId: string | null } { return writes.rebindProjectDirectory(this.db, directory, projectId); }
  /** Lista todos los proyectos registrados en la base. */
  listProjects(): Project[] { return projects.listProjects(this.db); }
  /** Cambia el nombre de un proyecto existente. */
  renameProject(projectId: string, name: string): Project { return writes.renameProject(this.db, projectId, name); }
  /** Si el nivel de esquema de esta base ya tiene activado el ciclo de vida de sesiones. */
  sessionsEnabled(): boolean { return sessions.sessionsEnabled(this.db); }
  /** Si el nivel de esquema de esta base ya tiene activado el refuerzo de búsqueda (nivel 3 de sincronización). */
  reinforcementEnabled(): boolean { return confirmations.reinforcementEnabled(this.db); }
  /** Migra la base para activar el refuerzo de búsqueda. */
  enableSearchReinforcement(): void { return enableSearchReinforcement(this.db); }
  /** Migra la base para activar el ciclo de vida de sesiones. */
  enableSessions(): void { return enableSessionLifecycle(this.db); }
  /** Inicia una sesión para un proyecto ya identificado por su id, anotando en qué carpeta corre si se da `runtimeDirectory`. */
  startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session { return writes.startSession(this.db, projectId, sessionId, runtimeDirectory); }
  /** Cierra (marca como terminada) una sesión ya iniciada. */
  endSession(projectId: string, sessionId: string): Session { return writes.endSession(this.db, projectId, sessionId); }
  /** Lee una sesión por proyecto y id, o `null` si no existe. */
  getSession(projectId: string, sessionId: string): Session | null { return sessions.getSession(this.db, projectId, sessionId); }
  /** Como `startSession`, pero resolviendo primero el proyecto a partir de una carpeta (la liga, la crea, o la reconoce por remoto de Git según `origin`, D6). */
  startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string,
      bindingAvailable?: (directory:string)=>boolean, origin?: string | null): Session { return writes.startSessionForProjectDirectory(this.db, directory, name, runtimeDirectory, sessionId, bindingAvailable, origin); }
  /** Lee el proyecto ya ligado a una carpeta, o `null` si ninguno lo está. */
  projectForDirectory(directory: string): Project | null { return projects.projectForDirectory(this.db, directory); }
  /** Liga una carpeta a un proyecto ya existente. */
  bindProjectDirectory(directory: string, projectId: string): Project { return writes.bindProjectDirectory(this.db, directory, projectId); }
  /** Resuelve el proyecto de una carpeta por su vínculo registrado, creándolo si `create` es `true` y no existía ninguno (o ligándola por remoto de Git si `origin` coincide con un proyecto ya conocido, D6, T3b). */
  resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean, origin?: string | null): { project: Project | null; created: boolean } { return writes.resolveProjectDirectory(this.db, directory, name, create, bindingAvailable, origin); }
  /** Guarda una memoria resolviendo antes el proyecto de la carpeta dada. */
  saveForProjectDirectory(directory: string, name: string, input: Omit<SaveInput,"projectId"|"scope">, bindingAvailable?: (directory:string)=>boolean, origin?: string | null): MemoryVersion { return writes.saveForProjectDirectory(this.db, directory, name, input, bindingAvailable, origin); }
  /** Como `saveForProjectDirectory`, pero además ligado a una sesión (la abre si hace falta). */
  saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string,
      input: Omit<SaveInput,"projectId"|"scope">, options: SessionSaveOptions = {},
      bindingAvailable?: (directory:string)=>boolean, origin?: string | null): SessionSaveResult { return writes.saveWithSessionForProjectDirectory(this.db, directory, name, runtimeDirectory, input, options, bindingAvailable, origin); }
  /** Guarda una memoria con el proyecto y alcance (`scope`) ya indicados en `input`. */
  save(input: SaveInput): MemoryVersion { return writes.save(this.db, input); }
  /** Como `save`, pero ligado a una sesión de proyecto. */
  saveWithSession(input: SaveInput, options: SessionSaveOptions = {}): SessionSaveResult { return writes.saveWithSession(this.db, input, options); }
  /** Guarda el resumen de una sesión de proyecto (sin moverla a un grupo). */
  saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields,
      request: {requestKey:string;expectedVersion?:number}): SessionSaveResult { return writes.saveSessionSummary(this.db, projectId, sessionId, fields, request); }
  /** Lee una memoria por proyecto (o compartida, con `projectId` `null`) e id. */
  get(projectId: string | null, id: string): Memory | null { return memory.get(this.db, projectId, id); }
  /** Lee una memoria por su clave temática (topicKey) en vez de por id. */
  getByTopic(projectId: string | null, topicKey: string): Memory | null { return memory.getByTopic(this.db, projectId, topicKey); }
  /** Lista todas las versiones guardadas de una memoria, de la más antigua a la más nueva. */
  history(projectId: string | null, id: string): MemoryVersion[] { return memory.history(this.db, projectId, id); }
  /** Busca memorias por texto dentro del alcance (`scope`) dado, limitado a `limit` resultados. */
  search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[] { return search.search(this.db, projectId, query, limit, scope); }
  /** Como `search`, pero devuelve previsualizaciones recortadas en vez de las memorias completas. */
  searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[] { return search.searchPreviews(this.db, projectId, query, limit, scope); }
  /** Lee una versión concreta de una memoria (la última, si no se da `version`). */
  getVersion(projectId: string | null, id: string, version?: number): VersionRead | null { return search.getVersion(this.db, projectId, id, version); }
  /** Lista los eventos recientes del proyecto (memorias y sesiones) en orden cronológico, filtrados según `input`. */
  timeline(projectId: string, input: TimelineInput): TimelineResult { return search.timeline(this.db, projectId, input); }
  /** Arma el contexto de arranque de un proyecto (o compartido, con `projectId` `null`): memorias relevantes dentro de un límite de bytes. */
  context(projectId: string | null, input?: ContextInput): ContextResult { return search.context(this.db, projectId, input); }
  /** Marca una memoria como archivada, para que deje de aparecer en búsquedas por defecto. */
  archive(projectId: string | null, id: string): Memory { return writes.archive(this.db, projectId, id); }
  /** Revierte el archivado de una memoria. */
  restore(projectId: string | null, id: string): Memory { return writes.restore(this.db, projectId, id); }
  /** Cierra la conexión a la base; llamar dos veces no hace nada la segunda vez. */
  close(): void { if (!this.closed) { closeDatabase(this.db); this.closed = true; } }
  /** Migra la base para activar la sincronización con PostgreSQL. */
  enableSync(): void { return enableSynchronization(this.db); }
  /** Migra la base para activar los vínculos de carpeta a proyecto. */
  enableProjectBindings(): void { return enableProjectBindings(this.db); }
  /** Exporta una fotografía (snapshot) completa del estado sincronizable de la base. */
  syncSnapshot(): SyncSnapshot { return exportSnapshot(this.db); }
  /** Lee la última fotografía (snapshot) que se sincronizó con éxito con la réplica dada. */
  syncCheckpoint(replica: string): SyncSnapshot { return checkpoint(this.db, replica); }
  /** Aplica una fotografía (snapshot) combinada a la base, comprobando que `expected` sigue siendo el estado local esperado. */
  applySync(expected: SyncSnapshot, next: SyncSnapshot, replica: string): void { return applySnapshot(this.db, expected, next, replica); }

  // Alcance de ecosistema: grupos de proyectos relacionados. Es aditivo; ningún método de arriba cambia.
  /** Si el nivel de esquema de esta base ya tiene activado el ecosistema (grupos de proyectos). */
  ecosystemEnabled(): boolean { return groups.ecosystemEnabled(this.db); }
  /** Migra la base para activar el ecosistema. */
  enableEcosystem(): EcosystemEnrolment { return enableEcosystem(this.db); }
  /** Crea un grupo (ecosistema) nuevo con el nombre dado. */
  createGroup(name: string): Group { return groups.createGroup(this.db, name); }
  /** Asegura que existe un grupo con el id y nombre dados, creándolo si hace falta. */
  ensureGroup(id: string, name: string): { group: Group; created: boolean } { return groups.ensureGroup(this.db, id, name); }
  /** Lee un grupo por su id, o `null` si no existe. */
  getGroup(id: string): Group | null { return groups.getGroup(this.db, id); }
  /** Busca grupos cuyo nombre coincide (total o parcialmente) con el dado. */
  findGroups(name: string): Group[] { return groups.findGroupsByName(this.db, name); }
  /** Resuelve un grupo a partir de una referencia (id o nombre), exigiendo que sea exactamente uno. */
  resolveGroup(reference: string): Group { return groups.resolveGroup(this.db, reference); }
  /** Lista todos los grupos con un resumen de cada uno (por ejemplo, cuántos proyectos tienen). */
  listGroups(): GroupSummary[] { return groups.listGroups(this.db); }
  /** Cambia el nombre de un grupo existente. */
  renameGroup(id: string, name: string): Group { return groups.renameGroup(this.db, id, name); }
  /** Liga un proyecto a un grupo, anotando el origen del vínculo (comando explícito, archivo de identidad, etc.). */
  bindProjectToGroup(projectId: string, groupId: string, source: MembershipSource = "command"): { group: Group; changed: boolean } { return groups.bindProjectToGroup(this.db, projectId, groupId, source); }
  /** Quita a un proyecto de su grupo, si tenía uno; devuelve si de verdad estaba ligado. */
  unbindProject(projectId: string): boolean { return groups.unbindProject(this.db, projectId); }
  /** Lee el grupo (y cómo se ligó) del proyecto dado, o `null` si no pertenece a ninguno. */
  groupOfProject(projectId: string): ProjectGroup | null { return groups.groupOfProject(this.db, projectId); }
  /** Lista los eventos de identidad (registros, vínculos, migraciones de grupo) recientes, opcionalmente filtrados por proyecto. */
  identityEvents(projectId?: string): IdentityEvent[] { return groups.identityEvents(this.db, projectId); }
  /** Como `get`, pero para una memoria de alcance de grupo (ecosistema) en vez de proyecto. */
  getInGroup(groupId: string, id: string): Memory | null { return memory.get(this.db, { groupId }, id); }
  /** Como `getByTopic`, pero para una memoria de alcance de grupo. */
  getByTopicInGroup(groupId: string, topicKey: string): Memory | null { return memory.getByTopic(this.db, { groupId }, topicKey); }
  /** Como `history`, pero para una memoria de alcance de grupo. */
  historyInGroup(groupId: string, id: string): MemoryVersion[] { return memory.history(this.db, { groupId }, id); }
  /** Como `getVersion`, pero para una memoria de alcance de grupo. */
  getVersionInGroup(groupId: string, id: string, version?: number): VersionRead | null { return search.getVersion(this.db, { groupId }, id, version); }
  /** Como `search`, pero restringida al alcance "ecosystem" del grupo dado. */
  searchInGroup(groupId: string, query: string, limit = 10): SearchResult[] { return search.search(this.db, null, query, limit, "ecosystem", groupId); }
  /** Como `searchPreviews`, pero restringida al alcance "ecosystem" del grupo dado. */
  searchPreviewsInGroup(groupId: string, query: string, limit = 10): PreviewResult[] { return search.searchPreviews(this.db, null, query, limit, "ecosystem", groupId); }
  /** Como `context`, pero para el alcance de grupo (ecosistema) dado. */
  contextForGroup(groupId: string, input?: ContextInput): ContextResult { return search.context(this.db, { groupId }, input); }
  /** Como `archive`, pero para una memoria de alcance de grupo. */
  archiveInGroup(groupId: string, id: string): Memory { return writes.archive(this.db, { groupId }, id); }
  /** Como `restore`, pero para una memoria de alcance de grupo. */
  restoreInGroup(groupId: string, id: string): Memory { return writes.restore(this.db, { groupId }, id); }

  // Inteligencia de memoria (nivel de esquema 11). Es aditiva; solo se activa explícitamente.
  /** Si el nivel de esquema de esta base ya tiene activada la inteligencia de memoria. */
  intelligenceEnabled(): boolean { return intelligenceEnabled(this.db); }
  /** Migra la base para activar la inteligencia de memoria. */
  enableIntelligence(): IntelligenceEnrolment { return enableIntelligence(this.db); }
  /** Lee la última sesión del proyecto que quedó abierta e interrumpida, si la hay. */
  previousInterrupted(projectId: string): PreviousSession | null { return previousInterrupted(this.db, projectId); }
  /** Arma el bloque de texto de arranque (formato 2) para el proyecto dado, dentro de 5000 caracteres. */
  startupBlock(projectId: string | null): StartupBlock { return startupBlock(this.db, projectId); }
  // Añadido en 1.7.1: sesiones que siguen abiertas en paralelo con la dada, "aviso por tiempo" en vez de marcarlas al iniciar.
  /** Lista las otras sesiones del proyecto que siguen abiertas al mismo tiempo que `sessionId`. */
  parallelSessions(projectId: string, sessionId: string): ParallelSession[] { return parallelSessions(this.db, projectId, sessionId); }
  /** Marca a un proyecto como la fuente (origen) de un grupo, para saber de dónde vienen sus reglas comunes. */
  setGroupSource(groupId: string, projectId: string): GroupSource { return board.setGroupSource(this.db, groupId, projectId); }
  /** Lee cuál es hoy el proyecto fuente de un grupo, o `null` si ninguno lo es. */
  groupSource(groupId: string): GroupSource | null { return board.groupSource(this.db, groupId); }
  /** Mueve una memoria de ecosistema (grupo) de vuelta a un proyecto concreto del grupo. */
  demoteMemory(projectId: string, id: string): { memory: Memory; from: { scope: "ecosystem"; groupId: string }; to: { scope: "project"; projectId: string } } { return board.demoteMemory(this.db, projectId, id); }
}
