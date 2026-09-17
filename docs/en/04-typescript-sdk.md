# 04 (EN). TypeScript SDK Guide (MemoryStore)

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Active (Verified with 191 tests on macOS with Bun 1.3.8)
> **Sister translation:** [04. Guía de Integración con el SDK de TypeScript](../es/04-sdk-typescript.md)

This guide documents the public TypeScript API of Forge614 Engram, how to utilize the `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` classes in your own applications, Schema 5 extensions for machine-local project bindings, and the architectural boundary between public APIs and internal infrastructure modules.

> [!NOTE]
> **Developer-Facing SDK:** This SDK is intended for software engineers embedding structured personal memory into TypeScript applications or agent runtimes. End users interact with the terminal binary `forge614-engram`. There is no public package on npm; imports are resolved directly from `./src/index`.

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
- **The SQLite SDK is 100% Synchronous:** All read, write, search, and directory binding operations on `MemoryStore` and `MemoryWorkspace` execute synchronously in real time on SQLite without asynchronous promises (`async`/`await`).
- **MCP, Assistant Configuration, and Sync Modules are Internal Infrastructure:**
  - The MCP stdio server (`src/mcp.ts`)
  - The Git project resolver (`src/project-context.ts`)
  - Assistant configuration adapters (`src/assistants/*`)
  - The terminal UI engine (`src/assistant-tui.ts`)
  - The server self-test runner (`src/assistant-self-test.ts`)
  - PostgreSQL replica synchronization engines (`src/sync-*.ts`)
  These are specialized internal components and **are not re-exported in `src/index.ts`**.
- **Do Not Invent an `AsyncMemoryWorkspace`:** There is no asynchronous wrapper class. Applications interact with the local synchronous store, while assistant integration occurs via the standard MCP protocol or CLI commands.

---

## 2. SDK Class Architecture

1. **`MemoryWorkspace` (High-Level Manager):**
   Manages user central storage (`~/.forge614/`), initializes the environment, manages project lifecycles (`createProject`, `listProjects`, `renameProject`), and opens verified database connections (`open()`).
2. **`WorkspaceConfig` (Configuration Manager):**
   Controls atomic reading and writing of `~/.forge614/.env`. Enforces file permissions (`0700` directory, `0600` file), supports format version 2 (local) and format version 3 (with `postgresUrl`), and coordinates setup concurrency using `.config-lock`.
3. **`MemoryStore` (Low-Level Storage Engine):**
   Executes direct SQLite operations (`save`, `get`, `history`, `search`, `archive`, `restore`, `enableAssistantIntegration`, `bindProjectDirectory`, `resolveProjectDirectory`, `saveForProjectDirectory`).

---

## 3. `MemoryWorkspace` API Methods

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Initializes `.env` and `engram.db` with secure permissions. If files already exist and are valid, leaves data intact.

### `workspace.createProject(name: string): Project`
Registers a new project in the database, generating a unique lowercase UUIDv4 `projectId`.

### `workspace.listProjects(): Project[]`
Returns all registered projects in the central database, ordered chronologically.

### `workspace.renameProject(projectId: string, name: string): Project`
Updates a project's cosmetic display name while preserving `projectId`, ownership, and history intact.

### `workspace.open(readonly = false): MemoryStore`
Validates workspace configuration and opens `MemoryStore`. If `readonly` is `true`, opens in read-only mode for non-mutating inspection.

---

## 4. `MemoryStore` API Methods (Including Schema 5)

### `store.enableAssistantIntegration(): void`
Explicitly enables assistant integration and machine-local directory bindings by applying an additive migration to **Schema 5** (creates the `project_bindings` table and index). This is a safe, additive, irreversible operation that never drops memories or alters existing records.

### `store.bindProjectDirectory(directory: string, projectId: string): Project`
Associates a local directory path with an existing `projectId` in `project_bindings`. If the path is already bound to a different project, it throws `PROJECT_BINDING_CONFLICT`.

### `store.resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (dir: string) => boolean): { project: Project | null; created: boolean }`
Resolves project association for a given directory path:
- If the directory is already bound, returns the associated project (`created: false`).
- If `create` is `false` and the directory is unbound, returns `project: null`.
- If `create` is `true`:
  - If a project with the same name exists, throws `PROJECT_BINDING_REQUIRED`.
  - If any recorded directory for any project is missing on disk (`bindingAvailable`), throws `PROJECT_BINDING_REQUIRED` to avoid creating orphan duplicates.
  - Otherwise, atomically creates the project, registers the binding in `project_bindings`, and returns the project (`created: true`).

### `store.saveForProjectDirectory(directory: string, name: string, input: Omit<SaveInput, "projectId" | "scope">, bindingAvailable?: (dir: string) => boolean): MemoryVersion`
Resolves the directory (creating the project and binding atomically if saving for the first time) and saves the memory under `scope: "project"`.

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

### `store.get(projectId: string | null, id: string): Memory | null`
Retrieves an active or archived memory card by UUID.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Returns the chronological list of immutable past revisions for a memory.

### `store.archive(projectId: string | null, id: string): Memory`
Retires an active memory from standard searches while preserving complete history.

### `store.restore(projectId: string | null, id: string): Memory`
Restores an archived memory back to the active state.

---

## 5. Production-Ready Code Examples

### Example 1: Workspace Initialization, Schema 5, and Directory Binding

```typescript
import { MemoryWorkspace } from "./src/index";

// 1. Initialize central storage (~/.forge614/)
const workspace = new MemoryWorkspace();
workspace.init();

// 2. Open writable database connection
const store = workspace.open();
try {
  // 3. Enable assistant integration (Schema 5)
  store.enableAssistantIntegration();

  // 4. Create formal project record
  const project = workspace.createProject("Payment Gateway");
  console.log(`Created project: ${project.name} (${project.projectId})`);

  // 5. Bind local repository path
  const localDir = "/Users/usuario/Projects/payment-gateway";
  store.bindProjectDirectory(localDir, project.projectId);
  console.log(`Directory bound successfully: ${localDir}`);
} finally {
  store.close();
}
```

---

### Example 2: Atomic Save Resolving Project from Directory

```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open();

try {
  // Save memory resolving directory automatically
  const version = store.saveForProjectDirectory(
    "/Users/usuario/Projects/payment-gateway",
    "Payment Gateway",
    {
      title: "Gateway Provider Decision",
      content: "Stripe Connect selected with idempotent webhook handling.",
      type: "decision",
      topicKey: "payment-gateway-provider",
    }
  );

  console.log(`Saved memory ID: ${version.memoryId}, Version: ${version.version}`);
} finally {
  store.close();
}
```

---

### Example 3: Consuming the Stdio MCP Server via Official Client SDK

To connect to Engram's MCP server from an external tool or agent:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // Configure stdio transport targeting installed binary
  const transport = new StdioClientTransport({
    command: "forge614-engram",
    args: ["mcp"],
    stderr: "ignore",
  });

  const client = new Client(
    { name: "ai-assistant-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. List available tools
  const tools = await client.listTools();
  console.log("Available MCP tools:", tools.tools.map(t => t.name));

  // 2. Resolve current project
  const currentProject = await client.callTool({
    name: "memory_current_project",
    arguments: { directory: process.cwd() },
  });
  console.log("Current project:", currentProject.content);

  // 3. Search relevant memories
  const searchResult = await client.callTool({
    name: "memory_search",
    arguments: {
      query: "stripe webhook",
      limit: 3,
    },
  });
  console.log("Search matches:", searchResult.content);

  await client.close();
}

main().catch(console.error);
```
