import { createHash } from "node:crypto";
import { MemoryError } from "../../shared/errors";
import { memoryTypes, type Confirmation, type ConfirmationRequest, type Memory, type MemoryVersion } from "../memory";
import { projectIdentity, type Project } from "../projects";
import type { Session, SessionEntry, SessionSummary } from "../sessions";
import { sessionIdentity } from "../sessions";
import { assertConfirmationExtension,assertConfirmationRequestExtension,confirmationRequestIdentity,requestOwnerKey,validateConfirmationCollections } from "./confirmations";

export interface MemoryBundle {
  memory: Memory;
  versions: MemoryVersion[];
  requests: { request_key: string; payload_hash: string; version: number }[];
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
export interface SyncSnapshotV1 { format: 1; projects: Project[]; memories: MemoryBundle[] }
export interface SyncSnapshotV2 { format: 2; projects: Project[]; memories: MemoryBundle[]; sessions: Session[]; sessionEntries: SessionEntry[]; sessionSummaries: SessionSummary[] }
export interface SyncSnapshotV3 { format: 3; projects: Project[]; memories: MemoryBundle[]; sessions: Session[]; sessionEntries: SessionEntry[]; sessionSummaries: SessionSummary[]; confirmations: Confirmation[]; confirmationRequests: ConfirmationRequest[] }
export type SyncSnapshot = SyncSnapshotV1 | SyncSnapshotV2 | SyncSnapshotV3;
export const emptySnapshot = (): SyncSnapshotV1 => ({ format:1,projects:[],memories:[] });
export function normalizeSnapshot(value: SyncSnapshot): SyncSnapshotV2|SyncSnapshotV3 {
  return value.format !== 1 ? value : { ...value, format: 2, sessions: [], sessionEntries: [], sessionSummaries: [] };
}
export function syncError(code = "SYNC_INVALID"): never {
  throw new MemoryError(code, `${code}: sincronización detenida; se conservan los datos locales y remotos.`);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value !== null && typeof value === "object") return "{"+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value);
}
export function snapshotHash(value: SyncSnapshot): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function text(v: unknown): asserts v is string { if(typeof v!=="string" || !v.trim() || v.includes("\0")) syncError(); }
function date(v: unknown) { text(v); if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString()!==v) syncError(); }
function keys(v: unknown, expected: string): asserts v is Record<string, any> {
  if(!v || typeof v!=="object" || Array.isArray(v) || Object.keys(v).sort().join(",")!==expected.split(",").sort().join(",")) syncError();
}
function unique(set:Set<string>, key:string) { if(set.has(key)) syncError(); set.add(key); }
function version(v: unknown): asserts v is MemoryVersion {
  keys(v,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt");
  projectIdentity(v.id); text(v.title);text(v.content);date(v.createdAt);date(v.updatedAt);
  if(v.scope==="project") projectIdentity(v.projectId);
  else if(v.scope!=="shared" || v.projectId!==null) syncError();
  if(v.topicKey!==null) text(v.topicKey);
  if(!memoryTypes.includes(v.type) || typeof v.pinned!=="boolean" || !Number.isSafeInteger(v.version) || v.version<1) syncError();
}
export function validateSnapshot(value: unknown): asserts value is SyncSnapshot {
  if(Buffer.byteLength(JSON.stringify(value) ?? "")>8*1024*1024) syncError("SYNC_TOO_LARGE");
  const format=(value as {format?:unknown}|null)?.format;
  keys(value,format===3?"format,projects,memories,sessions,sessionEntries,sessionSummaries,confirmations,confirmationRequests":format===2?"format,projects,memories,sessions,sessionEntries,sessionSummaries":"format,projects,memories");
  if((value.format!==1&&value.format!==2&&value.format!==3) || !Array.isArray(value.projects) || !Array.isArray(value.memories)) syncError();
  const snapshot=value as SyncSnapshot;
  const projects=new Set<string>();const ids=new Set<string>();const topics=new Set<string>();const requests=new Set<string>();
  for(const p of snapshot.projects) {
    keys(p,"projectId,name,createdAt,updatedAt");projectIdentity(p.projectId);text(p.name);date(p.createdAt);date(p.updatedAt);unique(projects,p.projectId);
  }
  for(const b of snapshot.memories) {
    keys(b,"memory,versions,requests,events");keys(b.memory,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt,state");
    const {state,...v}=b.memory;version(v);if(state!=="active"&&state!=="archived") syncError();
    unique(ids,v.id);if(v.projectId!==null&&!projects.has(v.projectId)) syncError();
    if(v.topicKey!==null) unique(topics,canonical([v.projectId,v.topicKey]));
    if(!Array.isArray(b.versions)||b.versions.length!==v.version||!Array.isArray(b.requests)||!Array.isArray(b.events)) syncError();
    b.versions.forEach((h:unknown,i:number)=>{
      version(h);if(h.version!==i+1||h.id!==v.id||h.projectId!==v.projectId||h.scope!==v.scope||h.topicKey!==v.topicKey||h.createdAt!==v.createdAt) syncError();
    });
    if(canonical(b.versions.at(-1))!==canonical(v)) syncError();
    for(const r of b.requests) {
      keys(r,"request_key,payload_hash,version");text(r.request_key);
      if(typeof r.payload_hash!=="string"||!/^[a-f0-9]{64}$/.test(r.payload_hash)||!Number.isInteger(r.version)||r.version<1||r.version>v.version) syncError();
      unique(requests,requestOwnerKey(v.scope,v.projectId,r.request_key));
      const saved=b.versions[r.version-1] as MemoryVersion;
      const expected=createHash("sha256").update(JSON.stringify([saved.scope,saved.projectId,saved.title,saved.content,saved.type,saved.topicKey,saved.pinned,saved.version===1?null:saved.version-1])).digest("hex");
      if(r.payload_hash!==expected) syncError();
    }
    let eventVersion=0;let eventState="active";
    for(const e of b.events) {
      keys(e,"action,version,created_at");date(e.created_at);
      if(!["save","archive","restore"].includes(e.action)||!Number.isInteger(e.version)||e.version<1||e.version>v.version) syncError();
      if(e.action==="save") {
        const saved=b.versions[e.version-1];
        if(!saved||e.version!==eventVersion+1||eventState!=="active"||e.created_at!==saved.updatedAt) syncError();
        eventVersion=e.version;
      } else {
        if(eventVersion===0||e.version!==eventVersion) syncError();
        const nextState=e.action==="archive"?"archived":"active";
        if(nextState===eventState) syncError();eventState=nextState;
      }
    }
    if(eventVersion!==v.version||eventState!==state) syncError();
  }
  if(snapshot.format!==1) validateSessions(snapshot,projects);
  if(snapshot.format===3) {
    validateConfirmationCollections(snapshot.confirmations,snapshot.confirmationRequests,{
      memories:new Map(snapshot.memories.map(bundle=>[bundle.memory.id,bundle])),
      sessions:new Map(snapshot.sessions.map(session=>[session.sessionId,session])),requestKeys:requests,
      invalid:syncError,validateVersion:version,canonical,
    });
  }
}

export function sessionEntryIdentity(entry: {memoryId:string;version:number}):string { return canonical([entry.memoryId,entry.version]); }
function validateSessions(snapshot:SyncSnapshotV2|SyncSnapshotV3,projects:Set<string>):void {
  if(!Array.isArray(snapshot.sessions)||!Array.isArray(snapshot.sessionEntries)||!Array.isArray(snapshot.sessionSummaries)) syncError();
  const sessions=new Map<string,Session>();const entries=new Map<string,SessionEntry>();const summaries=new Set<string>();
  const memories=new Map(snapshot.memories.map(b=>[b.memory.id,b]));
  for(const s of snapshot.sessions) {
    keys(s,"sessionId,projectId,kind,startedAt,endedAt");
    try {sessionIdentity(s.sessionId);} catch {syncError();}
    projectIdentity(s.projectId);date(s.startedAt);if(s.endedAt!==null) date(s.endedAt);
    if(!projects.has(s.projectId)||sessions.has(s.sessionId)||!["runtime","manual"].includes(s.kind)||(s.kind==="manual"&&s.endedAt!==null)) syncError();
    sessions.set(s.sessionId,s);
  }
  for(const e of snapshot.sessionEntries) {
    keys(e,"sessionId,memoryId,version,recordedAt");
    const s=sessions.get(e.sessionId);const v=memories.get(e.memoryId)?.versions[e.version-1];
    date(e.recordedAt);
    if(!s||!Number.isSafeInteger(e.version)||!v||v.version!==e.version||v.updatedAt!==e.recordedAt||
      (v.scope!=="shared"&&v.projectId!==s.projectId)||entries.has(sessionEntryIdentity(e))) syncError();
    entries.set(sessionEntryIdentity(e),e);
  }
  for(const p of snapshot.sessionSummaries) {
    keys(p,"sessionId,memoryId,version");
    const s=sessions.get(p.sessionId);const v=memories.get(p.memoryId)?.versions[p.version-1];const e=entries.get(sessionEntryIdentity(p));
    if(!s||s.kind!=="runtime"||!Number.isSafeInteger(p.version)||!v||v.version!==p.version||!e||e.sessionId!==s.sessionId||
      v.scope!=="project"||v.projectId!==s.projectId||v.type!=="procedure"||v.topicKey!==`session/${s.sessionId}/summary`) syncError();
    unique(summaries,p.sessionId);
  }
}
function merge<T>(base:T[],local:T[],remote:T[],key:(v:T)=>string):T[] {
  const b=new Map(base.map(v=>[key(v),v]));const l=new Map(local.map(v=>[key(v),v]));const r=new Map(remote.map(v=>[key(v),v]));
  const out:T[]=[];
  for(const id of [...new Set([...b.keys(),...l.keys(),...r.keys()])].sort()) {
    const bv=b.get(id),lv=l.get(id),rv=r.get(id);
    // There is no physical deletion protocol: a previously seen record cannot vanish.
    if(bv!==undefined&&(lv===undefined||rv===undefined)) syncError("SYNC_CONFLICT");
    const value=canonical(lv)===canonical(rv)?lv:canonical(lv)===canonical(bv)?rv:canonical(rv)===canonical(bv)?lv:syncError("SYNC_CONFLICT");
    if(value!==undefined) out.push(value);
  }
  return out;
}
export function reconcile(base:SyncSnapshot,local:SyncSnapshot,remote:SyncSnapshot):SyncSnapshot {
  [base,local,remote].forEach(validateSnapshot);
  assertExtension(base,local);assertExtension(base,remote);
  const data={projects:merge(base.projects,local.projects,remote.projects,p=>p.projectId),memories:merge(base.memories,local.memories,remote.memories,b=>b.memory.id)};
  let result:SyncSnapshot={format:1,...data};
  if([base,local,remote].some(s=>s.format!==1)) {
    const [b,l,r]=[normalizeSnapshot(base),normalizeSnapshot(local),normalizeSnapshot(remote)] as const;
    const sessions={sessions:mergeSessions(b.sessions,l.sessions,r.sessions),
      sessionEntries:merge(b.sessionEntries,l.sessionEntries,r.sessionEntries,sessionEntryIdentity),
      sessionSummaries:merge(b.sessionSummaries,l.sessionSummaries,r.sessionSummaries,s=>s.sessionId)};
    if([base,local,remote].some(snapshot=>snapshot.format===3)) {
      const memories=new Map(data.memories.map(bundle=>[bundle.memory.id,bundle]));
      const confirmations=(snapshot:SyncSnapshot):Confirmation[]=>snapshot.format===3?snapshot.confirmations:[];
      const requests=(snapshot:SyncSnapshot):ConfirmationRequest[]=>snapshot.format===3?snapshot.confirmationRequests:[];
      result={format:3,...data,...sessions,
        confirmations:merge(confirmations(base),confirmations(local),confirmations(remote),item=>item.confirmationId),
        confirmationRequests:merge(requests(base),requests(local),requests(remote),item=>confirmationRequestIdentity(memories,item))};
    } else result={format:2,...data,...sessions};
  }
  try { validateSnapshot(result); } catch(error) {
    if(error instanceof MemoryError&&error.code==="SYNC_TOO_LARGE") throw error;
    syncError("SYNC_CONFLICT");
  }
  assertExtension(local,result);assertExtension(remote,result);
  return result;
}

function sessionExtends(current:Session,next:Session):boolean {
  return current.sessionId===next.sessionId&&current.projectId===next.projectId&&current.kind===next.kind&&current.startedAt===next.startedAt&&
    (current.endedAt===null||current.endedAt===next.endedAt);
}
function mergeSessions(base:Session[],local:Session[],remote:Session[]):Session[] {
  // Identity is immutable even when two devices first observe the same ID without a checkpoint.
  const out=new Map<string,Session>();
  for(const s of [...base,...local,...remote]) {
    const prior=out.get(s.sessionId);
    if(prior&&!sessionExtends(prior,s)&&!sessionExtends(s,prior)) syncError("SYNC_CONFLICT");
    if(!prior||prior.endedAt===null) out.set(s.sessionId,s);
  }
  return [...out.values()].sort((a,b)=>a.sessionId<b.sessionId?-1:a.sessionId>b.sessionId?1:0);
}

/** A merge may add revisions but cannot erase or rewrite either participant. */
export function assertExtension(current:SyncSnapshot,next:SyncSnapshot):void {
  if((current.format===2&&next.format===1)||(current.format===3&&next.format!==3)) syncError("SYNC_CONFLICT");
  const projects=new Map(next.projects.map(p=>[p.projectId,p]));
  const bundles=new Map(next.memories.map(b=>[b.memory.id,b]));
  for(const p of current.projects) if(!projects.has(p.projectId)||projects.get(p.projectId)!.createdAt!==p.createdAt) syncError("SYNC_CONFLICT");
  for(const b of current.memories) {
    const n=bundles.get(b.memory.id);
    if(!n||n.memory.projectId!==b.memory.projectId||n.memory.scope!==b.memory.scope||n.memory.topicKey!==b.memory.topicKey||
      canonical(n.versions.slice(0,b.versions.length))!==canonical(b.versions)||
      canonical(n.events.slice(0,b.events.length))!==canonical(b.events)||
      b.requests.some(r=>!n.requests.some(s=>canonical(r)===canonical(s)))) syncError("SYNC_CONFLICT");
  }
  if(current.format!==1&&next.format!==1) {
    const sessions=new Map(next.sessions.map(s=>[s.sessionId,s]));
    const entries=new Map(next.sessionEntries.map(e=>[sessionEntryIdentity(e),e]));
    const summaries=new Map(next.sessionSummaries.map(s=>[s.sessionId,s]));
    for(const s of current.sessions) {const n=sessions.get(s.sessionId);if(!n||!sessionExtends(s,n)) syncError("SYNC_CONFLICT");}
    for(const e of current.sessionEntries) if(canonical(entries.get(sessionEntryIdentity(e)))!==canonical(e)) syncError("SYNC_CONFLICT");
    for(const s of current.sessionSummaries) {const n=summaries.get(s.sessionId);if(!n||n.memoryId!==s.memoryId||n.version<s.version) syncError("SYNC_CONFLICT");}
  }
  if(current.format===3&&next.format===3) {
    const memories=new Map(next.memories.map(bundle=>[bundle.memory.id,bundle]));
    assertConfirmationExtension(current.confirmations,next.confirmations,canonical,()=>syncError("SYNC_CONFLICT"));
    assertConfirmationRequestExtension(current.confirmationRequests,next.confirmationRequests,memories,canonical,()=>syncError("SYNC_CONFLICT"));
  }
}
