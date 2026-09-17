# Forge614 Engram — Official Documentation (English)

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Verified (191 total tests across 16 files: 187 passed and 4 skipped without PostgreSQL test binaries; 191 passed, 0 failures, 1133 assertions with isolated PostgreSQL on macOS with Bun 1.3.8)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | Strict TypeScript 5.9 | Git available (mandatory for project identity resolution)
> **Standalone Binary:** `forge614-engram` in `$HOME/.local/bin/` (operates autonomously without Bun or Node at runtime)
> **Central User Storage:** `~/.forge614/` (`.env` single global configuration and `engram.db` single database)

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal, local memory system residing in your user directory (`~/.forge614/`), designed for your developer coding assistants (Claude Code, Codex, Cursor, OpenCode, and Gemini CLI) and applications to retain durable technical decisions and shared preferences via a native stdio Model Context Protocol (MCP) server, featuring Git-based local project bindings, an interactive terminal UI menu (TUI), immutable version history, and an optional direct PostgreSQL replica without cloud intermediaries or hidden subscription fees.

---

## 2. The Real-World Problem It Solves

When developing software alongside artificial intelligence assistants in your daily workflow, several critical continuity problems emerge:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session or context compaction forgets architectural decisions, preferred libraries, or previously investigated bug fixes.
2. **Destructive edits without a trace (*Destructive Overwrites*):** Modifying a prior agreement overwrites the note, destroying technical justification and historical context.
3. **Black-box search engines (*Opaque Scoring*):** Most retrieval tools return snippets without explaining why specific notes ranked higher or which exact terms matched.
4. **Configuration drift across assistants (*Configuration Fragmentation*):** Manually editing MCP server parameters and hooks across five different editors causes subtle syntax errors, broken configs, and credential leaks.
5. **Project and branch ambiguity (*Worktree/Subdirectory Confusion*):** Working in subdirectories or Git linked worktrees often causes assistants to treat them as separate orphan projects.
6. **Device isolation (*Device Siloing*):** Decisions remain trapped on one machine's disk without a private, automated way to mirror them to your other computers.

Forge614 Engram solves this with **a single local SQLite database**, a native stdio MCP server, an interactive terminal configuration dashboard with safe preflight backups and byte verification, canonical Git project resolution, and direct PostgreSQL snapshot synchronization.

---

## 3. The Master Analogy: The Meticulous Clerk, the MCP Window, and the Interactive Dashboard

Imagine hiring a meticulous office archivist to safeguard knowledge across all your coding projects:

- **The Master Cabinet (`~/.forge614/engram.db`):** The clerk stores all records in a single secure cabinet in your local office with strict private permissions (`0600`). Reads and searches always run directly against this cabinet, regardless of network availability.
- **The Standardized Service Window (`mcp` via stdio):** In the office wall, the clerk operates a standardized sliding tray implementing the open Model Context Protocol over standard input/output (`stdio`). AI assistants can approach the window, identify themselves, and invoke five specific tools to read and record durable knowledge.
- **The Assistant Connection Dashboard (`tui`):** To connect your assistants safely, the clerk provides an interactive terminal board. Using arrow keys and the spacebar, you select your tools, inspect proposed configuration changes, trigger an async server self-test, and apply settings with private backups and post-publication byte verification.
- **The Git Identity Tracker (`project_bindings` and Git):** When an assistant calls from a folder or linked worktree, the clerk checks the Git common root directory (`--git-common-dir`). On the first save, it binds the local folder and creates the project atomically. If paths are unresolvable or missing, the clerk conservatively halts to prevent misattribution.
- **The Shared Tray (`scope: "shared"`):** At the top sits a universal tray for global rules (e.g., *"I prefer explanations in English"*). To file a note here, the assistant must explicitly explain its global intent (`globalIntent`).
- **The Topic Exception Rule (*Topic Override*):** If universal policy specifies *"Use Bun as default runtime"*, but an active project note with the exact same topic states *"Use Node.js 20 LTS for this project"*, the clerk delivers the project's exception and suppresses the shared rule.
- **The Version Audit Binder:** When updating a topic (`--topic`), the clerk never shreds the existing card: they snapshot the prior version, store it in the immutable history ledger, and file the revision in front.
- **The Secure Courier Pouch (Optional PostgreSQL Sync):** If PostgreSQL replication is enabled, the clerk prepares a sealed snapshot pouch. Running `sync` or `sync-watch` performs a deterministic 3-way merge across base, local, and remote states. If the remote database goes offline, local reading and saving continue without interruption.

---

## 4. Fundamental Design Principles

- **SQLite & FTS5 are ALWAYS Local:** PostgreSQL never replaces SQLite or local search. All `save`, `get`, `search`, `history`, and `archive`/`restore` calls run synchronously against `engram.db`.
- **Stdio MCP Server with Clean Output:** The `mcp` command strictly reserves standard output (`stdout`) for JSON-RPC messages. It never emits ANSI escapes or human logs that would break client protocol parsing.
- **Five Native MCP Tools:** Exposes `memory_current_project`, `memory_search`, `memory_get`, `memory_save`, and `memory_history`. Models are instructed to search before re-investigating and to summarize durable procedures before session close.
- **Interactive TUI with Preflight and Backups:** The `tui` command provides keyboard navigation, multi-assistant selection, a 5-second async MCP self-test, zero-write preview, explicit confirmation, `0600` private backups with UUID suffixes, and post-publication byte verification (`PUBLISHED_UNVERIFIED` if external processes interfere).
- **Detected vs Configured vs Tested Session:** The system honestly distinguishes an installed binary, written configuration files, and a verified live client session. "Configured does NOT mean connected"—client sessions remain unverified until tested inside each application.
- **Local Machine Project Bindings (`project_bindings` in Schema 5):** Each machine maintains its own mapping between filesystem directories and `projectId` values. Linked worktrees share common Git identity. Local filesystem paths are never synchronized across machines.
- **Conservative Blocking on Path Ambiguity:** If all recorded paths for any project are missing or uncheckable on disk, automatic project creation halts with `PROJECT_BINDING_REQUIRED` to avoid creating duplicate orphan projects.
- **Native Context Guidance via Hooks:** Injects guidance reminders into compatible clients (Claude Code, Codex, Cursor, OpenCode, Gemini CLI), respecting user policies and highlighting trust steps (such as `/hooks` approval in Codex).
- **Autonomous Compiled Binary:** Packaged as a standalone native binary (`forge614-engram`) in `$HOME/.local/bin/`. Does not require Bun or Node in PATH for daily operation.
- **Git Mandatory for Project Identity:** Git is required both to inspect repositories and to securely verify that a directory does not belong to Git. Missing Git fails closed with `PROJECT_IDENTITY_UNAVAILABLE`.
- **Direct & Optional PostgreSQL Sync:** No hosted cloud intermediaries. Employs 3-way snapshot merge, an 8 MiB size limit, and CAS optimistic locking on PostgreSQL. `sync-watch` runs in the foreground without system daemons.
- **Strict File Permissions:** Storage directory `0700`, files `.env` and `engram.db` in `0600`. Assistant configs and backups written in `0600`. Insecure symlinks are rejected.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Build requirements (Bun >=1.3.8, mandatory Git), dependencies via `bun install --frozen-lockfile --ignore-scripts`, install script, standalone executable, interactive `setup`, assistant discovery, and `integration-enable`.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): Complete lifecycle: `tui` menu, 5-second server self-test, preview and confirmation, manual project binding (`project-bind`), AI assistant MCP usage, native hooks, and PostgreSQL replication.
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Detailed command reference (`setup`, `tui`, `mcp`, `assistant-list`, `integration-enable`, `project-bind`, `memory-hook`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`, `sync`, `sync-watch`) with flags, exit codes, and JSON schemas.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): Programmatic integration using synchronous `MemoryWorkspace` and `MemoryStore` with Schema 5 (`enableAssistantIntegration`, `bindProjectDirectory`, `resolveProjectDirectory`, `saveForProjectDirectory`) and internal module boundaries.
5. [**05. Internal Architecture, MCP Protocol, and Ranking Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): SQLite Schema 5 (`project_bindings`), Git resolution and worktrees, MCP protocol (5 tools and Zod schemas), client adapters (`0600`/UUID backups), 3-way snapshot sync, and BM25 ranking formulas.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Comprehensive error catalog (`INTERACTIVE_REQUIRED`, `PROJECT_IDENTITY_UNAVAILABLE`, `PROJECT_BINDING_REQUIRED`, `PUBLISHED_UNVERIFIED`, `SYNC_CONFLICT`, `SYNC_TOO_LARGE`, etc.) with root causes and recovery steps.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday definitions with real-world analogies and formal technical terms in parentheses.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Consolidated delivery features (Phases 1, 2, and 3), active boundaries (voluntary model compliance, synthetic fixtures vs real sessions, 8 MiB limit), and the 2 remaining roadmap phases.
