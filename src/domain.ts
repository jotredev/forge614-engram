export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
export type MemoryType = (typeof memoryTypes)[number];

export interface SaveInput {
  project: string;
  title: string;
  content: string;
  type: MemoryType;
  topicKey?: string;
  pinned?: boolean;
  expectedVersion?: number;
  requestKey?: string;
}

export interface MemoryVersion {
  id: string;
  project: string;
  topicKey: string | null;
  title: string;
  content: string;
  type: MemoryType;
  pinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Memory extends MemoryVersion {
  state: "active" | "archived";
}

export interface SearchResult {
  memory: Memory;
  explanation: {
    mode: "fts5" | "literal";
    bm25: number | null;
    multiplier: number;
    orderScore: number | null;
  };
}

export class MemoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MemoryError";
  }
}
