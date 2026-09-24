import { previousInterrupted } from "../infrastructure/sqlite/activity";
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
import { applySnapshot,checkpoint,exportSnapshot } from "../infrastructure/sqlite/snapshots";
import * as writes from "../infrastructure/sqlite/writes";
import type { Group,GroupSource,GroupSummary,IdentityEvent,MembershipSource,ProjectGroup } from "../modules/ecosystem";
import { type Memory,type MemoryVersion,type SaveInput,type SearchResult,type SearchScope } from "../modules/memory";
import { type Project } from "../modules/projects";
import { type ContextInput,type ContextResult,type PreviewResult,type TimelineInput,type TimelineResult,type VersionRead } from "../modules/search";
import { type PreviousSession,type Session,type SessionSaveOptions,type SessionSaveResult,type SummaryFields } from "../modules/sessions";
import type { SyncSnapshot } from "../modules/synchronization";

export class MemoryStore {
  private readonly db: ReturnType<typeof openDatabase>;
  private closed = false;
  constructor(path: string = defaultDatabasePath(), options: { create?: boolean; readonly?: boolean } = {}) {
    this.db = openDatabase(path, options);
  }
  createProject(name: string): Project { return projects.createProject(this.db, name); }
  getProject(projectId: string): Project | null { return projects.getProject(this.db, projectId); }
  projectDirectories(projectId: string): string[] { return projects.projectDirectories(this.db, projectId); }
  moveMemoryToGroup(from: string | null, id: string, groupId: string): { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null } } { return writes.moveMemoryToGroup(this.db, from, id, groupId); }
  saveSessionSummaryInGroup(projectId: string, sessionId: string, groupId: string, fields: SummaryFields,
      request: {requestKey:string;expectedVersion?:number}): SessionSaveResult { return writes.saveSessionSummary(this.db, projectId, sessionId, fields, request, groupId); }
  registerProject(projectId: string, name: string): { project: Project; created: boolean } { return projects.registerProject(this.db, projectId, name); }
  rebindProjectDirectory(directory: string, projectId: string): { previousProjectId: string | null } { return writes.rebindProjectDirectory(this.db, directory, projectId); }
  listProjects(): Project[] { return projects.listProjects(this.db); }
  renameProject(projectId: string, name: string): Project { return writes.renameProject(this.db, projectId, name); }
  sessionsEnabled(): boolean { return sessions.sessionsEnabled(this.db); }
  reinforcementEnabled(): boolean { return confirmations.reinforcementEnabled(this.db); }
  enableSearchReinforcement(): void { return enableSearchReinforcement(this.db); }
  enableSessions(): void { return enableSessionLifecycle(this.db); }
  startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session { return writes.startSession(this.db, projectId, sessionId, runtimeDirectory); }
  endSession(projectId: string, sessionId: string): Session { return writes.endSession(this.db, projectId, sessionId); }
  getSession(projectId: string, sessionId: string): Session | null { return sessions.getSession(this.db, projectId, sessionId); }
  startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string,
      bindingAvailable?: (directory:string)=>boolean): Session { return writes.startSessionForProjectDirectory(this.db, directory, name, runtimeDirectory, sessionId, bindingAvailable); }
  projectForDirectory(directory: string): Project | null { return projects.projectForDirectory(this.db, directory); }
  bindProjectDirectory(directory: string, projectId: string): Project { return writes.bindProjectDirectory(this.db, directory, projectId); }
  resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean): { project: Project | null; created: boolean } { return writes.resolveProjectDirectory(this.db, directory, name, create, bindingAvailable); }
  saveForProjectDirectory(directory: string, name: string, input: Omit<SaveInput,"projectId"|"scope">, bindingAvailable?: (directory:string)=>boolean): MemoryVersion { return writes.saveForProjectDirectory(this.db, directory, name, input, bindingAvailable); }
  saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string,
      input: Omit<SaveInput,"projectId"|"scope">, options: SessionSaveOptions = {},
      bindingAvailable?: (directory:string)=>boolean): SessionSaveResult { return writes.saveWithSessionForProjectDirectory(this.db, directory, name, runtimeDirectory, input, options, bindingAvailable); }
  save(input: SaveInput): MemoryVersion { return writes.save(this.db, input); }
  saveWithSession(input: SaveInput, options: SessionSaveOptions = {}): SessionSaveResult { return writes.saveWithSession(this.db, input, options); }
  saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields,
      request: {requestKey:string;expectedVersion?:number}): SessionSaveResult { return writes.saveSessionSummary(this.db, projectId, sessionId, fields, request); }
  get(projectId: string | null, id: string): Memory | null { return memory.get(this.db, projectId, id); }
  getByTopic(projectId: string | null, topicKey: string): Memory | null { return memory.getByTopic(this.db, projectId, topicKey); }
  history(projectId: string | null, id: string): MemoryVersion[] { return memory.history(this.db, projectId, id); }
  search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[] { return search.search(this.db, projectId, query, limit, scope); }
  searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[] { return search.searchPreviews(this.db, projectId, query, limit, scope); }
  getVersion(projectId: string | null, id: string, version?: number): VersionRead | null { return search.getVersion(this.db, projectId, id, version); }
  timeline(projectId: string, input: TimelineInput): TimelineResult { return search.timeline(this.db, projectId, input); }
  context(projectId: string | null, input?: ContextInput): ContextResult { return search.context(this.db, projectId, input); }
  archive(projectId: string | null, id: string): Memory { return writes.archive(this.db, projectId, id); }
  restore(projectId: string | null, id: string): Memory { return writes.restore(this.db, projectId, id); }
  close(): void { if (!this.closed) { closeDatabase(this.db); this.closed = true; } }
  enableSync(): void { return enableSynchronization(this.db); }
  enableProjectBindings(): void { return enableProjectBindings(this.db); }
  syncSnapshot(): SyncSnapshot { return exportSnapshot(this.db); }
  syncCheckpoint(replica: string): SyncSnapshot { return checkpoint(this.db, replica); }
  applySync(expected: SyncSnapshot, next: SyncSnapshot, replica: string): void { return applySnapshot(this.db, expected, next, replica); }

  // Ecosystem scope: groups of related projects. Additive; every method above is unchanged.
  ecosystemEnabled(): boolean { return groups.ecosystemEnabled(this.db); }
  enableEcosystem(): EcosystemEnrolment { return enableEcosystem(this.db); }
  createGroup(name: string): Group { return groups.createGroup(this.db, name); }
  ensureGroup(id: string, name: string): { group: Group; created: boolean } { return groups.ensureGroup(this.db, id, name); }
  getGroup(id: string): Group | null { return groups.getGroup(this.db, id); }
  findGroups(name: string): Group[] { return groups.findGroupsByName(this.db, name); }
  resolveGroup(reference: string): Group { return groups.resolveGroup(this.db, reference); }
  listGroups(): GroupSummary[] { return groups.listGroups(this.db); }
  renameGroup(id: string, name: string): Group { return groups.renameGroup(this.db, id, name); }
  bindProjectToGroup(projectId: string, groupId: string, source: MembershipSource = "command"): { group: Group; changed: boolean } { return groups.bindProjectToGroup(this.db, projectId, groupId, source); }
  unbindProject(projectId: string): boolean { return groups.unbindProject(this.db, projectId); }
  groupOfProject(projectId: string): ProjectGroup | null { return groups.groupOfProject(this.db, projectId); }
  identityEvents(projectId?: string): IdentityEvent[] { return groups.identityEvents(this.db, projectId); }
  getInGroup(groupId: string, id: string): Memory | null { return memory.get(this.db, { groupId }, id); }
  getByTopicInGroup(groupId: string, topicKey: string): Memory | null { return memory.getByTopic(this.db, { groupId }, topicKey); }
  historyInGroup(groupId: string, id: string): MemoryVersion[] { return memory.history(this.db, { groupId }, id); }
  getVersionInGroup(groupId: string, id: string, version?: number): VersionRead | null { return search.getVersion(this.db, { groupId }, id, version); }
  searchInGroup(groupId: string, query: string, limit = 10): SearchResult[] { return search.search(this.db, null, query, limit, "ecosystem", groupId); }
  searchPreviewsInGroup(groupId: string, query: string, limit = 10): PreviewResult[] { return search.searchPreviews(this.db, null, query, limit, "ecosystem", groupId); }
  contextForGroup(groupId: string, input?: ContextInput): ContextResult { return search.context(this.db, { groupId }, input); }
  archiveInGroup(groupId: string, id: string): Memory { return writes.archive(this.db, { groupId }, id); }
  restoreInGroup(groupId: string, id: string): Memory { return writes.restore(this.db, { groupId }, id); }

  // Memory intelligence (schema level 11). Additive; explicit enrollment only.
  intelligenceEnabled(): boolean { return intelligenceEnabled(this.db); }
  enableIntelligence(): IntelligenceEnrolment { return enableIntelligence(this.db); }
  previousInterrupted(projectId: string): PreviousSession | null { return previousInterrupted(this.db, projectId); }
  setGroupSource(groupId: string, projectId: string): GroupSource { return board.setGroupSource(this.db, groupId, projectId); }
  groupSource(groupId: string): GroupSource | null { return board.groupSource(this.db, groupId); }
  demoteMemory(projectId: string, id: string): { memory: Memory; from: { scope: "ecosystem"; groupId: string }; to: { scope: "project"; projectId: string } } { return board.demoteMemory(this.db, projectId, id); }
}
