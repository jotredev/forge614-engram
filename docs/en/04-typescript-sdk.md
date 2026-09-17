# 04. TypeScript SDK Integration Guide

> **Stage:** Stage 1 — Local Memory (Single Database and Shared Memory)
> **Release Versions:** Program 0.2.0 | Configuration Format 2 | SQLite Schema 3
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
Validates configuration and returns an active `MemoryStore` instance. Pass `readonly = true` for read-only connections.

---

## 3. Methods of `MemoryStore`

### `store.save(input: SaveInput): Memory`
Saves a memory. `SaveInput` requires defining the target scope:
- **Project Scope:**
  `{ projectId: string, title: string, content: string, type: MemoryType, ... }`
- **Shared Scope:**
  `{ scope: "shared", projectId: null, title: string, content: string, type: MemoryType, ... }`

### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Executes explainable search.
- With `projectId`, `scope` can be `"all"` (default, combining project + shared with topic overrides), `"project"`, or `"shared"`.
- With `null` as `projectId`, **`scope: "shared"` is strictly required**.

### `store.get(projectId: string | null, id: string): Memory | null`
Fetches a memory by UUID. Requires matching `projectId` or `null` for shared memories.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Returns all chronological revision snapshots.

### `store.archive(projectId: string | null, id: string): Memory`
Marks memory as archived (`state: "archived"`).

### `store.restore(projectId: string | null, id: string): Memory`
Reactivates an archived memory (`state: "active"`).

### `store.close(): void`
Closes the SQLite connection and flushes WAL state.

---

## 4. Complete Executable Example

Save this script as `sdk-example.ts` in the repository root and run it with `bun run sdk-example.ts`:

```typescript
import { MemoryWorkspace } from "./src/index";

// 1. Instantiate the global workspace manager
const workspace = new MemoryWorkspace();

// 2. Safely initialize storage (idempotent)
workspace.init();

// 3. Locate existing project or create one
let project = workspace.listProjects().find((p) => p.name === "My Application");
if (!project) {
  project = workspace.createProject("My Application");
  console.log("Created new project with ID:", project.projectId);
} else {
  console.log("Reusing existing project:", project.projectId);
}

// 4. Open memory store
const store = workspace.open();

try {
  // A. Save project-scoped memory
  const projectMem = store.save({
    projectId: project.projectId,
    title: "Database Architecture",
    content: "We use SQLite locally with WAL mode",
    type: "decision",
    topicKey: "architecture/storage",
  });
  console.log("Project memory saved:", projectMem.id);

  // B. Save shared universal preference
  const sharedMem = store.save({
    scope: "shared",
    projectId: null,
    title: "Preferred Language",
    content: "I prefer clear explanations in English",
    type: "preference",
    topicKey: "preferences/language",
  });
  console.log("Shared preference saved:", sharedMem.id);

  // C. Combined search from project (returns both memories)
  console.log("\n--- Combined Search in Project ---");
  const results = store.search(project.projectId, "English");
  for (const r of results) {
    console.log(`[${r.memory.scope.toUpperCase()}] ${r.memory.title}: ${r.memory.content}`);
    console.log(`Order score: ${r.explanation.orderScore}`);
  }

  // D. Exclusive search in shared scope
  console.log("\n--- Shared-Only Search ---");
  const sharedOnly = store.search(null, "English", 5, "shared");
  console.log("Total shared memories matched:", sharedOnly.length);

} finally {
  // 5. Clean resource release
  store.close();
}
```

> [!IMPORTANT]
> **Clean Resource Release:** Always wrap `MemoryStore` operations in a `try { ... } finally { store.close(); }` block to release SQLite file descriptors and ensure proper WAL journal synchronization.
