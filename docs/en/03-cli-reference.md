# 03 (EN). Terminal CLI Command Reference

> **Stage:** Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (Verified with 250 tests across 18 files on macOS with Bun 1.3.8)
> **Sister translation:** [03. Manual Exhaustivo de Terminal (CLI)](../es/03-referencia-cli.md)

This manual provides an exhaustive reference for all CLI commands, options, syntax rules, exit codes, and response formats for Forge614 Engram.

---

## 1. General Command-Line Rules

1. **Command Structure:** The command must immediately follow the program name:
   ```bash
   forge614-engram <command> [options...]
   ```
2. **Option Formatting:** Every option (`--option`) must be separated from its value by a space. The syntax `--option=value` is not accepted.
   - ✅ Correct: `--project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --limit 5`
   - ❌ Incorrect: `--project-id=7c9e6679-7425-40de-944b-e07fc1f90ae7`
3. **Mandatory Quotes for Multi-Word Strings:** All titles, contents, JSON objects, or names with spaces must be wrapped in double quotes (`"..."`).
4. **Strict Prior Validation:** Passing an unknown option, repeating an option, or supplying incompatible arguments (such as mixing `--scope shared` with `--project-id` on single-memory commands or passing `--upgrade-format` to `sync-watch`) terminates immediately with `INVALID_INPUT` **before reading configuration or opening SQLite**.
5. **Output Streams and Exit Codes:**
   - **Interactive Commands (`setup`, `tui`):** Emit human-readable text via `stdout`. Return exit code `0` on success/confirmation; code `130` on voluntary cancellation (`Ctrl+C`, `Escape`, `cancelar`, `q`, or `no`); and code `1` on error or non-interactive execution (`INTERACTIVE_REQUIRED`).
   - **MCP Server (`mcp`):** Reserves `stdout` exclusively for JSON-RPC frames. On `Ctrl+C` (SIGINT) returns code `130`; on SIGTERM returns code `143`.
   - **Sync Watcher (`sync-watch`):** Emits successful sync rounds in JSON to `stdout` and retry notices to `stderr`. On `Ctrl+C` exits with code `130`.
   - **Data and Automation Commands (`init`, `sync`, `assistant-list`, `integration-enable`, `sessions-enable`, `project-*`, `save`, `search`, `session-*`, `timeline`, `context`, etc.):** Emit structured JSON responses to `stdout` with exit code `0` on success. On error, emit a JSON error payload to `stderr` with exit code `1`.
6. **Disallowed Legacy Flags:**
   - `--db`: Not accepted. Database path is fixed: `~/.forge614/engram.db`.
   - `--project` (by name): Not accepted. The identifier is strictly `--project-id <UUID>`.
   - `--id-project`: Not accepted. The official parameter is `--project-id`.

---

## 2. Configuration, Assistants, and MCP Commands

---

### 2.1. `--version`
Displays the program name and installed version.

```bash
forge614-engram --version
```
- **Output:** `forge614-engram 0.5.0`

---

### 2.2. `help`
Prints the official quick-reference guide.

```bash
forge614-engram help
```

---

### 2.3. `setup`
Interactive terminal wizard to configure the central workspace (`~/.forge614/.env` and `~/.forge614/engram.db`) with or without PostgreSQL replica sync.

```bash
forge614-engram setup
```
- **Requirements:** Interactive TTY (`stdin` and `stdout`).
- **Exit Codes:** `0` on apply; `130` on cancellation; `1` on error.

---

### 2.4. `tui`
Interactive full-screen terminal dashboard to audit, preview, and configure coding assistants (Claude Code, Codex, Cursor, OpenCode, Gemini CLI).

```bash
forge614-engram tui
```
- **Keybindings:**
  - `↑` / `↓`: Move cursor.
  - `Space`: Toggle client selection.
  - `r`: Rescan installed executables and configurations.
  - `c`: Custom binary or config path via masked input.
  - `t`: Run 5-second async MCP server self-test over stdio.
  - `Enter`: Advance through screens (`List` $\rightarrow$ `Preview` $\rightarrow$ `Confirm` $\rightarrow$ `Apply`).
  - `Escape`: Step back to previous screen.
  - `Ctrl+C`: Immediate clean abort, returning code `130`.
- **Side Effects:**
  - In Preview: Zero disk writes.
  - On Apply: Runs preflights, enables Schema 5 in SQLite, creates `0600` UUID-suffixed backups, applies changes preserving comments, and validates published bytes (`PUBLISHED_UNVERIFIED` if concurrently modified). In OpenCode, existing divergent plugins trigger `CONFLICT` without silent overwriting.

---

### 2.5. `assistant-list`
Read-only structured JSON inspection auditing detected executables, configuration paths, and hook coverage.

```bash
forge614-engram assistant-list
```

---

### 2.6. `integration-enable`
Explicitly enables assistant integration and local directory bindings by migrating the local database to **Schema 5** (adds table `project_bindings`).

```bash
forge614-engram integration-enable
```
- **JSON Output:** `{"enabled": true, "schema": 5}`

---

### 2.7. `sessions-enable`
Explicitly enables progressive memory sessions and ranked context retrieval by migrating the local database to **Schema 6** (adds tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`).

```bash
forge614-engram sessions-enable
```
- **JSON Output:** `{"enabled": true, "schema": 6}`
- **Side Effects:** Additive irreversible migration. Standard commands, `mcp`, and `init` never auto-migrate existing databases.

---

### 2.8. `mcp`
Starts the local Model Context Protocol (MCP) server over standard I/O channels (`stdio`).

```bash
forge614-engram mcp
```
- **Channels:** Reserves `stdout` strictly for JSON-RPC protocol frames.
- **10 Exposed Tools:**
  1. `memory_context`
  2. `memory_current_project`
  3. `memory_get`
  4. `memory_history`
  5. `memory_save`
  6. `memory_search`
  7. `memory_session_end`
  8. `memory_session_start`
  9. `memory_session_summary`
  10. `memory_timeline`
- **Precondition:** Requires Schema 5 (or Schema 6 for session tools). Does not auto-migrate on startup.

---

### 2.9. `memory-hook`
Native hook adapter invoked by AI coding assistants on session start or prompt submission.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|gemini-cli>
```
- **Side Effects:** Injects contextual guidance. **Never saves memories directly**.

---

### 2.10. `project-bind`
Manually associates a local directory to an existing `projectId`.

```bash
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

---

### 2.11. `init`
Programmatically initializes central storage (`~/.forge614/.env` and `~/.forge614/engram.db`) in local mode. Idempotent and never overwrites existing memories.

```bash
forge614-engram init
```

---

### 2.12. `sync`
Executes an immediate 3-way snapshot merge synchronization round against the configured PostgreSQL replica.

```bash
# Standard sync:
forge614-engram sync

# Explicit promotion of Format 1 replica to Format 2:
forge614-engram sync --upgrade-format
```
- **Options:**
  - `--upgrade-format`: Explicitly promotes a Format 1 PostgreSQL replica (projects & memories) to Format 2 (adding sessions, entries, and summaries) with atomic CAS protection on `forge614_sync.state`.

---

### 2.13. `sync-watch`
Executes an initial sync round and maintains a foreground polling loop.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Restriction:** Rejects `--upgrade-format` with `INVALID_INPUT`. Promotion must be performed explicitly via `sync --upgrade-format`. Exits with code `130` on `Ctrl+C`.

---

## 3. Project Management Commands

---

### 3.1. `project-create`
Registers a new project, returning its UUID `projectId`.

```bash
forge614-engram project-create --name "Recommendation Engine"
```

---

### 3.2. `project-list`
Lists all registered projects ordered chronologically.

```bash
forge614-engram project-list
```

---

### 3.3. `project-rename`
Renames a project without altering its UUID or memories.

```bash
forge614-engram project-rename \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --name "Brand New Name"
```

---

## 4. Memory Management Commands

---

### 4.1. `save`
Saves a new memory or updates an existing topic.

```bash
# Project memory with explicit session:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Database Engine" \
  --content "We will use PostgreSQL 16 with physical replication." \
  --type decision \
  --topic "database-engine" \
  --session-id "ses-arch-01"

# Universal shared memory:
forge614-engram save \
  --scope shared \
  --title "Language Preference" \
  --content "Write technical docs in English." \
  --type preference

# Shared memory associated with a private session context:
forge614-engram save \
  --scope shared \
  --title "Formatting Rule" \
  --content "Use 2-space indentation." \
  --type preference \
  --session-id "ses-arch-01" \
  --session-project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

- **Options:**
  - `--title <text>`: Descriptive title (mandatory).
  - `--content <text>`: Full text content (mandatory).
  - `--type <type>`: `fact` (default), `decision`, `procedure`, `warning`, `preference`.
  - `--scope <project|shared>`: Scope (`project` default).
  - `--project-id <UUID>`: Required for `project`; forbidden for `shared`.
  - `--topic <key>`: Stable topic identifier.
  - `--expected-version <n>`: Prior version required when updating an existing topic.
  - `--request-key <key>`: Idempotency key.
  - `--pinned <true|false>`: Pins memory for search and context priority.
  - `--session-id <id>`: Session identifier.
  - `--session-project-id <UUID>`: Session owner project when saving with `--scope shared`.
- **Session Inference:**
  - CLI `save` with `--session-id`: binds explicitly (`sessionSource: "explicit"`).
  - CLI `save` without `--session-id`: on Schema 6, falls back to the machine's local manual session for the project (`sessionSource: "manual"`).
  - MCP `memory_save` without `sessionId`: auto-binds if exactly 1 session was active in the last 7 days (`sessionSource: "inferred"`). If multiple candidates exist, halts with `AMBIGUOUS_SESSION`.
  - Shared memory with session: stored with `projectId: null` and strips private session origin metadata from external responses.

---

### 4.2. `search`
Searches active memories using SQLite FTS5 trigram tokenization and BM25 recency ranking.

```bash
# Combined project and shared search:
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "postgresql" \
  --limit 5

# Progressive preview search:
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "architecture" \
  --preview
```
- **Options:**
  - `--preview`: Returns `MemoryPreview` objects with content truncated to a maximum of **300 Unicode code points** and boolean `truncated` flag.

---

### 4.3. `get`
Retrieves a memory by its UUID in its current version or a specific historical version.

```bash
# Current active version:
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"

# Specific historical version:
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851" \
  --version 1
```

---

### 4.4. `history`
Audits the immutable chronological history of all versions of a memory.

```bash
forge614-engram history \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

### 4.5. `archive` and `restore`
- `archive`: Hides an active memory from normal searches while preserving its full history.
- `restore`: Returns an archived memory to active status.

```bash
forge614-engram archive \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"

forge614-engram restore \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

## 5. Progressive Sessions and Ranked Context Commands

> [!IMPORTANT]
> All commands in this section require **Schema 6** (enabled via `forge614-engram sessions-enable`).

---

### 5.1. `session-start`
Starts a runtime work session tied to a project directory.

```bash
forge614-engram session-start \
  --directory "/Users/usuario/Desktop/my-project" \
  --session-id "ses-refactor-api"
```
- **Options:** `--directory <path>`, `--session-id <id>` (1..200 characters).

---

### 5.2. `session-end`
Concludes a runtime session, recording its `endedAt` timestamp.

```bash
forge614-engram session-end \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api"
```
- **Restriction:** Manual sessions cannot be closed (`SESSION_KIND`).

---

### 5.3. `session-summary`
Saves or updates a structured session summary.

```bash
forge614-engram session-summary \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api" \
  --summary-json '{"goal":"Refactor API","instructions":"Use Zod schemas","discoveries":"Legacy routes untyped","accomplishments":"8 routes migrated","nextSteps":"Add integration tests","files":["src/routes/api.ts"]}' \
  --request-key "sum-refactor-v1"
```
- **Required JSON keys:** `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps` (non-empty strings) and `files` (array of strings). Saved under reserved topic `session/<sessionId>/summary` with type `procedure`.

---

### 5.4. `timeline`
Reconstructs the event timeline surrounding a focus memory within a work session.

```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851" \
  --version 1 \
  --before 3 \
  --after 3
```
- **Behavior:** Focus memory is truncated to 500 Unicode code points; neighbors to 150 code points each.

---

### 5.5. `context`
Assembles prioritized, ranked context for task startup or post-compaction recovery.

```bash
# Standard project context (16 KB max bytes default):
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"

# Compact context without previews:
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --compact

# Custom byte limit:
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --max-bytes 32768
```
- **Options:**
  - `--compact`: Omits `preview` text.
  - `--max-bytes <1024..65536>`: Strict cap on **total serialized UTF-8 JSON bytes** (default 16384). **Not an LLM token budget**.

---

## 6. Comprehensive Options Summary Table

| Command | Mandatory Options | Optional Options | Output |
| :--- | :--- | :--- | :--- |
| `setup` | None | None | Interactive text |
| `tui` | None | None | Interactive screen |
| `assistant-list` | None | None | JSON |
| `integration-enable` | None | None | JSON |
| `sessions-enable` | None | None | JSON |
| `mcp` | None | None | JSON-RPC (stdio) |
| `memory-hook` | `--client` | None | Native JSON |
| `project-bind` | `--directory`, `--project-id` | None | JSON |
| `init` | None | None | JSON |
| `sync` | None | `--upgrade-format` | JSON |
| `sync-watch` | None | `--interval` | Streaming JSON |
| `project-create` | `--name` | None | JSON |
| `project-list` | None | None | JSON |
| `project-rename` | `--project-id`, `--name` | None | JSON |
| `save` | `--title`, `--content` | `--type`, `--scope`, `--project-id`, `--topic`, `--expected-version`, `--request-key`, `--pinned`, `--session-id`, `--session-project-id` | JSON |
| `search` | `--query` | `--project-id`, `--scope`, `--limit`, `--preview` | JSON |
| `get` | `--id` | `--project-id`, `--scope`, `--version` | JSON |
| `history` | `--id` | `--project-id`, `--scope` | JSON |
| `archive` | `--id` | `--project-id`, `--scope` | JSON |
| `restore` | `--id` | `--project-id`, `--scope` | JSON |
| `session-start` | `--directory`, `--session-id` | None | JSON |
| `session-end` | `--project-id`, `--session-id` | None | JSON |
| `session-summary`| `--project-id`, `--session-id`, `--summary-json`, `--request-key` | `--expected-version` | JSON |
| `timeline` | `--project-id`, `--session-id`, `--id`, `--version` | `--before`, `--after` | JSON |
| `context` | `--project-id` (or `--scope shared`) | `--compact`, `--max-bytes`, `--scope` | JSON |
| `--version` | None | None | Plain text |
| `help` | None | None | Plain text |
