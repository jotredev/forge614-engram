# Forge614 Engram — Official Documentation (English)

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Verified (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | Strict TypeScript 5.9 | Git available (mandatory for project identity resolution)
> **Standalone Binary:** `forge614-engram` in `$HOME/.local/bin/` (operates autonomously without Bun or Node at runtime)
> **Central User Storage:** `~/.forge614/` (`.env` single global configuration and `engram.db` single database)

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal, local memory system residing in your user directory (`~/.forge614/`), structured internally as a **feature-oriented modular monolith** (separating pure domain rules, application flow coordination, concrete infrastructure adapters, and user/assistant delivery interfaces), designed for your developer coding assistants (Claude Code, Codex, Cursor, OpenCode, and Gemini CLI) and applications to retain durable technical decisions and shared preferences via a native stdio Model Context Protocol (MCP) server featuring 10 tools, progressive memory sessions, ranked context retrieval, Git-based local project bindings, an interactive terminal UI menu (TUI), immutable version history, and an optional direct PostgreSQL replica without cloud intermediaries or hidden subscription fees.

---

## 2. The Real-World Problem It Solves

When developing software alongside artificial intelligence assistants in your daily workflow, several critical continuity problems emerge:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session or context compaction forgets architectural decisions, preferred libraries, or previously investigated bug fixes.
2. **Context bloat and token exhaustion (*Context Window Pollution*):** Ingesting raw multi-thousand-word conversation logs or unranked search dumps saturates LLM context limits and wastes developer budget.
3. **Destructive edits without a trace (*Destructive Overwrites*):** Modifying a prior agreement overwrites the note, destroying technical justification and historical context.
4. **Session disorganization (*Unanchored Decisions*):** Notes are recorded as isolated fragments without knowing which work session, goal, or sequence of steps produced them.
5. **Black-box search engines (*Opaque Scoring*):** Most retrieval tools return snippets without explaining why specific notes ranked higher or which exact terms matched.
6. **Configuration drift across assistants (*Configuration Fragmentation*):** Manually editing MCP server parameters and hooks across five different editors causes subtle syntax errors, broken configs, and credential leaks.
7. **Project and branch ambiguity (*Worktree/Subdirectory Confusion*):** Working in subdirectories or Git linked worktrees often causes assistants to treat them as separate orphan projects.
8. **Device isolation (*Device Siloing*):** Decisions remain trapped on one machine's disk without a private, automated way to mirror them to your other computers.

Forge614 Engram solves this with **a single local SQLite database**, progressive memory sessions, ranked context retrieval with strict byte caps, a native stdio MCP server exposing 10 tools, an interactive terminal configuration dashboard with safe preflight backups and byte verification, canonical Git project resolution, and direct PostgreSQL snapshot synchronization with format promotion.

---

## 3. The Master Analogy: The Meticulous Clerk, the Work Logbook, and the Executive Dossier

Imagine hiring a meticulous office archivist to safeguard knowledge across all your coding projects:

- **The Master Cabinet (`~/.forge614/engram.db`):** The clerk stores all records in a single secure cabinet in your local office with strict private permissions (`0600`). Reads, searches, and sessions always run directly against this cabinet, regardless of network availability.
- **The Work Session Logbook (`sessions` & `session_entries`):** When you begin a task, the clerk opens a dedicated session logbook (`session-start`). Every technical decision or rule recorded during that shift is stamped with its exact sequence, allowing you to reconstruct later what happened before and after (`timeline`).
- **The Executive Dossier (`context` / `memory_context`):** When a new assistant joins or when your memory resets after compaction, the clerk hands over a neatly organized, multi-tab dossier: pinned essential rules (`pinned`), recent project agreements (`recent`), and executive summaries from past work sessions (`summaries`), strictly weighed to fit within your briefcase's carrying capacity (`maxBytes`).
- **Lightweight Index Cards (`MemoryPreview`):** When searching for notes, the clerk first shows concise 300-character index cards with a truncation flag, letting you inspect candidate items before requesting full text cards.
- **The Standardized Service Window (`mcp` via stdio):** In the office wall, the clerk operates a standardized sliding tray implementing the open Model Context Protocol over standard input/output (`stdio`). AI assistants can approach the window, identify themselves, and invoke 10 specialized tools to read, record, summarize, and navigate durable knowledge.
- **The Assistant Connection Dashboard (`tui`):** To connect your assistants safely, the clerk provides an interactive terminal board. Using arrow keys and the spacebar, you select your tools, inspect proposed configuration changes, trigger an async server self-test, and apply settings with private backups and post-publication byte verification.
- **The Git Identity Tracker (`project_bindings` and Git):** When an assistant calls from a folder or linked worktree, the clerk checks the Git common root directory (`--git-common-dir`). On the first save, it binds the local folder and creates the project atomically. If paths are unresolvable or missing, the clerk conservatively halts to prevent misattribution.
- **The Shared Tray (`scope: "shared"`):** At the top sits a universal tray for global rules (e.g., *"I prefer explanations in English"*). To file a note here, the assistant must explicitly explain its global intent (`globalIntent`).
- **The Topic Exception Rule (*Topic Override*):** If universal policy specifies *"Use Bun as default runtime"*, but an active project note with the exact same topic states *"Use Node.js 20 LTS for this project"*, the clerk delivers the project's exception and suppresses the shared rule.
- **The Version Audit Binder:** When updating a topic (`--topic`), the clerk never shreds the existing card: they snapshot the prior version, store it in the immutable history ledger, and file the revision in front.
- **The Secure Courier Pouch (PostgreSQL Sync & Format 2 Promotion):** If PostgreSQL replication is enabled, the clerk prepares a sealed snapshot pouch. Running `sync` or `sync-watch` performs a deterministic 3-way merge across base, local, and remote states. Upgrading the replica to Format 2 (syncing sessions and summaries) is performed via an explicit, atomic CAS-protected upgrade (`sync --upgrade-format`).

---

## 4. Fundamental Design Principles

- **SQLite & FTS5 are ALWAYS Local:** PostgreSQL never replaces SQLite or local search. All `save`, `get`, `search`, `history`, `timeline`, `context`, and session operations run synchronously against `engram.db`.
- **Progressive Memory Sessions (Schema 6):** Structured work sessions (`kind: "runtime"` or local manual fallbacks), session-bound entries, and 6-field structured session summaries under reserved immutable topics (`session/<id>/summary`). Explicit migration via `sessions-enable`.
- **Ranked Context Retrieval:** Assembles prioritized context partitioned into `pinned`, `recent`, and `summaries`. Truncation and omission metrics are reported cleanly.
- **Unicode Code Point and UTF-8 Byte Caps (Not Token Budgets):** Previews are bounded in Unicode code points (300 for search/context; 500 for focus and 150 for neighbors in timeline). The `--max-bytes` parameter strictly bounds total serialized UTF-8 JSON bytes (1024..65536, default 16384). Neither is an LLM token budget.
- **Ten Native MCP Tools:** Exposes `memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, and `memory_timeline`.
- **Stdio MCP Server with Clean Output:** The `mcp` command strictly reserves standard output (`stdout`) for JSON-RPC messages. It never emits ANSI escapes or human logs that would break client protocol parsing.
- **Interactive TUI with Preflight, Backups, and Conflict Protection:** The `tui` command provides keyboard navigation, multi-assistant selection, a 5-second async MCP self-test, zero-write preview, explicit confirmation, `0600` private backups with UUID suffixes, and post-publication byte verification. In OpenCode, existing divergent plugins are treated as `CONFLICT` and never blindly overwritten.
- **Detected vs Configured vs Tested Session:** The system honestly distinguishes an installed binary, written configuration files, and a verified live client session. "Configured does NOT mean connected"—client sessions remain unverified until tested inside each application.
- **Local Machine Project Bindings (`project_bindings` in Schema 5):** Each machine maintains its own mapping between filesystem directories and `projectId` values. Linked worktrees share common Git identity. Local filesystem paths are never synchronized across machines.
- **Autonomous Compiled Binary:** Packaged as a standalone native binary (`forge614-engram`) in `$HOME/.local/bin/`. Does not require Bun or Node in PATH for daily operation.
- **Direct & Optional PostgreSQL Sync with Format 2 Promotion:** Employs 3-way snapshot merge, an 8 MiB size limit, and CAS optimistic locking on PostgreSQL. Formats 1 and 2 are promoted exclusively via `sync --upgrade-format`.
- **Strict File Permissions:** Storage directory `0700`, files `.env` and `engram.db` in `0600`. Assistant configs and backups written in `0600`. Insecure symlinks are rejected.
- **Design Lineage and Attribution:** Progressive lookup, preview, and timeline behavior is Gentleman-inspired; UUID identity, explicit/manual per-device sessions, local bindings, and sync promotion are Forge614 adaptations.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Build requirements (Bun >=1.3.8, mandatory Git), dependencies via `bun install --frozen-lockfile --ignore-scripts`, install script, standalone executable, interactive `setup`, assistant discovery, `integration-enable`, `sessions-enable`, peer device coordination, and `sync --upgrade-format`.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): Complete lifecycle: `tui` menu, 5-second server self-test, preview and confirmation, manual project binding (`project-bind`), AI assistant MCP usage across 10 tools, session inference scenarios, progressive previews, timeline, context retrieval, safe OpenCode plugin conflict resolution, and PostgreSQL replication.
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Detailed command reference (`setup`, `tui`, `mcp`, `assistant-list`, `integration-enable`, `sessions-enable`, `project-bind`, `memory-hook`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `sync`, `sync-watch`) with flags, exit codes, and JSON schemas.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): TypeScript SDK guide: stable public exports from `src/index.ts`, compatible `MemoryStore` facade in `app/`, removal of deprecated deep internal imports, and synchronous local engine architecture.
5. [**05. Internal Architecture, Modular Monolith, and Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): Feature-oriented modular monolith (`app`, `modules`, `infrastructure`, `interfaces`, `shared`), import rules and AST auditor, before/after mapping, composite transactions in `writes.ts`, change placement guide, colocated tests (369 tests across 69 files), and BM25 recency ranking formulas.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Comprehensive error catalog (`MIGRATION_REQUIRED`, `AMBIGUOUS_SESSION`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `NO_SESSION_CONTEXT`, `CONFLICT`, `INTERACTIVE_REQUIRED`, `PROJECT_IDENTITY_UNAVAILABLE`, `PROJECT_BINDING_REQUIRED`, `PUBLISHED_UNVERIFIED`, `SYNC_CONFLICT`, `SYNC_TOO_LARGE`, etc.) with root causes and recovery steps.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday definitions with real-world analogies and formal technical terms in parentheses.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Consolidated delivery features (Phases 1 to 4), active boundaries (voluntary model compliance, synthetic fixtures vs real sessions, 8 MiB limit, byte budget vs token budget), and the remaining roadmap phases (Semantic Search / Embeddings and Memory TUI Explorer).
