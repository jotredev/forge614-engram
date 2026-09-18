# 03 (EN). Terminal CLI Command Reference

> **Stage:** TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [03. Manual Exhaustivo de Terminal (CLI)](../es/03-referencia-cli.md)

This manual provides an exhaustive reference for all CLI commands, options, syntax rules, exit codes, and response formats for Forge614 Engram.

---

## 1. General Command-Line Rules

1. **Command Structure:** The command must immediately follow the program name:
   ```bash
   forge614-engram <command> [options...]
   # Or in development with Bun inside the repository:
   bun run cli <command> [options...]
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
   - **Data and Automation Commands (`init`, `sync`, `assistant-list`, `integration-enable`, `sessions-enable`, `reinforcement-enable`, `project-*`, `save`, `search`, `session-*`, `timeline`, `context`, etc.):** Emit structured JSON responses to `stdout` with exit code `0` on success. On error, emit a JSON error payload to `stderr` with exit code `1`.
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
- **Options:** Accepts no additional options.
- **Side Effects:** None. Does not read or write disk files.

---

### 2.2. `help`
Prints the official quick-reference guide.

```bash
forge614-engram help
```

---

### 2.3. `setup`
Interactive terminal wizard to configure the central workspace (`~/.forge614/.env` and `~/.forge614/engram.db`), offering optional PostgreSQL replication and search reinforcement enablement (Schema 7).

```bash
forge614-engram setup
```
- **Requirements:** Interactive TTY (`stdin` and `stdout`).
- **Exit Codes:** `0` on apply; `130` on cancellation; `1` on error.

---

### 2.4. `tui`
Interactive full-screen Terminal Control Center to audit local storage, inspect project registries and shared memory, execute two-step confirmed actions (`confirm` + Enter), and configure AI coding assistants through a sequential subflow.

```bash
forge614-engram tui
```
- **Options:** None.
- **Requirements:** Interactive terminal (`isTTY` true on both `stdin` and `stdout`). In non-interactive or piped environments, aborts with `INTERACTIVE_REQUIRED`.
- **Top Menu Header:**
  `Summary | Projects | Shared | Storage | Actions | Assistants | Exit`
- **Keybindings:**
  - `←` / `→` / `↑` / `↓`: Shift tab focus across top header and navigate item lists.
  - `Enter`: Open focused tab or view selected project detail.
  - `Escape`: Return to prior view or cancel active action.
  - `PgUp` / `PgDn`: Scroll detail text when output exceeds viewport height.
  - `Ctrl+C` or `EOF`: Immediately terminate session, restore terminal, and exit with code `130`.
- **Read-Only by Default Principle:**
  - Opening the screen, navigating tabs, resizing the terminal, or unrecognized input **never creates or mutates files**, never creates `~/.forge614/.env`, never creates `engram.db`, and never registers projects.
  - If uninitialized, displays clear uninitialized notice and points to `setup` or `init`; never creates files implicitly.
- **Views and Available Metadata:**
  - **Summary:** Initialization state, active SQLite schema (3 to 7), enabled capabilities, total project count, and aggregated shared memory counts.
  - **Projects:** Lists projects by display name, abbreviated UUID, and active/archived memory counts. Pressing Enter opens Detail View with full canonical UUID, timestamps, and local bound directory paths (`bindings`).
  - **Shared:** Active and archived shared memory counts and last update timestamp; explains that shared memory is a single global collection rather than per-project storage.
  - **Storage:** Local SQLite database path, schema version, and PostgreSQL status (`configured` or `not-configured`).
- **Strict Privacy and Sanitization:**
  - **Zero Exposure:** Strictly conceals `POSTGRES_URL`, `.env` contents, passwords, secrets, memory titles, memory bodies, and assistant configs.
  - **Sanitization:** Strips or replaces ANSI escapes, control characters, bidi overrides, zero-width characters, and unapproved URLs. Hiding the URL does not test remote connectivity.
- **Confirmed Actions (`Actions`):**
  - Available actions: `Create project`, `Rename project`, `Bind directory`, `Enable assistant integration` (Schema 5), `Enable sessions` (Schema 6), `Enable search reinforcement` (Schema 7), `Synchronize now` (only if PostgreSQL is configured; single-shot without format promotion or background services).
  - **Confirmation Protocol:** Shows comprehensive preview, prompts for input if needed, and requires typing `confirm` (case-insensitive) followed by Enter. Pressing Enter alone never authorizes writes.
  - **Safe Cancellation:** Pressing Escape or Ctrl+C before final confirmation writes nothing. During an in-flight confirmed action, duplicate keys are ignored; on exit, terminal is restored, though an already started action is not promised to revert.
- **Sequential Assistant Subflow (`Assistants`):**
  - Cleanly suspends the Control Center and restores standard terminal mode.
  - Sequentially opens the assistant configurator (`assistantTui`) with Space selection, 5-second async self-test (`t`), preflight diffs, `0600`/UUID backups, and post-write verification.
  - Exiting the assistant tool restores the terminal and reloads a fresh snapshot in the Control Center without nested raw modes.
- **Exit Codes:** `0` on normal exit; `130` on cancellation; `1` on error or missing TTY (`INTERACTIVE_REQUIRED`).

---

### 2.5. `assistant-list`
Read-only structured JSON inspection auditing detected executables, configuration paths, and hook coverage.

```bash
forge614-engram assistant-list
```
- **Output:** JSON array of assistant descriptors. Ideal for automation and scripts.
- **Side Effects:** None. Does not write to disk or spawn assistant processes.

---

### 2.6. `integration-enable`
Explicitly enables assistant integration and local directory bindings by migrating the local database to **Schema 5** (adds table `project_bindings`).

```bash
forge614-engram integration-enable
```
- **JSON Output:** `{"enabled": true, "schema": 5}`
- **Side Effects:** Initializes global storage if missing and additively updates SQLite to Schema 5.

---

### 2.7. `sessions-enable`
Explicitly enables progressive memory sessions and ranked context retrieval by migrating the local database to **Schema 6** (adds tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`).

```bash
forge614-engram sessions-enable
```
- **JSON Output:** `{"enabled": true, "schema": 6}`
- **Side Effects:** Additive irreversible migration. Standard commands, `mcp`, and `init` never auto-migrate existing databases.

---

### 2.8. `reinforcement-enable`
Explicitly enables immutable confirmation tracking and reinforced FTS5 search ranking by migrating the local database to **Schema 7** (adds tables `confirmations` and `confirmation_requests`).

```bash
forge614-engram reinforcement-enable
```
- **Options:** None.
- **JSON Output:**
  ```json
  {
    "enabled": true,
    "schema": 7
  }
  ```
- **Side Effects:** Additive irreversible migration. If the database was at Schema 3, 4, 5, or 6, it upgrades it to Schema 7. Normal commands or `mcp` never auto-migrate existing databases to Schema 7; executing `reinforcement-enable` (or answering yes during `setup`) is required to activate reinforced ranking.

---

### 2.9. `mcp`
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
- **Precondition:** Requires Schema 5 (via `tui` or `integration-enable`), Schema 6 (via `sessions-enable`), or Schema 7 (via `reinforcement-enable`). Does not auto-migrate on startup.
- **Shutdown:** Orderly shutdown on `EOF` on `stdin`; code `130` on `SIGINT`; code `143` on `SIGTERM`.

---

### 2.10. `memory-hook`
Native hook adapter invoked by AI coding assistants on session start or prompt submission.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|gemini-cli>
```
- **Mandatory Options:** `--client <name>`
- **Side Effects:** Injects contextual guidance. **Never saves memories directly**.

---

### 2.11. `project-bind`
Manually associates a local directory to an existing `projectId`.

```bash
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```
- **Mandatory Options:** `--directory <path>`, `--project-id <UUID>`
- **Behavior:** Resolves canonical repository root via Git (`git rev-parse --path-format=absolute --git-common-dir`), unifying worktrees and subdirectories.

---

### 2.12. `init`
Programmatically initializes central storage (`~/.forge614/.env` and `~/.forge614/engram.db`) in local mode. Idempotent and never overwrites existing memories.

```bash
forge614-engram init
```
- **JSON Output:** `{"initialized":true,"storage":"sqlite"}`

---

### 2.13. `sync`
Executes an immediate 3-way snapshot merge synchronization round against the configured PostgreSQL replica.

```bash
# Standard sync:
forge614-engram sync

# Explicit promotion of replica to Format 3:
forge614-engram sync --upgrade-format
```
- **Options:**
  - `--upgrade-format`: Explicitly promotes a PostgreSQL replica from an earlier format to **Format 3** (adding `confirmations` and `confirmationRequests` collections). Protected by atomic CAS locking on `forge614_sync.state`.
- **Promotion Prerequisites:**
  - Requires local database at Schema 7 (`reinforcement-enable`).
  - **All peer machines must be upgraded** to Schema 7 before syncing against a Format 3 replica. If an unreinforced client syncs against Format 3, it halts with `REINFORCEMENT_REQUIRED`.
- **JSON Output:**
  ```json
  {
    "synchronized": true,
    "projects": 3,
    "memories": 15
  }
  ```
- **Errors:**
  - `REINFORCEMENT_REQUIRED`: If the local client lacks Schema 7 and the remote replica is at Format 3.
  - `SYNC_UPGRADE_REQUIRED`: If the remote replica requires `--upgrade-format` to match local version or vice-versa.
  - `SYNC_DISABLED`: If sync is not configured in `.env`.
  - `SYNC_CONFLICT`: If 3-way snapshot merge encounters unreconcilable conflicts.
  - `SYNC_TOO_LARGE`: If the snapshot exceeds 8 MiB (`8,388,608 bytes`).
  - `POSTGRES_UNAVAILABLE` / `POSTGRES_URL`: On network failure, bad credentials, or invalid TLS parameters.

---

### 2.14. `sync-watch`
Executes an initial sync round and maintains a foreground polling loop.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Restriction:** Rejects `--upgrade-format` with `INVALID_INPUT` ("sync-watch no acepta --upgrade-format."). Format promotions must be performed deliberately with single-shot `sync --upgrade-format`. Exits with code `130` on `Ctrl+C`.

---

## 3. Project Management Commands

---

### 3.1. `project-create`
Registers a new project, returning its UUID `projectId`.

```bash
forge614-engram project-create --name "Recommendation Engine"
```
- **Mandatory Options:** `--name <text>`

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
- **Mandatory Options:** `--project-id <UUID>`, `--name <text>`

---

## 4. Memory Management Commands

---

### 4.1. `save`
Saves a new memory, updates an existing topic, idempotently replays requests by key (`--request-key`), or records an immutable confirmation.

```bash
# Initial memory with idempotent request key:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Database Engine" \
  --content "We will use PostgreSQL 16 with physical replication." \
  --type decision \
  --topic "database-engine" \
  --request-key "req-db-01" \
  --session-id "ses-arch-01"

# Updating an existing topic (requires expected-version):
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "database-engine" \
  --title "Engine Upgrade" \
  --content "We will migrate to PostgreSQL 17." \
  --type decision \
  --expected-version 1

# Universal shared memory without session:
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
  - `--request-key <key>`: Idempotency key for safe retries.
  - `--pinned <true|false>`: Pins memory for search and context priority.
  - `--session-id <id>`: Session identifier.
  - `--session-project-id <UUID>`: Session owner project when saving with `--scope shared`.
- **Request Key Semantics (`--request-key`):**
  - **Idempotent Replay:** Re-submitting a request with the same `requestKey` and matching payload hash (SHA-256) returns the cached response without creating versions or confirmations.
  - **Payload Conflict (`REQUEST_CONFLICT`):** Reusing an existing `requestKey` with modified content or title aborts immediately with `REQUEST_CONFLICT`.
- **Immutable Confirmations (Schema 7):**
  - When saving an identical active note (matching title, content, type, and pinned status) with a **new request key**:
    - For notes with a topic (`topicKey`), it matches exact content.
    - For notes without a topic (`topicKey: null`), it matches within a **15-minute sliding window** (`now - 900,000 ms` to `now`).
    - Instead of fabricating a redundant version 2, Engram records an immutable confirmation event in `confirmations` linked to the intact active version.
    - Memory revision history remains at **exactly 1 version**.
    - **Honest Semantic Meaning:** Signifies the fact was observed again; does not certify absolute truth or human verification.
  - **Clock Skew Protection (`CLOCK_SKEW`):** If the local system clock is earlier than the timestamp of the confirmed memory version, Engram aborts with `CLOCK_SKEW`.
- **Session Inference:**
  - CLI `save` with `--session-id`: binds explicitly (`sessionSource: "explicit"`).
  - CLI `save` without `--session-id`: on Schema 6+, falls back to the machine's local manual session for the project (`sessionSource: "manual"`). For shared memories, saves without session (`sessionSource: null`).
  - MCP `memory_save` without `sessionId`: auto-binds if exactly 1 session was active in the last 7 days (`sessionSource: "inferred"`). If multiple candidates exist, halts with `AMBIGUOUS_SESSION`.
  - Shared memory with session: stored with `projectId: null` and strips private session origin metadata from external responses.

---

### 4.2. `search`
Searches active memories using SQLite FTS5 trigram tokenization and BM25 recency & stability multipliers.

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
  - `--limit <n>`: Maximum results (integer $\ge 1$, default 20).
  - `--scope <all|project|shared>`: Scope filter (`all` default).
- **Result Structure & Explanation Object:**
  Each search result contains `memory` and `explanation`:
  ```json
  {
    "memory": { ... },
    "explanation": {
      "mode": "fts5",
      "bm25": -2.145,
      "multiplier": 1.069,
      "orderScore": -2.293,
      "reinforcement": {
        "revisionCount": 0,
        "duplicateCount": 1,
        "lastSeenAt": "2026-09-17T12:12:00.000Z",
        "ageDays": 0.005,
        "pinnedBoost": 0,
        "recencyBoost": 0.059,
        "stabilityBoost": 0.008
      }
    }
  }
  ```
  - **FTS5 Ordering:** Sorted ascending by `orderScore = bm25 * multiplier`, breaking ties with `id ASC`. Because BM25 scores in SQLite FTS5 are negative, a higher multiplier yields a more negative value, ordering the note higher in search results.

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
- **Options:**
  - `--id <UUID>`: Memory identifier (mandatory).
  - `--version <n>`: Historical revision number (optional, integer $\ge 1$).

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
> All commands in this section require **Schema 6+** (enabled via `forge614-engram sessions-enable` or `reinforcement-enable`).

---

### 5.1. `session-start`
Starts a runtime work session tied to a project directory.

```bash
forge614-engram session-start \
  --directory "/Users/usuario/Desktop/my-project" \
  --session-id "ses-refactor-api"
```
- **Options:** `--directory <path>`, `--session-id <id>` (1..200 characters).
- **JSON Output:**
  ```json
  {
    "sessionId": "ses-refactor-api",
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "kind": "runtime",
    "startedAt": "2026-09-17T12:00:00.000Z",
    "endedAt": null
  }
  ```

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

## 6. Official Error Codes Catalog

When a CLI command fails, it outputs a JSON object to `stderr` with exit code `1` formatted as `{ "error": "<CODE>", "message": "<explanation>" }`:

| Error Code | Root Cause | Remediation |
| :--- | :--- | :--- |
| `INVALID_INPUT` | Incorrect syntax, unknown flags, repeated or conflicting options. | Check arguments against this manual. |
| `REINFORCEMENT_REQUIRED` | Local client lacks Schema 7 while remote syncs Format 3. | Run `forge614-engram reinforcement-enable` locally. |
| `SYNC_UPGRADE_REQUIRED` | Remote replica or local client requires explicit format promotion. | Run `forge614-engram sync --upgrade-format` deliberately. |
| `CLOCK_SKEW` | Local system clock is earlier than confirmed memory version timestamp. | Synchronize system clock with NTP. |
| `REQUEST_CONFLICT` | Reused the same `requestKey` with different payload (title, content, etc.). | Use a fresh `requestKey` for distinct requests. |
| `AMBIGUOUS_SESSION` | 2+ runtime sessions open concurrently on directory without `--session-id`. | Pass explicit `--session-id <id>` with command. |
| `SESSION_CLOSED` | Attempted to link memory to a session that has already ended. | Start a new session or save without referencing ended session. |
| `SESSION_KIND` | Attempted to close a permanent manual session with `session-end`. | Only runtime sessions can be concluded. |
| `NO_SESSION_CONTEXT` | Requested note in `timeline` does not belong to session or is archived. | Verify note UUID and session membership. |
| `SUMMARY_TOPIC_RESERVED` | Attempted to manually use reserved topic prefix `session/<id>/summary` in `save`. | Session summaries must only be recorded via `session-summary`. |
| `PROJECT_BINDING_REQUIRED` | Bound directory was moved, renamed, or unmounted. | Use `project-bind` to re-bind directory to project ID. |
| `CONFLICT` | OpenCode has existing divergent plugin file. | Backup and reconcile local file before running `tui`. |
| `PUBLISHED_UNVERIFIED` | Assistant configuration file was modified concurrently after write. | Review configuration files and re-run. |
| `INTERACTIVE_REQUIRED` | `setup` or `tui` invoked without interactive TTY terminal. | Run command in an interactive terminal. |
| `SYNC_DISABLED` | `sync` invoked but PostgreSQL replication is not configured in `.env`. | Run `forge614-engram setup` to configure replica. |
| `SYNC_CONFLICT` | Irreconcilable 3-way merge conflict between local and remote snapshots. | Review conflicting versions and resolve divergence. |
| `SYNC_TOO_LARGE` | Combined sync snapshot exceeds 8 MiB size limit. | Prune or archive historical records to reduce snapshot size. |
| `POSTGRES_UNAVAILABLE` | Remote PostgreSQL server unreachable or rejected connection. | Verify network, server status, and credentials. |

---

## 7. Comprehensive Options Summary Table

| Command | Mandatory Options | Optional Options | Output |
| :--- | :--- | :--- | :--- |
| `setup` | None | None | Interactive text |
| `tui` | None | None | Interactive screen |
| `assistant-list` | None | None | JSON |
| `integration-enable` | None | None | JSON |
| `sessions-enable` | None | None | JSON |
| `reinforcement-enable` | None | None | JSON |
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
