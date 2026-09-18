import type {
  ContextInput, ContextResult, Memory, MemoryScope, MemoryType, MemoryVersion, PreviewResult,
  Project, SaveInput, SearchResult, SearchScope, Session, SessionEntry, SessionSaveOptions,
  SessionSaveResult, SessionSummary, SummaryFields, TimelineInput, TimelineResult, VersionRead,
  WorkspaceSettings, MemoryStore,
} from "../../src/index";
import type { SyncSnapshot } from "../../src/modules/synchronization";
import type { CapabilityState, ProjectSummary, SharedSummary } from "../../src/modules/control-center";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _MemoryScope = Assert<Equal<MemoryScope, "project" | "shared">>;
type _SearchScope = Assert<Equal<SearchScope, MemoryScope | "all">>;
type _MemoryType = Assert<Equal<MemoryType, "fact" | "decision" | "procedure" | "warning" | "preference">>;
type _WorkspaceSettings = Assert<Equal<WorkspaceSettings, {storage:"sqlite";postgresUrl?:string}>>;
interface ExpectedStore {
  createProject(name:string):Project;getProject(projectId:string):Project|null;listProjects():Project[];renameProject(projectId:string,name:string):Project;
  controlCenter():{capabilities:CapabilityState;projects:ProjectSummary[];shared:SharedSummary|null};
  sessionsEnabled():boolean;reinforcementEnabled():boolean;enableSessions():void;enableSearchReinforcement():void;startSession(projectId:string,sessionId:string,runtimeDirectory?:string):Session;endSession(projectId:string,sessionId:string):Session;getSession(projectId:string,sessionId:string):Session|null;
  startSessionForProjectDirectory(directory:string,name:string,runtimeDirectory:string,sessionId:string,bindingAvailable?:(directory:string)=>boolean):Session;
  projectForDirectory(directory:string):Project|null;bindProjectDirectory(directory:string,projectId:string):Project;
  resolveProjectDirectory(directory:string,name:string,create:boolean,bindingAvailable?:(directory:string)=>boolean):{project:Project|null;created:boolean};
  saveForProjectDirectory(directory:string,name:string,input:Omit<SaveInput,"projectId"|"scope">,bindingAvailable?:(directory:string)=>boolean):MemoryVersion;
  saveWithSessionForProjectDirectory(directory:string,name:string,runtimeDirectory:string,input:Omit<SaveInput,"projectId"|"scope">,options?:SessionSaveOptions,bindingAvailable?:(directory:string)=>boolean):SessionSaveResult;
  save(input:SaveInput):MemoryVersion;saveWithSession(input:SaveInput,options?:SessionSaveOptions):SessionSaveResult;
  saveSessionSummary(projectId:string,sessionId:string,fields:SummaryFields,request:{requestKey:string;expectedVersion?:number}):SessionSaveResult;
  get(projectId:string|null,id:string):Memory|null;history(projectId:string|null,id:string):MemoryVersion[];
  search(projectId:string|null,query:string,limit?:number,scope?:SearchScope):SearchResult[];
  searchPreviews(projectId:string|null,query:string,limit?:number,scope?:SearchScope):PreviewResult[];
  getVersion(projectId:string|null,id:string,version?:number):VersionRead|null;timeline(projectId:string,input:TimelineInput):TimelineResult;
  context(projectId:string|null,input?:ContextInput):ContextResult;archive(projectId:string|null,id:string):Memory;restore(projectId:string|null,id:string):Memory;
  close():void;enableSync():void;enableAssistantIntegration():void;syncSnapshot():SyncSnapshot;syncCheckpoint(replica:string):SyncSnapshot;
  applySync(expected:SyncSnapshot,next:SyncSnapshot,replica:string):void;
}
type ActualStore = InstanceType<typeof MemoryStore>;
type _StoreMethodNames = Assert<Equal<keyof ActualStore, keyof ExpectedStore>>;
type StoreSignatureChecks = {[K in keyof ExpectedStore]: Equal<ActualStore[K],ExpectedStore[K]>}[keyof ExpectedStore];
type _StoreSignatures = Assert<Equal<StoreSignatureChecks,true>>;

declare const contracts: [Project, SaveInput, MemoryVersion, Memory, SearchResult, Session, SessionEntry,
  SessionSummary, SessionSaveOptions, SessionSaveResult, SummaryFields, PreviewResult, VersionRead,
  TimelineInput, TimelineResult, ContextInput, ContextResult];
void contracts;
