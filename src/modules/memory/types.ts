export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
export type MemoryType = (typeof memoryTypes)[number];
export type MemoryScope = "project" | "shared";
export type SearchScope = MemoryScope | "all";
export type SaveInput = { title:string;content:string;type:MemoryType;topicKey?:string;pinned?:boolean;expectedVersion?:number;requestKey?:string }
  & ({scope?:"project";projectId:string}|{scope:"shared";projectId:null});
export interface MemoryVersion { id:string;projectId:string|null;scope:MemoryScope;topicKey:string|null;title:string;content:string;type:MemoryType;pinned:boolean;version:number;createdAt:string;updatedAt:string }
export interface Memory extends MemoryVersion { state:"active"|"archived" }
export interface ReinforcementExplanation {
  revisionCount:number;duplicateCount:number;lastSeenAt:string;ageDays:number;
  pinnedBoost:number;recencyBoost:number;stabilityBoost:number;
}
export interface SearchExplanation {
  mode:"fts5"|"literal";bm25:number|null;multiplier:number;orderScore:number|null;
  reinforcement?:ReinforcementExplanation;
}
export interface SearchResult { memory:Memory;explanation:SearchExplanation }
