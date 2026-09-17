// Compatibility fixture copied from 193e89a:src/sync-snapshot.ts (0.5.0).
import { createHash } from "node:crypto";
import { MemoryError } from "../../src/shared/errors";
import { memoryTypes, type Memory, type MemoryVersion } from "../../src/modules/memory";
import { type Project } from "../../src/modules/projects";
import { projectIdentity } from "../../src/modules/projects";

export interface MemoryBundle {
  memory: Memory;
  versions: MemoryVersion[];
  requests: { request_key: string; payload_hash: string; version: number }[];
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
export interface SyncSnapshot { format: 1; projects: Project[]; memories: MemoryBundle[] }
export const emptySnapshot = (): SyncSnapshot => ({ format:1,projects:[],memories:[] });
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
function date(v: unknown) { text(v); if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v))) syncError(); }
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
  keys(value,"format,projects,memories");
  if(value.format!==1 || !Array.isArray(value.projects) || !Array.isArray(value.memories)) syncError();
  const projects=new Set<string>();const ids=new Set<string>();const topics=new Set<string>();const requests=new Set<string>();
  for(const p of value.projects) {
    keys(p,"projectId,name,createdAt,updatedAt");projectIdentity(p.projectId);text(p.name);date(p.createdAt);date(p.updatedAt);unique(projects,p.projectId);
  }
  for(const b of value.memories) {
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
      unique(requests,canonical([v.projectId,r.request_key]));
      const saved=b.versions[r.version-1] as MemoryVersion;
      const expected=createHash("sha256").update(JSON.stringify([saved.scope,saved.projectId,saved.title,saved.content,saved.type,saved.topicKey,saved.pinned,saved.version===1?null:saved.version-1])).digest("hex");
      if(r.payload_hash!==expected) syncError();
    }
    let eventVersion=0;let eventState="active";
    for(const e of b.events) {
      keys(e,"action,version,created_at");date(e.created_at);
      if(!["save","archive","restore"].includes(e.action)||!Number.isInteger(e.version)||e.version<1||e.version>v.version) syncError();
      if(e.action==="save") {
        if(e.version!==eventVersion+1||eventState!=="active"||e.created_at!==b.versions[e.version-1].updatedAt) syncError();
        eventVersion=e.version;
      } else {
        if(eventVersion===0||e.version!==eventVersion) syncError();
        const nextState=e.action==="archive"?"archived":"active";
        if(nextState===eventState) syncError();eventState=nextState;
      }
    }
    if(eventVersion!==v.version||eventState!==state) syncError();
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
  const result:SyncSnapshot={format:1,projects:merge(base.projects,local.projects,remote.projects,p=>p.projectId),memories:merge(base.memories,local.memories,remote.memories,b=>b.memory.id)};
  try { validateSnapshot(result); } catch {syncError("SYNC_CONFLICT");}
  assertExtension(local,result);assertExtension(remote,result);
  return result;
}

/** A merge may add revisions but cannot erase or rewrite either participant. */
export function assertExtension(current:SyncSnapshot,next:SyncSnapshot):void {
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
}
