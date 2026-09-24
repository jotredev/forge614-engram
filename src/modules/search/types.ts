import type { Memory,MemoryMark,MemoryMeta,MemoryVersion,SearchResult } from "../memory";
export type MemoryPreview=Omit<MemoryVersion,"content">&{preview:string;truncated:boolean};
export interface PreviewResult{memory:MemoryPreview;explanation:SearchResult["explanation"];meta?:MemoryMeta;marks?:MemoryMark[]}
export interface VersionRead{memory:MemoryVersion;currentVersion:number;state:Memory["state"];meta?:MemoryMeta;marks?:MemoryMark[]}
export interface TimelineInput{sessionId:string;memoryId:string;version:number;before?:number;after?:number}
export interface TimelineRow{memory:MemoryPreview;recordedAt:string}
export interface TimelineResult{sessionId:string;focus:TimelineRow;before:TimelineRow[];after:TimelineRow[]}
export interface ContextInput{compact?:boolean;maxBytes?:number}
export type ContextRow=Omit<MemoryPreview,"preview">&{preview?:string};
export interface ContextResult{format:1;pinned:ContextRow[];recent:ContextRow[];summaries:ContextRow[];omitted:{pinned:number;recent:number;summaries:number};truncated:boolean}
