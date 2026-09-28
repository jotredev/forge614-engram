/**
 * Contrato del SDK público, solo de tipos: no lo importa nada, lo comprueba `tsc` al hacer el
 * chequeo de tipos (typecheck) porque el compilador falla si alguna de estas afirmaciones deja
 * de ser cierta. Verifica que cuatro tipos públicos (`MemoryScope`, `SearchScope`, `MemoryType` y
 * `WorkspaceSettings`) siguen teniendo exactamente la forma esperada, que los demás tipos de
 * la lista `contracts` se siguen exportando, y que la clase `MemoryStore` sigue teniendo
 * exactamente los mismos métodos, con las mismas firmas, que la interfaz `ExpectedStore` de aquí
 * abajo: así un cambio accidental en la forma
 * pública del SDK rompe el chequeo de tipos en vez de descubrirse en tiempo de ejecución.
 */
import type {
  ContextInput, ContextResult, Memory, MemoryScope, MemoryType, MemoryVersion, PreviewResult,
  Project, SaveInput, SearchResult, SearchScope, Session, SessionEntry, SessionSaveOptions,
  SessionSaveResult, SessionSummary, SummaryFields, TimelineInput, TimelineResult, VersionRead,
  WorkspaceSettings, MemoryStore, Group, GroupSummary, IdentityEvent, MembershipSource, ProjectGroup,
  PreviousSession, GroupSource, StartupBlock, ParallelSession,
} from "../../src/index";
import type { SyncSnapshot } from "../../src/modules/synchronization";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _MemoryScope = Assert<Equal<MemoryScope, "project" | "shared" | "ecosystem">>;
type _SearchScope = Assert<Equal<SearchScope, MemoryScope | "all">>;
type _MemoryType = Assert<Equal<MemoryType, "fact" | "decision" | "procedure" | "warning" | "preference">>;
type _WorkspaceSettings = Assert<Equal<WorkspaceSettings, {storage:"sqlite";postgresUrl?:string;installationId?:string}>>;
interface ExpectedStore {
  // D6 (T3b): las cuatro firmas de abajo con "origin" ganaron ese parámetro opcional al final (identidad de proyecto por remoto de Git); ningún nombre cambió.
  createProject(name:string):Project;getProject(projectId:string):Project|null;listProjects():Project[];renameProject(projectId:string,name:string):Project;
  sessionsEnabled():boolean;reinforcementEnabled():boolean;enableSessions():void;enableSearchReinforcement():void;startSession(projectId:string,sessionId:string,runtimeDirectory?:string):Session;endSession(projectId:string,sessionId:string):Session;getSession(projectId:string,sessionId:string):Session|null;
  startSessionForProjectDirectory(directory:string,name:string,runtimeDirectory:string,sessionId:string,bindingAvailable?:(directory:string)=>boolean,origin?:string|null):Session;
  projectForDirectory(directory:string):Project|null;bindProjectDirectory(directory:string,projectId:string):Project;
  resolveProjectDirectory(directory:string,name:string,create:boolean,bindingAvailable?:(directory:string)=>boolean,origin?:string|null):{project:Project|null;created:boolean};
  saveForProjectDirectory(directory:string,name:string,input:Omit<SaveInput,"projectId"|"scope">,bindingAvailable?:(directory:string)=>boolean,origin?:string|null):MemoryVersion;
  saveWithSessionForProjectDirectory(directory:string,name:string,runtimeDirectory:string,input:Omit<SaveInput,"projectId"|"scope">,options?:SessionSaveOptions,bindingAvailable?:(directory:string)=>boolean,origin?:string|null):SessionSaveResult;
  save(input:SaveInput):MemoryVersion;saveWithSession(input:SaveInput,options?:SessionSaveOptions):SessionSaveResult;
  saveSessionSummary(projectId:string,sessionId:string,fields:SummaryFields,request:{requestKey:string;expectedVersion?:number}):SessionSaveResult;
  get(projectId:string|null,id:string):Memory|null;getByTopic(projectId:string|null,topicKey:string):Memory|null;history(projectId:string|null,id:string):MemoryVersion[];
  search(projectId:string|null,query:string,limit?:number,scope?:SearchScope):SearchResult[];
  searchPreviews(projectId:string|null,query:string,limit?:number,scope?:SearchScope):PreviewResult[];
  getVersion(projectId:string|null,id:string,version?:number):VersionRead|null;timeline(projectId:string,input:TimelineInput):TimelineResult;
  context(projectId:string|null,input?:ContextInput):ContextResult;archive(projectId:string|null,id:string):Memory;restore(projectId:string|null,id:string):Memory;
  close():void;enableSync():void;enableProjectBindings():void;syncSnapshot():SyncSnapshot;syncCheckpoint(replica:string):SyncSnapshot;
  applySync(expected:SyncSnapshot,next:SyncSnapshot,replica:string):void;
  // Agregado en 1.6.0 (ámbito ecosystem). Puramente aditivo: nada de lo de arriba cambió.
  ecosystemEnabled():boolean;enableEcosystem():{readonly migrated:boolean;readonly backup:string|null};createGroup(name:string):Group;ensureGroup(id:string,name:string):{group:Group;created:boolean};
  getGroup(id:string):Group|null;findGroups(name:string):Group[];resolveGroup(reference:string):Group;listGroups():GroupSummary[];renameGroup(id:string,name:string):Group;
  bindProjectToGroup(projectId:string,groupId:string,source?:MembershipSource):{group:Group;changed:boolean};unbindProject(projectId:string):boolean;
  groupOfProject(projectId:string):ProjectGroup|null;identityEvents(projectId?:string):IdentityEvent[];
  getInGroup(groupId:string,id:string):Memory|null;getByTopicInGroup(groupId:string,topicKey:string):Memory|null;historyInGroup(groupId:string,id:string):MemoryVersion[];
  getVersionInGroup(groupId:string,id:string,version?:number):VersionRead|null;searchInGroup(groupId:string,query:string,limit?:number):SearchResult[];
  searchPreviewsInGroup(groupId:string,query:string,limit?:number):PreviewResult[];contextForGroup(groupId:string,input?:ContextInput):ContextResult;
  archiveInGroup(groupId:string,id:string):Memory;restoreInGroup(groupId:string,id:string):Memory;
  projectDirectories(projectId:string):string[];moveMemoryToGroup(from:string|null,id:string,groupId:string):{memory:Memory;from:{scope:"project"|"shared";projectId:string|null}};
  saveSessionSummaryInGroup(projectId:string,sessionId:string,groupId:string,fields:SummaryFields,request:{requestKey:string;expectedVersion?:number}):SessionSaveResult;
  registerProject(projectId:string,name:string):{project:Project;created:boolean};rebindProjectDirectory(directory:string,projectId:string):{previousProjectId:string|null};
  // Agregado en 1.7.0 (inteligencia de memoria). Puramente aditivo: nada de lo de arriba cambió.
  intelligenceEnabled():boolean;enableIntelligence():{readonly migrated:boolean;readonly backup:string|null};previousInterrupted(projectId:string):PreviousSession|null;
  setGroupSource(groupId:string,projectId:string):GroupSource;groupSource(groupId:string):GroupSource|null;
  demoteMemory(projectId:string,id:string):{memory:Memory;from:{scope:"ecosystem";groupId:string};to:{scope:"project";projectId:string}};
  startupBlock(projectId:string|null):StartupBlock;
  // Agregado en 1.7.1 (aviso de sesión paralela, "aviso por tiempo"). Puramente aditivo: nada de lo de arriba cambió.
  parallelSessions(projectId:string,sessionId:string):ParallelSession[];
}
type ActualStore = InstanceType<typeof MemoryStore>;
type _StoreMethodNames = Assert<Equal<keyof ActualStore, keyof ExpectedStore>>;
type StoreSignatureChecks = {[K in keyof ExpectedStore]: Equal<ActualStore[K],ExpectedStore[K]>}[keyof ExpectedStore];
type _StoreSignatures = Assert<Equal<StoreSignatureChecks,true>>;

declare const contracts: [Project, SaveInput, MemoryVersion, Memory, SearchResult, Session, SessionEntry,
  SessionSummary, SessionSaveOptions, SessionSaveResult, SummaryFields, PreviewResult, VersionRead,
  TimelineInput, TimelineResult, ContextInput, ContextResult];
void contracts;
