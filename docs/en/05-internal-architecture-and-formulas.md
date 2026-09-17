# 05 (EN). Internal Architecture, MCP Protocol, FTS5, and Ranking Formulas

> **Stage:** Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (Verified with 250 tests across 18 files on macOS with Bun 1.3.8)
> **Sister translation:** [05. Arquitectura Interna, Protocolo MCP, SQLite FTS5 y Fórmulas Matemáticas](../es/05-arquitectura-interna-y-formulas.md)

This document provides a technical thesis on the internal architecture of Forge614 Engram: SQLite engine pragmas, relational schemas v3 to v6, progressive session lifecycles, Git canonical identity resolution, the stdio MCP server exposing 10 tools, Format 2 PostgreSQL replication with atomic CAS promotion, and mathematical formulas for BM25, recency ranking, and payload byte budgets.

---

## 1. SQLite Engine Pragmas, Concurrency, and WAL Initialization

Forge614 Engram executes over Bun's embedded SQLite engine (`bun:sqlite`), initialized with strict operational directives:

1. **`PRAGMA foreign_keys = ON;`**
   Enforces absolute referential integrity. Historical versions, events, sessions, entries, and summaries require valid foreign keys.
2. **`PRAGMA busy_timeout = 5000;`**
   If two processes attempt concurrent writes, SQLite waits **up to 5,000 ms (5 seconds)** for the active transaction to commit before raising a busy error.
3. **`PRAGMA application_id = 1177956660;`**
   Unique application identifier verified before interacting with any SQLite database file.
4. **`PRAGMA user_version = 3`, `4`, `5`, or `6`;**
   - **Version 3:** Pure local storage without sync or assistant bindings.
   - **Version 4:** Storage with PostgreSQL sync enabled (adds `sync_checkpoints`).
   - **Version 5:** Storage with assistant integration and local bindings (adds `project_bindings`).
   - **Version 6:** Storage with progressive memory sessions and ranked context (adds `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, `local_manual_sessions`).
   - **Golden Rule of Opening:** Standard database opens (`workspace.open()`), standard queries, and MCP startup **never auto-migrate the database**. Schema promotions are strictly additive and explicit (`setup`, `tui`, `integration-enable`, `sessions-enable`).
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Readers do not block writers and writers do not block readers.
   - Cold read-only queries on macOS are ensured by executing an immediate empty transaction (`BEGIN IMMEDIATE; COMMIT;`) upon database creation.

---

## 2. SQLite Relational Schema (Schemas 3 to 6)

```text
┌─────────────────────────────────┐
│            projects             │
│   (Global Project Identity)     │
├─────────────────────────────────┤
│ projectId TEXT (PK UUIDv4)      │◄──┐
│ name TEXT (Non-empty)           │   │
│ createdAt / updatedAt           │   │
└─────────────────────────────────┘   │
                 ▲                    │
                 │ Foreign Key        │
┌────────────────┴────────────────┐   │   ┌─────────────────────────────────┐
│            memories             │   │   │         memory_versions         │
├─────────────────────────────────┤   │   ├─────────────────────────────────┤
│ rowid INTEGER (Internal PK)     │   │   │ memory_id TEXT (FK memories.id) │◄──┐
│ id TEXT (Unique UUID)           │◄──┼───┤ version INTEGER (>= 1)          │   │
│ projectId TEXT (FK nullable)    ├───┘   │ snapshot TEXT (Valid JSON)      │   │
│ scope TEXT ('project'|'shared') │       └─────────────────────────────────┘   │
│ topic_key TEXT (Optional)       │                         ▲                   │
│ type TEXT (Category)            │                         │                   │
│ title / content TEXT            │       ┌─────────────────┴───────────────┐   │
│ pinned INTEGER (0 or 1)         │       │            requests             │   │
│ version INTEGER (>= 1)          │       ├─────────────────────────────────┤   │
│ state ('active'|'archived')     │       │ projectId TEXT (FK nullable)    ├───┤
│ created_at / updated_at         │       │ scope TEXT ('project'|'shared') │   │
└─────────────────────────────────┘       │ request_key TEXT (Non-empty)    │   │
                 ▲                        │ payload_hash TEXT (SHA-256)     │   │
                 │                        │ memory_id, version (FK) ────────┼───┘
┌────────────────┴────────────────┐       └─────────────────────────────────┘
│             events              │
├─────────────────────────────────┤       ┌─────────────────────────────────┐
│ id INTEGER (PK autoincrement)   │       │          memories_fts           │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ memory_id TEXT (FK memories.id) │       │ Virtual FTS5 Table (trigram)    │
│ action ('save'|'archive'|'rest')│       │ title (5.0), topic_key (3.0),   │
│ version INTEGER                 │       │ content (1.0)                   │
│ created_at TIMESTAMP            │       └─────────────────────────────────┘
└─────────────────────────────────┘
                 ▲
                 │ (Schema 4 - Replication Migration)
┌────────────────┴────────────────┐
│        sync_checkpoints         │
├─────────────────────────────────┤
│ replica TEXT PRIMARY KEY        │
│ snapshot TEXT (Valid JSON)      │
└─────────────────────────────────┘
                 ▲
                 │ (Schema 5 - Assistant Integration Migration)
┌────────────────┴────────────────┐
│        project_bindings         │
├─────────────────────────────────┤
│ directory TEXT PRIMARY KEY      │  (Machine-local canonical path)
│ projectId TEXT REFERENCES proj  ├───► projects.projectId
│ createdAt TEXT NOT NULL         │
└─────────────────────────────────┘
  CREATE INDEX project_bindings_project ON project_bindings(projectId);
                 ▲
                 │ (Schema 6 - Progressive Sessions Migration)
┌────────────────┴────────────────────────────────────────────────────────┐
│                               sessions                                 │
├────────────────────────────────────────────────────────────────────────┤
│ sessionId TEXT PRIMARY KEY                                             │
│ projectId TEXT REFERENCES projects(projectId)                          │
│ kind TEXT ('runtime' | 'manual')                                       │
│ startedAt TEXT NOT NULL                                                │
│ endedAt TEXT NULLABLE                                                  │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│      session_entries      │ │     session_summaries     │ │ local_session_bindings    │
├───────────────────────────┤ ├───────────────────────────┤ ├───────────────────────────┤
│ sessionId REFERENCES sess │ │ sessionId PK REFERENCES s │ │ sessionId REFERENCES sess │
│ memoryId REFERENCES mem   │ │ memoryId REFERENCES mem   │ │ directory TEXT            │
│ version INTEGER           │ │ version INTEGER           │ │ createdAt TEXT            │
│ recordedAt TEXT NOT NULL  │ └───────────────────────────┘ └───────────────────────────┘
└───────────────────────────┘                               (Machine-local only, not synced)
                 ▲
                 │
┌────────────────┴───────────────┐
│     local_manual_sessions      │
├────────────────────────────────┤
│ projectId PK REFERENCES proj   │  (Machine-local fallback session tracker)
│ sessionId REFERENCES sessions  │
└────────────────────────────────┘
```

---

## 3. Canonical Git Resolution and Worktrees

1. **Git Common Directory Resolution (`git rev-parse --path-format=absolute --git-common-dir`):**
   - **Linked worktrees:** Worktrees created with `git worktree add` share the common `.git` root. Engram maps all worktrees of a repository to the identical canonical `projectId` and memories.
   - **Nested subdirectories:** Nested folders resolve up to the common Git root.
2. **Git Mandatory:** Git is required even to safely verify that a directory is not a Git repository. If Git is unavailable, resolution fails closed with `PROJECT_IDENTITY_UNAVAILABLE`.
3. **Conservative Path Ambiguity:** If all recorded bindings for any project are missing on disk, Engram halts automatic project creation with `PROJECT_BINDING_REQUIRED` to avoid duplicate orphan projects.

---

## 4. Native Stdio MCP Server Architecture (10 Tools)

The MCP server implements the Model Context Protocol over standard I/O (`stdio`):

```text
┌────────────────────────────────────────────────────────┐
│                   Coding Assistant                     │
│   (Claude Code / Codex / Cursor / OpenCode / Gemini)   │
└──────────────────────────┬─────────────────────────────┘
                           │ JSON-RPC via stdio
                           ▼
┌────────────────────────────────────────────────────────┐
│             forge614-engram mcp (Server)               │
│                                                        │
│  - Transport: StdioServerTransport (256 KB buffer)     │
│  - Stdout: 100% reserved for JSON-RPC protocol frames  │
│  - Stderr: Zero human logs or ANSI escape pollution    │
├────────────────────────────────────────────────────────┤
│                    10 Native Tools                     │
│ 1. memory_context(directory?, scope?, compact?, ...)   │
│ 2. memory_current_project(directory?)                  │
│ 3. memory_get(id, directory?, scope?, version?)        │
│ 4. memory_history(id, directory?, scope?)              │
│ 5. memory_save(title, content, type, directory?, ...)  │
│ 6. memory_search(query, directory?, limit?, scope?)    │
│ 7. memory_session_end(directory?, sessionId)           │
│ 8. memory_session_start(directory, sessionId)          │
│ 9. memory_session_summary(directory?, sessionId, ...)  │
│ 10. memory_timeline(directory?, sessionId, id, v, ...) │
└──────────────────────────┬─────────────────────────────┘
                           │ Synchronous queries
                           ▼
┌────────────────────────────────────────────────────────┐
│               Local SQLite (engram.db)                 │
│               Schemas 5 & 6 + FTS5 Trigram             │
└────────────────────────────────────────────────────────┘
```

### Protocol Guidelines (`MEMORY_PROTOCOL`):
- Store durable architectural decisions and preferences, **not raw conversational transcripts**.
- Call `memory_context` or `memory_search` at task start or post-compaction before repeating research.
- For `scope: "shared"`, explicit justification is required in `globalIntent`.
- Storing shared memories with session retains `projectId: null` in storage and private session metadata is excluded from external queries.

---

## 5. Client Configuration Adapters and OpenCode Safety

| Client | Configuration File | Hooks / Dedicated Plugin |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` |
| **Codex** | `~/.codex/config.toml` | `~/.codex/hooks.json` (requires `/hooks` trust) |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` |
| **OpenCode** | `~/.config/opencode/opencode.json` (or `.jsonc`) | `plugins/forge614-engram.js` in global directory |
| **Gemini CLI** | `~/.gemini/settings.json` | Internal `hooks` section |

### Safe Modification Workflow:
1. **Preflight:** Inspects paths, validates permissions, and rejects suspicious symlinks.
2. **Private Backups:** Generates `.bak` files with mode `0600` and UUID suffixes before writing.
3. **Comment Preservation:** AST modification using `jsonc-parser` and `smol-toml`.
4. **Post-Publication Byte Verification:** Validates exact planned bytes. Reports `PUBLISHED_UNVERIFIED` if concurrently modified.
5. **OpenCode Plugin Conflict Detection (`CONFLICT`):** If `plugins/forge614-engram.js` already exists with different contents, Engram fails closed with `CONFLICT`. The file is never overwritten; the user must inspect, back up, and reconcile manually.

---

## 6. PostgreSQL Replication and Format 2 Promotion

Replication operates via deterministic 3-way snapshot merging:
- **Format 1:** Classic snapshot replicating projects, memories, versions, requests, and events.
- **Format 2:** Extended snapshot replicating sessions (`sessions`), session entries (`sessionEntries`), and structured summaries (`sessionSummaries`).
- **Atomic CAS Promotion:**
  - Upgrading a PostgreSQL replica from Format 1 to Format 2 is executed exclusively via `forge614-engram sync --upgrade-format`.
  - Governed by atomic compare-and-swap (CAS) locking on `forge614_sync.state`.
  - `sync-watch` rejects `--upgrade-format` with `INVALID_INPUT` to prevent accidental unattended promotions.
  - Machine-local tables (`local_session_bindings`, `local_manual_sessions`) are never replicated.
- **Payload Limits:** Snapshots exceeding 8 MiB (`8,388,608 bytes`) trigger `SYNC_TOO_LARGE` instead of false historical conflicts.

---

## 7. Mathematical Ranking Formulas

### 7.1. SQLite FTS5 BM25 Scoring

SQLite FTS5 ranks matches using BM25 (*Best Matching 25*):

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- Parameters: $k_1 = 1.2$, $b = 0.75$.
- Column weights: `title: 5.0`, `topic_key: 3.0`, `content: 1.0`.
- **Negative BM25 Scores:** SQLite's native `bm25()` returns **negative numbers**, where more negative represents a stronger match.

### 7.2. Priority and Recency Multiplier

To integrate explicit pinning and temporal freshness with SQLite's negative BM25 score:

$$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \frac{\text{ageDays}}{30}}, \quad (\text{ageDays} \ge 0)$$

where:
- $\text{pinned} \in \{0, 1\}$: 1 if pinned, 0 otherwise.
- $\text{ageDays} = \max\left(0, \text{julianday}('now') - \text{julianday}(m.\text{updated\_at})\right)$.
- New memories ($\text{ageDays} = 0$) with $\text{pinned} = 1$ achieve maximum multiplier of $1.16$.
- As time elapses, the recency factor converges to 0 and the multiplier approaches $1.00$ (or $1.10$ if pinned).

**Ranking Calculation:**
$$\text{orderScore} = \text{bm25} \times \text{multiplier}$$

Because $\text{bm25}$ is negative, multiplying by $\text{multiplier} \ge 1.0$ makes strong, recent matches even more negative. The query orders ascending:
```sql
ORDER BY bm25 * multiplier ASC, m.id ASC
```
placing the most relevant and fresh memories first, resolving ties deterministically with `m.id`.

### 7.3. Literal Searches for Short Terms
Queries under 3 characters perform literal scans with Unicode lowercase folding, ordering strictly by:
```sql
ORDER BY m.pinned DESC, m.updated_at DESC, m.id ASC
```
In this mode, `bm25` and `orderScore` are reported as `null` with `multiplier: 1`.

---

## 8. Progressive Retrieval Limits vs Token Budgets

1. **Unicode Code Points for Previews:**
   - In `memory_search` with `--preview` and `memory_context`: content is truncated to a maximum of **300 Unicode code points** with boolean `truncated: true`.
   - In `memory_timeline`: focus memory is truncated to **500 code points**; neighbors to **150 code points**.
2. **Byte Limits (`--max-bytes`):**
   - In `memory_context`: `--max-bytes` bounds the **total serialized UTF-8 JSON bytes** (1024..65536, default 16384).
   - **Not an LLM Token Budget:** Token counting belongs to the model client; Engram guarantees a predictable byte payload limit between processes.

---

## 9. Design Lineage and Attribution

Forge614 Engram's retrieval design acknowledges key design influences:
- **Gentleman Inspiration:** The progressive lookup, preview truncation, and timeline reconstruction pattern is inspired by the Gentleman architecture.
- **Forge614 Adaptations:**
  - Decoupled UUID project identity independent of directory paths or display names.
  - Explicit and manual per-device sessions resolved via Git common root directories.
  - Complete isolation of machine-local session bindings (`local_session_bindings`).
  - PostgreSQL 3-way snapshot replication with CAS-protected Format 2 promotion.
