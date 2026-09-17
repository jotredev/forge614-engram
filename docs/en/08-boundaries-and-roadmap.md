# 08 (EN). Stage Boundaries and Evolutionary Roadmap

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Verified (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [08. Límites de la Etapa y Hoja de Ruta Futura](../es/08-limites-y-roadmap.md)

This document declares with complete transparency which capabilities are implemented and verified in the current release, active technical and operational boundaries, the distinction between synthetic test fixtures and live assistant sessions, and pending development phases on the official roadmap.

---

## 1. Completed and Verified Capabilities

The following development phases are **100% implemented and verified**:

### Phase 1: Interactive Setup Wizard (`setup`) — COMPLETED
- [x] Step-by-step guidance in interactive terminals (`stdin` and `stdout` TTY).
- [x] User-level central storage paths: `~/.forge614/.env` and `~/.forge614/engram.db`.
- [x] Confidential PostgreSQL URL capture with masked input (`{ secret: true }`).
- [x] Explicit confirmation before writing and standard exit code `130` on cancellation.

### Phase 2: Direct PostgreSQL Replica Synchronization (`sync` / `sync-watch`) — COMPLETED
- [x] Direct workspace replication to PostgreSQL without cloud intermediaries.
- [x] Commands `sync` (single on-demand JSON round) and `sync-watch` (foreground loop with configurable interval).
- [x] Offline resilience: SQLite and FTS5 remain 100% local; if PostgreSQL is unavailable, local operations continue without error.
- [x] Deterministic 3-way snapshot merge with strict conflict detection (`SYNC_CONFLICT`) and 8 MiB snapshot boundary (`SYNC_TOO_LARGE`).

### Phase 3: Local MCP Integration & Assistant TUI Menu — COMPLETED
- [x] Stdio MCP server with clean JSON-RPC communication on `stdout`.
- [x] Interactive terminal menu (`forge614-engram tui`) with keyboard navigation, zero-write preview, and safe confirmation.
- [x] 5-second asynchronous MCP server self-test.
- [x] Secure adapters for 5 clients (Claude Code, Codex, Cursor, OpenCode, Gemini CLI) with `0600`/UUID backups and post-publication byte verification.
- [x] SQLite Schema 5 with `project_bindings` resolving canonical Git root identities.

### Phase 4: Progressive Memory Sessions & Ranked Context — COMPLETED
- [x] **SQLite Schema 6:** Tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`.
- [x] **Explicit Migration (`sessions-enable`):** Additive, irreversible migration; standard opens, MCP, and init never auto-migrate existing databases.
- [x] **Complete Session Lifecycle:** CLI commands `session-start`, `session-end`, `session-summary`, and corresponding MCP tools.
- [x] **Structured Session Summaries:** Strict validation of 6 mandatory fields (`goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`) under reserved topic `session/<id>/summary` with type `procedure`.
- [x] **Ranked Context Retrieval (`context` / `memory_context`):** Structured dossier partitioned into `pinned`, `recent`, and `summaries` with omission tracking and boolean `truncated` flag.
- [x] **Strict Byte Budgeting (`--max-bytes`):** Numerical boundary between 1024 and 65536 bytes of total serialized UTF-8 JSON.
- [x] **Session Event Timeline (`timeline` / `memory_timeline`):** Chronological reconstruction surrounding a focus memory with prior and subsequent entries.
- [x] **Progressive Previews (`--preview` and `searchPreviews`):** Content truncated to a maximum of 300 Unicode code points with truncation flags.
- [x] **10 Native MCP Tools:** Full suite of memory tools exposed over stdio.
- [x] **Format 2 PostgreSQL Promotion:** Replicating sessions and summaries promoted exclusively via `sync --upgrade-format` under atomic CAS locking on `forge614_sync.state`.
- [x] **OpenCode Plugin Conflict Safety:** Halts with `CONFLICT` if `plugins/forge614-engram.js` contains divergent code, requiring manual reconciliation.

### Phase 4.1: Feature-Oriented Modular Monolith & Colocated Tests — COMPLETED
- [x] **Feature-oriented modular monolith:** Clean separation of responsibilities into `app/` (workflow coordination), `modules/` (pure business rules & types, zero I/O), `infrastructure/` (concrete SQLite, PostgreSQL, filesystem, git, and assistant adapters), `interfaces/` (CLI, MCP, TUI, and terminal delivery), and `shared/` (`errors.ts`).
- [x] **Compatible `MemoryStore` facade:** Full preservation of historical SDK signatures and methods in `src/app/memory-store.ts`, delegating to specialized SQLite persistence modules.
- [x] **Removal of deprecated internal flat paths:** Complete removal of legacy root files from `src/`, routing all external consumers strictly through `src/index.ts`.
- [x] **Automated TypeScript AST architecture auditor:** Strict compile-time AST validation (`tests/architecture/import-rules.ts`) enforcing layer import rules, prohibiting cross-component cycles, and preventing domain leaks.
- [x] **Colocated sibling tests:** 1:1 sibling test pairing (`<file>.test.ts`) for all 46 logic-bearing implementation files, accompanied by local collaboration suites in `__tests__` subdirectories.
- [x] **Composite outer transactions:** Persistence writes coordinated through `infrastructure/sqlite/writes.ts` under a single shared transaction (`BEGIN IMMEDIATE ... COMMIT`).
- [x] **369 automated tests across 69 files:** 361 passed and 8 skipped without isolated PostgreSQL binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured (30.69s).

---

## 2. Active Boundaries and Operational Constraints

To maintain strictly realistic expectations, the following boundaries are declared:

1. **Byte Budget vs LLM Token Budget:**
   The `--max-bytes` parameter bounds the total serialized UTF-8 JSON payload size transferred between processes. **It is not an internal token accounting system for LLM context windows**.
2. **Previews in Unicode Code Points:**
   Abbreviated notes are delimited by Unicode code points (300 in previews and context; 500 for focus and 150 for neighbors in timeline), preventing character corruption from byte splitting.
3. **Voluntary Model Compliance:**
   Configuring MCP servers and hooks does not guarantee that language models will invoke tools or save session summaries. Models are probabilistic and may skip tool calls.
4. **No Guaranteed Save on Abrupt Process Kill:**
   If a client terminal is forcibly killed (e.g. `kill -9` or hard window close), assistants cannot be guaranteed to record a final session summary.
5. **No Conversational Transcript Capture:**
   Engram stores curated, durable technical knowledge, **not raw chat transcripts, logs, or tool dumps**.
6. **No Background LLM Daemon:**
   Engram does not run an autonomous background language model; it never synthesizes notes without an explicit tool invocation.
7. **Manual Trust Policy in Codex (`/hooks`):**
   In Codex, newly installed hooks must be reviewed and trusted explicitly by the user via `/hooks` before they are permitted to run.
8. **Synthetic Fixtures vs Live Assistant Sessions:**
   The automated test suite exercises protocol compliance using synthetic fixtures and virtual PTY terminals. Live human sessions inside all 5 clients must be verified in their actual host applications.
9. **Machine-Local Bindings Not Synced:**
   Tables `project_bindings`, `local_session_bindings`, and `local_manual_sessions` are strictly local to each machine and are never replicated to PostgreSQL.
10. **8 MiB Snapshot Payload Limit:**
    Combined sync snapshots have a hard limit of 8 MiB (`8,388,608 bytes`), returning `SYNC_TOO_LARGE` if exceeded.
11. **No Heuristic Automatic Conflict Resolution:**
    Concurrent incompatible modifications to the same entity trigger `SYNC_CONFLICT`.
12. **Literal Trigram BM25 Search:**
    Search relies on exact term and trigram matches in SQLite FTS5; it does not perform semantic vector embedding search. The current modular architecture defines clean extension boundaries in `modules/search/` and `infrastructure/`, but does not implement embedding providers in this phase.

---

## 3. Evolutionary Roadmap: Pending Phases

With Phases 1 through 4.1 completed, future development focuses on the following phases:

```text
┌────────────────────────────────────────────────────────┐
│ [x] Phase 1: Interactive Setup Wizard                  │ (Completed v0.3.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 2: Direct PostgreSQL Synchronization         │ (Completed v0.4.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 3: Local MCP Server & Assistant TUI Menu     │ (Completed v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 4: Progressive Sessions & Ranked Context     │ (Completed v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 4.1: Modular Monolith & Colocated Tests      │ (Completed v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Phase 5: Semantic Search & Advanced Ranking        │ (Pending)
│     - Local vector embedding generation                │
│     - Hybrid retrieval (FTS5 BM25 + cosine similarity) │
│     - Dynamic token-aware context allocation           │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Phase 6: Full Terminal Management Interface (TUI)  │ (Pending)
│     - Interactive memory explorer in terminal          │
│     - Visual editing of topics, versions, and sessions │
│     - Interactive sync conflict resolution tool        │
└────────────────────────────────────────────────────────┘
```

> [!NOTE]
> Following honest engineering practices, Phases 5 and 6 are documented as approved conceptual milestones pending implementation, without promising guaranteed release versions or deadlines.
