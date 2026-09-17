import { expect, test } from "bun:test";
import type { SyncSnapshotV3 } from "./snapshot";
import {
  assertConfirmationExtension,
  assertConfirmationRequestExtension,
  confirmationRequestIdentity,
  requestOwnerKey,
  validateConfirmationCollections,
} from "./confirmations";
import {
  confirmation,confirmationA,confirmationB,memoryId,otherProjectId,request,snapshot3,
} from "./__test-support__/confirmation-fixtures";

function invalid():never { throw new Error("invalid confirmation collection"); }
function canonical(value:unknown):string { return JSON.stringify(value); }

function context(snapshot:SyncSnapshotV3, requestKeys=new Set<string>()) {
  return {
    memories:new Map(snapshot.memories.map(bundle=>[bundle.memory.id,bundle])),
    sessions:new Map(snapshot.sessions.map(session=>[session.sessionId,session])),requestKeys,invalid,
    validateVersion:(value:unknown)=>{if(!value||typeof value!=="object"||Array.isArray(value)) invalid();},canonical,
  };
}

test("bare project confirmation events accept manual and runtime sessions without a request",()=>{
  for(const kind of ["manual","runtime"] as const) {
    const snapshot=snapshot3(1);snapshot.sessions[0]!.kind=kind;snapshot.confirmationRequests=[];
    expect(()=>validateConfirmationCollections(snapshot.confirmations,snapshot.confirmationRequests,context(snapshot))).not.toThrow();
  }
});

test("bare confirmation sessions retain project ownership and shared runtime restrictions",()=>{
  const foreign=snapshot3(1);foreign.confirmationRequests=[];foreign.sessions[0]!.projectId=otherProjectId;
  expect(()=>validateConfirmationCollections(foreign.confirmations,foreign.confirmationRequests,context(foreign))).toThrow("invalid confirmation collection");

  const shared=snapshot3(1);shared.confirmationRequests=[];shared.sessions[0]!.kind="manual";
  shared.memories[0]!.memory.scope="shared";shared.memories[0]!.memory.projectId=null;
  shared.memories[0]!.versions[0]!.scope="shared";shared.memories[0]!.versions[0]!.projectId=null;
  expect(()=>validateConfirmationCollections(shared.confirmations,shared.confirmationRequests,context(shared))).toThrow("invalid confirmation collection");
  shared.sessions[0]!.kind="runtime";
  expect(()=>validateConfirmationCollections(shared.confirmations,shared.confirmationRequests,context(shared))).not.toThrow();
});

test("collection validation checks request hashes, response sources, and occupied owner namespaces",()=>{
  const good=snapshot3(1);
  expect(()=>validateConfirmationCollections(good.confirmations,good.confirmationRequests,context(good))).not.toThrow();

  const badSource=snapshot3(1);badSource.confirmationRequests[0]!.response.sessionSource="manual";
  expect(()=>validateConfirmationCollections(badSource.confirmations,badSource.confirmationRequests,context(badSource))).toThrow("invalid confirmation collection");

  const badHash=snapshot3(1);badHash.confirmationRequests[0]!.payloadHash="0".repeat(64);
  expect(()=>validateConfirmationCollections(badHash.confirmations,badHash.confirmationRequests,context(badHash))).toThrow("invalid confirmation collection");

  const occupied=snapshot3(1);const keys=new Set([requestOwnerKey("project",occupied.memories[0]!.memory.projectId,"confirm-v1")]);
  expect(()=>validateConfirmationCollections(occupied.confirmations,occupied.confirmationRequests,context(occupied,keys))).toThrow("invalid confirmation collection");
});

test("request identities derive scope and project from the referenced memory",()=>{
  expect(requestOwnerKey("project",otherProjectId,"same")).toBe('["project","22222222-2222-4222-8222-222222222222","same"]');
  expect(requestOwnerKey("shared",null,"same")).toBe('["shared",null,"same"]');
  const snapshot=snapshot3(1);const memories=new Map(snapshot.memories.map(bundle=>[bundle.memory.id,bundle]));
  expect(confirmationRequestIdentity(memories,snapshot.confirmationRequests[0]!)).toBe(
    '["project","11111111-1111-4111-8111-111111111111","confirm-v1"]',
  );
});

test("confirmation extension helpers reject removed or rewritten identities",()=>{
  expect(()=>assertConfirmationExtension([confirmation()],[],canonical,invalid)).toThrow("invalid confirmation collection");
  expect(()=>assertConfirmationExtension([confirmation()],[{...confirmation(),recordedAt:"2026-09-17T10:01:01.000Z"}],canonical,invalid)).toThrow("invalid confirmation collection");
  expect(()=>assertConfirmationExtension([confirmation()],[confirmation(),confirmation(confirmationB)],canonical,invalid)).not.toThrow();
});

test("confirmation request extension is keyed by owner namespace and request key",()=>{
  const snapshot=snapshot3(1);const memories=new Map(snapshot.memories.map(bundle=>[bundle.memory.id,bundle]));
  const current=request(confirmationA,"same");
  expect(()=>assertConfirmationRequestExtension([current],[],memories,canonical,invalid)).toThrow("invalid confirmation collection");
  expect(()=>assertConfirmationRequestExtension([current],[{...current,confirmationId:confirmationB}],memories,canonical,invalid)).toThrow("invalid confirmation collection");
  expect(()=>assertConfirmationRequestExtension([current],[current,request(confirmationA,"other")],memories,canonical,invalid)).not.toThrow();
  expect(current.memoryId).toBe(memoryId);
});
