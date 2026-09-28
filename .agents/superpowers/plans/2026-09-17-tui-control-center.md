# TUI Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `forge614-engram tui` a safe, read-first control center for projects, shared memory, storage, capabilities, synchronization and the existing assistant configurator.

**Architecture:** Application code returns a secret-free `ControlCenterSnapshot` and owns every coordinated write. SQLite adds read-only project/shared summaries beside existing project operations. The terminal controller only holds keyboard state and delegates mutations; rendering stays pure and bounded. The existing assistant TUI runs as a sequential subflow, never as nested raw-mode input.

**Tech Stack:** TypeScript, Bun >=1.3.8, bun:sqlite, Node TTY/readline APIs, existing PostgreSQL replica and TUI infrastructure. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-tui-control-center-design.md`

## Global Constraints

- One global `~/.forge614/.env` and one `~/.forge614/engram.db`; opening TUI never creates either.
- Stable `projectId`, explicit `shared`, topic override/visibility/ownership/history/FTS5 contracts stay unchanged.
- No secrets, `.env` contents, PostgreSQL URL, assistant configuration content or memory content in TUI state/render/error messages.
- All writes go through `MemoryWorkspace`, `MemoryStore`, `syncWorkspace` or existing assistant configuration services; interfaces do not use SQL or filesystem writes directly.
- Create/rename/bind/capability/sync actions require a final confirmation. Before it, Escape, Ctrl+C, EOF and cancellation make no writes; an already-started confirmed operation is not promised to roll back.
- No new dependency, embedding, model, daemon, implicit migration, real-user config/database, assistant launch, commit, push, PR, merge or branch deletion.
- Existing assistant flow remains previewed/validated/confirmed; it is sequential rather than a nested terminal session.
- Every behavior-bearing implementation receives a sibling `*.test.ts`; integration/e2e suites stay local in `__tests__`; no test imports another test suite.
- Final docs/es, docs/en and Notion changes belong to another model; create a handoff prompt only.

## Task 1: Read-only dashboard data and project summaries

**Files:**
- Create: `src/modules/control-center/types.ts`, `src/modules/control-center/index.ts`.
- Create: `src/infrastructure/sqlite/control-center.ts`, `src/infrastructure/sqlite/control-center.test.ts`.
- Create: `src/app/control-center.ts`, `src/app/control-center.test.ts`.
- Modify: `src/app/index.ts`, `src/app/memory-store.ts`.

**Interfaces:**
- Produces `CapabilityState`, `ProjectSummary`, `SharedSummary`, `StorageSummary`, `ControlCenterSnapshot` from the module barrel.
- Produces `readControlCenter(db): { capabilities; projects; shared }` from SQLite and `readControlCenter(config?): ControlCenterSnapshot` from app.
- App read returns `{ initialized:false, databasePath:null, capabilities:null, postgres:"not-configured", projects:[], shared:null }` when config does not exist; it does not call `init`.
- Project summary contains only `projectId,name,createdAt,updatedAt,bindings` and `{active,archived,lastUpdatedAt}`. `shared` has the same counts with no directories.

- [x] **Step 1: Write failing SQLite-summary tests.**

```ts
test("control-center summaries isolate project and shared metadata without memory content", () => {
  const store = withDatabase();
  const alpha = store.createProject("Alpha");
  const beta = store.createProject("Beta");
  store.enableAssistantIntegration();
  store.bindProjectDirectory("/tmp/alpha", alpha.projectId);
  store.save({ projectId: alpha.projectId, title:"A", content:"private alpha", type:"fact" });
  store.save({ projectId: alpha.projectId, title:"Old", content:"archived", type:"fact" });
  store.archive(alpha.projectId, /* old ID */);
  store.save({ projectId: beta.projectId, title:"B", content:"private beta", type:"fact" });
  store.save({ scope:"shared", projectId:null, title:"S", content:"global", type:"fact" });

  const snapshot = store.controlCenter();
  expect(snapshot.projects.find(p => p.projectId === alpha.projectId)).toMatchObject({
    bindings:["/tmp/alpha"], memories:{active:1, archived:1},
  });
  expect(JSON.stringify(snapshot)).not.toContain("private alpha");
  expect(snapshot.shared).toMatchObject({ active:1, archived:0 });
});
```

- [x] **Step 2: Run the new test and confirm RED.**

Run: `bun test src/infrastructure/sqlite/control-center.test.ts`

Expected: failure because `MemoryStore.controlCenter` does not exist.

- [x] **Step 3: Implement types, SQLite aggregate query and app facade.**

```ts
export type ProjectSummary = Project & {
  bindings: string[];
  memories: { active:number; archived:number; lastUpdatedAt:string|null };
};

export function readControlCenter(db: Database): Omit<ControlCenterSnapshot,"storage"> {
  // Use LEFT JOIN aggregates over memories and a separate ordered bindings query.
  // Return no title/content/snapshot/URL fields. Read-only only.
}

export function readControlCenter(config = new WorkspaceConfig()): ControlCenterSnapshot {
  if (!config.exists()) return uninitializedSnapshot;
  const settings = config.read();
  const store = new MemoryWorkspace(config).open(true);
  try { return { storage: safeStorage(config, settings, store), ...store.controlCenter() }; }
  finally { store.close(); }
}
```

Use `PRAGMA user_version` as an exact supported schema value; expose booleans only
from existing `sessionsEnabled()` and `reinforcementEnabled()`. Assistant integration
is true for schema 5, 6 or 7; schema 3/4 are false. Add `MemoryStore.controlCenter` as
a direct delegator to the SQLite adapter; export the app facade through `app/index.ts`.

- [x] **Step 4: Run focused tests and typecheck.**

Run: `bun test src/infrastructure/sqlite/control-center.test.ts src/app/control-center.test.ts && bun run typecheck`

Expected: all pass. Verify a missing config does not appear on disk, a configured
missing DB rejects via existing safe error, snapshots contain no content or URL, and
all stores close after success/error.

## Task 2: Pure terminal state and bounded read-only rendering

**Files:**
- Create: `src/interfaces/tui/control-center-state.ts`, `src/interfaces/tui/control-center-state.test.ts`.
- Create: `src/interfaces/tui/control-center-render.ts`, `src/interfaces/tui/control-center-render.test.ts`.

**Interfaces:**
- Consumes `ControlCenterSnapshot` and emits `ControlCenterState` with page union
  `"menu"|"overview"|"projects"|"project-detail"|"shared"|"storage"|"actions"|"confirm"|"result"`.
- Produces synchronous `ControlCenterSession.key(name)` state transitions with no I/O or mutation.
- Render consumes state/width/height and returns terminal text only. Reuse current safe character policy; never copy raw external strings directly to ANSI output.

- [x] **Step 1: Write failing state-transition tests.**

```ts
test("navigation changes pages but does not execute a selected action", () => {
  const session = new ControlCenterSession(snapshotWithProject());
  session.key("down"); // Projects
  session.key("enter");
  expect(session.state.page).toBe("projects");
  session.key("escape");
  expect(session.state.page).toBe("menu");
  expect(session.state.intent).toBeNull();
});

test("an action reaches confirmation only after its input is valid", () => {
  const session = new ControlCenterSession(snapshotWithProject());
  session.openAction("enable-sessions");
  expect(session.state.page).toBe("confirm");
  expect(session.consumeConfirmation()).toEqual({ kind:"enable-sessions" });
});
```

- [x] **Step 2: Verify RED.**

Run: `bun test src/interfaces/tui/control-center-state.test.ts`

Expected: failure because no control-center session exists.

- [x] **Step 3: Implement state transitions and pure renderer.**

```ts
export type ControlCenterIntent =
  | {kind:"create-project"; name:string}
  | {kind:"rename-project"; projectId:string; name:string}
  | {kind:"bind-directory"; projectId:string; directory:string}
  | {kind:"enable-integration"|"enable-sessions"|"enable-reinforcement"}
  | {kind:"sync-now"}
  | {kind:"open-assistants"};

export class ControlCenterSession {
  // Holds selection/input/intent only. `consumeConfirmation` clears a confirmed
  // intent exactly once. Escape clears it. No app or filesystem import.
}
```

Menu order exactly: Summary, Projects, Shared, Storage, Actions, Assistants,
Exit. Actions page exposes only unavailable capabilities and `sync-now` only when
`storage.postgres === "configured"`; it never offers format promotion. Create/rename/
bind collect text in an input page, show a summary in confirmation and reject blank,
NUL or non-absolute directory input before emitting an intent. Project selection
always retains its UUID rather than resolving by display name.

Renderer must include the difference between `shared` and projects, show exact
schema/capability labels, preserve screen width/height bounds and show a footer with
keys. It must show messages only from app's safe `MemoryError` codes/messages and
replace control, ANSI, bidi and wide characters as the current renderer does.

- [x] **Step 4: Add render RED/GREEN coverage.**

```ts
test("render bounds output and never exposes a URL or memory content", () => {
  const text = renderControlCenterScreen(stateWith("postgresql://secret", "private body"), 18, 5);
  expect(text).not.toContain("secret");
  expect(text).not.toContain("private body");
  expect(text.split("\n").length).toBeLessThanOrEqual(5);
});
```

Run: `bun test src/interfaces/tui/control-center-state.test.ts src/interfaces/tui/control-center-render.test.ts`

Expected: all pass, including escape/cancel clearing input, small viewport, scroll,
malicious display/path strings and no state-side writes.

## Task 3: TTY orchestration, confirmed actions and assistant subflow

**Files:**
- Create: `src/interfaces/tui/control-center.ts`, `src/interfaces/tui/control-center.test.ts`.
- Create: `src/interfaces/tui/__tests__/control-center.integration.test.ts`.
- Modify: `src/interfaces/cli/commands.ts`, `src/interfaces/cli/help.ts`.
- Modify only if a reusable app operation is needed: `src/app/control-center.ts`, `src/app/control-center.test.ts`.

**Interfaces:**
- Produces `controlCenterTui(options?): Promise<{cancelled:boolean}>` with injectable config/input/output/assistant runner/sync runner for tests.
- `tui` CLI calls a high-level loop from this controller. A `open-assistants` intent ends the current raw-mode screen, awaits `assistantTui`, then creates a fresh read snapshot and reopens the center unless the user cancelled the whole command.
- Confirmed intents map one-for-one to `MemoryWorkspace.createProject`, `.renameProject`, `MemoryStore.bindProjectDirectory`, existing enable methods and `syncWorkspace`; each operation closes resources in `finally`.

- [x] **Step 1: Write failing orchestration tests.**

```ts
test("Ctrl+C before confirmation leaves config and database bytes absent", async () => {
  const { input, output, config } = interactiveFixture();
  const run = controlCenterTui({ config, input, output });
  input.write("\r"); // summary
  input.write("\x03");
  expect((await run).cancelled).toBe(true);
  expect(existsSync(config.root)).toBe(false);
});

test("confirmed enabling uses the app operation once and refreshes the dashboard", async () => {
  const fixture = initializedInteractiveFixture();
  const run = controlCenterTui(fixture.options);
  navigateToAndConfirm(fixture.input, "enable-sessions");
  await waitFor(() => outputText(fixture.output).includes("Sesiones: activadas"));
  fixture.input.write("\x03");
  expect(readSchema(fixture.config.databasePath)).toBe(6);
});
```

- [x] **Step 2: Verify RED.**

Run: `bun test src/interfaces/tui/control-center.test.ts`

Expected: failure because `controlCenterTui` does not exist.

- [x] **Step 3: Implement TTY lifecycle and intent executor.**

```ts
export async function controlCenterTui(options: ControlCenterTuiOptions = {}): Promise<{cancelled:boolean}> {
  // Reject non-TTY before opening config. Set raw mode, alternate screen and
  // listeners once. On confirmed intent await app executor, reload snapshot, and
  // render safe result. Restore all listeners/mode/screen in finally.
}
```

Use `emitKeypressEvents`, output resize handling and full cleanup equivalent to the
existing assistant TUI. Async operations must serialize: ignore a second Enter while
one action is pending. `sync-now` invokes the injected/default `syncWorkspace` only
after final confirmation; a `SYNC_UPGRADE_REQUIRED` result is displayed and does not
retry or change any schema. For assistant intent, finish/restore the current session
before invoking the injected/default assistant runner; then return to a newly loaded
control center. No raw mode nesting.

- [x] **Step 4: Add real integration/e2e behavior.**

Run: `bun test src/interfaces/tui/control-center.test.ts src/interfaces/tui/__tests__/control-center.integration.test.ts src/interfaces/cli/__tests__/cli.e2e.test.ts`

Cover non-TTY `INTERACTIVE_REQUIRED` without config writes; EOF/Ctrl+C/resize cleanup;
read-only detail view; confirmed create/rename/bind; cancel at each confirmation;
capability promotion/repeat; missing PostgreSQL hides sync; sync error preserves local
bytes; assistant runner is sequential and receives no secrets. Use temp `WorkspaceConfig`
roots and a fake injected sync runner, never user databases.

- [x] **Step 5: Update CLI text and verify layout policy.**

Change help from the assistant-only description to a plain-language control-center
description, retaining that assistants are configured with preview. Keep command name
and noninteractive behavior unchanged. Run:

`bun test src/interfaces/cli/commands.test.ts src/interfaces/cli/main.test.ts tests/architecture/test-layout.test.ts && bun run typecheck && git diff --check`

Expected: all pass and every new behavior file has a direct sibling test.

## Task 4: Full verification and documentation handoff

**Files:**
- Create: `docs/handoffs/12-tui-control-center.md`.
- Modify only tests required by a verified integration failure found here, with a red test first.

**Interfaces:** consumes the completed control center and produces a documentation prompt only.

- [x] **Step 1: Run the full verification with disposable PostgreSQL.**

Run:

```sh
FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test
bun run typecheck
git diff --check
```

Record exact outcome, including skips if the temporary binary path no longer exists.
Do not use `DATABASE_URL` or a user service.

- [x] **Step 2: Write documentation handoff prompt.**

The prompt must require Spanish and English docs/Notion to describe: the new main
TUI menu; read-only default; how each project/shared/storage view is scoped; exact
confirmation/cancel behavior; project UUID rather than name; assistant subflow;
capability/sync boundaries and non-promotion; no secret/content display; TTY
requirements; architecture (modular monolith and colocated tests); exact commands,
observed evidence and known limits. State that no data are automatically created,
synced or deleted. Do not claim a graphical UI, remote health check, background
service or direct configuration of assistants without preview.

- [x] **Step 3: Report uncommitted handoff.**

No commit/push/PR/merge/Notion update. State branch name, tests and the handoff path.
