# 04 (EN). TypeScript SDK Guide (MemoryStore)

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Active (Verified with 90 tests on macOS with Bun 1.3.8)
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents how to utilize the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes in your own TypeScript applications, integration suites, and developer scripts.

> [!NOTE]
> **Developer-Facing SDK:** This SDK is intended for engineers embedding structured personal memory into TypeScript applications. End users interact with the terminal CLI `forge614-engram`. There is no public package on npm; imports are resolved directly from `./src/index`.

---

## 1. Exported Modules & Core SDK Principles

The primary public entry point is `src/index.ts`:

```typescript
import {
  MemoryWorkspace,
  WorkspaceConfig,
  type WorkspaceSettings,
  MemoryStore,
  MemoryError,
  memoryTypes,
  defaultDatabasePath,
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
  type MemoryScope,
  type SearchScope,
} from "./src/index";
```

### Core SDK Principle: Fully Synchronous Local Operation
- **The SQLite SDK is 100% Synchronous:** All read, write, and search operations on `MemoryStore` and `MemoryWorkspace` execute synchronously in real time on SQLite without asynchronous promises (`async`/`await`).
- **Sync Modules are Internal Infrastructure:** Modules such as `sync-runner.ts`, `synchronize.ts`, `sync-postgres.ts`, `sync-snapshot.ts`, and `sync-local.ts` are internal network transport and reconciliation machinery. **They are not re-exported as public APIs in `src/index.ts`**.
- **Do Not Invent an `AsyncMemoryWorkspace`:** There is no asynchronous wrapper class. Applications interact with the local synchronous store, while PostgreSQL synchronization is coordinated via terminal commands (`sync`, `sync-watch`) or internal runner processes.
- **Internal Synchronization Store Hooks:** The helper methods `store.enableSync()`, `store.syncSnapshot()`, `store.syncCheckpoint()`, and `store.applySync()` exist for synchronization runners. They are not intended for arbitrary manual JSON injection or ad-hoc conflict manipulation.

---

## 2. SDK Class Architecture

1. **`MemoryWorkspace` (High-Level Manager):**
   Manages the lifecycle of user storage (`~/.forge614/`). The recommended interface for bootstrapping the environment, managing projects (`createProject`, `listProjects`, `renameProject`), and opening verified database connections (`open()`).
2. **`WorkspaceConfig` (Configuration Manager):**
   Controls atomic reading and writing of `~/.forge614/.env`. Enforces file permissions (`0700` directory, `0600` file), supports format version 2 (pure local) and format version 3 (with `postgresUrl`), and coordinates setup concurrency using `.config-lock`.
3. **`MemoryStore` (Low-Level Storage Engine):**
   Executes direct SQLite operations (`save`, `get`, `history`, `search`, `archive`, `restore`).

---

## 3. `MemoryWorkspace` API Methods

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Initializes `.env` and `engram.db` with secure permissions. If files already exist and are valid, leaves data intact.

### `workspace.createProject(name: string): Project`
Registers a new project, generating a unique lowercase UUIDv4 `projectId`.
⚠️ **Best Practice:** Do not call `createProject()` on every application boot, as this creates a new identity each time. Register the project once and reuse its `projectId` by looking it up with `listProjects()`.

### `workspace.listProjects(): Project[]`
Returns all registered projects ordered alphabetically by name. Returns `[]` if storage is uninitialized.

### `workspace.renameProject(projectId: string, name: string): Project`
Updates a project's display name while preserving `projectId`, ownership, and history intact.

### `workspace.open(readonly = false): MemoryStore`
Validates workspace configuration and opens `MemoryStore`. If `readonly` is `true`, opens in read-only mode for non-mutating inspection.

---

## 4. `MemoryStore` API Methods

Once opened via `workspace.open()` or `new MemoryStore()`:

### `store.save(input: SaveInput): MemoryVersion`
Stores a new memory or evolves an existing topic memory:
- Requires `title`, `content`, and `type`.
- If `scope` is `'project'`, requires `projectId`.
- If `scope` is `'shared'`, `projectId` must be strictly `null`.
- If updating an existing topic, requires `expectedVersion` matching current version to prevent blind overwrites.
- Supports `requestKey` for idempotency replay protection.

### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Executes explainable FTS5 retrieval:
- When passing `projectId`, defaults to `all` (project + shared memories, applying topic overrides).
- Returns each memory alongside its `explanation` (`bm25`, `multiplier`, `orderScore`).

### `store.get(projectId: string | null, id: string): Memory`
Retrieves an active or archived memory card by ID.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Returns the immutable chronological array of historical version snapshots.

### `store.archive(projectId: string | null, id: string): Memory`
Hides a memory from default search results without deleting its historical records.

### `store.restore(projectId: string | null, id: string): Memory`
Restores an archived memory back into active search results.

### `store.close(): void`
Closes the underlying SQLite connection.

---

## 5. Practical Code Examples

### Example 1: Initializing Workspace and Registering a Project
```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();

// Initialize global storage if absent
workspace.init();

// Find or create project
let project = workspace.listProjects().find(p => p.name === "Developer Platform");
if (!project) {
  project = workspace.createProject("Developer Platform");
  console.log(`Created project with ID: ${project.projectId}`);
} else {
  console.log(`Found existing project: ${project.projectId}`);
}
```

### Example 2: Saving Project & Shared Memories
```typescript
const store = workspace.open();

try {
  // 1. Save project-specific memory
  const docMemory = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "API Documentation",
    content: "We use OpenAPI 3.1 to document HTTP endpoints",
    type: "decision",
    topicKey: "api/docs",
    requestKey: "req-api-01",
  });
  console.log(`Saved memory ID: ${docMemory.id}, Version: ${docMemory.version}`);

  // 2. Save universal shared preference (projectId must be null)
  const langMemory = store.save({
    scope: "shared",
    projectId: null,
    title: "Response Language",
    content: "Explain technical concepts in English",
    type: "preference",
    topicKey: "preferences/language",
    requestKey: "req-lang-01",
  });
  console.log(`Saved shared memory ID: ${langMemory.id}`);
} finally {
  store.close();
}
```

### Example 3: Combined Search with Scoring Breakdown
```typescript
const store = workspace.open();

try {
  // Combined search: returns project and shared notes
  const results = store.search(project.projectId, "OpenAPI English", 5, "all");

  for (const { memory, explanation } of results) {
    console.log(`[${memory.scope.toUpperCase()}] ${memory.title}`);
    console.log(`  Content: ${memory.content}`);
    console.log(`  Score: ${explanation.orderScore} (BM25: ${explanation.bm25}, Multiplier: ${explanation.multiplier})`);
  }
} finally {
  store.close();
}
```

### Example 4: Concurrency-Safe Update with `expectedVersion`
```typescript
const store = workspace.open();

try {
  const updated = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "API Documentation",
    content: "Migrated from OpenAPI 3.1 to TypeSpec for contract generation",
    type: "decision",
    topicKey: "api/docs",
    expectedVersion: 1, // Asserts current active version is 1
    requestKey: "req-api-02",
  });

  console.log(`Updated memory version: ${updated.version}`);
} catch (error: any) {
  if (error.code === "VERSION_CONFLICT") {
    console.error("Conflict: the active memory version changed before update.");
  } else {
    throw error;
  }
} finally {
  store.close();
}
```
