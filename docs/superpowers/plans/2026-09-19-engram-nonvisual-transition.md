# Forge614 Engram Nonvisual Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Engram a nonvisual memory engine that Forge614 Shell and, later, Forge614 AI can initialize safely without breaking its CLI, MCP server, SQLite/FTS5, SDK, project identity or existing users.

**Architecture:** Extract storage setup from the terminal conversation into a typed application contract with three actions: inspect status, preview changes and apply an approved request. Keep the current setup and TUI temporarily. Remove visual and assistant ownership only after Engines, Shell and Forge614 AI deliver the replacement contracts.

**Tech Stack:** TypeScript strict, Bun, SQLite/FTS5, `WorkspaceConfig`, `MemoryWorkspace`, Bun test.

**Spec:** `FORGE614_ECOSYSTEM_CONTRACT.md`

## Global Constraints

- Engram owns only `~/.forge614/engram/`.
- Local SQLite and FTS5 are always local. PostgreSQL remains optional synchronization, never a replacement.
- Initialization never creates or selects a project.
- Status, preview, logs and errors never expose PostgreSQL URLs or credentials.
- Every configuration write uses `WorkspaceConfig.revision()` and `WorkspaceConfig.configurePostgres()`.
- No TUI, assistant detection or assistant configuration removal may start before Task 5 gates are fulfilled.
- Documentation is updated by the separate documentation workflow after accepted code changes.

## Review Focus

- Missing storage inspection must not create a directory, database or `.env` (Task 1).
- Existing projects and memories must survive every initialization request (Task 2).
- Credentials must never appear in status, preview or errors (Tasks 1 and 2).
- A changed config between preview and apply must return `CONFIG_CHANGED` without replacement (Task 2).
- Legacy commands stay functional until their replacement exists (Task 4).

---

## Planned File Structure

| File | Purpose |
|---|---|
| `src/app/initialization.ts` | New nonvisual status, preview and apply workflow. |
| `src/app/initialization.test.ts` | Colocated contract tests. |
| `src/app/setup.ts` | Temporary human-text adapter; delegates storage mutation to the workflow. |
| `src/app/setup.test.ts` | Legacy setup regression tests. |
| `src/app/index.ts` | Application exports. |
| `src/index.ts` | Public SDK exports for Shell, Atlas and future Forge614 AI. |
| `src/interfaces/terminal/setup.ts` | Storage-only legacy terminal adapter. |
| `src/interfaces/terminal/setup.test.ts` | Terminal compatibility tests. |
| `src/interfaces/cli/help.ts` | Accurate transitional command help. |
| `src/interfaces/tui/**` | Retained unchanged until Task 5 gates are satisfied. |

## Contract Produced by Task 1

Create `src/app/initialization.ts` with these exports:

```ts
export interface MemoryInitializationStatus {
  readonly initialized: boolean;
  readonly storage: "sqlite";
  readonly postgresConfigured: boolean;
  readonly reinforcementEnabled: boolean;
}

export interface MemoryInitializationRequest {
  readonly postgresUrl: string | null;
  readonly enableReinforcement: boolean;
}

export interface MemoryInitializationPreview {
  readonly status: MemoryInitializationStatus;
  readonly expectedRevision: string | null;
  readonly initializesStorage: boolean;
  readonly configuresPostgres: boolean;
  readonly enablesReinforcement: boolean;
}

export interface MemoryInitializationResult {
  readonly status: MemoryInitializationStatus;
  readonly initializedStorage: boolean;
  readonly configuredPostgres: boolean;
  readonly enabledReinforcement: boolean;
}

export function inspectMemoryInitialization(
  config?: WorkspaceConfig,
): MemoryInitializationStatus;

export function previewMemoryInitialization(
  request: MemoryInitializationRequest,
  config?: WorkspaceConfig,
): Promise<MemoryInitializationPreview>;

export function applyMemoryInitialization(
  request: MemoryInitializationRequest,
  expectedRevision: string | null,
  config?: WorkspaceConfig,
): Promise<MemoryInitializationResult>;
```

`postgresConfigured` is deliberately a boolean. A PostgreSQL URL is input only and must never be returned.

## Task 1: Add Read-Only Status and Preview

**Files:**
- Create: `src/app/initialization.ts`
- Create: `src/app/initialization.test.ts`
- Modify: `src/app/index.ts`
- Modify: `src/index.ts`

**Consumes:** `WorkspaceConfig.exists/read/revision`, `MemoryWorkspace.open(true)`, `MemoryStore.reinforcementEnabled` and `postgresOptions`.

**Produces:** Status and preview functions plus their types. `applyMemoryInitialization()` and `MemoryInitializationResult` are added to the public barrels in Task 2.

- [ ] **Step 1: Write failing tests**

```ts
test("inspection of an absent workspace is read-only", () => {
  const { config } = fixture();
  expect(inspectMemoryInitialization(config)).toEqual({
    initialized: false,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: false,
  });
  expect(existsSync(config.root)).toBe(false);
});

test("preview does not reveal a PostgreSQL URL or create storage", async () => {
  const { config } = fixture();
  const preview = await previewMemoryInitialization({
    postgresUrl: "postgresql://user:SECRET_MARKER@127.0.0.1/db?sslmode=disable",
    enableReinforcement: true,
  }, config);
  expect(preview.initializesStorage).toBe(true);
  expect(JSON.stringify(preview)).not.toContain("SECRET_MARKER");
  expect(existsSync(config.root)).toBe(false);
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
bun test src/app/initialization.test.ts
```

Expected: failure because the module and exports do not exist.

- [ ] **Step 3: Implement inspection and preview**

Implement these rules exactly:

```text
Absent workspace → initialized=false; never call prepare(), init() or configurePostgres().
Existing workspace → open readonly, read reinforcement state, always close in finally.
Preview → validate a non-null URL with postgresOptions(), capture revision(), return booleans only.
Preview → never call workspace.init(), configurePostgres() or mutate the store.
```

- [ ] **Step 4: Export the read-only contract**

Export `MemoryInitializationStatus`, `MemoryInitializationRequest`, `MemoryInitializationPreview`, `inspectMemoryInitialization()` and `previewMemoryInitialization()` from `src/app/index.ts` and `src/index.ts`. Do not export `applyMemoryInitialization()` until it exists in Task 2. The root SDK must permit:

```ts
import {
  inspectMemoryInitialization,
  previewMemoryInitialization,
} from "forge614-engram";
```

- [ ] **Step 5: Verify and commit**

```bash
bun test src/app/initialization.test.ts
bun run typecheck
git add src/app/initialization.ts src/app/initialization.test.ts src/app/index.ts src/index.ts
git commit -m "feat: expose nonvisual memory initialization preview"
```

Expected: tests and type check pass before commit.

## Task 2: Apply an Approved Request Safely

**Files:**
- Modify: `src/app/initialization.ts`
- Modify: `src/app/initialization.test.ts`

**Consumes:** Task 1 contract, `MemoryWorkspace.init`, `WorkspaceConfig.configurePostgres`, `PostgresReplica.connect` and `MemoryStore.enableSearchReinforcement`.

**Produces:** `applyMemoryInitialization()` and `MemoryInitializationResult`.

- [ ] **Step 1: Write failing tests**

```ts
test("apply initializes SQLite without creating a project", async () => {
  const { config, workspace } = fixture();
  const request = { postgresUrl: null, enableReinforcement: false };
  const preview = await previewMemoryInitialization(request, config);
  const result = await applyMemoryInitialization(request, preview.expectedRevision, config);
  expect(result.initializedStorage).toBe(true);
  expect(workspace.listProjects()).toEqual([]);
});

test("apply rejects an outdated preview", async () => {
  const { config, workspace } = fixture();
  workspace.init();
  const request = { postgresUrl: null, enableReinforcement: false };
  const preview = await previewMemoryInitialization(request, config);
  config.configurePostgres(
    "postgresql://user:password@127.0.0.1/db?sslmode=disable",
    config.revision(),
  );
  await expect(applyMemoryInitialization(request, preview.expectedRevision, config))
    .rejects.toMatchObject({ code: "CONFIG_CHANGED" });
});

test("reinforcement is never downgraded", async () => {
  const { config } = fixture();
  const on = { postgresUrl: null, enableReinforcement: true };
  let preview = await previewMemoryInitialization(on, config);
  await applyMemoryInitialization(on, preview.expectedRevision, config);
  const off = { postgresUrl: null, enableReinforcement: false };
  preview = await previewMemoryInitialization(off, config);
  const result = await applyMemoryInitialization(off, preview.expectedRevision, config);
  expect(result.status.reinforcementEnabled).toBe(true);
});
```

- [ ] **Step 2: Verify the test fails**

```bash
bun test src/app/initialization.test.ts
```

Expected: failure because `applyMemoryInitialization()` is absent.

- [ ] **Step 3: Implement application in this exact order**

```text
1. Compare config.revision() with expectedRevision; mismatch throws CONFIG_CHANGED.
2. Validate and make a temporary checked connection to a requested PostgreSQL URL before local mutation.
3. Call workspace.init() to create or revalidate SQLite safely.
4. Enable reinforcement only when requested and currently disabled; always close the store.
5. Call config.configurePostgres(request.postgresUrl, expectedRevision).
6. Reinspect and return booleans only.
```

A request with `enableReinforcement: false` never disables existing reinforcement. No operation deletes data or downgrades schema.

- [ ] **Step 4: Verify and commit**

Before verification, export `MemoryInitializationResult` and `applyMemoryInitialization()` from `src/app/index.ts` and `src/index.ts`.

```bash
bun test src/app/initialization.test.ts src/infrastructure/filesystem/workspace-config.test.ts
bun run typecheck
git add src/app/initialization.ts src/app/initialization.test.ts
git commit -m "feat: apply approved memory initialization requests"
```

Expected: tests and type check pass before commit.

## Task 3: Make Legacy `setup` Storage-Only

**Files:**
- Modify: `src/app/setup.ts`
- Modify: `src/app/setup.test.ts`
- Modify: `src/interfaces/terminal/setup.ts`
- Modify: `src/interfaces/terminal/setup.test.ts`

**Consumes:** Task 1 and Task 2 application contract.

**Produces:** Legacy `forge614-engram setup` that asks memory questions only and never opens assistant selection.

- [ ] **Step 1: Write the failing delegation test**

```ts
test("legacy setup produces the nonvisual initialization state", async () => {
  const { config } = fixture();
  const result = await runSetup(conversation(["no", "si", "si"]).io, config);
  expect(result).toEqual({ cancelled: false, storage: "sqlite" });
  expect(inspectMemoryInitialization(config)).toMatchObject({
    initialized: true,
    postgresConfigured: false,
    reinforcementEnabled: true,
  });
});
```

- [ ] **Step 2: Verify the test fails**

```bash
bun test src/app/setup.test.ts
```

Expected: failure until legacy setup delegates its mutation boundary.

- [ ] **Step 3: Refactor the mutation boundary**

Keep all existing Spanish questions, secret masking, cancellation behavior and confirmation order. Replace direct storage mutation with:

```ts
const request = { postgresUrl, enableReinforcement };
const preview = await previewMemoryInitialization(request, config);
await applyMemoryInitialization(request, preview.expectedRevision, config);
```

- [ ] **Step 4: Remove terminal assistant selection**

`setupTerminal()` invokes only the storage conversation. Remove `completeSetup()` and the `assistantTui` import. Replace the escape-after-storage test with:

```ts
expect(result.exitCode).toBe(0);
expect(existsSync(config.databasePath)).toBe(true);
expect(result.stdout.toString()).not.toContain("Forge614 Engram | Asistentes");
```

- [ ] **Step 5: Verify and commit**

```bash
bun test src/app/setup.test.ts src/interfaces/terminal/setup.test.ts src/interfaces/cli/commands.test.ts
bun run typecheck
git diff --check
git add src/app/setup.ts src/app/setup.test.ts src/interfaces/terminal/setup.ts src/interfaces/terminal/setup.test.ts
git commit -m "refactor: keep legacy setup focused on memory storage"
```

Expected: all checks pass before commit.

## Task 4: Publish the Transitional Boundary

**Files:**
- Modify: `src/index.test.ts`
- Modify: `src/interfaces/cli/help.ts`
- Modify: documentation through the dedicated documentation workflow

**Consumes:** Public API from Tasks 1-3.

**Produces:** Verified root SDK exports and accurate compatibility help.

- [ ] **Step 1: Write the root SDK export test**

```ts
expect(typeof sdk.inspectMemoryInitialization).toBe("function");
expect(typeof sdk.previewMemoryInitialization).toBe("function");
expect(typeof sdk.applyMemoryInitialization).toBe("function");
```

- [ ] **Step 2: Update help accurately**

Describe `setup` as a temporary storage-only compatibility command. Keep `tui` documented as legacy until Task 5. Do not advertise `forge614 init`: it belongs to `forge614-ai`, which is not released yet.

- [ ] **Step 3: Verify and commit**

```bash
bun test src/index.test.ts src/interfaces/cli/commands.test.ts
bun run typecheck
git add src/index.test.ts src/interfaces/cli/help.ts
git commit -m "docs: describe nonvisual initialization compatibility"
```

Expected: tests and type check pass before commit.

## Task 5: Explicit Gates Before TUI Removal

Do not start removal until all of these independently exist and pass:

| Provider | Required capability |
|---|---|
| `forge614-engines` | Public detection, read-only preview, confirmed apply/removal and compatible release artifact |
| `forge614-shell` | Visual flow that consumes Engines and Engram's nonvisual contract, shows preview and requires confirmation |
| `forge614-ai` | Published ownership and lifecycle contract for future `forge614 init` |
| Cross-product verification | Clean-machine test: Shell initializes Engram and configures a selected assistant without Engram TUI |

After the gates pass, write a separate removal plan. It must remove `src/interfaces/tui/**`, `tui`, `assistant-list`, `memory-hook` and Engram-owned assistant configuration only after the Engines/Shell replacements are live. It must preserve MCP, data CLI commands, public SDK, installer integrity, Atlas SDK support and safe uninstallation.

## Final Verification for Every Merged Task

```bash
bun test
bun run typecheck
git diff --check
```

The documentation handoff must state changed behavior, changed files, compatibility behavior and test evidence.
