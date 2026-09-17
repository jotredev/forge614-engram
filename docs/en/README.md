# Forge614 Engram — Official Documentation (English)

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Verified (90 total tests: 86 passed and 4 skipped without PostgreSQL test binaries; 90 passed, 0 failures, 645 assertions with isolated PostgreSQL 17.6 on macOS with Bun 1.3.8)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | SQLite (`bun:sqlite` with local FTS5 trigram) | Strict TypeScript 5.9
> **Standalone Binary:** `forge614-engram` in `$HOME/.local/bin/` (does not require Bun in PATH for daily execution)
> **Central User Storage:** `~/.forge614/` (`.env` single global configuration and `engram.db` single database)

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal local memory notebook stored in your user directory (`~/.forge614/`), designed for artificial intelligence assistants and applications to remember project decisions and universal preferences over time, maintaining an immutable version audit tree, an explainable SQLite FTS5 search engine that operates 100% locally, and an optional direct PostgreSQL replica to back up and share your entire workspace across machines without token costs or third-party cloud servers.

---

## 2. The Real-World Problem It Solves

When interacting with artificial intelligence assistants or developer tools, five persistent challenges arise:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session forgets which database you chose, your preferred coding conventions, or past architecture agreements.
2. **Destructive edits without a trace (*Destructive Overwrites*):** When modifying an important decision, conventional tools overwrite the previous note, destroying the context and rationale behind the change.
3. **Black-box search engines (*Opaque Scoring*):** Most retrieval systems return notes without explaining why they selected that data or which specific words matched.
4. **Duplication of universal preferences (*Preference Fragmentation*):** If you have a general preference (e.g. *"I prefer explanations in English"* or *"Use Bun as default runtime"*), you previously had to duplicate it across every individual project.
5. **Isolation across multiple devices (*Device Siloing*):** When switching between your laptop and workstation, architectural decisions remained trapped on a single disk without a secure, private way to sync them.

Forge614 Engram solves this with **a single database and a single configuration file** across all projects, cleanly separating project-specific decisions from shared universal rules, backed by explainable local mathematical ranking, strict revision control, and optional direct PostgreSQL synchronization via full workspace snapshots.

---

## 3. The Master Analogy: The Meticulous Clerk with a Master Cabinet and Secure Courier

Imagine hiring a meticulous office archivist to manage knowledge across all your projects:

- **The Master Cabinet (`~/.forge614/engram.db`):** The clerk stores all documents in a single secure cabinet in your local office. No scattered folders or separate databases across your drive. Reading and searching always happen locally at this cabinet, with or without an active network connection.
- **The Project Drawers (`projectId`):** Each registered project receives a stable, permanent credential (a unique UUIDv4 `projectId`). Its private memories are placed inside its drawer and never leak into other projects.
- **The Shared Tray (`scope: "shared"`):** At the top of the cabinet sits a shared tray for universal guidelines (e.g., *"I prefer explanations in English"*). This note is written once and guides all projects without duplicating storage.
- **The Topic Exception Rule (*Topic Override*):** If company-wide policy says *"Use Bun as default runtime"*, but your specific project stores an active note with the exact same topic saying *"Use Node.js for project compatibility"*, the clerk delivers the project's exception and suppresses the shared policy. If you later archive the project's exception, the shared rule automatically reappears.
- **The Version Audit Binder:** When updating a topic (`--topic`), the clerk never shreds the old note: they file a dated snapshot into the immutable history binder and place the new version in front.
- **The Idempotency Stamp:** If a script attempts to deliver the exact same note twice using the same dispatch key (`--request-key`), the clerk checks the ledger, recognizes the stamp, and returns the existing note without creating duplicates.
- **The Trigram Index & Blackboard:** When searching, the clerk scans a rapid three-letter index and delivers matching cards, writing the exact ranking formula (BM25, pinned priority, and recency decay) on the board.
- **The Secure Courier Pouch (Optional PostgreSQL Sync):** If you enable PostgreSQL synchronization, the clerk prepares a sealed pouch containing a complete snapshot of the master cabinet (all projects, shared memories, versions, requests, and events). During synchronization (`sync` or `sync-watch`), the clerk compares three snapshots (last agreed baseline, local state, and remote replica) and merges non-conflicting changes cleanly. If the remote database is unreachable or offline, the clerk continues saving and searching locally without delay.

---

## 4. Fundamental Design Principles

- **SQLite & FTS5 are ALWAYS Local:** PostgreSQL does not replace SQLite or its full-text search engine. All `save`, `get`, `search`, `history`, and `archive`/`restore` commands run synchronously and locally against `engram.db`. If PostgreSQL goes offline, local memory operations remain 100% functional without blocking.
- **Single Global Configuration and Database:** Everything lives in `~/.forge614/` with one private `.env` file and one SQLite database (`engram.db`), regardless of which working directory you run from.
- **Direct & Optional PostgreSQL Sync:** There is no proprietary cloud backend or hosted middleware. The connection is direct from your machine to your designated PostgreSQL database using a secure connection string.
- **User-Friendly Setup with Exact Choices:** The interactive `setup` wizard offers exactly two choices: `No` (default) and `Sí, configurar PostgreSQL`. It avoids misleading terms like "remote" or "Cloud". Connection URLs are accepted via hidden terminal input to protect credentials.
- **Full Workspace Scope:** Synchronization is not configured per project. When enabled, it replicates the entire workspace: all registered projects, shared universal memories, version snapshots, request keys, and audit events.
- **Deterministic 3-Way Snapshot Merge:** Reconciliation compares the base checkpoint, the local snapshot, and the remote snapshot. Changes on independent entities merge cleanly. Incompatible concurrent edits on the same entity trigger a controlled `SYNC_CONFLICT` error, halting the round without altering or corrupting either database.
- **Strict Safety Limit (8 MiB):** Full snapshots are constrained to a strict 8 MiB limit (`SYNC_TOO_LARGE`) to safeguard memory consumption and transmission stability in this release.
- **Foreground Watcher Without Background Daemons (`sync-watch`):** The `sync-watch` command runs an immediate round and retries periodically while kept open in your terminal (default 30 seconds). It does not install OS services, cron jobs, or background daemons. Exiting via `Ctrl+C` (exit code 130) leaves local changes safely stored in SQLite for the next sync.
- **Stable Project Identity (`projectId`):** Projects are registered in the `projects` table with a lowercase UUIDv4 `projectId`. The display name is purely cosmetic; renaming a project never alters identity, history, or access to memories.
- **Two Memory Scopes (`scope`):**
  - `project`: Private decisions belonging strictly to a project (requires `--project-id`).
  - `shared`: Universal preferences applying across all projects (stored once with null `projectId`).
- **Combined Search with Smart Topic Overrides:** Searching from a project (`search --project-id <UUID>`) defaults to `--scope all`, returning project memories plus shared memories. If a project defines an active memory with the identical `topicKey` as a shared note, the project decision overrides the shared rule.
- **100% Local, Private, Zero Network Cost:** Requires no external API keys, sends zero data to third parties, consumes zero LLM tokens in this stage, and contains no telemetry.
- **Autonomous Compiled Executable:** Packaged as a standalone native binary (`forge614-engram`) in `$HOME/.local/bin/`. Does not require Bun or Node in PATH for everyday usage.
- **Strict Security & Permissions:** Directory mode `0700` and files mode `0600`. Symlinks, hard links, and foreign file owners are rejected before opening SQLite. For PostgreSQL, TLS with valid certificates is strictly enforced outside loopback (localhost).
- **No Destructive Erasure:** Notes are retired using `archive` to hide them from active searches, remaining intact for auditing or restoration (`restore`).
- **Manual/Programmatic Operation:** Saves only on explicit command (`save`). Automated assistant integration via `memory_save` is scheduled for subsequent roadmap stages.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Compiling with Bun, PATH configuration, interactive onboarding with `setup` (including optional PostgreSQL sync), scriptable initialization with `init`, registering projects, and first saves.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): End-to-end lifecycle tutorial: interactive setup (`setup`), project creation, saves, combined search, topic overrides, on-demand synchronization (`sync`), and foreground continuous sync (`sync-watch`).
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Exhaustive command reference (`setup`, `init`, `sync`, `sync-watch`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`) with exact syntax, exit codes, and output modes.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): Programmatic integration using synchronous `MemoryWorkspace`, `runSetup`, `WorkspaceConfig`, and `MemoryStore`, explaining internal sync infrastructure.
5. [**05. Internal Architecture, FTS5, and Ranking Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): SQLite schemas v3/v4 (`sync_checkpoints`), PostgreSQL schema `forge614_sync` (`revisions`, `state`, CAS locking), 3-way snapshot reconciliation protocol, 8 MiB limit, trigram tokenizer, and BM25 ranking.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Error code reference table for local and synchronization diagnostics (`SYNC_DISABLED`, `SYNC_CONFLICT`, `SYNC_LOCAL_CHANGED`, `SYNC_REMOTE_CHANGED`, `SYNC_INVALID`, `SYNC_TOO_LARGE`, `POSTGRES_URL`, `POSTGRES_UNAVAILABLE`, `POSTGRES_UNINITIALIZED`, `POSTGRES_SCHEMA`, `CONFIG_BUSY`, `CONFIG_CHANGED`, etc.) with root causes and fixes.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday explanations of technical terms with formal names in parentheses.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Verified delivery features, active boundaries (full snapshot costs, absence of automated conflict resolution), approved future assistant policy, and the 3-phase pending backlog.
