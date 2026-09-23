import { createHash } from "node:crypto";
import type { Confirmation, ConfirmationRequest, Memory, MemoryScope, MemoryVersion } from "../memory";
import type { Session } from "../sessions";

interface ConfirmationBundle {
  memory:Memory;
  versions:MemoryVersion[];
}

interface ValidationContext {
  memories:Map<string,ConfirmationBundle>;
  sessions:Map<string,Session>;
  requestKeys:Set<string>;
  invalid:()=>never;
  validateVersion:(value:unknown)=>void;
  canonical:(value:unknown)=>string;
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactKeys(value:unknown, expected:string[], invalid:()=>never):asserts value is Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==[...expected].sort().join(",")) invalid();
}

function requiredText(value:unknown, invalid:()=>never):asserts value is string {
  if(typeof value!=="string"||!value.trim()||value.includes("\0")) invalid();
}

function canonicalDate(value:unknown, invalid:()=>never):asserts value is string {
  requiredText(value,invalid);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) invalid();
}

export function requestOwnerKey(scope:MemoryScope, projectId:string|null, requestKey:string):string {
  return JSON.stringify([scope,projectId,requestKey]);
}

export function confirmationRequestIdentity(memories:Map<string,ConfirmationBundle>, request:ConfirmationRequest):string {
  const memory=memories.get(request.memoryId)?.memory;
  if(!memory) return "";
  return requestOwnerKey(memory.scope,memory.projectId,request.requestKey);
}

function payloadHash(memory:MemoryVersion, expectedVersion:number|null):string {
  return createHash("sha256").update(JSON.stringify([
    memory.scope,memory.projectId,memory.title,memory.content,memory.type,memory.topicKey,memory.pinned,expectedVersion,
  ])).digest("hex");
}

function confirmationSession(memory:MemoryVersion, sessionId:string|null, sessions:Map<string,Session>, invalid:()=>never):Session|null {
  if(sessionId===null) return null;
  requiredText(sessionId,invalid);
  const session=sessions.get(sessionId);
  if(!session||(memory.scope==="project"&&session.projectId!==memory.projectId)) invalid();
  if(memory.scope==="shared"&&session.kind!=="runtime") invalid();
  return session;
}

function selectedSession(memory:MemoryVersion, sessionId:string|null, source:ConfirmationRequest["response"]["sessionSource"], sessions:Map<string,Session>, invalid:()=>never):void {
  const session=confirmationSession(memory,sessionId,sessions,invalid);
  if(session===null) {
    if(source!==null) invalid();
    return;
  }
  if(source===null||!(["explicit","inferred","manual"] as const).includes(source)) invalid();
  if((source==="explicit"||source==="inferred")&&session.kind!=="runtime") invalid();
  if(source==="manual"&&session.kind!=="manual") invalid();
  if(memory.scope==="shared"&&source!=="explicit") invalid();
}

export function validateConfirmationCollections(confirmationsValue:unknown, requestsValue:unknown, context:ValidationContext):void {
  const {memories,sessions,requestKeys,invalid,validateVersion,canonical}=context;
  if(!Array.isArray(confirmationsValue)||!Array.isArray(requestsValue)) return invalid();
  const confirmationValues:unknown[]=confirmationsValue;
  const requestValues:unknown[]=requestsValue;
  const confirmations=new Map<string,Confirmation>();
  for(const value of confirmationValues) {
    exactKeys(value,["confirmationId","memoryId","version","recordedAt","sessionId"],invalid);
    if(typeof value.confirmationId!=="string"||!uuid.test(value.confirmationId)||typeof value.memoryId!=="string"||!uuid.test(value.memoryId)||
      !Number.isSafeInteger(value.version)||Number(value.version)<1) invalid();
    canonicalDate(value.recordedAt,invalid);
    if(value.sessionId!==null&&typeof value.sessionId!=="string") invalid();
    const item=value as unknown as Confirmation;
    const historical=memories.get(item.memoryId)?.versions[item.version-1];
    if(!historical) return invalid();
    if(historical.version!==item.version||Date.parse(item.recordedAt)<Date.parse(historical.updatedAt)||confirmations.has(item.confirmationId)) invalid();
    confirmationSession(historical,item.sessionId,sessions,invalid);
    confirmations.set(item.confirmationId,item);
  }
  for(const value of requestValues) {
    exactKeys(value,["memoryId","requestKey","payloadHash","expectedVersion","confirmationId","response"],invalid);
    if(typeof value.memoryId!=="string"||!uuid.test(value.memoryId)||typeof value.confirmationId!=="string"||!uuid.test(value.confirmationId)) invalid();
    requiredText(value.requestKey,invalid);
    if(typeof value.payloadHash!=="string"||!/^[a-f0-9]{64}$/.test(value.payloadHash)||
      (value.expectedVersion!==null&&(!Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<1))) invalid();
    exactKeys(value.response,["memory","sessionId","sessionSource"],invalid);
    validateVersion(value.response.memory);
    if(value.response.sessionId!==null&&typeof value.response.sessionId!=="string") invalid();
    if(value.response.sessionSource!==null&&!(["explicit","inferred","manual"] as const).includes(value.response.sessionSource as never)) invalid();
    const request=value as unknown as ConfirmationRequest;
    const event=confirmations.get(request.confirmationId);
    const bundle=memories.get(request.memoryId);
    const historical=bundle?.versions[event?.version===undefined?-1:event.version-1];
    if(!event||!historical) return invalid();
    if(event.memoryId!==request.memoryId||historical.version!==event.version||canonical(request.response.memory)!==canonical(historical)||
      request.response.sessionId!==event.sessionId) invalid();
    const expected=historical.topicKey===null?null:historical.version;
    if(request.expectedVersion!==expected||request.payloadHash!==payloadHash(historical,expected)) invalid();
    selectedSession(historical,request.response.sessionId,request.response.sessionSource,sessions,invalid);
    const identity=requestOwnerKey(historical.scope,historical.projectId,request.requestKey);
    if(requestKeys.has(identity)) invalid();
    requestKeys.add(identity);
  }
}

export function assertConfirmationExtension(current:readonly Confirmation[], next:readonly Confirmation[], canonical:(value:unknown)=>string, invalid:()=>never):void {
  const records=new Map(next.map(item=>[item.confirmationId,item]));
  for(const item of current) if(canonical(records.get(item.confirmationId))!==canonical(item)) invalid();
}

export function assertConfirmationRequestExtension(current:readonly ConfirmationRequest[], next:readonly ConfirmationRequest[], memories:Map<string,ConfirmationBundle>, canonical:(value:unknown)=>string, invalid:()=>never):void {
  const records=new Map(next.map(item=>[confirmationRequestIdentity(memories,item),item]));
  for(const item of current) if(canonical(records.get(confirmationRequestIdentity(memories,item)))!==canonical(item)) invalid();
}
