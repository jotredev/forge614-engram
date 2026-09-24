export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
export type MemoryType = (typeof memoryTypes)[number];
export type MemoryScope = "project" | "shared" | "ecosystem";
export type SearchScope = MemoryScope | "all";
export type SaveInput = { title:string;content:string;type:MemoryType;topicKey?:string;pinned?:boolean;expectedVersion?:number;requestKey?:string;
  short?:string;supersedes?:string;affects?:readonly string[] }
  & ({scope?:"project";projectId:string}|{scope:"shared";projectId:null}|{scope:"ecosystem";projectId:null;groupId:string;fromProjectId?:string});
/** A project id, null for shared, or a group for the ecosystem scope. */
export type MemoryOwner = string | null | { readonly groupId: string };
export interface MemoryVersion { id:string;projectId:string|null;scope:MemoryScope;topicKey:string|null;title:string;content:string;type:MemoryType;pinned:boolean;version:number;createdAt:string;updatedAt:string;groupId?:string }
export interface Memory extends MemoryVersion { state:"active"|"archived" }
export interface ReinforcementExplanation {
  revisionCount:number;duplicateCount:number;lastSeenAt:string;ageDays:number;
  pinnedBoost:number;recencyBoost:number;stabilityBoost:number;
}
export interface SearchExplanation {
  mode:"fts5"|"literal"|"hybrid";bm25:number|null;multiplier:number;orderScore:number|null;
  reinforcement?:ReinforcementExplanation;
}
export interface SearchResult { memory:Memory;explanation:SearchExplanation }

/** A memory of the same scope and owner that looks like the one just saved (level 11). */
export interface SimilarCandidate { id:string;title:string;version:number;score:number }
