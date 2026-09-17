# 08 (EN). Stage Boundaries and Evolutionary Roadmap

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Verified (191 total tests across 16 files: 187 passed and 4 skipped without PostgreSQL test binaries; 191 passed, 0 failures, 1133 assertions with isolated PostgreSQL on macOS with Bun 1.3.8)
> **Sister translation:** [08. Límites de la Etapa y Hoja de Ruta Futura](../es/08-limites-y-roadmap.md)

This document declares with absolute transparency which capabilities are fully implemented and verified in version 0.5.0, current operational and technical boundaries, the distinction between synthetic test fixtures and live assistant sessions, and the official roadmap for the 2 remaining development phases.

---

## 1. Verified & Completed Capabilities (Version 0.5.0)

The following roadmap phases are **100% implemented and verified**:

### Phase 1: Interactive Onboarding Setup Assistant (`setup`) — COMPLETED
- [x] Step-by-step console guide for interactive terminals (`stdin` and `stdout` TTY).
- [x] Central user storage paths: `~/.forge614/.env` and `~/.forge614/engram.db`.
- [x] Exact synchronization choices: `No` (default) and `Sí, configurar PostgreSQL`.
- [x] Confidential PostgreSQL URL prompt via hidden input (`{ secret: true }`).
- [x] Explicit confirmation before writing and standard exit code `130` on cancellation.
- [x] Safe rejection of non-interactive environments with `INTERACTIVE_REQUIRED`.
- [x] Zero project prompts during global configuration.

### Phase 2: Direct & Optional PostgreSQL Synchronization (`sync` / `sync-watch`) — COMPLETED
- [x] Direct workspace replication to PostgreSQL without cloud vendors.
- [x] Commands `sync` (single on-demand round in JSON) and `sync-watch` (foreground watcher with configurable interval).
- [x] Offline resilience: SQLite and FTS5 remain 100% local; PostgreSQL downtime never degrades local operations.
- [x] Additive Schema 4 migration in SQLite (`sync_checkpoints`).
- [x] Dedicated `forge614_sync` PostgreSQL schema with `revisions` (SHA-256 hash) and `state` (CAS optimistic locking).
- [x] Deterministic 3-way snapshot merge with conflict detection (`SYNC_CONFLICT`) and 8 MiB limit (`SYNC_TOO_LARGE`).

### Phase 3: Local MCP Server & Assistant TUI Menu — COMPLETED
- [x] **Native stdio MCP Server (`forge614-engram mcp`):** Built on the official MCP SDK, reserving `stdout` strictly for JSON-RPC messages without ANSI escapes or human logs.
- [x] **Five Native MCP Memory Tools:** `memory_current_project`, `memory_search`, `memory_get`, `memory_save`, and `memory_history`.
- [x] **Interactive Terminal UI Menu (`forge614-engram tui`):** Arrow navigation, Space selection, rescan with `r`, custom paths with `c`, zero-write preview, explicit confirmation, and exit code `130`.
- [x] **Asynchronous MCP Server Self-Test:** Official SDK handshake against the installed binary, validating server identity and the 5 tools within a 5-second deadline, with clean `Escape` cancellation.
- [x] **Safe Adapters for 5 Clients:** Claude Code, Codex, Cursor, OpenCode, and Gemini CLI.
- [x] **Client Configuration Safety:** `0600` permissions, UUID-suffixed exact backups, comment preservation (JSONC/TOML), preflight checks, and post-publication byte verification (`PUBLISHED_UNVERIFIED` on concurrent interference).
- [x] **Additive Schema 5 Migration in SQLite:** `project_bindings` table mapping local directory paths to `projectId` independently per device.
- [x] **Canonical Git Project Resolution:** Uses `git rev-parse --path-format=absolute --git-common-dir` to unify linked worktrees and subdirectories under the same project identity.
- [x] **Conservative Unknown Directory Blocking:** If any recorded binding in `project_bindings` is missing from disk, resolution halts with `PROJECT_BINDING_REQUIRED` to avoid creating orphan duplicate projects.
- [x] **Native Context Hooks (`memory-hook`):** Adapter emitting contextual reminders upon session start or prompt submission without writing memories directly.
- [x] **Autonomous Standalone Binary:** Native compiled executable operating without Bun or Node in PATH. Mandatory Git requirement for identity resolution.

---

## 2. Active Technical Boundaries and Current Limits

To maintain realistic expectations, the following boundaries remain active:

1. **Voluntary AI Model Compliance:**
   Configuring MCP tools and hooks does not guarantee that a language model will invoke memory tools or record summaries. LLMs are probabilistic and may choose to omit tool calls at their own discretion.
2. **No Guaranteed Save on Abrupt Session Close:**
   If a client process is killed abruptly (`kill -9`, power loss, or forced window close), the assistant cannot be guaranteed to execute a final procedure summary save.
3. **No Conversation Transcript Capture:**
   Engram does not capture full transcripts, raw prompts, debug logs, or massive tool outputs. It is strictly engineered for curated, durable knowledge.
4. **No Autonomous Background LLM:**
   Engram does not run an autonomous background language model. It never synthesizes notes on its own without an explicit tool call.
5. **No Infinite Loop Stop Hooks:**
   Engram does not install continuous background interceptors interfering with client runtime loops.
6. **Codex Manual Trust Policy (`/hooks`):**
   In Codex, newly installed hooks do not execute automatically: **the user must open Codex and trust them explicitly via `/hooks`**.
7. **Synthetic Fixtures vs Live Assistant Sessions:**
   The automated test suite verifies protocol compliance using synthetic fixtures, real PTY (`/usr/bin/expect`), and official SDK harnesses. However, live human sessions inside the 5 editors depend on application runtime behaviors and must be verified inside each client.
8. **Configured Does Not Mean Connected:**
   The TUI and `assistant-list` clearly separate detected binaries and written configurations from tested sessions. Until tested inside each application, client sessions are considered unverified.
9. **Machine-Local Bindings:**
   The `project_bindings` table is strictly local. Cross-machine clones preserve project UUIDs via PostgreSQL sync, but require explicit linking using `project-bind`.
10. **Recreated Old Paths:**
    Recreating an old path alone cannot distinguish a moved folder without explicit manual binding.
11. **8 MiB Snapshot Limit:**
    Snapshots are constrained to 8 MiB (`SYNC_TOO_LARGE`).
12. **No Automated Conflict Resolution in Sync:**
    Concurrent incompatible edits trigger `SYNC_CONFLICT`.
13. **`sync-watch` in Foreground:**
    No background OS daemons (*systemd*, *launchd*) are installed.
14. **BM25 Trigram Literal Matching:**
    Retrieval relies on exact character trigram matches in SQLite FTS5; it does not perform semantic embedding vector searches.

---

## 3. Evolutionary Roadmap: The 2 Remaining Phases

With **Phase 1 (Interactive Setup)**, **Phase 2 (PostgreSQL Sync)**, and **Phase 3 (Local MCP & Assistant TUI Menu)** completed, future development focuses on the following 2 phases:

```text
┌────────────────────────────────────────────────────────┐
│ [x] Phase 1: Interactive Onboarding Setup Assistant    │ (Completed v0.3.0)
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
│ [ ] Phase 4: Semantic Search & Advanced Weighting      │ (Pending)
│     - Local vector embedding generation (SLM)          │
│     - Hybrid search (FTS5 BM25 + cosine similarity)    │
│     - Context token window budgeting                   │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ [ ] Phase 5: Full Terminal Memory Management UI (TUI)  │ (Pending)
│     - Interactive memory browser & editor in terminal  │
│     - Visual topic & version inspection                │
│     - Interactive conflict resolution for sync replicas │
└────────────────────────────────────────────────────────┘
```

### Details of Pending Phases:

1. **Phase 4: Semantic Search & Vector Embeddings**
   - Embed a local small language model (SLM) for vector generation without external cloud dependencies.
   - Hybrid ranking combining trigram BM25 lexical precision with semantic cosine similarity.
   - Dynamic context budgeting tailored to the client's available token window.
2. **Phase 5: Full Terminal Memory Management UI**
   - An interactive terminal explorer to browse, filter, edit, and archive memories directly.
   - A visual 3-way diff tool for manually resolving `SYNC_CONFLICT` situations between PostgreSQL replicas.
