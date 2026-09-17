# FTS5 Reinforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add auditable confirmations, safe replication and explainable local FTS5 reinforcement without embeddings.

**Architecture:** Keep the modular monolith. Immutable confirmation records belong to memory; SQLite owns persistence and SQL ranking; synchronization merges confirmation identities rather than counters. Existing public historical memory snapshots remain unchanged.

**Tech Stack:** TypeScript, Bun >=1.3.8, bun:sqlite FTS5, existing Bun PostgreSQL adapter and MCP SDK; no new dependencies.

**Spec:** docs/superpowers/specs/2026-09-17-fts5-reinforcement-design.md

## Global Constraints

- Una sola `~/.forge614/engram.db`, un `.env`, projectId estable y shared únicamente explícito.
- No cambiar las reglas de sustitución por tema, visibilidad ni propiedad.
- Sin embeddings, sin modelos adicionales y sin revisión de contradicciones con IA.
- No modificar versiones históricas, checkpoints ni revisiones remotas anteriores.
- Una lectura, búsqueda, exportación o importación no genera confirmaciones.
- Repeating a requestKey must not increase confirmation count or change the stored response.
- Opening old schema versions does not migrate them. Explicit enrollment only, SQLite schema 7 and sync payload 3.
- Keep the 8 MiB snapshot limit, 300-code-point search previews, existing context byte limits, and existing literal-search behavior.
- Own sibling `.test.ts` for each implementation; integration suites beside their owning component; no imports between test suites.
- No real-user databases/configuration, no assistant launches, no secrets, no commits/push/branch deletion unless separately requested. Keep scratch reports until user can inspect them.
- Final docs/es, docs/en and Notion edits belong to another model; produce a handoff prompt only.

## Shared Contracts and Decisions

```ts
// modules/memory: exported through its index.ts
interface Confirmation {
  confirmationId: string; memoryId: string; version: number;
  recordedAt: string; sessionId: string | null;
}
interface ConfirmationRequest {
  memoryId: string; requestKey: string; payloadHash: string;
  expectedVersion: number | null; confirmationId: string;
  // Stable response is the existing SessionSaveResult JSON. Do not import
  // sessions into memory (that would invert the module dependency).
  response: {
    memory: MemoryVersion; sessionId: string | null;
    sessionSource: "explicit" | "inferred" | "manual" | null;
  };
}
interface ReinforcementMetrics {
  revisionCount: number; duplicateCount: number; lastSeenAt: string;
}
```

Session association on a confirmation does not create or move a session_entries row. A response uses the selected session only after validating the same ownership/closed-session rules as a normal save. Replays follow existing explicit-session checks and shared visibility rules. For requestKey uniqueness use `(scope, projectId, key)` across old save requests and new confirmation requests; owner is resolved from the referenced memory, not trusted from wire data.

Exact comparison includes normalized title/content/type/topicKey/pinned, not timestamps. For no-topic dedup, eligibility is active, same owner, topic_key IS NULL and lastSeenAt >= now - 900000 ms AND lastSeenAt <= now. Choose greatest lastSeenAt then lowest memory ID. New-topic creation is never deduplicated into a different topic. Content changes retain existing expectedVersion checks. Confirmation timing uses one requestNow.

All historical versions remain immutable. revisionCount = memory.version - 1; duplicateCount counts unique confirmation IDs. lastSeenAt = maximum of updatedAt and all confirmation times. Old versions' confirmations remain auditable; this weak bounded factor is not a claim that the current content was verified. Old memories get zero synthetic confirmations.

## Task 1: Immutable confirmations and explicit SQLite enrollment

**Files:**
- Create: src/modules/memory/confirmations.ts, confirmations.test.ts.
- Modify: src/modules/memory/index.ts.
- Create: src/infrastructure/sqlite/confirmations.ts, confirmations.test.ts.
- Modify: src/infrastructure/sqlite/schema.ts, schema.test.ts, sessions.ts, sessions.test.ts, projects.ts, projects.test.ts (schema capability checks only).
- Modify: src/infrastructure/sqlite/writes.ts, writes.test.ts.
- Modify: src/app/memory-store.ts, memory-store.test.ts.
- Test integration: src/app/__tests__/confirmations.integration.test.ts.

**Interfaces:**
- Produces `enableSearchReinforcement(db):void` in schema and `reinforcementEnabled(db):boolean` in SQLite confirmations.
- Produces MemoryStore.enableSearchReinforcement():void and reinforcementEnabled():boolean.
- Produces confirmations table, confirmation_requests table and immutable types above.
- Consumes SaveInput, MemoryVersion, SessionSaveResult and existing save transaction wrappers.

- [x] **Step 1: Write and run failing persistence tests.** Use existing withDatabase fixture; require migrations from 3,4,5,6 and repeat enrollment, reopening, foreign-key constraints, no changed historical snapshots. A minimal integration behavior:

```ts
store.enableSearchReinforcement();
const first = store.save({projectId, title:"Queue", content:"Use jobs", type:"decision", requestKey:"first"});
const again = store.save({projectId, title:"Queue", content:"Use jobs", type:"decision", requestKey:"again"});
expect(again).toEqual(first);
expect(store.history(projectId, first.id)).toHaveLength(1);
expect(store.listProjects()).toHaveLength(1);
```

Run `bun test src/infrastructure/sqlite/confirmations.test.ts src/infrastructure/sqlite/schema.test.ts src/app/__tests__/confirmations.integration.test.ts`; capture expected red before implementation.

- [x] **Step 2: Implement additive storage and capabilities.** DDL shape:

```sql
CREATE TABLE confirmations (
 confirmationId TEXT PRIMARY KEY NOT NULL,
 memoryId TEXT NOT NULL, version INTEGER NOT NULL,
 recordedAt TEXT NOT NULL, sessionId TEXT REFERENCES sessions(sessionId),
 FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX confirmations_memory_time ON confirmations(memoryId,recordedAt,confirmationId);
CREATE TABLE confirmation_requests (
 memoryId TEXT NOT NULL REFERENCES memories(id),
 requestKey TEXT NOT NULL, payloadHash TEXT NOT NULL,
 expectedVersion INTEGER, confirmationId TEXT NOT NULL REFERENCES confirmations(confirmationId),
 response TEXT NOT NULL CHECK(json_valid(response)),
 PRIMARY KEY(memoryId,requestKey)
);
```

Owner-wide uniqueness is additionally enforced transactionally across both request tables, because memoryId alone is not the request namespace. Enrollment validates current schema first and appends missing 4/5/6 prerequisites plus these tables atomically. Existing capability checks explicitly admit 7 without admitting arbitrary future versions. Do not activate networking or assistant configuration.

- [x] **Step 3: Write failing write/retry tests and implement the confirmation branch.** Replay lookup happens before stale-version checks, as in existing saves. For a new operation select and validate session, resolve candidate, enforce expectedVersion, then choose one branch:

```text
same exact eligible memory -> insert confirmation UUID
                          -> insert confirmation request if supplied
                          -> return existing MemoryVersion with selected session response
                          -> no version/event/session_entries insertion
changed or no candidate   -> existing versioned save transaction
```

Use the existing payload hash algorithm; store expectedVersion explicitly for confirmation requests so sync can recompute it against the confirmed historical version. Recheck both request namespaces before writing. Test request reuse with changed content, retry after later update/archive, wrong project, same-key simultaneous requests, stale topic version, archived topic, shared without session, closed/wrong session, repeated summary save, 900000 ms boundary and future-clock exclusion. Tests with controlled time use Bun fake system time restored in finally, not test flags in production.

- [x] **Step 4: Verify and review.** Run focused changed-file tests plus `bun run typecheck`; capture red/green evidence and changed-file report. Guard legacy schemas: duplicates still create independent records there. No commit; create a review diff including untracked files, not just git diff tracked output.

## Task 2: Snapshot 3 validation and lossless reconciliation

**Files:**
- Create: src/modules/synchronization/confirmations.ts, confirmations.test.ts.
- Create: src/modules/synchronization/__tests__/confirmations.integration.test.ts for snapshot/confirmation collaboration; share fixtures via __test-support__/confirmation-fixtures.ts when needed, never via another test suite.
- Modify: src/modules/synchronization/snapshot.ts, snapshot.test.ts, index.ts.

**Interfaces:**
- Consumes Confirmation and ConfirmationRequest from memory public entry.
- Produces SyncSnapshotV3 `{format:3,projects,memories,sessions,sessionEntries,sessionSummaries,confirmations,confirmationRequests}`.
- Existing `validateSnapshot`, `reconcile`, `assertExtension`, `snapshotHash`, `normalizeSnapshot` support 3 without changing serialized legacy formats or old hashes.

- [x] **Step 1: Write failing union and validation tests.** Build real legacy bundles with existing fixtures; promote with empty new arrays. For two different confirmation UUIDs on the same memory version, reconcile to two; merging a replica twice remains two. Assert exact same-ID conflicting time is SYNC_CONFLICT and that dropping a base event is refused.

```ts
expect(reconcile(base, local, remote).format).toBe(3);
const merged = reconcile(base, local, remote);
expect(merged.format === 3 && merged.confirmations.map(c => c.confirmationId)).toEqual([idA,idB]);
expect(() => reconcile(base, local, conflictingRemote)).toThrow("SYNC_CONFLICT");
```

Run `bun test src/modules/synchronization/confirmations.test.ts src/modules/synchronization/snapshot.test.ts` and record red.

- [x] **Step 2: Implement strict format 3 validation.** Validate exact keys, UUIDs, integer versions, canonical UTC dates, referenced memory version and session owner, response equality with that version, sessionSource consistency and referenced confirmation. Validate hash by reconstructing `[scope,projectId,title,content,type,topicKey,pinned,expectedVersion]`. Topic confirmation expectedVersion equals confirmed version; no-topic expectedVersion is null. Reject duplicate request namespaces across both collections and old bundle requests. Confirmation timestamps may be older than a later memory update, but must not precede the confirmed version's updatedAt. Preserve size bounds and historical bundle validation unchanged.

- [x] **Step 3: Implement identity-set reconciliation and append-only checks.** Canonical sorting by confirmationId; requests by owner namespace and requestKey. Set union with same-ID equality requirement; require every base/local historical record unchanged in extension. Merge memory bundles and sessions with existing conflict rules. Do not treat independent requests on one confirmation as independent confirmations. Keep old-format peers usable until an explicit promotion by the orchestration layer. Test confirmations concurrent with edits, same requestKey on different event IDs, shared/project keys, malformed responses and removal of historical records.

- [x] **Step 4: Verify focused tests and typecheck, report, review.** Serialization of fixtures in formats 1 and 2 must be byte-for-byte hash compatible. Capture the tests and exact output in the task report. No commit.

## Task 3: SQLite/PostgreSQL transport and upgrade gates

**Files:**
- Modify: src/infrastructure/sqlite/snapshots.ts, snapshots.test.ts.
- Modify: src/app/synchronization.ts, synchronization.test.ts.
- Modify: src/infrastructure/postgres/replica.test.ts (adapter production only if a demonstrated format-3 boundary requires it).
- Test: src/app/__tests__/confirmations-sync.integration.test.ts, src/app/__tests__/postgres-sync.integration.test.ts.

**Interfaces:**
- Consumes Task 1 SQLite tables and Task 2 SyncSnapshotV3.
- Preserves `exportSnapshot`, `applySnapshot`, and `synchronize(...,{upgradeFormat?:boolean})` API.

- [x] **Step 1: Red tests for export/import and gates.** Export schema 7 as format 3, export 6 as 2 and 3–5 as 1. Import format 3 only into explicitly enrolled local 7. Refuse promotion of remote 1/2 without upgradeFormat before publish. Assert local/remote snapshots unchanged after refusal.

```ts
await expect(synchronize(enrolledStore, replica)).rejects.toThrow("SYNC_UPGRADE_REQUIRED");
await synchronize(enrolledStore, replica, {upgradeFormat:true});
expect((await replica.read()).snapshot.format).toBe(3);
```

- [x] **Step 2: Implement transactional export/apply.** Export deterministic arrays and parse request responses. Validate before mutation, assert current hash and extension, insert sessions/versions before their referencing confirmations. Add new rows only; conflict cannot overwrite an event. Preserve previous requests and checkpoints. Update all exact-format branches needed for 3; do not accidentally disable sessions in schema 7. Check local capability and upgrade gates before any remote write.

- [x] **Step 3: Exercise real disposable PostgreSQL.** Two local databases confirm independently, exchange through replica, and repeat sync without multiplying count. Test lost acknowledgment, foreign event ownership, unsupported local schema, old remote promotion, immutable historical revisions, content conflict without partial apply and offline failure preserving local confirmation. PostgreSQL DDL remains unchanged; payload.format differs from state.format.

- [x] **Step 4: Verify focused transport and module tests plus typecheck; report and review.** Use existing disposable PostgreSQL fixture only. Never read real `.env`. No commit.

## Task 4: Shared FTS5 ranking and explainable factors

**Files:**
- Create: src/modules/memory/ranking.ts, ranking.test.ts.
- Modify: src/modules/memory/index.ts, types.ts.
- Modify: src/infrastructure/sqlite/search.ts, search.test.ts.
- Test: src/app/__tests__/retrieval.integration.test.ts.

**Interfaces:**
- Consumes per-memory confirmation count/MAX time from Task 1 and current version.
- Produces a single ranking policy with weights and `rankingFactors(metrics,pinned,now)` used for public explanations; SQL formula uses the same exported constants.
- SearchResult explanation gains optional `reinforcement` containing revisionCount, duplicateCount, lastSeenAt, ageDays, pinnedBoost, recencyBoost and stabilityBoost. Legacy schemas/literal search keep their existing result shape.

- [x] **Step 1: Red formula and ordering tests.** For current, pinned memory with four total reinforcements expect multiplier 1.18; at 30 days expect 1.15. With none and not pinned at 30 days expect 1.03. BM25 -2 multiplied by 1.18 sorts before -2*1.06. Future dates clamp age to zero; no Infinity or NaN.

```ts
expect(rankingFactors({revisionCount:2,duplicateCount:2,lastSeenAt:now},true,now).multiplier).toBeCloseTo(1.18,12);
```

- [x] **Step 2: Implement SQL ranking before LIMIT.** For schema 7 derive counts and lastSeenAt with indexed aggregate queries/CTE; do not load full content or all candidates into JS. Compute one timestamp per request and bind it. Use `1 + .10*pinned + .06/(1+ageDays/30) + .04*n/(n+4)`; retain raw BM25 and ID tie-break. Share SQL construction between full and preview projections. Keep old schema formula unchanged and no silent migration. Literal path keeps its current ordering and null BM25.

- [x] **Step 3: Exercise real SQLite with competing memories.** Pin/recency/stability tests must affect rank on equal lexical content; include stronger lexical match against weaker reinforced match. Test title/topic/content weights, archived memories, wrong project, shared overrides, preview truncation and identical full/preview IDs. Compare persisted snapshot before/after search to prove no write reinforcement. Test exact input Unicode and literal short terms.

- [x] **Step 4: Verify focused ranking/search/integration tests and typecheck, report and review.** No embeddings/model dependencies, no probabilistic confidence field, no commit.

## Task 5: Explicit setup, CLI and assistant guidance

**Files:**
- Modify: src/app/setup.ts, setup.test.ts.
- Modify: src/interfaces/cli/commands.ts, commands.test.ts, help.ts, arguments.ts, arguments.test.ts as required by the new command.
- Modify: src/modules/assistants/protocol.ts (static instruction text, no new logic); verify delivery through src/modules/assistants/templates.test.ts using the executed generated plugin.
- Test: src/interfaces/cli/__tests__/cli.e2e.test.ts; src/interfaces/mcp/memory-tools.test.ts and src/interfaces/mcp/__tests__/mcp.e2e.test.ts for actual save behavior.
- Modify public SDK contract tests only for new methods, not to weaken ownership checks.

**Interfaces:**
- Consumes `MemoryStore.enableSearchReinforcement()`.
- Produces explicit CLI `forge614-engram reinforcement-enable` and setup yes/no offer.
- Existing `sync --upgrade-format` is reused for payload promotion; help explains all devices must understand format 3.

- [x] **Step 1: Red setup/CLI tests.** Declining/cancelling must not upgrade schema or mutate settings; accepting and confirming upgrades. A repeated enable is safe, including with a missing configured database (must not recreate silently). Legacy noninteractive commands do not opt in automatically.

```text
setup: ¿Quieres habilitar el refuerzo de recuerdos? [si/NO]
explanation: registrar repeticiones mejora el orden; no verifica la verdad.
warning: sincronizar esta función requiere actualizar todos los equipos.
```

- [x] **Step 2: Implement enrollment after final setup confirmation.** No mutation during prompts or preview. If already enrolled, display enabled status without offering a misleading disable/downgrade option. CLI uses existing MemoryWorkspace safety and closes store in finally. Surface errors without credentials. Do not install services or modify assistant files automatically. Explain the separate explicit remote promotion command. Update scripted answers in existing runSetup consumer tests (including tests/e2e/postgres-sync.test.ts and src/app/__tests__/postgres-sync.integration.test.ts) to explicitly decline/accept the new question while preserving their original assertions.

- [x] **Step 3: Update model guidance.** Recommend stable requestKey per logical save and reuse for retries; new keys for independent observations. Explain default project scope and explicit shared, read topic before modifying, and that repeated saves are not truth verification. Preserve permission and no-guaranteed-save caveats. Test runtime MCP duplicate save on an enrolled temporary database without increasing version or leaking another project's result.

- [x] **Step 4: Run focused UI/app/MCP tests, typecheck, report and review.** Keep defaults safe and labels plain-language. No commit or user config writes.

## Task 6: End-to-end validation and documentation handoff

**Files:**
- Create: docs/handoffs/11-fts5-reinforcement.md.
- Modify only necessary related tests uncovered by real integration defects, with red before fix.

**Interfaces:** Consumes all previous tasks; produces verification evidence and ready-to-paste bilingual documentation prompt.

- [x] **Step 1: Run `bun test`, `bun run typecheck`, `git diff --check`.** Do not skip installer, PTY, real disposable PostgreSQL or architecture tests. Record counts, environment and failures honestly.
- [x] **Step 2: Whole-branch independent review.** Review spec compliance, format upgrades, request identity, owner/session checks, SQL ordering and migration preservation. Fix verified findings and rerun covering tests. Review all untracked implementation files too.
- [x] **Step 3: Write handoff.** Include actual commands, formula, worked example, exact dedup window, retry limitation without requestKey, distinction between confirmations/revisions/truth, schema 7/payload 3/state 1, offline behavior, migration compatibility, non-destructive guarantees, tests and remaining limitations. Explain modular-monolith pattern and colocated tests in English and Spanish documentation instructions. Mention no embeddings/training/LLM auditor; don't claim Gentleman parity beyond verified behavior.
- [x] **Step 4: Report outcome and uncommitted changes.** No commit, push, PR, merge, branch deletion or Notion updates. User handles documentation before integration.
