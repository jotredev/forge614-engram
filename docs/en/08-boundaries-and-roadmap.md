# 08 (EN). Stage Boundaries and Evolutionary Roadmap

> **Stage:** Nonvisual Engine Transition (Task 1: Inspection & Preview), Ecosystem Contract (`FORGE614_ECOSYSTEM_CONTRACT.md`), Product Home (`~/.forge614/engram/`), Safe & Atomic Legacy Workspace Migration, Guarded Coordinated Uninstaller (`uninstall`), TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 1.1.0-beta.2 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (con sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Verified (607 total tests across 92 files: 592 passed and 15 skipped without isolated PostgreSQL test binaries or native Windows; 0 failures on macOS ARM64 with Bun 1.3.8)
> **Sister translation:** [08. Límites de la Etapa y Hoja de Ruta Futura](../es/08-limites-y-roadmap.md)

This document transparently defines implemented and verified capabilities in the current delivery, operational boundaries, distinctions between synthetic tests and live assistant sessions, and official pending roadmap phases.

---

## 1. Completed and Verified Capabilities

The following development phases are **100% implemented and verified**:

### Phase 1: Interactive Initial Setup Wizard (`setup`) — COMPLETED
- [x] Human-guided interactive CLI wizard (`stdin` and `stdout` TTY).
- [x] Central file paths located in product home: `~/.forge614/engram/.env` and `~/.forge614/engram/engram.db`.
- [x] Masked entry for PostgreSQL URL (`{ secret: true }`).
- [x] Interactive prompt to enable search reinforcement (Schema 7).
- [x] Explicit pre-confirmation and standard exit code `130` on cancellation.

### Phase 2: Direct PostgreSQL Synchronization (`sync` / `sync-watch`) — COMPLETED
- [x] Full workspace replication to PostgreSQL.
- [x] CLI commands `sync` (single-shot JSON) and `sync-watch` (continuous polling).
- [x] Offline resilience: SQLite and FTS5 remain 100% local; unavailability of PostgreSQL never blocks local operations.
- [x] Deterministic 3-way merge snapshot synchronization with conflict detection (`SYNC_CONFLICT`) and 8 MiB size cap (`SYNC_TOO_LARGE`).

### Phase 3: Local MCP Server and Assistant TUI Menu — COMPLETED
- [x] Native stdio MCP server with clean I/O channels (stdout reserved for JSON-RPC).
- [x] Full-screen terminal UI menu (`forge614-engram tui`) with keyboard navigation and safe preview.
- [x] Asynchronous MCP server self-test verifying binary and tools within a 5-second deadline.
- [x] Safe adapters for 5 clients (Claude Code, Codex, Cursor, OpenCode, Antigravity) with `0600`/UUID backups and post-write verification.
- [x] Schema 5 in SQLite with `project_bindings` resolving canonical repository identity via Git.

### Phase 4: Progressive Memory Sessions and Ranked Context — COMPLETED
- [x] **Schema 6 in SQLite:** Tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`.
- [x] **`sessions-enable` Command:** Additive irreversible migration; ordinary commands and `mcp` never auto-migrate databases.
- [x] **Full Session Lifecycle:** CLI commands `session-start`, `session-end`, `session-summary` and matching MCP tools.
- [x] **Structured Session Summaries:** Strict 6-field validation (`goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`) under reserved topic `session/<id>/summary` with type `procedure`.
- [x] **Ranked Context Dossier (`context` / `memory_context`):** Structured 3-partition dossiers (`pinned`, `recent`, `summaries`) with omission metrics and `truncated` boolean flag.
- [x] **Strict Byte Budget (`--max-bytes`):** Enforces 1024..65536 UTF-8 JSON serialized byte limit.
- [x] **Session Event Timeline (`timeline` / `memory_timeline`):** Chronological window around a focus memory with before/after neighbors.
- [x] **Lightweight Previews (`--preview` and `searchPreviews`):** Cards truncated to 300 Unicode code points with truncation flag.
- [x] **10 Native MCP Tools:** Full suite exposed to AI models.
- [x] **Format 2 Promotion in PostgreSQL:** Replica support for sessions promoted via `sync --upgrade-format` under atomic CAS locking.
- [x] **Safe OpenCode Conflict Resolution:** Halts with `CONFLICT` on divergent plugins, requiring manual reconciliation without silent overwrite.

### Phase 4.1: Feature-Oriented Modular Monolith and Colocated Tests — COMPLETED
- [x] **Feature-Oriented Modular Monolith:** Strict boundary separation into `app/` (orchestration), `modules/` (pure rules & types without I/O), `infrastructure/` (SQLite, PostgreSQL, filesystem, git, assistants), `interfaces/` (CLI, MCP, TUI, terminal), and `shared/` (`errors.ts`).
- [x] **Compatible Facade `MemoryStore`:** 100% preservation of SDK method signatures in `src/app/memory-store.ts`, delegating to partitioned SQLite operations.
- [x] **Complete Removal of Legacy Root Files:** Flat root files eliminated in `src/`; public SDK consumed strictly from `src/index.ts`.
- [x] **Automated AST Architecture Auditor:** TypeScript AST verification (`tests/architecture/import-rules.ts`) preventing cycles and cross-layer violations.
- [x] **Colocated Sibling Tests:** 1:1 colocated sibling tests (`<name>.test.ts`) for all production logical components.
- [x] **Composite Outer Transactions:** Persistence atomic transactions orchestrated in `infrastructure/sqlite/writes.ts` under a shared `BEGIN IMMEDIATE`.

### Phase 4.2: Reinforced FTS5 Search (No Embeddings) and Immutable Confirmations — COMPLETED
- [x] **Schema 7 in SQLite:** Tables `confirmations` and `confirmation_requests` with indices.
- [x] **`reinforcement-enable` Command:** Additive irreversible migration; ordinary commands never auto-migrate databases to Schema 7.
- [x] **Immutable Memory Confirmations:** Records repeated observations without inflating memory versions or duplicating records.
- [x] **Idempotent Request Key Replay (`requestKey` replay):** Returns cached response without adding confirmations or versions if the SHA-256 payload hash matches.
- [x] **Payload Conflict Detection (`REQUEST_CONFLICT`):** Immediate halt when reusing a request key with modified payload content.
- [x] **15-Minute Sliding Deduplication Window:** Bounded deduplication for notes without a topic (`topicKey: null`), discarding future timestamps and selecting by greatest `lastSeenAt` then `id ASC`.
- [x] **Clock Skew Protection (`CLOCK_SKEW`):** Halts when local clock reads earlier than confirmed memory version timestamp.
- [x] **Exact Mathematical Ranking Formula:** $\text{orderScore} = \text{BM25} \times \text{multiplier}$ with column weights $5.0 / 3.0 / 1.0$, factors $0.10$ (pinned), $0.06$ (30-day recency), and $0.04$ (asymptotic stability $\frac{n}{n+4}$), sorted ascending `orderScore ASC` and tie-broken by `id ASC`.
- [x] **Deterministic Single Query Clock:** `request_clock(nowMs)` evaluated once per search query, applying ordering before `LIMIT`.
- [x] **PostgreSQL Format 3 Promotion:** Replicates confirmations and requests under atomic CAS snapshot locking, preserving physical table schema `state.format = 1`.
- [x] **Peer Client Compatibility Safeguard:** Unreinforced peer clients halt with `REINFORCEMENT_REQUIRED` when syncing Format 3 snapshots.

### Phase 4.3: TUI Control Center (`forge614-engram tui`) — COMPLETED
- [x] **Unified Interactive Control Center:** Full-screen terminal dashboard with `Summary`, `Projects`, `Shared`, `Storage`, `Actions`, `Assistants`, and `Exit` tabs.
- [x] **Strict Read-Only Default:** Opening the interface, switching tabs, browsing project hierarchies, and resizing windows execute 100% read-only without modifying a single byte on disk or SQLite.
- [x] **Two-Step Mutation Confirmation:** Write actions require preview inspection, explicitly typing `confirm` (or `CONFIRM`) into a dialog prompt, and pressing `Enter`.
- [x] **Comprehensive Secret and Note Concealment:** Completely masks `POSTGRES_URL`, unredacted `.env` contents, memory note text, titles, and assistant configuration contents.
- [x] **Terminal Output Sanitization:** Neutralizes ANSI escape sequences, non-printable control characters, bidirectional overrides (bidi), zero-width characters, and URLs.
- [x] **Sequential Assistant Subflow:** Cleanly pauses Control Center event loop, restores terminal mode, spawns the assistant menu (`assistantTui`), and reloads fresh system state upon return without nested raw modes.
- [x] **572 Automated Tests Passed Across 90 Files:** 0 failures, 15 skipped without isolated PostgreSQL test binaries or native Windows on macOS ARM64 with Bun 1.3.8.

### Phase 4.4: Product Home, Safe Migration, and Coordinated Uninstaller (`uninstall`) — COMPLETED
- [x] **Dedicated Product Home (`~/.forge614/engram/`):** Strict confinement of Engram within its exclusive directory. Guaranteed peaceful coexistence with `~/.forge614/shell/` and `~/.forge614/atlas/` without touching sibling files. Executables hosted in `~/.forge614/engram/bin/forge614-engram` (`.exe` on Windows).
- [x] **Atomic Legacy Migration (`EngramProductHome.migrateLegacyWorkspace`):** Automatic detection and atomic migration of the 5 exact Engram files (`.env`, `engram.db`, `engram.db-wal`, `engram.db-shm`, `.config-lock`). Immediate rollback on any I/O error.
- [x] **Fail-Closed Rejection of Legacy Risks:** Dedicated error codes: `LEGACY_UNSAFE` (if legacy root or files are symbolic links or owned by a foreign user), `LEGACY_CONFLICT` (if files already exist at destination or if orphaned WAL/SHM files lack a main database), and `LEGACY_MIGRATION_FAILED` (with atomic rollback on transfer error).
- [x] **Automatic Permission Repair (`repairExistingRoot`):** Preemptive restriction to `0700` (`rwx------`) only on Engram's owned `~/.forge614/engram` directory. The shared `~/.forge614` container is validated but never chmodded.
- [x] **Guarded Coordinated Uninstaller (`forge614-engram uninstall`):** Safe, complete removal of Engram. Requires mandatory exact confirmation string via `--confirm <phrase>`.
- [x] **Dual-Level Confirmation Based on Atlas Presence:** Standard phrase `"REMOVE FORGE614-ENGRAM"` when standalone; combined phrase `"REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS"` if `~/.forge614/atlas/` exists, enforcing prior coordinated removal of the dependent sibling.
- [x] **Prior Coordinated Atlas Removal:** Executes `~/.forge614/atlas/bin/forge614-atlas uninstall --from forge614-engram --confirmed` in a subprocess. Stops safely with `ATLAS_UNINSTALL_REQUIRED` or `ATLAS_UNINSTALL_FAILED` if missing or failing.
- [x] **Surgical Assistant and Hook Removal:** Clean stripping of managed blocks across Claude Code, Codex, Cursor, OpenCode, and Antigravity, restoring backups or cleaning blocks without corrupting foreign settings. Halts with `ASSISTANT_REMOVE_FAILED` if JSON files are malformed.
- [x] **Surgical PATH Dotfile Cleanup:** Clean removal of `# >>> forge614-engram PATH >>>` blocks in Unix shell dotfiles and user environment cleanup on Windows. Halts with `PATH_CONFLICT` if manual edits occurred within managed markers.
- [x] **Strictly Confined Data Deletion:** Deletes only `~/.forge614/engram/`. Preserves parent root `~/.forge614/` if sibling products (`shell/`, `atlas/`) or foreign user files remain.

### Phase 4.5: Nonvisual Engine Transition in the Forge614 Ecosystem — IN PROGRESS (Tasks 1, 2, and 3 Complete)
- [x] **Master Ecosystem Contract (`FORGE614_ECOSYSTEM_CONTRACT.md`):** Clear definition of product hierarchy (`forge614-ai`, `forge614-shell`, `forge614-engines`, `forge614-engram`, `forge614-atlas`). Engram formally embraces its role as a headless memory engine without proprietary human-facing visual interfaces.
- [x] **Task 1 — Passive Inspection and Nonvisual Initialization Preview (`src/app/initialization.ts`):** Functions `inspectMemoryInitialization()` and `previewMemoryInitialization()` exported from the public TypeScript SDK with strict types (`MemoryInitializationStatus`, `MemoryInitializationRequest`, `MemoryInitializationPreview`).
- [x] **Zero Side Effects in Inspection and Preview:** Strictly read-only verification without directory creation, `.env` file generation, SQLite database creation, remote PostgreSQL network calls, or credential leaks.
- [x] **Task 2 — Atomic Initialization Execution (`applyMemoryInitialization`):** Atomic, safe execution with optimistic concurrency verification (`expectedRevision`), pre-flight transient PostgreSQL connectivity validation, and permanent additive reinforcement.
- [x] **Task 3 — Unified CLI Initialization (`forge614-engram init [--json]`):** Formal retirement of `setup` (`COMMAND_RETIRED`), unification into `forge614-engram init` (interactive terminal mode), and introduction of `init --json` (headless mode returning JSON without opening TUI).
- [ ] **Task 4 — Decouple Assistant Detection and Integrate with Engines:** (Planned) Delegate assistant discovery and configuration management to `forge614-engines`.
- [ ] **Task 5 — Gradual TUI Retirement and Redirection to Forge614 Shell:** (Planned) Deprecation of direct terminal interfaces in Engram in favor of Shell.

---

## 2. Current Operational Boundaries

To maintain realistic expectations, the following boundaries are formally declared:

1. **Confirmation Does Not Equal Absolute Truth:**
   An immutable confirmation records that the assistant observed the same fact again; it does not certify ontological truth, infallibility, or human verification.
2. **Reinforced Search Operates Without Embeddings:**
   Does not use vector embeddings, neural networks, local transformers, or remote embedding APIs. It operates 100% on deterministic SQLite FTS5 trigrams with mathematical stability and recency multipliers.
3. **No Autonomous LLM Arbitrator:**
   Engram does not autonomously arbitrate contradictory statements across distinct notes; contradictions are resolved at the application level or through explicit topic overrides (`topicKey`).
4. **Byte Budget vs. Token Budget:**
   `--max-bytes` bounds the total UTF-8 JSON serialized payload weight transferred between processes. **It does not manage the LLM's internal token context window**.
5. **Code Point Bounded Previews:**
   Previews are truncated by Unicode code points (300 in previews and context; 500 for focus and 150 for neighbors in timeline), preventing broken multi-byte UTF-8 sequences.
6. **Voluntary Model Compliance:**
   Configuring MCP tools and hooks does not force an LLM to invoke them. AI models are probabilistic and may decline to call tools.
7. **No Guaranteed Save on Abrupt Exit:**
   If a client or terminal process terminates abruptly (`kill -9`, window close), a closing session summary cannot be guaranteed.
8. **No Raw Transcript Ingestion:**
   Engram does not capture full chat transcripts, raw conversation logs, or verbose tool dumps.
9. **No Autonomous Background AI Model:**
   Engram does not run a background LLM; it does not synthesize memories without an explicit user or assistant request.
10. **Manual Hook Approval in Codex (`/hooks`):**
    In Codex, newly installed hooks require explicit user approval via `/hooks`.
11. **Machine-Local Unreplicated Paths:**
    Tables `project_bindings`, `local_session_bindings`, and `local_manual_sessions` are strictly machine-local and never synced to PostgreSQL.
12. **Snapshot Size Limit (8 MiB):**
    Each synchronization snapshot is strictly capped at 8 MiB (`8,388,608 bytes`), halting with `SYNC_TOO_LARGE` if exceeded.
13. **No Heuristic Auto-Merge in Sync:**
    Concurrent modifications to the same entity trigger `SYNC_CONFLICT`. No heuristic three-way text merging is performed in this version.
14. **No Heavy Desktop or Web GUI (Zero Bloated GUI):**
    The Control Center operates exclusively inside the terminal console using standard ANSI/POSIX sequences. It uses no Electron, local HTTP daemons, React views, or browser engines.
15. **No Resident Background Daemon:**
    The Control Center starts strictly on demand via `forge614-engram tui` and terminates completely when exited with `Escape`, `q`, or `Ctrl+C`. It consumes zero CPU cycles or RAM when not running.
16. **No Passive Remote Network Probing:**
    PostgreSQL status inspection in the `Storage` tab reads local `.env` values and the latest sync state recorded in SQLite. It never emits unsolicited network pings or remote probes during passive navigation.
17. **Dedicated Product Home and Centralized Database:**
    Engram maintains its database strictly inside its product home `~/.forge614/engram/engram.db` (rather than the shared parent root `~/.forge614/`). Projects are partitioned logically by immutable `projectId`, avoiding scattering `.db` files across workspace folders.
18. **No Granular Note Content Editing in Control Center:**
    The Control Center manages projects, directory bindings, storage, migrations, and assistants. Authoring and editing granular memory notes is performed via CLI (`save`, `get`, `delete`), MCP tools, or future specialized explorers.
19. **Antigravity Configured as MCP Only:**
    Antigravity is integrated exclusively as *MCP only* (`~/.gemini/config/mcp_config.json`). No automatic hooks are installed (*Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified*).
20. **Windows Native CI Validation, Strengthened Smoke Test, and Addon Bundling:**
    Functional validation on Windows x64 (`Verify`, **Run ID `35427426902`**, commit `f047693b9e27368d104cfc945c0e419af4a1d4b9`), native Node-API C++ addon compilation and standalone embedding (`windows_reparse_guard.node`) into both Windows x64 and ARM64 release binaries, isolated packaged-executable testing outside the repository with a **strengthened smoke test** (requiring all 5 assistants to report status `absent` in an empty profile, failing on any `blocked` status), and cryptographic verification of all 6 release artifacts against `SHA256SUMS` were executed and verified in GitHub Actions (**Release Run ID `35427429725`** and reference run `35428406085`). However, release v1.1.0 retains the following pending distribution items: (1) test execution on a clean physical or virtual Windows machine lacking development tools (no Node.js, Python, or C++ compilers installed previously), (2) certify absence of missing C++ runtime dependencies (*MSVC CRT*), and (3) publish the official release via explicit push of version tag `v1.1.0`.
21. **Discontinuation of Gemini CLI and Protection of Legacy Configurations:**
    Forge614 Engram no longer manages Gemini CLI. It does not read, modify, or delete `~/.gemini/settings.json`, leaving any preexisting file completely untouched.
22. **Official Bootstrap Installers and Public Release Prerequisite:**
    The official bootstrap installation commands (`curl ... scripts/install.sh | bash` and `irm ... scripts/install.ps1 | iex`) are designed to download and verify prebuilt standalone binaries into `~/.forge614/engram/bin/` from a published GitHub Release. This feature delivery (`feat/engram-product-home-migration`) has not published a release or created a `v*` tag; until an official release is published following merge to `main`, remote installation commands depend on existing public release assets.
23. **PATH Configuration and New Terminal Session Requirement:**
    Automatic configuration of executable paths (`~/.forge614/engram/bin/`) in Unix shell dotfiles (Zsh, Bash, Fish) and Windows User PATH via .NET updates environment variables for future shell sessions. Utilizing the `forge614-engram` command directly following installation requires launching a new terminal window (or manually running the printed export/source command).
24. **Irreversible Uninstall and Data Safeguards:**
    The `forge614-engram uninstall` command permanently destroys product home `~/.forge614/engram/` (including the local SQLite database and `.env` secrets). If historical memory preservation is desired, users must make a manual backup of `engram.db` or run `sync` against PostgreSQL prior to uninstalling.
25. **Coexistence with Atlas and Removal Order:**
    If Forge614 Atlas is present (`~/.forge614/atlas/`), Engram cannot be uninstalled in isolation without first uninstalling Atlas due to suite dependencies. The uninstaller requires the extended confirmation phrase `"REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS"` and orchestrates Atlas removal prior to wiping Engram.
26. **Formal Retirement of `setup` in Favor of `init` (`COMMAND_RETIRED`):**
    The `forge614-engram setup` subcommand is permanently retired from the public CLI binary (it does not act as a silent alias). Invocations return the structured error `COMMAND_RETIRED` with exit code 1 (`{"code": "COMMAND_RETIRED", "error": "El comando setup fue retirado. Usa forge614-engram init."}`). Initialization is channeled exclusively through `forge614-engram init` (interactive guided mode in a terminal TTY delegating to `assistantTui`) and `forge614-engram init --json` (headless mode returning JSON without prompts).
27. **Exclusive Ownership of Future Global Command `forge614 init`:**
    The future global command `forge614 init` will belong exclusively to the central orchestrator `forge614-ai` once released. Engram does not implement, expose, or own `forge614 init`.
28. **Atomic Initialization Execution and Safety Invariants in Task 2 (`applyMemoryInitialization`):**
    The `applyMemoryInitialization` SDK function safely applies planned changes with optimistic concurrency verification (`expectedRevision` / `CONFIG_CHANGED`), transient pre-flight PostgreSQL connectivity checks prior to altering local disk, idempotent directory and file permission enforcement (`0700`/`0600`), and permanent additive search reinforcement (never degrading existing reinforcement if false).
29. **Shell Runtime Role (Optional in Daily Work):**
    Forge614 Shell is the official visual onboarding and guided setup environment, but **running Shell is strictly optional during daily work**. External AI clients (ADE Orca, Claude Code, Codex, Antigravity) interact directly with Engram via its local stdio MCP server without requiring Shell to remain open or running in the background.

---

## 3. Evolutionary Roadmap: Official Future Phases

With Phases 1 through 4.4 completed, development is currently in Phase 4.5 (with Tasks 1, 2, and 3 completed), after which subsequent phases will continue:

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
│ [x] Phase 4.2: Reinforced FTS5 Search (No Embeddings)  │ (Completed v0.5.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 4.3: Full TUI Control Center                 │ (Completed v1.0.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [x] Phase 4.4: Product Home, Migration & Uninstaller   │ (Completed v1.1.0)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [/] Phase 4.5: Nonvisual Engine Transition (Ecosystem) │ (In Progress - Tasks 1-3)
│     - [x] Task 1: SDK inspection & safe preview        │
│     - [x] Task 2: Atomic nonvisual execution           │
│     - [x] Task 3: Unified CLI init & --json adapter    │
│     - [ ] Task 4: Decouple to forge614-engines         │
│     - [ ] Task 5: Gradual TUI retirement to Shell      │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Phase 5: Semantic Search & Vector Embeddings       │ (Pending)
│     - Local vector embedding generation                │
│     - Hybrid retrieval (FTS5 BM25 + cosine similarity) │
│     - Adaptive token allocation for context dossiers   │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Phase 6: Interactive Memory Explorer in TUI        │ (Pending)
│     - Interactive memory explorer in terminal          │
│     - Visual topic, version, and session editor        │
│     - Interactive replica conflict reconciliation      │
└────────────────────────────────────────────────────────┘
```

> [!NOTE]
> Consistent with honest engineering guidelines, pending phases are documented as approved technical milestones governed by the ecosystem contract (`FORGE614_ECOSYSTEM_CONTRACT.md`), without artificial deadlines or premature version numbers.
