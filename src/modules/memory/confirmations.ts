import type { MemoryType, MemoryVersion } from "./types";

export interface Confirmation {
  confirmationId:string;
  memoryId:string;
  version:number;
  recordedAt:string;
  sessionId:string|null;
}

export interface ConfirmationRequest {
  memoryId:string;
  requestKey:string;
  payloadHash:string;
  expectedVersion:number|null;
  confirmationId:string;
  response:{
    memory:MemoryVersion;
    sessionId:string|null;
    sessionSource:"explicit"|"inferred"|"manual"|null;
  };
}

export interface ConfirmationPayload {
  title:string;
  content:string;
  type:MemoryType;
  topicKey:string|null;
  pinned:boolean;
}

export function sameConfirmationPayload(memory: MemoryVersion, payload: ConfirmationPayload): boolean {
  return memory.title===payload.title && memory.content===payload.content && memory.type===payload.type
    && memory.topicKey===payload.topicKey && memory.pinned===payload.pinned;
}
