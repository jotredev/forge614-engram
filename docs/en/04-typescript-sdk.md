# 04. TypeScript SDK Integration Guide

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Active
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents how to use the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes in your own TypeScript applications, automation scripts, and test suites within this repository.

> [!NOTE]
> **For Software Engineers:** This SDK is intended for developers embedding structured memory into TypeScript applications. End users of the terminal only need to run the `forge614-engram` CLI. There is no npm package; import directly from `./src/index`.

---

## 1. Exported Modules and Class Architecture

The main entry point is `src/index.ts`:

```typescript
import {
  MemoryWorkspace,
  WorkspaceConfig,
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

### Class Architecture:
1. **`MemoryWorkspace` (High-Level Manager):**
   Manages the global user storage lifecycle (`~/.forge614/`). This is the recommended class for initialization, project management (`createProject`, `listProjects`, `renameProject`), and opening validated database connections (`open()`).
2. **`WorkspaceConfig` (Configuration Reader):**
   Handles atomic reads and writes of `~/.forge614/.env`. Validates file modes (`0700` directory, `0600` file) and rejects legacy project configurations (`projects/`) with `LEGACY_CONFIG`.
3. **`MemoryStore` (Low-Level Storage Engine):**
   Executes direct SQLite operations (`save`, `get`, `history`, `search`, `archive`, `restore`).

---

## 2. Methods of `MemoryWorkspace`

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Prepares `.env` and `engram.db` in secure mode. If already existing and valid, performs no destructive changes.

### `workspace.createProject(name: string): Project`
Registers a new project, assigning a lowercase UUIDv4 `projectId`.
⚠️ **Best Practice:** Do not invoke `createProject()` on every application boot, as this creates a new identity every time. Register projects once and reuse their `projectId` via `listProjects()`.

### `workspace.listProjects(): Project[]`
Returns all registered projects from the database, sorted by name. If storage is uninitialized, returns `[]`.

### `workspace.renameProject(projectId: string, name: string): Project`
Updates a project's display name while preserving its `projectId`, history, and memories.

### `workspace.open(readonly = false): MemoryStore`
Validates configuration and returns an active `MemoryStore` instance. Pass `readonly = true` for read-only connections (used, for example, to validate compatibility without mutating files).

---

## 3. Methods of `MemoryStore`

### `store.save(input: SaveInput): Memory`
Saves a new memory or creates a new revision of an existing topic:
- Requires `title`, `content`, and `type`.
- If `scope` is `'project'`, requires `projectId`.
- If `scope` is `'shared'`, `projectId` must be `null`.
- If updating an existing topic, requires `expectedVersion` to prevent concurrent overwrite collisions.
- Accepts `requestKey` for idempotency protection.

### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Executes full-text explainable search using SQLite FTS5:
- When given a `projectId`, `scope` defaults to `"all"` (returns project-scoped plus shared memories, honoring topic overrides).
- Returns each memory alongside an `explanation` object (`bm25`, `multiplier`, `orderScore`).

### `store.get(projectId: string | null, id: string): Memory`
Retrieves a memory record by UUID in the specified scope.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Returns the chronological array of immutable version snapshots.

### `store.archive(projectId: string | null, id: string): Memory`
Hides a memory from standard search results while preserving its full audit history.

### `store.restore(projectId: string | null, id: string): Memory`
Restores search visibility for an archived memory.

---

## 4. Complete Integration Example

```typescript
import { MemoryWorkspace } from "./src/index";

// 1. Instantiate workspace manager
const workspace = new MemoryWorkspace();

// 2. Safely initialize storage (idempotent)
workspace.init();

// 3. Retrieve or create project
const projects = workspace.listProjects();
let project = projects.find(p => p.name === "My Application");

if (!project) {
  project = workspace.createProject("My Application");
  console.log("Created project with ID:", project.projectId);
} else {
  console.log("Reusing existing project:", project.projectId);
}

// 4. Open memory store
const store = workspace.open();

try {
  // A. Save project-scoped memory
  const memProject = store.save({
    projectId: project.projectId,
    title: "Database Engine",
    content: "We use SQLite in WAL mode",
    type: "decision",
    topicKey: "architecture/storage",
  });
  console.log("Saved project memory:", memProject.id);

  // B. Save shared universal guideline
  const memShared = store.save({
    scope: "shared",
    projectId: null,
    title: "Language Preference",
    content: "I prefer clear explanations in English",
    type: "preference",
    topicKey: "preferences/language",
  });
  console.log("Saved shared memory:", memShared.id);

  // C. Combined search from project
  console.log("\n--- Combined Search ---");
  const results = store.search(project.projectId, "English");
  for (const r of results) {
    console.log(`[${r.memory.scope.toUpperCase()}] ${r.memory.title}: ${r.memory.content}`);
    console.log(`Ranking Order Score: ${r.explanation.orderScore}`);
  }

  // D. Exclusive shared search
  console.log("\n--- Exclusive Shared Search ---");
  const sharedMatches = store.search(null, "English", 5, "shared");
  console.log("Shared matches count:", sharedMatches.length);

} finally {
  // 5. Always close to release locks
  store.close();
}
```

---

## 5. Interactive Setup Module (`src/setup.ts`)

For custom terminal user interfaces, alternative CLI adapters, or test automation, the repository provides `runSetup`:

```typescript
import { runSetup, type SetupIO, type SetupResult } from "./src/setup";
import { WorkspaceConfig } from "./src/workspace-config";

// Custom I/O adapter
const customIO: SetupIO = {
  write: (message: string) => console.log(message),
  ask: async (question: string) => {
    // Return user answer or null if cancelled
    return "yes";
  },
};

const result: SetupResult = await runSetup(customIO, new WorkspaceConfig());

if (result.cancelled) {
  console.log("Setup was cancelled without applying changes.");
} else {
  console.log("Global storage initialized:", result.storage);
}
```

> [!IMPORTANT]
> **Always wrap `store` operations in `try ... finally { store.close(); }`** to ensure file descriptors and SQLite write locks are properly released.
