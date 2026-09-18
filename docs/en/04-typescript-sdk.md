# 04 (EN). TypeScript SDK Guide (MemoryStore)

> **Stage:** TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents the public TypeScript API for Forge614 Engram, covering the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes, Schema 7 support for immutable confirmations and reinforced FTS5 search ranking without embeddings, and progressive retrieval and Control Center contracts.

> [!NOTE]
> **Aimed at developers:** This SDK is designed for engineers integrating structured memory into TypeScript agents or extensions. Terminal end users only require the `forge614-engram` CLI binary. There is no npm package published; imports resolve locally from `./src/index`.

---

## 1. Exported Modules and Architecture

The primary public entry point for the SDK is `src/index.ts`:

```typescript
import {
  // Core classes and configuration
  MemoryWorkspace,
  WorkspaceConfig,
  type WorkspaceSettings,
  MemoryStore,
  MemoryError,
  memoryTypes,
  defaultDatabasePath,

  // Domain types and reinforcement (Schema 7)
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
  type SearchExplanation,
  type ReinforcementExplanation,
  type Confirmation,
  type ConfirmationRequest,
  type MemoryScope,
  type SearchScope,

  // Progressive memory sessions types (Schema 6)
  type Session,
  type SessionEntry,
  type SessionSummary,
  type SessionSaveOptions,
  type SessionSaveResult,
  type SummaryFields,

  // Progressive retrieval and ranked context types
  type MemoryPreview,
  type PreviewResult,
  type VersionRead,
  type TimelineInput,
  type TimelineRow,
  type TimelineResult,
  type ContextInput,
  type ContextRow,
  type ContextResult,

  // Project context helper functions
  saveProjectMemoryWithSession,
  startProjectSession,
} from "./src/index";
```

### Core SDK Architecture Principles

- **The SQLite API remains 100% synchronous:** All read, write, search, confirmation, session, timeline, and context operations in `MemoryStore` and `MemoryWorkspace` execute immediately on SQLite without `async`/`await`.
- **`MemoryStore` Facade Pattern:** Located in `src/app/memory-store.ts`, `MemoryStore` provides an immutable, backwards-compatible public interface while delegating persistence to specialized modules under `src/infrastructure/sqlite/` (`memory.ts`, `confirmations.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`, `control-center.ts`).
- **Complete Elimination of Legacy Root Files:** Historical files in the root of `src/` (`src/domain.ts`, `src/store.ts`, `src/identity.ts`, `src/sessions.ts`, etc.) have been completely removed. External consumers must import strictly from `src/index.ts`. Internal modules are forbidden by TypeScript AST lint rules (`tests/architecture/import-rules.ts`) from importing from `src/index.ts` to prevent cycles.
- **Network, transport, and interface modules are strictly internal:**
  - MCP server (`src/interfaces/mcp/`)
  - Assistant hook runner (`src/interfaces/terminal/` & `src/modules/assistants/`)
  - Terminal Control Center interface (`src/interfaces/tui/`)
  - Async self-test runner (`src/infrastructure/assistants/self-test.ts`)
  - Replica sync engine (`src/infrastructure/postgres/` & `src/app/synchronization.ts`)
  These components are not re-exported in `src/index.ts`.
- **No `AsyncMemoryWorkspace`:** No public asynchronous wrapper exists. Applications interact locally with the synchronous store; external assistants interact via MCP or CLI commands.

---

## 2. SDK Class Architecture

1. **`MemoryWorkspace` (High-Level Workspace Manager):**
   Manages user central storage (`~/.forge614/`), initializes the environment, orchestrates project lifecycle (`createProject`, `listProjects`, `renameProject`), and opens secure database connections (`open()`).
2. **`WorkspaceConfig` (Configuration Manager):**
   Manages atomic read/write of `~/.forge614/.env`. Validates permissions (`0700` directory, `0600` file), format versions (Format 2 local, Format 3 sync), and prevents concurrency using `.config-lock`.
3. **`MemoryStore` (SQLite Database Engine):**
   Directly executes operations on SQLite tables (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, `enableSearchReinforcement`, `reinforcementEnabled`, `controlCenter`, etc.).

---

## 3. `MemoryWorkspace` Methods

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Ensures `.env` and `engram.db` exist with secure permissions (`0700`/`0600`). Idempotent and non-destructive.

### `workspace.createProject(name: string): Project`
Registers a new project, assigning a unique UUIDv4 `projectId`.

### `workspace.listProjects(): Project[]`
Returns all registered projects ordered chronologically.

### `workspace.renameProject(projectId: string, name: string): Project`
Updates a project's cosmetic display name without affecting its `projectId` or stored memories.

### `workspace.open(readonly = false): MemoryStore`
Opens a `MemoryStore` instance after verifying permissions and database schema version.

---

## 4. `MemoryStore` Methods (Schemas 5, 6, and 7)

### Control Center Methods (Monitoring & Aggregates)

#### `store.controlCenter(): { capabilities: CapabilityState; projects: ProjectSummary[]; shared: SharedSummary | null }`
Queries database aggregate statistics and capability status in a 100% read-only fashion:
- `capabilities`: `{ schema: 3 | 4 | 5 | 6 | 7; assistantIntegration: boolean; sessions: boolean; reinforcement: boolean }`
- `projects`: List of enrolled projects with `projectId`, `name`, `createdAt`, `updatedAt`, bound directory paths (`bindings`), and counts `{ active: number; archived: number; lastUpdatedAt: string | null }`.
- `shared`: Global `{ active: number; archived: number; lastUpdatedAt: string | null }` counts for shared universal memories.
- **Strict Privacy:** This query performs relational counts (`LEFT JOIN`) only; it never loads memory titles or content into memory.

#### Application Orchestration Function: `readControlCenter(config?: WorkspaceConfig): ControlCenterSnapshot`
(Located in `src/app/control-center.ts`):
Loads a complete, safe snapshot for UI consumption:
- If `config.exists()` is `false`, returns an uninitialized state snapshot without touching storage.
- Opens `MemoryStore` in read-only mode (`readonly: true`), fetches aggregates from `store.controlCenter()`, appends safe storage attributes (`databasePath`, `postgres: "configured" | "not-configured"`), and guarantees store closure in a `finally` block.

---

### Schema Management & Local Bindings

#### `store.enableAssistantIntegration(): void`
Migrates the local database additively to **Schema 5** (creates `project_bindings` table and indices).

#### `store.enableSessions(): void`
Migrates the local database additively to **Schema 6** (creates `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`).

#### `store.sessionsEnabled(): boolean`
Synchronously checks if the current database is at Schema 6 or higher (`PRAGMA user_version >= 6`).

#### `store.enableSearchReinforcement(): void`
Migrates the local database additively to **Schema 7** (creates `confirmations` and `confirmation_requests` tables and indices).

#### `store.reinforcementEnabled(): boolean`
Synchronously checks if the current database is at Schema 7 (`PRAGMA user_version === 7`).

#### `store.bindProjectDirectory(directory: string, projectId: string): Project`
Associates a local directory path to an existing `projectId` in `project_bindings`. Throws `PROJECT_BINDING_CONFLICT` if already bound to another project.

#### `store.resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (dir: string) => boolean): { project: Project | null; created: boolean }`
Resolves project binding:
- If bound, returns the project (`created: false`).
- If unbound and `create` is `false`, returns `project: null`.
- If unbound and `create` is `true`: checks name collisions and path availability before atomically creating the project and binding.

---

### Progressive Sessions Lifecycle (Schema 6)

#### `store.startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session`
Starts a runtime work session (`kind: "runtime"`). If `runtimeDirectory` is passed, records local binding in `local_session_bindings`.

#### `store.endSession(projectId: string, sessionId: string): Session`
Closes a runtime session, recording its ISO 8601 `endedAt` timestamp. Throws `SESSION_KIND` if session is manual.

#### `store.getSession(projectId: string, sessionId: string): Session | null`
Retrieves a session record ensuring it belongs to `projectId`.

#### `store.startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string, bindingAvailable?: (dir: string) => boolean): Session`
Resolves the canonical repository root and starts the session in a single atomic transaction.

#### `store.saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields, request: { requestKey: string; expectedVersion?: number }): SessionSaveResult`
Persists a structured closing summary under reserved topic `session/<sessionId>/summary` with type `procedure`. Updates `session_summaries`.

---

### Memory Persistence, Idempotency & Confirmations (Schema 7)

#### `store.save(input: SaveInput): MemoryVersion`
Persists a standard memory note.
- If `input.requestKey` matches an existing request with identical payload hash, returns the cached response (*replay*). If the payload differs, throws `REQUEST_CONFLICT`.
- On Schema 7, saving an identical active note (matching title, content, type, and pinned status) with a new request key within 15 minutes (if `topicKey` is null) or matching topic records an immutable confirmation event in `confirmations` without bumping the version number.
- If the system clock is earlier than the confirmed version timestamp, throws `CLOCK_SKEW`.

#### `store.saveWithSession(input: SaveInput, options?: SessionSaveOptions): SessionSaveResult`
Persists a memory note associated with a work session:
- `options.sessionId`: Explicit session identifier (`sessionSource: "explicit"`).
- `options.mode`: `"independent"` (CLI) or `"assistant"` (MCP).
- If `sessionId` is omitted in assistant mode, auto-infers if exactly 1 session was active in the last 7 days; halts with `AMBIGUOUS_SESSION` if multiple exist.
- Shared memories (`scope: "shared"`) require explicit `sessionId` and `options.projectId`. The note is saved with `projectId: null` and strips session origin from public responses.

#### `store.saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, input: Omit<SaveInput, "projectId" | "scope">, options?: SessionSaveOptions, bindingAvailable?: (dir: string) => boolean): SessionSaveResult`
Resolves project directory and saves the memory with session association in a single transaction.

---

### Progressive Retrieval & Reinforced Search

#### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Explainable search in SQLite FTS5 with trigram tokenizer and reinforced ordering `orderScore = bm25 * multiplier ASC`. Each result includes `explanation: SearchExplanation`.

#### `store.searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[]`
Progressive search returning `MemoryPreview` objects bounded to **300 Unicode code points** with boolean `truncated` flag.

#### `store.getVersion(projectId: string | null, id: string, version?: number): VersionRead | null`
Retrieves a specific historical revision or active version, reporting `currentVersion` and `state`.

#### `store.timeline(projectId: string, input: TimelineInput): TimelineResult`
Reconstructs chronological session events around a focus memory (`focus`), with configurable before/after windows (default 5).

#### `store.context(projectId: string | null, input?: ContextInput): ContextResult`
Assembles a prioritized context dossier partitioned into `pinned`, `recent`, and `summaries`, respecting strict UTF-8 JSON serialization byte budgets (`maxBytes`, 1024..65536, default 16384).

---

## 5. Production-Ready Code Examples

### Example 1: Schema 7 Activation, Immutable Confirmations, and Reinforced Search

```typescript
import { MemoryWorkspace, type SearchResult } from "./src/index";

const workspace = new MemoryWorkspace();
workspace.init();

const store = workspace.open();
try {
  // 1. Ensure Schema 7 for confirmations and reinforced ranking
  if (!store.reinforcementEnabled()) {
    store.enableSearchReinforcement();
  }

  const project = workspace.createProject("Reinforced Search Engine");

  // 2. Initial memory save with idempotent request key
  const v1 = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "In-Memory Queue Caching",
    content: "We use SQLite WAL mode and deferred transactions for throughput.",
    type: "decision",
    requestKey: "req-queue-01",
  });
  console.log(`Memory created: version ${v1.version}, ID: ${v1.id}`);

  // 3. Idempotent replay with same key -> Returns cached response
  const v1Replay = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "In-Memory Queue Caching",
    content: "We use SQLite WAL mode and deferred transactions for throughput.",
    type: "decision",
    requestKey: "req-queue-01",
  });
  console.log(`Replay detected: version ${v1Replay.version} (identical)`);

  // 4. Repeated observation with new key within 15 min -> Immutable confirmation
  const v1Confirm = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "In-Memory Queue Caching",
    content: "We use SQLite WAL mode and deferred transactions for throughput.",
    type: "decision",
    requestKey: "req-queue-02",
  });
  console.log(`Confirmation recorded: version remains ${v1Confirm.version} without duplication`);

  // 5. Reinforced search: inspect mathematical factors and multipliers
  const results: SearchResult[] = store.search(project.projectId, "sqlite queues wal");
  for (const item of results) {
    console.log(`- ${item.memory.title}`);
    console.log(`  BM25: ${item.explanation.bm25}`);
    console.log(`  Multiplier: ${item.explanation.multiplier}`);
    console.log(`  OrderScore: ${item.explanation.orderScore}`);
    if (item.explanation.reinforcement) {
      console.log(`  Confirmations: ${item.explanation.reinforcement.duplicateCount}`);
      console.log(`  Stability Boost: ${item.explanation.reinforcement.stabilityBoost}`);
      console.log(`  Recency Boost: ${item.explanation.reinforcement.recencyBoost}`);
    }
  }
} finally {
  store.close();
}
```

---

### Example 2: Progressive Memory Sessions and Ranked Context

```typescript
import { MemoryWorkspace, type SummaryFields } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open();

try {
  const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const sessionId = "ses-payments-migration-v2";

  // Start runtime work session
  const session = store.startSession(projectId, sessionId);
  console.log(`Session started: ${session.sessionId}`);

  // Record structured session summary
  const summary: SummaryFields = {
    goal: "Implement webhook idempotency",
    instructions: "Use Redis SETNX with 86400s TTL",
    discoveries: "Occasional duplicates from Stripe retries",
    accomplishments: "Idempotency filter tested and verified",
    nextSteps: "Monitor collision rates in staging",
    files: ["src/payments/webhooks.ts", "src/redis/client.ts"],
  };

  store.saveSessionSummary(projectId, sessionId, summary, {
    requestKey: "req-summary-payments-01",
  });

  // Conclude session
  store.endSession(projectId, sessionId);

  // Assemble prioritized context dossier with 16 KiB budget
  const context = store.context(projectId, {
    compact: false,
    maxBytes: 16384,
  });

  console.log(`Ranked context: ${context.pinned.length} pinned, ${context.recent.length} recent, ${context.summaries.length} summaries.`);
} finally {
  store.close();
}
```
