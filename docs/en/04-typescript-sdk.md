# 04 (EN). TypeScript SDK Guide (MemoryStore)

> **Stage:** Nonvisual Engine Transition (Task 1: Inspection & Preview, Task 2: Atomic Initialization Application), Ecosystem Contract (`FORGE614_ECOSYSTEM_CONTRACT.md`), TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant Detection & Inspection for Atlas, Dedicated Product Home (`~/.forge614/engram/`), Safe Legacy Migration, Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 1.1.0-beta.2 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (582 tests passed, 15 skipped across 92 files, SDK contract types and runtime values verified on macOS ARM64 with Bun 1.3.8)
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents the public TypeScript API for Forge614 Engram, covering the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes, Schema 7 support for immutable confirmations and reinforced FTS5 search ranking without embeddings, progressive retrieval and Control Center contracts, and the public AI assistant detection and path inspection API used by sibling products such as Forge614 Atlas.

> [!NOTE]
> **Aimed at developers and sibling products:** This SDK is designed for engineers and companion tools (such as Forge614 Atlas) integrating structured memory or inspecting installed AI assistant engines on the host machine. Terminal end users only require the `forge614-engram` CLI binary. Consuming applications import directly from `forge614-engram`.

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

  // AI assistant detection and inspection (for sibling products like Atlas)
  CLIENT_IDS,
  LABELS,
  isClientId,
  inspectAssistant,
  resolveAssistantPaths,
  coverageWarnings,
  type ClientId,
  type AssistantLocation,
  type AssistantOptions,
  type AssistantDescriptor,
  type AssistantPaths,

  // Nonvisual initialization contract (for Forge614 Shell and Forge614 AI)
  inspectMemoryInitialization,
  previewMemoryInitialization,
  applyMemoryInitialization,
  type MemoryInitializationStatus,
  type MemoryInitializationRequest,
  type MemoryInitializationPreview,
  type MemoryInitializationResult,
} from "forge614-engram";
```

### Core SDK Architecture Principles

- **The SQLite API remains 100% synchronous:** All read, write, search, confirmation, session, timeline, and context operations in `MemoryStore` and `MemoryWorkspace` execute immediately on SQLite without `async`/`await`.
- **`MemoryStore` Facade Pattern:** Located in `src/app/memory-store.ts`, `MemoryStore` provides an immutable, backwards-compatible public interface while delegating persistence to specialized modules under `src/infrastructure/sqlite/` (`memory.ts`, `confirmations.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`, `control-center.ts`).
- **Complete Elimination of Legacy Root Files:** Historical files in the root of `src/` (`src/domain.ts`, `src/store.ts`, `src/identity.ts`, `src/sessions.ts`, etc.) have been completely removed. External consumers must import strictly from the root package `forge614-engram` (`src/index.ts`). Internal modules are forbidden by TypeScript AST lint rules (`tests/architecture/import-rules.ts`) from importing from `src/index.ts` to prevent cycles.
- **Direct Root Package Imports Without Deep Paths:** Consumers of the SDK (like Atlas) must always import from `forge614-engram`. Never import or recommend deep internal paths such as `forge614-engram/src/...` or `forge614-engram/src/modules/...`.
- **Public Read-Only Assistant Detection & Inspection:** While interactive configuration tools (`src/interfaces/terminal/`) and the MCP server (`src/interfaces/mcp/`) remain internal, **passive detection and path resolution** (`CLIENT_IDS`, `LABELS`, `isClientId`, `inspectAssistant`, `resolveAssistantPaths`, `coverageWarnings`) is an official first-class capability exported by the SDK, enabling sibling products to audit the host machine without executing CLI commands or modifying settings.
- **No `AsyncMemoryWorkspace`:** No public asynchronous wrapper exists. Applications interact locally with the synchronous store; external assistants interact via MCP or CLI commands.

---

## 2. SDK Class Architecture

1. **`MemoryWorkspace` (High-Level Workspace Manager):**
   Manages user central storage in its dedicated product home (`~/.forge614/engram/`), initializes the environment ensuring permissions (`0700`) and performing automatic safe migration of prior loose files, orchestrates project lifecycle (`createProject`, `listProjects`, `renameProject`), and opens secure database connections (`open()`).
2. **`WorkspaceConfig` (Configuration Manager):**
   Manages atomic read/write of `~/.forge614/engram/.env`. Validates permissions (`0700` directory, `0600` file), format versions (Format 2 local, Format 3 sync), and prevents concurrency using `.config-lock`. Its `prepare()` method performs atomic migration of prior loose files in `~/.forge614/` into `~/.forge614/engram/` before securing the directory to `0700`. Its `databasePath` property defaults to `~/.forge614/engram/engram.db`. Includes `repairExistingRoot()` to automatically tighten existing user-owned workspace directories to `0700`.
3. **`MemoryStore` (SQLite Database Engine):**
   Directly executes operations on SQLite tables (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getByTopic`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, `enableSearchReinforcement`, `reinforcementEnabled`, `controlCenter`, etc.).
4. **`defaultDatabasePath(): string` (Default Database Path Helper):**
   Exported utility function that returns the canonical path to the local SQLite database: `join(engramHome(), "engram.db")` (by default `~/.forge614/engram/engram.db`).

---

## 3. `MemoryWorkspace` Methods

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Automatically repairs permissions of an existing user-owned directory to `0700` (`config.repairExistingRoot()`), performs safe legacy migration of loose files if present (`config.prepare()`), and ensures `.env` and `engram.db` exist with secure permissions (`0700`/`0600`) inside `~/.forge614/engram/`. Idempotent and non-destructive.

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

### Direct Retrieval, Progressive Retrieval & Reinforced Search

#### `store.get(projectId: string | null, id: string): Memory | null`
Retrieves an active memory by its UUID identifier `id`.
- If `projectId` is a string, queries exclusively within that project (`projectId IS ? AND id=?`).
- If `projectId` is `null`, queries exclusively within universal shared memories (`scope: "shared"`).
- Returns the complete `Memory` object or `null` if not found or owned by a different scope.

#### `store.getByTopic(projectId: string | null, topicKey: string): Memory | null`
Directly retrieves an existing memory using its unique topic key (`topicKey`).
- **Exact Contract:**
  ```typescript
  getByTopic(projectId: string | null, topicKey: string): Memory | null
  ```
- **Behavior & Guarantees:**
  - Looks up an existing memory using its `topicKey`.
  - Returns the complete `Memory` record or `null` if it does not exist.
  - With `projectId` (string), searches **exclusively** within that project (`WHERE projectId IS ? AND topic_key=?`).
  - With `projectId: null`, searches **exclusively** within universal shared memories (`scope: "shared"`).
  - **Strict Owner Isolation:** Never crosses memories across different projects or between a project and the shared scope.
  - **Input Validation:** Validates that `topicKey` is non-empty text without null characters (`\0`). If passed an empty string, whitespace only, or null characters, immediately throws `MemoryError` with code `INVALID_INPUT`.
  - **Exact Lookup (NOT FTS5 or Approximate Search):** Must not be described as FTS5 search, vector search, or fuzzy/approximate matching. It is an exact relational SQLite query; its result is determined by the exact owner and topic key.
  - **SDK Availability:** Available automatically from the SDK because `MemoryStore` is already exported as a public class from `src/index.ts` (no new root export was added).
- **Official Forge614 Atlas Use Case:**
  Forge614 Atlas uses this method to immediately check whether a module or code component has already been analyzed by its autonomous agents, avoiding redundant work:
  ```typescript
  const previous = store.getByTopic(projectId, "atlas:module:authentication");

  if (previous) {
    // The module was already analyzed and Atlas can resume without repeating work.
  } else {
    // Atlas must analyze it and save the new knowledge.
  }
  ```

#### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Returns the complete immutable revision history for a memory, ordered chronologically by version number in ascending order.

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
import { MemoryWorkspace, type SearchResult } from "forge614-engram";

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
import { MemoryWorkspace, type SummaryFields } from "forge614-engram";

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

---

### Example 3: Exact Topic Query (`getByTopic`) for Forge614 Atlas

```typescript
import { MemoryWorkspace, type Memory } from "forge614-engram";

const workspace = new MemoryWorkspace();
const store = workspace.open();

try {
  const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const topicKey = "atlas:module:authentication";

  // 1. Exact indexed query by topicKey and owner (not FTS5, no approximations)
  const previous: Memory | null = store.getByTopic(projectId, topicKey);

  if (previous) {
    // The module was already analyzed: Atlas can resume without repeating work
    console.log(`Module previously analyzed in version ${previous.version} (ID: ${previous.id})`);
    console.log(`Last updated: ${previous.updatedAt}`);
    console.log(`Cached analysis: ${previous.content}`);
  } else {
    // Atlas must analyze it and persist new structured knowledge
    console.log("Module not analyzed yet. Performing architectural analysis...");

    store.save({
      scope: "project",
      projectId,
      topicKey,
      title: "Architectural Analysis: Authentication Module",
      content: "Module implements OAuth2 with refresh token rotation and RS256 signing keys.",
      type: "procedure",
      requestKey: "atlas-auth-analysis-v1",
    });

    console.log("New Atlas knowledge saved successfully.");
  }

  // 2. Exact query in universal shared scope (scope: 'shared')
  const globalStandard = store.getByTopic(null, "atlas:standard:typescript-strict");
  if (globalStandard) {
    console.log(`Active global standard: ${globalStandard.title}`);
  }
} finally {
  store.close();
}
```

---

## 6. AI Assistant Detection and Inspection API (Atlas Integration)

### Purpose and Integration Context

**Forge614 Atlas** (a companion product for autonomous agent orchestration and execution) imports **Forge614 Engram** as a TypeScript library (`import { ... } from "forge614-engram"`), and **not** as a command-line terminal CLI.

Atlas uses this public SDK surface for two core needs:
1. **Assistant Inspection:** Inspecting which development assistants or agent engines (`claude -p`, and in the future Codex or others) are actually installed on the user's host machine, allowing Atlas to choose the appropriate execution engine when launching autonomous subagents.
2. **Exact Knowledge Verification:** Calling the synchronous `MemoryStore` facade method `store.getByTopic(projectId, topicKey)` to immediately verify if a code module or component was already processed, eliminating redundant work without paying full-text search overhead.

### Mandatory Security Guarantees (Strictly Passive Operation)

This API surface operates under strict isolation and security boundaries:

- **Read-only inspection and path resolution:** It does not execute arbitrary shell commands, launch assistant background processes, or touch user files.
- **Does not connect, configure, install, or modify assistants:** It does not download binaries, alter third-party configuration files (`.claude.json`, `config.toml`, `mcp.json`, `opencode.json`), or modify permissions.
- **Does not configure MCP automatically:** Adding MCP memory tools requires Engram's explicit setup flows (`forge614-engram init` or `assistant-config`); this SDK purely reports whether an assistant is detected and where its configuration paths reside.
- **Does not touch databases or initialize storage during assistant inspection:** The detection helpers (`inspectAssistant`, `resolveAssistantPaths`) do not create or repair `~/.forge614/engram/`, do not read/write `.env`, and never open SQLite (`engram.db`) or PostgreSQL connections.
- **Strict separation of concerns:** Atlas decides what to do with the inspection result; Engram exclusively provides objective, safe, and consistent inspection data about the host machine.
- **No deep internal imports:** Consumers must import strictly from `forge614-engram`. Do not import from internal paths like `forge614-engram/src/...` or `forge614-engram/src/modules/...`.

---

### Exported Values and Functions Catalog

The following detection tools are exported directly from the root of `forge614-engram`:

```typescript
import {
  CLIENT_IDS,
  LABELS,
  isClientId,
  inspectAssistant,
  resolveAssistantPaths,
  coverageWarnings,
} from "forge614-engram";
```

#### `CLIENT_IDS`
An immutable constant array (`readonly string[]`) declaring the official identifiers of currently known and supported assistants:
```typescript
export const CLIENT_IDS = [
  "claude-code",
  "codex",
  "cursor",
  "opencode",
  "antigravity",
] as const;
```

#### `LABELS: Record<ClientId, string>`
A record mapping each technical identifier to its official display name for user interfaces and logs:
- `"claude-code"` → `"Claude Code"`
- `"codex"` → `"Codex"`
- `"cursor"` → `"Cursor"`
- `"opencode"` → `"OpenCode"`
- `"antigravity"` → `"Antigravity"`

#### `isClientId(value: string): value is ClientId`
A TypeScript type guard function. Takes an arbitrary string and validates whether it matches a known `ClientId` before attempting inspection or path resolution.

#### `resolveAssistantPaths(clientId: ClientId, options?: AssistantOptions): AssistantPaths`
Deterministically computes the expected disk paths for the requested assistant based on platform environment variables and the user's home directory (`$HOME`).
- **Returns:** An `AssistantPaths` object:
  - `directory`: The base configuration directory (e.g. `~/.claude`, `~/.codex`, `~/.cursor`).
  - `config`: Absolute path to the main configuration file (e.g. `~/.claude.json`, `~/.cursor/mcp.json`).
  - `hooks`: Path to the event hooks file, if supported by the client (e.g. `settings.json` or `hooks.json`). Omitted (`undefined`) for Antigravity.
  - `plugin`: Path to the bundled Engram plugin (`plugins/forge614-engram.js`).
  - `activeConfigs`: List of all active configuration file candidates evaluated (essential for OpenCode where global XDG and custom config directories may coexist).
  - `activePlugins`: List of evaluated plugin paths.
- **Invariant:** It does not create directories or files; it only projects canonical filesystem paths.

#### `inspectAssistant(clientId: ClientId, options?: AssistantOptions): AssistantDescriptor`
Safely inspects the host machine without spawning subprocesses or executing external binaries. Searches for executable files across directories listed in `PATH` and standard platform-specific fallback locations (macOS, Linux, and Windows), checks for existing configuration files, and returns a structured `AssistantDescriptor`:
- `id`: The queried client identifier (`ClientId`).
- `label`: Human-readable assistant label.
- `detected`:
  - `installed`: Boolean confirming whether an executable binary was found with execution permissions (`accessSync(..., X_OK)`).
  - `executable`: Absolute path to the found binary, or `null` if not detected.
  - `configFound`: Boolean indicating whether at least one configuration file was located on disk.
  - `evidence`: List of safe, objective detection evidence gathered on disk.
- `configuration`:
  - `status`: Current configuration state (`"absent"`, `"needs-configuration"`, `"configured"`, `"conflict"`, `"malformed"`, `"blocked"`).
  - `paths`: Tested configuration file paths on disk.
  - `message`: Optional descriptive message in case of configuration conflict or parsing anomaly.
- `automation`:
  - `coverage`: Hook coverage level supported by the assistant (`"session-and-prompt"`, `"session-only"`, `"experimental-system-and-compaction"`, `"mcp-only"`).
  - `warnings`: Warning strings highlighting real automation boundaries.

#### `coverageWarnings(clientId: ClientId, options?: AssistantOptions): string[]`
Returns clear warning strings regarding the real automation boundaries of each assistant (for example, Cursor only injecting guidance on session start with no compaction recovery hook, Codex requiring manual approval of new hooks under `/hooks`, or Antigravity lacking durable hooks until an official event is verified).

> [!IMPORTANT]
> **Architectural Distinction: Infrastructure vs Pure `coverageWarnings`**
> Two internal functions share the name `coverageWarnings`:
> 1. A pure function in `src/modules/assistants/catalog.ts` requiring explicit environment options to evaluate overrides such as `OPENCODE_CONFIG_CONTENT`.
> 2. An infrastructure function in `src/infrastructure/assistants/catalog.ts`:
>    ```typescript
>    export function coverageWarnings(id: ClientId, options: AssistantOptions = {}): string[] {
>      return pureCoverageWarnings(id, { ...options, env: options.env ?? process.env });
>    }
>    ```
> **The public SDK exports strictly the infrastructure version.** This guarantees that external consumers, like Forge614 Atlas, automatically observe the user's live host environment (`process.env`) without needing to manually pass system environment records. Never import the internal pure version from deep paths.

---

### Exported TypeScript Types

```typescript
import type {
  ClientId,
  AssistantLocation,
  AssistantOptions,
  AssistantDescriptor,
  AssistantPaths,
} from "forge614-engram";
```

- **`ClientId`:** Literal union type `'claude-code' | 'codex' | 'cursor' | 'opencode' | 'antigravity'`.
- **`AssistantLocation`:** Path override shape (`configDir`, `configFile`, `executable`).
- **`AssistantOptions`:** Inspection options for testing or customized environments (`home`, `env`, `path`, `platform`, `locations`, `engramExecutable`).
- **`AssistantDescriptor`:** Complete structured contract returned by `inspectAssistant()`.
- **`AssistantPaths`:** Resolved paths contract returned by `resolveAssistantPaths()`.

---

### Production Code Example for Sibling Projects (Atlas)

The following example demonstrates how a sibling product (such as Atlas) inspects installed assistant engines on the host machine prior to spawning subagents:

```typescript
import {
  CLIENT_IDS,
  inspectAssistant,
  isClientId,
  resolveAssistantPaths,
} from "forge614-engram";

// 1. Iterate through all supported assistants to audit installed engines
for (const clientId of CLIENT_IDS) {
  const assistant = inspectAssistant(clientId);

  if (assistant.detected.installed) {
    console.log(`${assistant.label} is available at ${assistant.detected.executable}`);
    console.log(`Configuration status: ${assistant.configuration.status}`);
    console.log(`Automation level: ${assistant.automation.coverage}`);
  }
}

// 2. Validate dynamic client identifiers before use
const requestedClient = "claude-code";

if (isClientId(requestedClient)) {
  // 3. Resolve canonical configuration paths safely
  const paths = resolveAssistantPaths(requestedClient);
  console.log(`Base directory: ${paths.directory}`);
  console.log(`Config path: ${paths.config}`);
  if (paths.hooks) {
    console.log(`Hooks path: ${paths.hooks}`);
  }
} else {
  console.error(`Client '${requestedClient}' is not a recognized assistant.`);
}
```

---

### SDK Contract Verification and Quality

The public SDK contract is continuously verified by a dedicated contract test suite in `src/index.test.ts`:
1. **Type and Runtime Verification:** Verifies that `CLIENT_IDS`, `LABELS`, `isClientId`, `inspectAssistant`, `resolveAssistantPaths`, `coverageWarnings`, `inspectMemoryInitialization`, `previewMemoryInitialization`, and `applyMemoryInitialization` are exported runtime constants/functions, and verifies that TypeScript types compile without errors.
2. **Test Suite:** Validated with `bun test src/index.test.ts` (5 passed, 0 failed) and full `bun test`.
3. **Strict Type Checking:** Verified with `bun run typecheck` (`tsc --noEmit`).
4. **Formatting and Whitespace:** Verified with `git diff --check`.

---

## 8. Nonvisual Initialization Contract

As part of the architectural transition toward the unified Forge614 ecosystem (`FORGE614_ECOSYSTEM_CONTRACT.md`), Forge614 Engram exposes a public TypeScript contract so that **Forge614 Shell** and, in the future, **Forge614 AI** can inspect memory status, request safe initialization previews, and apply approved initialization requests without opening Engram's terminal user interface (TUI):

```typescript
import {
  inspectMemoryInitialization,
  previewMemoryInitialization,
  applyMemoryInitialization,
  type MemoryInitializationStatus,
  type MemoryInitializationRequest,
  type MemoryInitializationPreview,
  type MemoryInitializationResult,
} from "forge614-engram";
```

### 8.1. `inspectMemoryInitialization(config?: WorkspaceConfig): MemoryInitializationStatus`

Passively inspects the initialization state of the Engram workspace:

```typescript
const status = inspectMemoryInitialization();
// Returns:
// {
//   initialized: boolean,
//   storage: "sqlite",
//   postgresConfigured: boolean,
//   reinforcementEnabled: boolean
// }
```

**Field Descriptions in Plain Language:**
- **`initialized`:** Indicates whether Engram's dedicated product home (`~/.forge614/engram/`) already exists and contains a prepared local database. If `false`, memory has not been configured yet.
- **`storage`:** Local storage engine used. In Engram, this is always `"sqlite"` (memories are stored directly on your machine first, ensuring fast and private local access).
- **`postgresConfigured`:** Indicates whether a PostgreSQL replica URL is configured in the `.env` file. If `false`, memory operates in 100% local mode.
- **`reinforcementEnabled`:** Indicates whether memory repetition reinforcement (Schema 7) is enabled in SQLite to rank search results by stability and recency.

**Security Guarantees and Invariants:**
- **100% Read-Only:** If Engram does not exist yet, it returns `{ initialized: false, storage: "sqlite", postgresConfigured: false, reinforcementEnabled: false }`. **It creates no directories (`~/.forge614/engram`), creates no `.env`, creates no `engram.db`, and creates no projects or memories.**
- **Safe Connection Teardown:** If the workspace exists, it opens SQLite in read-only mode (`open(true)`), queries whether Schema 7 is active, and closes the database immediately within a `finally` block.
- **Zero Credential Leaks:** `postgresConfigured` is intentionally a boolean flag. The actual PostgreSQL connection string and credentials are never returned in this object.

---

### 8.2. `previewMemoryInitialization(request: MemoryInitializationRequest, config?: WorkspaceConfig): Promise<MemoryInitializationPreview>`

Takes a nonvisual initialization request and computes a structured forecast of proposed changes without altering the system:

```typescript
const preview = await previewMemoryInitialization({
  postgresUrl: "postgresql://user:password@127.0.0.1/db?sslmode=disable",
  enableReinforcement: true,
});
// Returns:
// {
//   status: { initialized: false, storage: "sqlite", postgresConfigured: false, reinforcementEnabled: false },
//   expectedRevision: null,
//   initializesStorage: true,
//   configuresPostgres: true,
//   enablesReinforcement: true
// }
```

**Field Descriptions in Plain Language:**
- **`status`:** Current system state prior to applying any action (the exact object returned by `inspectMemoryInitialization`).
- **`expectedRevision`:** The fingerprint or version stamp of the current configuration (`config.revision()`). It serves as an integrity seal: it allows downstream callers to verify that no third party modified `.env` while the user was reviewing the preview. If the workspace does not yet exist, its value is `null`.
- **`initializesStorage`:** Boolean flag (`true`/`false`). Indicates whether applying the request will create the dedicated directory, `.env` file, and initial SQLite database.
- **`configuresPostgres`:** Boolean flag. Indicates whether the requested PostgreSQL URL will cause a configuration change (addition, modification, or removal) relative to the existing configuration.
- **`enablesReinforcement`:** Boolean flag. Indicates whether the Schema 7 migration (FTS5 search reinforcement) will be applied. If reinforcement was already active, this flag is `false` because no migration is needed.

**Security Guarantees and Invariants:**
- **Zero Disk Writes:** The preview never creates directories, writes files, or mutates SQLite tables.
- **No Remote Network Calls:** It never opens network sockets or attempts to contact a remote PostgreSQL server during preview generation. It strictly validates the URL syntax locally via `postgresOptions()`.
- **Credential Protection:** The `postgresUrl` string and its credentials are never serialized into `MemoryInitializationPreview`, nor are they logged or leaked in error messages.

---

### 8.3. `applyMemoryInitialization(request: MemoryInitializationRequest, expectedRevision: string | null, config?: WorkspaceConfig): Promise<MemoryInitializationResult>`

Atomically and safely applies the changes planned and confirmed by the user in Forge614 Shell:

```typescript
const result = await applyMemoryInitialization(
  {
    postgresUrl: "postgresql://user:password@127.0.0.1/db?sslmode=disable",
    enableReinforcement: true,
  },
  preview.expectedRevision,
);
// Returns:
// {
//   status: { initialized: true, storage: "sqlite", postgresConfigured: true, reinforcementEnabled: true },
//   initializedStorage: true,
//   configuredPostgres: true,
//   enabledReinforcement: true
// }
```

**Parameters and Fields in Plain Language:**
- **`request`:** The typed request containing the optional PostgreSQL URL (`postgresUrl: string | null`) and the reinforcement preference (`enableReinforcement: boolean`).
- **`expectedRevision`:** The revision stamp captured during the preview (`preview.expectedRevision`). If another process or user modified the `.env` file while the user was reviewing the preview screen in Shell, the operation stops immediately, throwing `CONFIG_CHANGED` ("La configuración cambió; genera una vista previa nueva antes de aplicar cambios.").
- **`config` (Optional):** Workspace configuration instance (`WorkspaceConfig`), defaulting to `~/.forge614/engram/`.
- **`result.status`:** Final inspected state of the system after completing the operations.
- **`result.initializedStorage`:** `true` if local SQLite storage was created in this execution; `false` if it already existed.
- **`result.configuredPostgres`:** `true` if the PostgreSQL configuration in `.env` changed relative to the existing configuration.
- **`result.enabledReinforcement`:** `true` if FTS5 search reinforcement (Schema 7) was activated during this execution.

**Security Guarantees and Invariants:**
- **Optimistic Concurrency Control:** Compares `config.revision() === expectedRevision`. If external concurrent drift is detected, it strictly aborts without writing to disk.
- **Transient Pre-Flight PostgreSQL Validation:** When `postgresUrl` is provided, it executes a transient connection and read check (`PostgresReplica.connect(url, true); await replica.read(); await replica.close()`) **before mutating local disk or `.env`**. If the remote database is unreachable or credentials are bad, it fails cleanly without leaving `.env` or the database in an inconsistent state.
- **Idempotent Initialization:** Calls `workspace.init()` to ensure dedicated directory ownership (`0700`) and initial `engram.db` permissions (`0600`) without corrupting or wiping pre-existing user data.
- **Additive Reinforcement (No Downgrade):** When `enableReinforcement` is `true` and not previously active, it runs `store.enableSearchReinforcement()`. When `enableReinforcement` is `false`, it never disables or downgrades existing reinforcement (reinforcement in Engram is strictly additive and permanent).

---

### 8.4. Complete Integration Example for Forge614 Shell

```typescript
import {
  inspectMemoryInitialization,
  previewMemoryInitialization,
  applyMemoryInitialization,
} from "forge614-engram";

// 1. Check status without side effects
const currentStatus = inspectMemoryInitialization();

if (!currentStatus.initialized) {
  console.log("Engram is not initialized. Preparing initialization request...");

  // 2. Build the desired request from user input gathered in Shell
  const request = {
    postgresUrl: null, // or the confidential URL entered in Shell
    enableReinforcement: true,
  };

  // 3. Generate the safe preview and capture the expected revision
  const preview = await previewMemoryInitialization(request);

  console.log("Computed initialization preview:");
  console.log(`- Will initialize local storage?: ${preview.initializesStorage ? "Yes" : "No"}`);
  console.log(`- Will configure PostgreSQL replica?: ${preview.configuresPostgres ? "Yes" : "No"}`);
  console.log(`- Will enable FTS5 reinforcement?: ${preview.enablesReinforcement ? "Yes" : "No"}`);
  console.log(`- Expected revision for confirmation: ${preview.expectedRevision ?? "Fresh install"}`);

  // 4. Upon explicit user confirmation in Shell, apply changes atomically
  const result = await applyMemoryInitialization(request, preview.expectedRevision);

  console.log("Initialization completed successfully:");
  console.log(`- Local storage initialized: ${result.initializedStorage}`);
  console.log(`- PostgreSQL configured: ${result.configuredPostgres}`);
  console.log(`- Reinforcement enabled: ${result.enabledReinforcement}`);
}
```
