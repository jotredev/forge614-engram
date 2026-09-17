import type { MemoryVersion } from "../memory";
export interface Session {sessionId:string;projectId:string;kind:"runtime"|"manual";startedAt:string;endedAt:string|null}
export interface SessionEntry {sessionId:string;memoryId:string;version:number;recordedAt:string}
export interface SessionSummary {sessionId:string;memoryId:string;version:number}
export interface SessionSaveOptions {sessionId?:string;projectId?:string;mode?:"independent"|"assistant";runtimeDirectory?:string}
export interface SessionSaveResult {memory:MemoryVersion;sessionId:string|null;sessionSource:"explicit"|"inferred"|"manual"|null}
export interface SummaryFields {goal:string;instructions:string;discoveries:string;accomplishments:string;nextSteps:string;files:string[]}
