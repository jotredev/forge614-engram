# TypeScript SDK Integration Guide

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/04-sdk-typescript.md)

This guide documents how to import and use the `MemoryStore` class in your own TypeScript scripts and applications within this repository.

---

## 1. Import and Connection Lifecycle

Forge614 Engram exports its primary programmatic API directly from `src/index.ts`:

```typescript
import {
  MemoryStore,
  MemoryError,
  memoryTypes,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
} from "./src/index";
```

### Initializing the Store
Instantiating `MemoryStore` requires an explicit file path:

```typescript
// Persistent disk storage (creates folders and SQLite file if missing)
const store = new MemoryStore("./.forge614/example.sqlite");

// Or volatile ephemeral storage (disappears completely when closed)
const memoryOnlyStore = new MemoryStore(":memory:");
```

> [!IMPORTANT]
> **Always Close the Connection:** SQLite connections hold file locks and Write-Ahead Log resources. Always wrap usage inside `try { ... } finally { store.close(); }` blocks.

---

## 2. Complete, Executable Example

Save as a TypeScript script (e.g. `scratch/example.ts`) and run with `bun run scratch/example.ts`:

```typescript
import { MemoryStore, MemoryError } from "./src/index";

// 1. Open database connection
const store = new MemoryStore("./.forge614/app-memory.sqlite");

try {
  // 2. Save an initial memory with a topic key
  const saved = store.save({
    project: "backend-api",
    title: "Database Engine Selection",
    content: "We use PostgreSQL for production and SQLite for local development",
    type: "decision",
    topicKey: "architecture/storage",
    requestKey: "req-001",
  });

  console.log("Memory saved with ID:", saved.id);
  console.log("Current version:", saved.version);

  // 3. Search active memories
  const searchResults = store.search("backend-api", "SQLite", 5);
  for (const item of searchResults) {
    console.log(`[Match] ${item.memory.title}: ${item.memory.content}`);
    console.log(`Mode: ${item.explanation.mode}, Score: ${item.explanation.orderScore}`);
  }

  // 4. Retrieve memory record
  const current = store.get("backend-api", saved.id);
  if (current) {
    console.log("Memory state:", current.state); // "active"
  }

  // 5. Update to version 2 (requires expectedVersion matching current version)
  const updated = store.save({
    project: "backend-api",
    title: "Database Engine Selection",
    content: "We use PostgreSQL 16 with pgvector extension in production",
    type: "decision",
    topicKey: "architecture/storage",
    expectedVersion: 1,
    requestKey: "req-002",
  });

  console.log("Updated version:", updated.version); // 2

  // 6. Inspect historical snapshots
  const historyList = store.history("backend-api", saved.id);
  console.log(`Historical snapshots: ${historyList.length}`);
  for (const snap of historyList) {
    console.log(` -> Version ${snap.version} (${snap.updatedAt}): ${snap.content}`);
  }

  // 7. Archive memory (hides from active search)
  store.archive("backend-api", saved.id);
  console.log("Search results after archive:", store.search("backend-api", "SQLite").length); // 0

  // 8. Restore memory
  store.restore("backend-api", saved.id);
  console.log("Search results after restore:", store.search("backend-api", "SQLite").length); // 1

} catch (error) {
  if (error instanceof MemoryError) {
    console.error(`Memory system error [${error.code}]:`, error.message);
  } else {
    console.error("Unexpected filesystem or SQLite error:", error);
  }
} finally {
  store.close();
}
```

---

## 3. `MemoryStore` Method API

### `save(input: SaveInput): MemoryVersion`
Saves a new memory or advances a topic version.
- **SDK Difference from CLI:** The `type` field is **strictly required** in `SaveInput`.
- **Required fields:** `project`, `title`, `content`, `type`.
- **Optional fields:** `topicKey`, `pinned` (boolean), `expectedVersion` (integer $\ge 1$), `requestKey`.
- **Returns:** The saved `MemoryVersion` snapshot.
- **Exceptions:** Throws `MemoryError` on invalid input, version mismatch (`VERSION_CONFLICT`), request hash mismatch (`REQUEST_CONFLICT`), or archived topics (`ARCHIVED`).

### `get(project: string, id: string): Memory | null`
Retrieves a memory record by ID. Returns `null` if not found in the project.

### `search(project: string, query: string, limit = 10): SearchResult[]`
Searches active memories where all query words match. Returns array of `{ memory, explanation }`.

### `history(project: string, id: string): MemoryVersion[]`
Returns historical content snapshots in ascending version order. Returns `[]` if ID is not found.

### `archive(project: string, id: string): Memory`
Sets state to `'archived'` and logs audit event. Throws `NOT_FOUND` if unknown.

### `restore(project: string, id: string): Memory`
Sets state back to `'active'` and logs audit event. Throws `NOT_FOUND` if unknown.

### `close(): void`
Closes the underlying SQLite database connection. Safe to call multiple times.

---

## 4. Domain Types and Interfaces

```typescript
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
```
