# Progressive Memory and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver preview search, session timeline, full versioned reads and recent context, with safe session persistence and PostgreSQL replication.

**Architecture:** SQLite remains authoritative for local operations. Add explicit schema 6 enrollment, transactional session associations and snapshot format 2 before exposing the new MCP operations. Reuse existing ownership, topic overrides, FTS5 ordering and request hashes; do not build a second memory engine.

**Tech Stack:** TypeScript, Bun >=1.3.8, bun:sqlite, existing PostgreSQL and MCP SDK dependencies; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-ranked-memory-context-design.md` (approved corrected design).

**Execution status (2026-09-17):** Tasks 1–5 implemented and independently reviewed;
final review findings addressed. Final controller verification: 250 passed,
0 failed/skipped, 1506 assertions with real disposable PostgreSQL 17.6; typecheck
and diff check passed. No commit or push. Delivery and documentation prompt:
`docs/handoffs/09-progressive-memory-sessions.md`.

## Global Constraints

- Work from `feat/ranked-memory-context`, base main `193e89a`; preserve unrelated changes.
- No commit, staging, push, personal database access or assistant configuration changes. User owns integration.
- One `~/.forge614/.env` and `engram.db`; projectId and explicit shared remain unchanged.
- No transcript capture, additional model, semantic search, cloud server or new ranking formula.
- Runtime session IDs: opaque text, 1–200 characters, no control characters, NUL or surrounding whitespace.
- Automatic candidates: same project and canonical worktree, open runtime kind, activity within seven days; never choose the newest among multiple candidates.
- Preview limits: search/context 300 Unicode code points; timeline focus 500 and neighbors 150.
- Timeline before/after: default 5, integer range 0–20.
- Context: pinned <=20, recent <=20, summaries <=5; maxBytes default 16384, integer range 1024–65536.
- Snapshot maximum 8 MiB; PostgreSQL state.format remains 1, payload.format may become 2.
- Explicit `sessions-enable` and first-promotion `sync --upgrade-format`; reads/server startup never migrate.
- SDK/CLI full search remains compatible. MCP search explicitly adopts previews, not silently truncated full records.
- All tests use temporary stores and existing isolated-user fixture; no real credentials. Report skipped PostgreSQL tests honestly.
- Another model owns docs/es, docs/en and Notion. Deliver a documentation prompt, not edits to those surfaces.

## File responsibilities and execution order

| Files | Responsibility |
| --- | --- |
| `src/session-types.ts` (new) | Session, association, summary and save-policy contracts |
| `src/sessions.ts` (new) | SQL lifecycle, candidate resolution and association operations on an injected Database |
| `src/schema.ts` | Exact schema validation and additive version 6 enrollment |
| `src/store.ts` | Public facade and single transaction boundary for memory/session writes |
| `src/project-context.ts` | Preserve Git common identity; separately resolve worktree runtime root |
| `src/sync-snapshot.ts`, `src/sync-local.ts` | Format union, validation, merge, import/export |
| `src/synchronize.ts`, `src/sync-runner.ts`, `src/sync-postgres.ts` | Capability preflight, explicit promotion and original-hash CAS |
| `src/retrieval-types.ts`, `src/retrieval.ts` (new) | Preview projection, timeline, version reads, bounded context |
| `src/mcp-tools.ts` (new), `src/mcp.ts`, `src/assistant-self-test.ts` | Ten-tool catalog and real registration/self-test |
| `src/cli.ts`, `src/index.ts`, `src/memory-protocol.ts` | Public surfaces and progressive retrieval instructions |
| `tests/sessions.test.ts`, `tests/retrieval.test.ts` (new) | Focused lifecycle and read contracts |
| Existing sync/project/MCP/CLI/hook/install tests | Compatibility and end-to-end regression |

Execute tasks sequentially: each depends on the preceding contracts. Keep SQL helpers private to modules; do not expose Database through the public SDK. A helper taking Database participates in the caller's transaction and must not independently commit it.

## Task 1: Schema and session lifecycle

**Files:** Create `src/session-types.ts`, `src/sessions.ts`, `tests/sessions.test.ts`; modify `src/schema.ts`, `src/store.ts`, `src/project-context.ts`, `src/index.ts`, `tests/project-context.test.ts`.

**Consumes:** Existing `MemoryStore.createProject(name): Project`, exact schema validator and project directory resolution.

**Produces:** Export these types and facade methods (Session IDs are not project UUIDs):

```ts
export interface Session {
  sessionId: string; projectId: string; kind: "runtime" | "manual";
  startedAt: string; endedAt: string | null;
}
export interface SessionEntry {
  sessionId: string; memoryId: string; version: number; recordedAt: string;
}
export interface SessionSummary {
  sessionId: string; memoryId: string; version: number;
}
// MemoryStore methods:
// enableSessions(): void
// startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session
// endSession(projectId: string, sessionId: string): Session
// getSession(projectId: string, sessionId: string): Session | null
// sessionsEnabled(): boolean
```

Add `startProjectSession(store: MemoryStore, directory: string, sessionId: string): Session` in project-context. Its store-level counterpart is `startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string, bindingAvailable?: (directory: string) => boolean): Session`. It wraps project creation/binding and start in one immediate transaction. Runtime resolution uses bounded `git rev-parse --show-toplevel`, separately from common Git identity; retain current no-Git and ambiguous-relocation safety.

- [x] Add this failing lifecycle test, with explicit cleanup:

```ts
import { expect, test } from "bun:test";
import { MemoryStore } from "../src/index";

test("session enrollment is explicit and closing is idempotent", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Demo");
    expect(() => store.startSession(projectId, "conversation-1")).toThrow();
    store.enableSessions();
    store.enableSessions();
    const started = store.startSession(projectId, "conversation-1");
    expect(store.startSession(projectId, "conversation-1")).toEqual(started);
    const ended = store.endSession(projectId, "conversation-1");
    expect(ended.endedAt).not.toBeNull();
    expect(store.endSession(projectId, "conversation-1")).toEqual(ended);
    expect(() => store.startSession(projectId, "conversation-1")).toThrow();
  } finally { store.close(); }
});
```

- [x] Run `bun test tests/sessions.test.ts`; confirm missing lifecycle methods, not fixture failure.
- [x] Extend expected schema definitions to 6 and add the following DDL after validated intermediate schemas inside an immediate transaction. Set user_version only at the end:

```sql
CREATE TABLE sessions (
  sessionId TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  kind TEXT NOT NULL CHECK(kind IN ('runtime','manual')),
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  CHECK(kind != 'manual' OR endedAt IS NULL)
);
CREATE INDEX sessions_project_started ON sessions(projectId,startedAt,sessionId);
CREATE TABLE session_entries (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  recordedAt TEXT NOT NULL,
  PRIMARY KEY(memoryId,version),
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX session_entries_timeline ON session_entries(sessionId,recordedAt,memoryId,version);
CREATE TABLE session_summaries (
  sessionId TEXT PRIMARY KEY NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE TABLE local_session_bindings (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  directory TEXT NOT NULL,
  PRIMARY KEY(sessionId,directory)
);
CREATE INDEX local_session_directory ON local_session_bindings(directory,sessionId);
CREATE TABLE local_manual_sessions (
  projectId TEXT PRIMARY KEY NOT NULL REFERENCES projects(projectId),
  sessionId TEXT UNIQUE NOT NULL REFERENCES sessions(sessionId)
);
```

The composite local binding allows an explicitly identified open session to be started again from a moved path without deleting prior local bindings. Resolve candidates with DISTINCT sessionId. Imported sessions have no bindings. Do not infer a binding on read/import. Validate canonical paths at the project-context boundary; SDK start without directory is explicit-only.

- [x] Implement lifecycle validation and no-op replay. Use `Array.from(id).length`, `id.trim() === id` and `/[\p{Cc}\p{Cf}]/u` to reject invalid IDs. Start rejects another owner/closed session; end rejects manual kind and preserves first endedAt. Return no foreign-session details.
- [x] Add migration fixtures for versions 3, 4, 5 with saved/history/request rows; compare snapshots before/after excluding only the new empty collections. Test malformed/future/foreign databases unchanged, failed migration rollback, reopening 6, old reads not enrolling and enableSync/enableAssistantIntegration accepting 6.
- [x] Add Git worktree tests: common project identity, distinct runtime roots, subdirectory equivalence, non-Git explicit root, unavailable Git and ambiguous relocation fail closed. Inject a failed start to prove no partial project/binding remains.
- [x] Run `bun test tests/sessions.test.ts tests/project-context.test.ts tests/store.test.ts tests/projects.test.ts` and `bun run typecheck`. Gate: validated additive schema and independent lifecycle work with no memory associations fabricated.

## Task 2: Atomic save associations, inference and summaries

**Files:** Modify `src/session-types.ts`, `src/sessions.ts`, `src/store.ts`, `src/project-context.ts`, `src/index.ts`, `tests/sessions.test.ts`.

**Consumes:** Task 1 lifecycle and existing SaveInput/MemoryVersion/request hashing.

**Produces:** Keep `save(input: SaveInput): MemoryVersion` unchanged externally; introduce:

```ts
import type { SaveInput, MemoryVersion } from "./domain";
export interface SessionSaveOptions {
  sessionId?: string;
  projectId?: string; // required for explicit shared-session ownership
  mode?: "independent" | "assistant"; // default independent
  runtimeDirectory?: string;
}
export interface SessionSaveResult {
  memory: MemoryVersion;
  sessionId: string | null;
  sessionSource: "explicit" | "inferred" | "manual" | null;
}
export interface SummaryFields {
  goal: string; instructions: string; discoveries: string;
  accomplishments: string; nextSteps: string; files: string[];
}
// saveWithSession(input: SaveInput, options?: SessionSaveOptions): SessionSaveResult
// saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields,
//   request: {requestKey: string; expectedVersion?: number}): SessionSaveResult
```

Add `saveProjectMemoryWithSession(store, directory, input, options): SessionSaveResult`, with typed parameters `MemoryStore`, `string`, `Omit<SaveInput,"projectId"|"scope">`, `SessionSaveOptions`. Its store counterpart `saveWithSessionForProjectDirectory(directory, name, runtimeDirectory, input, options, bindingAvailable?)` uses the same parameter types as Task 1 plus the input/options above. Resolve project and save inside one transaction, not two committed calls.

- [x] Add a failing replay test to the existing sessions test imports:

```ts
test("an omitted-ID replay is not reattached after candidates change", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions();
    const { projectId } = store.createProject("Replay");
    const input = { projectId, title: "Choice", content: "SQLite",
      type: "decision" as const, requestKey: "once" };
    const first = store.saveWithSession(input);
    store.startSession(projectId, "chat-a", "/tmp/replay-project");
    store.startSession(projectId, "chat-b", "/tmp/replay-project");
    const replay = store.saveWithSession(input, {
      mode: "assistant", runtimeDirectory: "/tmp/replay-project",
    });
    expect(replay.memory).toEqual(first.memory);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(() => store.saveWithSession({ ...input, requestKey: "new" }, {
      mode: "assistant", runtimeDirectory: "/tmp/replay-project",
    })).toThrow("AMBIGUOUS_SESSION");
  } finally { store.close(); }
});
```

- [x] Run `bun test tests/sessions.test.ts`; confirm the new API test fails.
- [x] Factor the existing save body into a private transactional core accepting SessionSaveOptions. Preserve the exact old hash array `[scope,projectId,title,content,type,topic,pinned,expected]`. `save` returns only `.memory`; `saveWithSession` returns the envelope. The ordered write algorithm is:

```text
validate input and compute unchanged request hash
BEGIN IMMEDIATE
  verify project ownership
  if matching request exists:
    reject mismatched payload or explicit different/missing origin association
    return original version + permitted original association, with no writes
  require schema 6 if sessionId is explicit
  resolve explicit / assistant candidates / independent manual policy
  verify selected session is open, correct owner and permitted kind
  perform existing version/topic save, event and request inserts
  insert session_entries only for a newly saved version with selected session
  return result
COMMIT
```

For old schema without an explicit session, retain existing save behavior. For schema 6 project saves, independent mode always uses the local manual registry. Shared without session is unassociated; explicit shared requires options.projectId validated against the session. Never expose shared origin in a generic shared read or another project's replay response. For replay reporting, explicit selection reports explicit; omitted selection reports manual for a manual origin, inferred for runtime, null for historical absence. It describes resolution of this call, not a rewritten audit history.

- [x] Implement automatic candidates with a single request clock and DISTINCT local binding match:

```sql
SELECT s.sessionId FROM sessions s
WHERE s.projectId=? AND s.kind='runtime' AND s.endedAt IS NULL
AND EXISTS (SELECT 1 FROM local_session_bindings b
            WHERE b.sessionId=s.sessionId AND b.directory=?)
AND max(s.startedAt,coalesce((SELECT max(e.recordedAt)
    FROM session_entries e WHERE e.sessionId=s.sessionId),s.startedAt)) >= ?
ORDER BY s.sessionId;
```

Threshold is requestNow minus 7*24*60*60*1000 milliseconds as canonical ISO UTC. Future activity remains eligible (clock skew does not justify closing a session). Zero creates/uses a random UUID manual session in the same immediate transaction; one selects it; multiple raise AMBIGUOUS_SESSION; SQL errors propagate without manual fallback. No directory means zero inferred candidates, not all project sessions.

- [x] Implement summary rendering as six labeled sections in fixed order, files as separate lines. Store type procedure, owner project, topic `session/${sessionId}/summary`, title `Session summary: ${sessionId}`. Require nonblank goal and requestKey, string remaining fields, string-array files. Use existing body validation/size constraints. Write memory, entry and summary pointer atomically. Reject an existing reserved-topic memory unless it is already the valid pointer for that session; reject new general saves to an existing session's summary topic. Preserve existing unrelated historical data rather than adopting it. Exact summary replay precedes closed-state rejection; new summaries require an open runtime session.
- [x] Add zero/one/many candidate cases, seven-day boundary ±1ms with fake clock restoration, future timestamps, imported unbound sessions, separate worktrees, explicit old session, explicit wrong owner, explicit absent ID and SQL error rollback. Add two-connection manual registry race, closed exact replay, explicit association conflict, legacy unassociated replay, update from another session preserving original version association and summary rollback/stale expectedVersion tests.
- [x] Run `bun test tests/sessions.test.ts tests/store.test.ts tests/shared.test.ts tests/project-context.test.ts` and `bun run typecheck`. Gate: every failed save leaves memory/history/events/requests/session tables unchanged.

## Task 3: Versioned synchronization and explicit promotion

**Files:** Modify `src/sync-snapshot.ts`, `src/sync-local.ts`, `src/synchronize.ts`, `src/sync-runner.ts`, `src/sync-postgres.ts`, `tests/sync.test.ts`, `tests/postgres-sync.test.ts`.

**Consumes:** Session, SessionEntry, SessionSummary from Task 1; existing MemoryBundle and CAS replica.

**Produces:** Existing APIs accept a discriminated snapshot union. Add optional `{upgradeFormat?: boolean}` to synchronize as its third argument and syncWorkspace as its second argument after the existing config. Watch never supplies true. Keep the existing synchronize result shape.

```ts
export interface SyncSnapshotV1 {
  format: 1; projects: Project[]; memories: MemoryBundle[];
}
export interface SyncSnapshotV2 {
  format: 2; projects: Project[]; memories: MemoryBundle[];
  sessions: Session[]; sessionEntries: SessionEntry[];
  sessionSummaries: SessionSummary[];
}
export type SyncSnapshot = SyncSnapshotV1 | SyncSnapshotV2;
export function normalizeSnapshot(value: SyncSnapshot): SyncSnapshotV2 {
  return value.format === 2 ? value : {
    ...value, format: 2, sessions: [], sessionEntries: [], sessionSummaries: [],
  };
}
```

Import Project from domain and session types from session-types. Keep emptySnapshot returning the existing format 1. Do not normalize inside snapshotHash or replica.read.

- [x] Add a red format test using existing sync test imports plus normalizeSnapshot:

```ts
test("format normalization never changes the original CAS payload", () => {
  const old = emptySnapshot();
  const originalHash = snapshotHash(old);
  const current = normalizeSnapshot(old);
  expect(current.format).toBe(2);
  expect(current.sessions).toEqual([]);
  expect(snapshotHash(old)).toBe(originalHash);
  expect(snapshotHash(current)).not.toBe(originalHash);
  expect(() => assertExtension(current, old)).toThrow();
});
```

- [x] Run `bun test tests/sync.test.ts`; confirm the missing format contract fails.
- [x] Validate exact keys for each format, opaque IDs, unique rows, canonical dates and all foreign references. Entry owner must match session owner unless memory is shared; entry timestamp and immutable origin must agree with the saved version. Summary must point to an entry in the same runtime session and project procedure with exact reserved topic. Reject local paths/registry keys in either payload. Preserve 8 MiB validation before parsing/application/publication.
- [x] Merge existing projects/memory bundles using current rules; merge sessions by immutable sessionId/projectId/kind/startedAt and monotonic endedAt. Independent sessions union; same session different close timestamps conflict. Merge entries by memoryId/version, reject differing origin/time. Merge summary pointers with three-way rules and verify referenced history. Reject removal of existing sessions/entries and format downgrade in assertExtension. Emit format 1 only when all three inputs are format 1.
- [x] Export format 2 only from schema 6; import project/memory history first, then sessions/entries/summary pointers in the existing transaction. Preserve every local binding/registry and never adopt imported manual sessions as this device's registry. Check capability before apply and keep old checkpoint payloads byte-semantically intact until successful advancement.
- [x] Add preflight before remote.publish:

```ts
if (merged.format === 2 && !store.sessionsEnabled()) {
  syncError("SESSIONS_REQUIRED");
}
if (remote.snapshot.format === 1 && merged.format === 2 && !options.upgradeFormat) {
  syncError("SYNC_UPGRADE_REQUIRED");
}
validateSnapshot(merged);
// Publish with remote.hash from read(), never snapshotHash(normalizeSnapshot(...)).
```

Here `options` is the optional third synchronize argument defaulting to `{}`; import syncError/validateSnapshot from sync-snapshot. Retain remote lock and expected-head comparison; do not change remote state.format constraint or historical revisions. A failed CAS returns the existing concurrent-change error, with no local import.
- [x] Test 1+1 unchanged, 1→2 requires opt-in, 2→2 normal, local pre-6 rejects remote 2 before publish, old checkpoints, invalid references, conflicting origins, divergent closes, local bindings preserved, 8 MiB refusal and interrupted/offline retry. Copy the prior format-1 validator into a test-only compatibility fixture with base commit attribution to prove old clients reject 2 rather than dropping fields.
- [x] Run `bun test tests/sync.test.ts tests/postgres-sync.test.ts` and `bun run typecheck`. Run PostgreSQL integration against a disposable instance using the existing test fixture protocol; include simultaneous promotion CAS, unchanged state.format=1 and untouched historical hashes. Gate: explicitly distinguish actual PostgreSQL execution from skipped tests; never use user's configured URL.

## Task 4: Progressive read APIs

**Files:** Create `src/retrieval-types.ts`, `src/retrieval.ts`, `tests/retrieval.test.ts`; modify `src/store.ts`, `src/index.ts`.

**Consumes:** Existing scoped search predicate/order and Task 1–2 session tables.

**Produces:** Export the following types and MemoryStore methods. New module receives Database internally; public facade enforces ownership.

```ts
import type { Memory, MemoryVersion, SearchResult } from "./domain";
export type MemoryPreview = Omit<MemoryVersion,"content"> & {
  preview: string; truncated: boolean;
};
export interface PreviewResult {
  memory: MemoryPreview; explanation: SearchResult["explanation"];
}
export interface VersionRead {
  memory: MemoryVersion; currentVersion: number; state: Memory["state"];
}
export interface TimelineInput {
  sessionId: string; memoryId: string; version: number; before?: number; after?: number;
}
export interface TimelineRow { memory: MemoryPreview; recordedAt: string }
export interface TimelineResult {
  sessionId: string; focus: TimelineRow; before: TimelineRow[]; after: TimelineRow[];
}
export interface ContextInput { compact?: boolean; maxBytes?: number }
export type ContextRow = Omit<MemoryPreview,"preview"> & {preview?: string};
export interface ContextResult {
  format: 1; pinned: ContextRow[]; recent: ContextRow[]; summaries: ContextRow[];
  omitted: {pinned: number; recent: number; summaries: number}; truncated: boolean;
}
// searchPreviews(projectId: string|null, query: string, limit?: number,
//   scope?: SearchScope): PreviewResult[]
// getVersion(projectId: string|null, id: string, version?: number): VersionRead|null
// timeline(projectId: string, input: TimelineInput): TimelineResult
// context(projectId: string|null, input?: ContextInput): ContextResult
```

SearchScope comes from domain. Context(null) is shared-only with no private summaries. Pre-6 context can return memory sections with an empty summaries section; timeline requires sessions enabled.

- [x] Add a red Unicode/full-read test:

```ts
import { expect, test } from "bun:test";
import { MemoryStore } from "../src/index";
test("preview is code-point bounded and full read remains exact", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Unicode");
    const content = "😀".repeat(301);
    const saved = store.save({ projectId, title: "Unicode decision", content, type: "decision" });
    const preview = store.searchPreviews(projectId, "Unicode")[0]!.memory;
    expect(Array.from(preview.preview)).toHaveLength(300);
    expect(preview.truncated).toBe(true);
    expect(preview).not.toHaveProperty("content");
    expect(store.getVersion(projectId, saved.id)?.memory.content).toBe(content);
  } finally { store.close(); }
});
```

- [x] Run `bun test tests/retrieval.test.ts`; verify new read API is missing.
- [x] Implement FTS SQL selecting only metadata, `substr(content,1,300) AS preview` and `length(content)>300 AS truncated`, retaining bm25 weights 5/1/3 and existing multiplier. For literal mode preserve Unicode lowercasing and all-term matching, processing one row at a time, never returning content. Share predicate/order construction to prevent drift with full search; do not change the old return contract.
- [x] Implement version lookup using owner-validated current row then requested memory_versions snapshot. Return exact historical version plus currentVersion/state; invalid/nonexistent version returns null without another owner's data. Keep existing get untouched.
- [x] Implement timeline focus by exact session/memory/version, owner check and current active memory join; query neighbors by `(recordedAt,memoryId,version)` with bounded limits in a read transaction. Older neighbors fetched descending must be reversed for ascending output. Missing association returns NO_SESSION_CONTEXT; wrong session/owner never substitutes another session. Shared entry requires session owner access. Archived focus fails; archived neighbors omitted.
- [x] Implement context sections as SQL-bounded active scoped candidates, pinned first, then recent, then session summaries; recent ordered updatedAt DESC,id and summaries by session startedAt DESC,sessionId. Deduplicate id/version in that section order. Apply shared topic override before deduplication. Count omitted candidates, including section-cap overflow but excluding intentional duplicates. Drop rows from the end of summaries, then recent, then pinned until the complete result fits; update counts before each size check:

```ts
const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
```

`result` is ContextResult. Compact deletes only preview fields. Empty-result metadata fits 1024 bytes; validate budget before querying and preserve full stored text. Use one read transaction for consistent section snapshots. Do not include JSON-RPC envelope bytes or promise token counts.
- [x] Add tests for 299/300/301 code points, combining marks, literal CJK/emoji, punctuation, query order parity, shared overrides/archive/restore, exact historical focus after newer updates, same-time ordering, no-session old memories, private shared origin, 0/20 neighbors, huge titles, multibyte byte budgets and read-only database/no timestamp mutations.
- [x] Run `bun test tests/retrieval.test.ts tests/store.test.ts tests/shared.test.ts tests/sessions.test.ts` and `bun run typecheck`. Gate: previews never carry full bodies; versioned get always does.

## Task 5: MCP, CLI, protocol and delivery verification

**Files:** Create `src/mcp-tools.ts`; modify `src/mcp.ts`, `src/cli.ts`, `src/assistant-self-test.ts`, `src/memory-protocol.ts`, `src/index.ts`, `tests/mcp.test.ts`, `tests/cli.test.ts`, `tests/assistant-hooks.test.ts`, `tests/install.test.ts`.

**Consumes:** Tasks 1–4 facade and synchronize options. **Produces:** ten actually registered tools, explicit CLI equivalents and documentation handoff.

- [x] Replace the five-name assertion in the existing isolated MCP initialize test with this independent literal (do not import the catalog into the assertion):

```ts
expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
  "memory_context", "memory_current_project", "memory_get", "memory_history",
  "memory_save", "memory_search", "memory_session_end", "memory_session_start",
  "memory_session_summary", "memory_timeline",
]);
```

- [x] Run `bun test tests/mcp.test.ts`; verify the five additional tools are missing.
- [x] Add one shared tool-name tuple in mcp-tools and consume it in registration and self-test. Keep SDK initialize/listTools lazy and storage-free; self-test must never call a mutation or enroll sessions. Existing roots/cwd rules and EOF cleanup remain unchanged.
- [x] Register strict schemas matching SDK contracts. Start uses directory/sessionId and atomic project resolution; save uses assistant mode and resolved runtime directory; summary/end/timeline require explicit session identity and project resolution. Preserve explicit globalIntent on shared saves. MCP search response is `{format:2, results: PreviewResult[]}` and description clearly says previews; get is VersionRead; context is ContextResult. Keep existing memory_history and current_project contracts. Do not expose shared origin metadata outside its owning project.
- [x] Extend CLI allowed options and dispatch with the exact surface below. Use JSON for structured summary input, reject unknown keys and malformed JSON; no interactive prompt is introduced:

```text
sessions-enable
session-start --directory <path> --session-id <id>
session-end --project-id <uuid> --session-id <id>
session-summary --project-id <uuid> --session-id <id> --summary-json <json>
                --request-key <key> [--expected-version <n>]
timeline --project-id <uuid> --session-id <id> --id <memory-id>
         --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <uuid> | --scope shared] [--compact] [--max-bytes <1024..65536>]
search <existing options> [--preview]
get <existing options> [--version <n>]
save <existing options> [--session-id <id>]
sync [--upgrade-format]
```

Shared CLI save with a session needs `--session-project-id <uuid>` to validate origin without changing shared owner=null. Plain save stays independent. Plain get/search preserve existing JSON; versioned get returns VersionRead, preview search returns PreviewResult[]. Reject upgrade-format on sync-watch. Treat boolean flags as no-value flags in parser; accept 0 for before/after without weakening positive integer validation elsewhere. Make sessions-enable initialize/open only through existing safe workspace rules, not an alternative path bypass.
- [x] Update protocol to the following behavior, preserving existing shared-intent/security guidance:

```text
At conversation start, reuse a stable conversation sessionId or generate one,
then call memory_session_start when sessions are enabled. Keep that ID in context.
Use memory_context for orientation, memory_search to locate previews,
memory_timeline only when neighboring session decisions matter, and memory_get
before relying on details that a preview may omit. Pass sessionId when saving.
Save durable decisions and lessons, not transcripts, credentials or every prompt.
Before ending, save a structured summary and then close the session explicitly.
After compaction, recover the known sessionId; do not invent a replacement for an
existing conversation or claim that the MCP transport supplies native chat IDs.
If sessions are not enabled, existing memory operations remain usable.
```

Native hooks still supply reminders, not guaranteed model obedience. Generated OpenCode plugin changes must trigger existing-content conflict rather than auto-overwrite; include explicit update guidance in handoff.
- [x] Extend isolated CLI/MCP tests for all tool contracts, two parallel chats, roots ambiguity, versioned retrieval, no migration on initialize/list/read, partial summary failure, replay after close, shared origin isolation, ten-tool self-test and post-EOF cleanup. Compile and use the actual binary in a temporary user directory via existing installation fixtures. Verify no personal config or database was created/changed.
- [x] Run `bun test`, `bun run typecheck`, `git diff --check`; record actual pass/skip/fail counts. Run disposable PostgreSQL integration if available and record its version and results separately. Review security/compatibility changes before calling the feature complete; use requesting-code-review and verification-before-completion skills at execution time.
- [x] Create a delivery handoff under `docs/handoffs/09-progressive-memory-sessions.md` (create directory if absent) containing actual implemented commands/output schemas/errors, migrations, promotion/peer-upgrade instructions, tests and remaining limits. Include a ready-to-paste prompt for the other documentation model: update docs/es and docs/en separately plus Notion, plain language with technical terms in parentheses, no commits or product edits, examples for zero/one/many sessions and explicit shared intent. Correct the documented ranking to `1 + 0.10*pinned + 0.06/(1+ageDays/30)` with nonnegative ageDays; label Gentleman-inspired behavior versus our UUID/manual-per-device/sync adaptations. Document preview code points versus bytes versus tokens and honest MCP save reliability.

## Plan self-review and completion gates

- Spec sections 1–7: Task 4 retrieval and Task 5 protocol/handoff; no new scoring formula.
- Sections 8–9: Tasks 1–2, including replay-before-inference, worktree boundaries, manual registry and atomicity.
- Section 10: Task 2 summaries and Task 4 bounded, owner-checked reads.
- Section 11: Task 3 format/hash/CAS compatibility and local-only metadata.
- Sections 12–13: Task 5 ten tools, actual binary, disposable PostgreSQL and truthful parity documentation.
- All task interfaces use MemoryStore facade; no duplicate persistence store or public Database exposure.
- No completion claim until executed evidence is available. This file is a plan, not a record of passing implementation tests.
- Stop at the documentation handoff for the user's documentation model and subsequent integration decision; do not commit/push automatically.
