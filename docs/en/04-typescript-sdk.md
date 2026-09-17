# 04 (EN). TypeScript SDK Guide (MemoryStore)

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents the public TypeScript API of Forge614 Engram, how to integrate the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes into custom developer tools, the Schema 6 progressive session lifecycle, ranked context retrieval, and architectural module boundaries.

> [!NOTE]
> **Developer Focus:** This SDK is intended for developers creating custom AI agents or TypeScript tooling. End users running terminal commands only require the compiled `forge614-engram` binary. There is no public npm package; imports reference `./src/index`.

---

## 1. Exported Modules and SDK Philosophy

The primary entry point is `src/index.ts`:

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

  // Domain types
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
  type MemoryScope,
  type SearchScope,

  // Progressive session types (Schema 6)
  type Session,
  type SessionEntry,
  type SessionSummary,
  type SessionSaveOptions,
  type SessionSaveResult,
  type SummaryFields,

  // Retrieval and context types
  type MemoryPreview,
  type PreviewResult,
  type VersionRead,
  type TimelineInput,
  type TimelineRow,
  type TimelineResult,
  type ContextInput,
  type ContextRow,
  type ContextResult,

  // Project context utilities
  saveProjectMemoryWithSession,
  startProjectSession,
} from "./src/index";
```

### Core SDK Architecture Principles

- **Synchronous SQLite Engine:** All read, write, search, session, timeline, and context operations in `MemoryStore` and `MemoryWorkspace` execute directly and synchronously over SQLite without async promises.
- **Compatible `MemoryStore` Facade:** The `MemoryStore` class (located in `src/app/memory-store.ts`) implements the Facade pattern: it preserves 100% of the public interface and method signatures expected by SDK consumers while delegating persistence to specialized partitioned modules in `src/infrastructure/sqlite/` (`memory.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`).
- **Removal of Legacy Internal Paths:** Historical flat files in the root of `src/` (`src/domain.ts`, `src/store.ts`, `src/identity.ts`, `src/sessions.ts`, `src/retrieval.ts`, `src/schema.ts`, `src/paths.ts`, etc.) have been **completely removed**. External tools must import exclusively from `src/index.ts`. Internal codebase imports into `src/index.ts` are strictly forbidden and enforced by the TypeScript AST auditor (`tests/architecture/import-rules.ts`).
- **Internal Infrastructure and Interface Boundaries:**
  - The MCP server (`src/interfaces/mcp/`)
  - Assistant hooks and terminal commands (`src/interfaces/terminal/` and `src/modules/assistants/`)
  - The interactive terminal UI menu (`src/interfaces/tui/`)
  - The asynchronous self-tester (`src/infrastructure/assistants/self-test.ts`)
  - The replication sync engine (`src/infrastructure/postgres/` and `src/app/synchronization.ts`)
  These components are internal and are never re-exported through the public SDK entry point.
- **No `AsyncMemoryWorkspace`:** There is no asynchronous wrapper class. Applications interact synchronously with the local SQLite engine, and remote assistant communication uses the standard MCP protocol or CLI commands.

---

## 2. Core SDK Classes

1. **`MemoryWorkspace` (High-Level Workspace Manager):**
   Manages the user's central space (`~/.forge614/`), initializes storage (`init()`), handles project lifecycles (`createProject`, `listProjects`, `renameProject`), and opens store connections (`open()`).
2. **`WorkspaceConfig` (Configuration Manager):**
   Manages atomic reading and writing of `~/.forge614/.env`. Enforces file permissions (`0700` directory, `0600` file) and prevents race conditions via `.config-lock`.
3. **`MemoryStore` (SQLite Database Engine):**
   Executes direct database queries (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, etc.).

---

## 3. Methods of `MemoryWorkspace`

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Prepares `.env` and `engram.db` with secure permissions (`0700`/`0600`). If already valid, preserves existing data.

### `workspace.createProject(name: string): Project`
Creates and registers a new project, assigning an immutable UUIDv4 `projectId`.

### `workspace.listProjects(): Project[]`
Returns all registered projects ordered chronologically.

### `workspace.renameProject(projectId: string, name: string): Project`
Updates the cosmetic display name while preserving `projectId` and memories.

### `workspace.open(readonly = false): MemoryStore`
Opens a `MemoryStore` instance after validating permissions and schema version.

---

## 4. Methods of `MemoryStore` (Schemas 5 & 6)

### Schema Management & Bindings

#### `store.enableAssistantIntegration(): void`
Explicitly migrates the database to **Schema 5** (creates `project_bindings`).

#### `store.enableSessions(): void`
Explicitly migrates the database to **Schema 6** (creates `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`).

#### `store.sessionsEnabled(): boolean`
Returns `true` if the database has Schema 6 applied (`PRAGMA user_version === 6`).

#### `store.bindProjectDirectory(directory: string, projectId: string): Project`
Associates a local directory to an existing `projectId`.

#### `store.resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (dir: string) => boolean): { project: Project | null; created: boolean }`
Resolves a directory binding or creates the project atomically.

---

### Progressive Session Lifecycle (Schema 6)

#### `store.startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session`
Starts a runtime work session (`kind: "runtime"`). If `runtimeDirectory` is supplied, registers a local binding in `local_session_bindings`.

#### `store.endSession(projectId: string, sessionId: string): Session`
Closes a runtime session, recording its ISO 8601 completion timestamp. Manual sessions cannot be closed (`SESSION_KIND`).

#### `store.saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields, request: { requestKey: string; expectedVersion?: number }): SessionSaveResult`
Persists a structured session summary (with mandatory fields `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`) under reserved topic `session/<sessionId>/summary` with type `procedure`. Updates `session_summaries`.

---

### Memory Persistence & Session Tracking

#### `store.save(input: SaveInput): MemoryVersion`
Persists a standard memory. On Schema 6, project memories automatically attach to the local manual fallback session.

#### `store.saveWithSession(input: SaveInput, options?: SessionSaveOptions): SessionSaveResult`
Persists a memory with session tracking:
- `options.sessionId`: Explicit session ID.
- `options.mode`: `"independent"` (CLI) or `"assistant"` (MCP).
- Auto-infers active runtime sessions in assistant mode when exactly 1 was active in the last 7 days; halts with `AMBIGUOUS_SESSION` if multiple exist.
- Shared memories with session require explicit `options.projectId`; stored with `projectId: null` and private session metadata stripped from external responses.

---

### Progressive Retrieval & Ranked Context

#### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
FTS5 trigram search with BM25 and recency ranking.

#### `store.searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[]`
Lightweight retrieval returning `MemoryPreview` records with content truncated to **300 Unicode code points** and boolean `truncated` flag.

#### `store.getVersion(projectId: string | null, id: string, version?: number): VersionRead | null`
Retrieves a specific historical revision or current version of a memory.

#### `store.timeline(projectId: string, input: TimelineInput): TimelineResult`
Reconstructs the chronological event window of a session surrounding a focus memory.

#### `store.context(projectId: string | null, input?: ContextInput): ContextResult`
Assembles prioritized context in three sections (`pinned`, `recent`, `summaries`) respecting `maxBytes` UTF-8 serialized byte cap (1024..65536, default 16384).

---

## 5. Production-Ready Code Examples

### Example 1: Schema 6 Enablement, Session Lifecycle, and Memory Save

```typescript
import { MemoryWorkspace, type SummaryFields } from "./src/index";

const workspace = new MemoryWorkspace();
workspace.init();

const store = workspace.open();
try {
  // 1. Ensure Schema 6 is enabled
  if (!store.sessionsEnabled()) {
    store.enableSessions();
  }

  // 2. Create project and bind local directory
  const project = workspace.createProject("Payments Service");
  const localDir = "/Users/usuario/Projects/payments-service";
  store.bindProjectDirectory(localDir, project.projectId);

  // 3. Start a runtime work session
  const sessionId = "ses-payments-migration-v2";
  const session = store.startSession(project.projectId, sessionId, localDir);
  console.log(`Session started: ${session.sessionId} at ${session.startedAt}`);

  // 4. Save a memory bound to the active session
  const result = store.saveWithSession(
    {
      scope: "project",
      projectId: project.projectId,
      title: "Idempotent Webhook Implementation",
      content: "Redis keys used for idempotency tracking with 24h TTL.",
      type: "decision",
      topicKey: "webhook-idempotency",
    },
    { sessionId: session.sessionId }
  );

  console.log(`Saved memory ${result.memory.id} (Source: ${result.sessionSource})`);

  // 5. Save structured session summary
  const summary: SummaryFields = {
    goal: "Implement idempotent payment webhooks",
    instructions: "Use Redis SETNX with 86400s TTL",
    discoveries: "Stripe retries caused duplicate credit attempts",
    accomplishments: "Idempotency filter tested and deployed",
    nextSteps: "Monitor collision rates in production",
    files: ["src/payments/webhooks.ts", "src/redis/client.ts"],
  };

  store.saveSessionSummary(project.projectId, sessionId, summary, {
    requestKey: "req-summary-pay-01",
  });

  // 6. Close the session cleanly
  const closedSession = store.endSession(project.projectId, sessionId);
  console.log(`Session closed at ${closedSession.endedAt}`);
} finally {
  store.close();
}
```

---

### Example 2: Progressive Retrieval (Previews, Timeline, and Ranked Context)

```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open(true); // Read-only connection

try {
  const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  // 1. Progressive search previews (bounded to 300 code points)
  const previews = store.searchPreviews(projectId, "webhooks", 5);
  for (const item of previews) {
    console.log(`- [${item.memory.type}] ${item.memory.title}: "${item.memory.preview}" (Truncated: ${item.memory.truncated})`);
  }

  // 2. Timeline inspection surrounding a memory in a session
  if (previews.length > 0) {
    const memoryId = previews[0]!.memory.id;
    const version = previews[0]!.memory.version;
    const timeline = store.timeline(projectId, {
      sessionId: "ses-payments-migration-v2",
      memoryId,
      version,
      before: 2,
      after: 2,
    });

    console.log(`Timeline for session ${timeline.sessionId}:`);
    console.log(`  Focus: ${timeline.focus.memory.title}`);
    console.log(`  Prior entries: ${timeline.before.length}, Subsequent entries: ${timeline.after.length}`);
  }

  // 3. Ranked context retrieval with byte budget
  const context = store.context(projectId, {
    compact: false,
    maxBytes: 16384, // 16 KiB serialized UTF-8 payload limit
  });

  console.log(`Ranked context: ${context.pinned.length} pinned, ${context.recent.length} recent, ${context.summaries.length} summaries.`);
  console.log(`Omitted by byte cap:`, context.omitted);
} finally {
  store.close();
}
```

---

### Example 3: Client MCP Tool Interaction (10 Tools)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "forge614-engram",
    args: ["mcp"],
    stderr: "ignore",
  });

  const client = new Client(
    { name: "custom-coding-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. List all 10 MCP tools
  const tools = await client.listTools();
  console.log("Exposed MCP tools:", tools.tools.map(t => t.name));

  // 2. Fetch ranked context on agent startup
  const contextRes = await client.callTool({
    name: "memory_context",
    arguments: { directory: process.cwd() },
  });
  console.log("Context dossier:", contextRes.content);

  await client.close();
}

main().catch(console.error);
```
