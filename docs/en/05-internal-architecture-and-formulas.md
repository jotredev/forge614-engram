# 05 (EN). Internal Architecture, MCP Protocol, FTS5, and Ranking Formulas

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Verified (191 total tests on macOS with Bun 1.3.8)
> **Sister translation:** [05. Arquitectura Interna, Protocolo MCP, SQLite FTS5 y Fórmulas Matemáticas](../es/05-arquitectura-interna-y-formulas.md)

This document provides an exhaustive technical specification of Forge614 Engram: SQLite engine pragmas, relational schemas v3, v4, and v5 (`project_bindings`), canonical Git resolution for projects and linked worktrees, native stdio Model Context Protocol (MCP) server architecture, client configuration adapters with atomic backups (`0600`/UUID) and post-publication byte verification, 3-way snapshot merge replication with PostgreSQL, and mathematical formulas for **BM25**, recency decay, and explainable ranking.

---

## 1. SQLite Engine Pragmas, Concurrency, and WAL Initialization

Forge614 Engram builds upon the native SQLite engine bundled in Bun (`bun:sqlite`), initialized with strict security and data integrity directives:

1. **`PRAGMA foreign_keys = ON;`**
   Enforces referential integrity at all times. A record in `memory_versions` cannot exist without referencing an `id` in `memories`, and a project binding in `project_bindings` cannot exist without referencing a valid `projectId` in `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   If concurrent processes attempt to write simultaneously, SQLite waits up to **5,000 milliseconds (5 seconds)** for the active transaction to commit before raising a busy error.
3. **`PRAGMA application_id = 1177956660;`**
   Unique identification signature for Forge614 Engram databases, preventing accidental manipulation of foreign SQLite files.
4. **`PRAGMA user_version = 3`, `4`, or `5`;**
   - **Version 3:** Pure local SQLite storage without synchronization.
   - **Version 4:** Storage with PostgreSQL replica sync enabled (adds `sync_checkpoints`).
   - **Version 5:** Storage with assistant integration and local bindings enabled (adds `project_bindings` and its index).
   - **Opening Rule:** A normal SQLite connection (`workspace.open()`) **never auto-migrates the database**. Migrations to schemas 4 and 5 are explicit and additive (via `setup`, `tui`, or `integration-enable`). Downgrading is not supported.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Readers access the main database file while writes append to the auxiliary write-ahead log (`engram.db-wal`).
   - Readers do not block writers and writers do not block readers.
   - Writes remain serialized across processes.

### WAL Initialization Adjustment (Empty Immediate Transaction)
When initializing a new database:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
This forces physical synchronization of headers across `engram.db-wal` and `engram.db-shm` to support cold read-only opens on macOS.

---

## 2. Local SQLite Relational Schema (Schemas 3, 4, and 5)

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
│ id TEXT (UUID unique)           │◄──┼───┤ version INTEGER (>= 1)          │   │
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
│ memory_id TEXT (FK memories.id) │       │ FTS5 Virtual Table (trigram)    │
│ action ('save'|'archive'|'rest')│       │ title (5.0), topic_key (3.0),   │
│ version INTEGER                 │       │ content (1.0)                   │
│ created_at TIMESTAMP            │       └─────────────────────────────────┘
└─────────────────────────────────┘
                 ▲
                 │ (Schema 4 Only - Additive Migration)
┌────────────────┴────────────────┐
│        sync_checkpoints         │
├─────────────────────────────────┤
│ replica TEXT PRIMARY KEY        │
│ snapshot TEXT (Valid JSON)      │
└─────────────────────────────────┘
                 ▲
                 │ (Schema 5 Only - Additive Migration)
┌────────────────┴────────────────┐
│        project_bindings         │
├─────────────────────────────────┤
│ directory TEXT PRIMARY KEY      │  (Canonical local machine path)
│ projectId TEXT REFERENCES proj  ├───► projects.projectId
│ createdAt TEXT NOT NULL         │
└─────────────────────────────────┘
  CREATE INDEX project_bindings_project ON project_bindings(projectId);
```

### Table `project_bindings` (Schema 5):
Maps machine-local filesystem paths to project UUIDs:
- `directory`: Canonical absolute filesystem directory path (`PRIMARY KEY`).
- `projectId`: Foreign key referencing `projects(projectId)`.
- `createdAt`: ISO 8601 creation timestamp.
- Secondary index: `CREATE INDEX project_bindings_project ON project_bindings(projectId);`

---

## 3. Canonical Git Project Resolution

When resolving project identity during MCP tool execution or `project-bind`:

1. **Git Common Directory Resolution:**
   Engram executes:
   ```bash
   git rev-parse --path-format=absolute --git-common-dir
   ```
   - **Linked worktrees:** Running in a worktree created with `git worktree add` points to the primary `.git` directory. Worktrees share identical project identity and memories.
   - **Nested subdirectories:** Navigating inside subfolders resolves to the same common Git root.
2. **Non-Git Directories:**
   Directories outside Git require passing an explicit `directory` parameter or possessing a single MCP root. The executable directory is never used as an implicit project.
3. **Mandatory Git Requirement:**
   Git is required even to certify that a folder does not belong to Git. Missing Git fails closed with `PROJECT_IDENTITY_UNAVAILABLE`.
4. **Conservative Path Ambiguity Check:**
   Before creating a new project automatically for an unbound directory:
   - Recorded bindings in `project_bindings` are inspected.
   - If **all bindings for any project are unavailable on disk**, resolution halts with `PROJECT_BINDING_REQUIRED`.
   - This prevents creating orphan duplicate projects when a folder was renamed or an external drive unmounted.
   - **Resolution:** Explicitly bind the folder via `project-bind --directory /path --project-id <UUID>`.
5. **Local Binding Isolation During Sync:**
   Synchronization (`sync`) mirrors projects, memories, versions, requests, and events, **but never synchronizes local filesystem paths (`project_bindings`)**, which remain strictly local to each device.

---

## 4. Stdio MCP Server Architecture

The `forge614-engram mcp` command implements the Model Context Protocol over standard I/O:

```text
┌────────────────────────────────────────────────────────┐
│                      AI Client                         │
│   (Claude Code / Codex / Cursor / OpenCode / Gemini)   │
└──────────────────────────┬─────────────────────────────┘
                           │ JSON-RPC via stdio
                           ▼
┌────────────────────────────────────────────────────────┐
│             forge614-engram mcp (Server)               │
│                                                        │
│  - Instructions: MEMORY_PROTOCOL                       │
│  - Transport: StdioServerTransport (256 KB buffer)     │
│  - Stdout: 100% reserved for JSON-RPC protocol frames  │
│  - Stderr: No human logs or ANSI escape sequences      │
├────────────────────────────────────────────────────────┤
│                     5 Tools                            │
│ 1. memory_current_project(directory?)                  │
│ 2. memory_search(query, directory?, limit?, scope?)    │
│ 3. memory_get(id, directory?, scope?)                  │
│ 4. memory_save(title, content, type, directory?, ...)  │
│ 5. memory_history(id, directory?, scope?)              │
└──────────────────────────┬─────────────────────────────┘
                           │ Synchronous operations
                           ▼
┌────────────────────────────────────────────────────────┐
│                Local SQLite (engram.db)                │
│              FTS5 Trigram BM25 + Schema 5              │
└────────────────────────────────────────────────────────┘
```

### Protocol Directives (`MEMORY_PROTOCOL`):
- Treat Engram as curated durable memory, **not as a conversation transcript**.
- On task start, after context compaction, or when resuming, call `memory_current_project` and `memory_search` before repeating research.
- Record only durable decisions, resolved bugs, warnings, and explicit preferences.
- **Never save secrets, API keys, credentials, personal data, raw logs, or full tool outputs.**
- Default scope is `project`. `shared` strictly requires `globalIntent`.
- Update existing topics using `expectedVersion` to prevent concurrent overwrite races.

---

## 5. Client Configuration Adapters & Safe Publication

The `tui` command configures five AI development clients:

| Client | Configuration File | Hooks / Plugin Location |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` |
| **Codex** | `~/.codex/config.toml` | `~/.codex/hooks.json` |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` |
| **OpenCode** | `~/.config/opencode/opencode.json` (or `.jsonc`) | `plugins/forge614-engram.js` in active global source |
| **Gemini CLI** | `~/.gemini/settings.json` | `hooks` array in same file |

### Safe Publication Workflow:
1. **Preflight:** Validates directory permissions, verifies files are not symlinks, and checks file sizes.
2. **Private Backups:** Creates exact copies of previous bytes in mode `0600` with a UUID suffix (e.g., `mcp.json.3a8f...bak`).
3. **Comment Preservation:** Uses `jsonc-parser` for JSON/JSONC and `smol-toml` for TOML, preserving formatting and external comments.
4. **Post-Publication Byte Verification:** Re-reads the file immediately after writing. If modified concurrently by another process, reports `PUBLISHED_UNVERIFIED`, retains backups, and avoids destructive rollback.
5. **OpenCode Multi-Source Handling:** `OPENCODE_CONFIG_DIR` adds a configuration source without replacing the XDG global directory. Reuses the single global plugin rather than duplicating it.

---

## 6. Event Coverage and Native Hooks

| Client | Events with Injected Memory Guidance | Operational Limits |
| :--- | :--- | :--- |
| **Claude Code** | `SessionStart`, `UserPromptSubmit` | Subject to model compliance and enterprise policies. |
| **Codex** | `SessionStart`, `UserPromptSubmit` | **Requires explicit review and approval in Codex via `/hooks`**. |
| **Cursor** | `sessionStart` | Session start only; no prompt or post-compaction recovery hook verified. |
| **OpenCode** | `experimental.chat.system.transform`, `experimental.session.compacting` | Upstream experimental plugin callbacks. |
| **Gemini CLI** | `SessionStart`, `BeforeAgent` | Does not guarantee post-compaction callback. |

---

## 7. Mathematical Retrieval & Ranking Formulas

Searches compute transparent relevance ranking combining **BM25**, priority, and recency decay:

$$\text{orderScore} = \text{bm25Score} \times \text{multiplier}$$

### 7.1. BM25 Algorithm
Textual matching score:

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- $k_1 = 1.2$: Term frequency saturation parameter.
- $b = 0.75$: Document length penalty relative to average collection length ($\text{avgdl}$).
- FTS5 column weights: `title: 5.0`, `topic_key: 3.0`, `content: 1.0`.

### 7.2. Priority and Recency Multipliers

$$\text{multiplier} = \text{priorityFactor} \times \text{recencyFactor}$$

1. **Priority Factor:**
   - If `pinned == 1`: $\text{priorityFactor} = 1.5$
   - If `pinned == 0`: $\text{priorityFactor} = 1.0$
2. **Recency Factor (Smooth Exponential Decay):**
   $$\text{recencyFactor} = 1.0 + 0.2 \cdot e^{-\lambda \cdot \Delta t}$$
   where $\Delta t$ is age in days and $\lambda = \frac{\ln(2)}{30} \approx 0.0231$ (30-day half-life). Fresh notes receive a factor of $1.20$, asymptotically decaying to $1.00$ over time.
