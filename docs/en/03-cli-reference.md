# 03 (EN). Terminal CLI Command Reference

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Active (Verified with 191 tests on macOS with Bun 1.3.8)
> **Sister translation:** [03. Manual Exhaustivo de Terminal (CLI)](../es/03-referencia-cli.md)

This guide exhaustively documents all commands, options, syntax rules, exit codes, and output modes of the Forge614 Engram command-line interface (CLI).

---

## 1. General Terminal Syntax & Operational Rules

1. **Command Invocation:** The command verb must immediately follow the program binary:
   ```bash
   forge614-engram <command> [options...]
   # Or when developing with Bun inside the repository:
   bun run cli <command> [options...]
   ```
2. **Option Formatting:** Each option flag (`--flag`) must be separated from its value by a space. Key-value assignment (`--flag=value`) is not supported.
   - ✅ Correct: `--project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --limit 5`
   - ❌ Incorrect: `--project-id=7c9e6679-7425-40de-944b-e07fc1f90ae7`
3. **Double Quotes for Text with Spaces:** All titles, contents, and project names containing spaces must be enclosed in double quotes (`"..."`).
4. **Strict Upfront Validation:** If you pass unknown flags, duplicate options, or incompatible arguments (e.g. combining `--scope shared` with `--project-id` on single-memory commands), execution terminates immediately with a syntax error **before reading configuration or opening SQLite**.
5. **Output Channels & Exit Codes:**
   - **Interactive Commands (`setup`, `tui`):** Emit human-readable text to `stdout`. Return exit code `0` on successful confirmation; code `130` on cancellation (`Ctrl+C`, `Escape`, `cancelar`, `q`, or `no`); and code `1` on error or non-interactive execution (`isTTY` is false, throwing `INTERACTIVE_REQUIRED`).
   - **MCP Server (`mcp`):** Reserves `stdout` exclusively for JSON-RPC protocol frames. Exiting via SIGINT (`Ctrl+C`) returns code `130`; SIGTERM returns code `143`.
   - **Continuous Watcher (`sync-watch`):** Emits successful rounds as JSON to `stdout` and retry warnings to `stderr`. Exits with code `130` when interrupted via `Ctrl+C`.
   - **Data & Automation Commands (`init`, `sync`, `assistant-list`, `integration-enable`, `project-*`, `save`, `search`, etc.):** Emit structured **JSON** to `stdout` with exit code `0` on success. On failure, emit a structured JSON error object to `stderr` with exit code `1`.
6. **Removed Flags that are NOT Supported:**
   - `--db`: Rejected. The database path is fixed at `~/.forge614/engram.db`.
   - `--project` (by name): Rejected. Project identity is strictly `--project-id <UUID>`.
   - `--id-project`: Rejected. The canonical flag name is `--project-id`.

---

## 2. Configuration, Assistant, and MCP Commands

---

### 2.1. `--version`
Displays the program name and installed version.

```bash
forge614-engram --version
```
- **Output:** `forge614-engram 0.5.0`
- **Options:** Accepts no additional flags.
- **Side effects:** None. Does not read or write disk files.

---

### 2.2. `help`
Prints the official quick-reference manual in the terminal.

```bash
forge614-engram help
```

---

### 2.3. `setup`
Interactive setup wizard for configuring central user storage (`~/.forge614/.env` and `~/.forge614/engram.db`) with or without PostgreSQL sync.

```bash
forge614-engram setup
```
- **Options:** None.
- **Requirements:** Interactive terminal (`stdin` and `stdout` TTY).
- **Exit codes:** `0` on confirmation; `130` on cancellation; `1` on error.

---

### 2.4. `tui`
Full-screen interactive terminal menu for auditing, previewing, and configuring AI coding assistants (Claude Code, Codex, Cursor, OpenCode, Gemini CLI).

```bash
forge614-engram tui
```
- **Options:** None.
- **Requirements:** Interactive terminal (`isTTY` true and raw mode support). Non-interactive execution throws `INTERACTIVE_REQUIRED`.
- **Keyboard navigation:**
  - `↑` / `↓`: Move cursor.
  - `Space`: Select or deselect client.
  - `r`: Rescan installed executables and configurations.
  - `c`: Customize executable or config directory via masked input.
  - `t` / "Probar servidor propio (opcional)": Runs an asynchronous 5-second self-test of Engram's installed binary via MCP SDK over stdio, checking the 5 expected tools. Pressing `Escape` during the test cancels only the self-test.
  - `Enter`: Advances through screens (`List` $\rightarrow$ `Preview` $\rightarrow$ `Confirm` $\rightarrow$ `Apply`).
  - `Escape`: Steps back to previous screen.
  - `Ctrl+C`: Cancels session immediately, restores terminal, and exits with code `130`.
- **Side effects:**
  - In Preview: None (zero disk writes).
  - In Confirm: Executes preflight, enables Schema 5 in SQLite, creates `0600` backups with UUID suffixes, applies client configurations preserving comments, and validates post-publication bytes (`PUBLISHED_UNVERIFIED` on external interference).

---

### 2.5. `assistant-list`
Read-only structured JSON inspection auditing installed assistant executables, existing configuration files, and native hook coverage levels.

```bash
forge614-engram assistant-list
```
- **Options:** None.
- **Output:** JSON array of assistant descriptors. Ideal for automation scripts.
- **Side effects:** None. Does not write files, initialize databases, or launch client processes.

---

### 2.6. `integration-enable`
Explicitly enables assistant integration and local project bindings by upgrading the local SQLite database to **Schema 5** (adds `project_bindings` table), without modifying any client configuration files.

```bash
forge614-engram integration-enable
```
- **Options:** None.
- **JSON Output:**
  ```json
  {
    "enabled": true,
    "schema": 5
  }
  ```
- **Side effects:** Initializes central storage if absent and applies additive Schema 5 migration.

---

### 2.7. `mcp`
Launches the local Model Context Protocol server over standard input/output (`stdio`).

```bash
forge614-engram mcp
```
- **Options:** None.
- **Channels:** Reserves `stdout` strictly for JSON-RPC MCP messages.
- **Exposed Tools:**
  1. `memory_current_project`
  2. `memory_search`
  3. `memory_get`
  4. `memory_save`
  5. `memory_history`
- **Precondition:** Requires Schema 5 enabled beforehand (via `tui` or `integration-enable`). The MCP server never auto-migrates the database on launch.
- **Shutdown:** Closes cleanly on `EOF` on `stdin`; exits with code `130` on `SIGINT`; exits with code `143` on `SIGTERM`.

---

### 2.8. `memory-hook`
Native adapter invoked by assistant lifecycle hooks on session start or prompt submission.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|gemini-cli>
```
- **Required flag:** `--client <name>`
- **Output:** Emits native JSON context for the specified client, injecting memory guidance.
- **Side effects:** **Never saves memories directly to disk.** Saves are performed by the model via `memory_save`.

---

### 2.9. `project-bind`
Manually associates a local filesystem path with an existing project UUID (`projectId`).

```bash
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```
- **Required flags:** `--directory <path>`, `--project-id <UUID>`
- **Behavior:** Resolves canonical repository root via Git (`git rev-parse --path-format=absolute --git-common-dir`), unifying worktrees and subdirectories.
- **JSON Output:**
  ```json
  {
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "directory": "/Users/usuario/Desktop/my-project",
    "source": "binding"
  }
  ```

---

### 2.10. `init`
Programmatically initializes central storage (`~/.forge614/.env` and `~/.forge614/engram.db`) in purely local mode.

```bash
forge614-engram init
```
- **JSON Output:** `{"initialized":true,"storage":"sqlite"}`
- **Side effects:** Idempotent. Preserves any pre-existing memories.

---

### 2.11. `sync`
Executes an immediate round of 3-way merge snapshot synchronization against the configured PostgreSQL replica.

```bash
forge614-engram sync
```
- **Options:** None.
- **JSON Output:**
  ```json
  {
    "synchronized": true,
    "projects": 3,
    "memories": 15
  }
  ```
- **Errors:** Returns `SYNC_DISABLED` if sync is not enabled, `SYNC_CONFLICT` on incompatible concurrent edits, and `SYNC_TOO_LARGE` if snapshots exceed 8 MiB.

---

### 2.12. `sync-watch`
Executes an immediate sync round and maintains a foreground polling loop.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Optional flag:** `--interval <seconds>` (integer between 1 and 3600; default `30`).
- **Behavior:** Runs in foreground. Exiting with `Ctrl+C` exits cleanly with code **130** while preserving local SQLite data.

---

## 3. Project Management Commands

---

### 3.1. `project-create`
Registers a new project in the central database.

```bash
forge614-engram project-create --name "Recommendation Engine"
```
- **Required flag:** `--name <text>`
- **Output:** Returns project object with generated UUID `projectId`.

---

### 3.2. `project-list`
Lists all registered projects in the central database.

```bash
forge614-engram project-list
```
- **Output:** Chronologically sorted JSON array of all projects.

---

### 3.3. `project-rename`
Updates a project's cosmetic display name without modifying its UUID or memories.

```bash
forge614-engram project-rename \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --name "New Project Name"
```
- **Required flags:** `--project-id <UUID>`, `--name <text>`

---

## 4. Memory Storage & Retrieval Commands

---

### 4.1. `save`
Creates a new memory or records a new revision of an existing topic (`--topic`).

```bash
# Save to a project:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Database Selection" \
  --content "We will use PostgreSQL 16 with physical replication." \
  --type decision \
  --topic "database-engine"

# Update an existing topic (requires expected-version):
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "database-engine" \
  --title "Engine Upgrade" \
  --content "We will upgrade to PostgreSQL 17." \
  --type decision \
  --expected-version 1

# Save a universal shared memory:
forge614-engram save \
  --scope shared \
  --title "Language Convention" \
  --content "Write all technical documentation in English." \
  --type preference
```

- **Flags:**
  - `--title <text>`: Note title (required).
  - `--content <text>`: Note content (required).
  - `--type <type>`: `fact` (default), `decision`, `procedure`, `warning`, `preference`.
  - `--scope <project|shared>`: Memory scope (`project` by default).
  - `--project-id <UUID>`: Required when scope is `project`; rejected when scope is `shared`.
  - `--topic <key>`: Topic identifier for evolutive updates.
  - `--expected-version <int>`: Required when updating an existing topic.
  - `--request-key <key>`: Idempotency dispatch key for safe retries.
  - `--pinned <true|false>`: Pins memory for boosted search rank.

---

### 4.2. `search`
Searches active memories using SQLite FTS5 with trigram tokenization and BM25 ranking.

```bash
# Combined search across project and shared memories (scope all default):
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "postgresql replication" \
  --limit 5

# Exclusive search for shared memories:
forge614-engram search --scope shared --query "convention"
```

---

### 4.3. `get`
Retrieves a memory record by its UUID.

```bash
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

### 4.4. `history`
Returns the immutable version history of a memory across past revisions.

```bash
forge614-engram history \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

### 4.5. `archive` and `restore`
- `archive`: Hides a memory from standard searches while preserving complete history.
- `restore`: Reactivates an archived memory.

```bash
forge614-engram archive \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"

forge614-engram restore \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

## 5. Command Summary Reference Table

| Command | Required Flags | Optional Flags | Output Format |
| :--- | :--- | :--- | :--- |
| `setup` | None | None | Interactive text |
| `tui` | None | None | Full-screen interactive |
| `assistant-list` | None | None | JSON |
| `integration-enable` | None | None | JSON |
| `mcp` | None | None | JSON-RPC (stdio) |
| `memory-hook` | `--client` | None | Native JSON |
| `project-bind` | `--directory`, `--project-id` | None | JSON |
| `init` | None | None | JSON |
| `sync` | None | None | JSON |
| `sync-watch` | None | `--interval` | Continuous JSON |
| `project-create` | `--name` | None | JSON |
| `project-list` | None | None | JSON |
| `project-rename` | `--project-id`, `--name` | None | JSON |
| `save` | `--title`, `--content` | `--type`, `--scope`, `--project-id`, `--topic`, `--expected-version`, `--request-key`, `--pinned` | JSON |
| `search` | `--query` | `--project-id`, `--scope`, `--limit` | JSON |
| `get` | `--id` | `--project-id`, `--scope` | JSON |
| `history` | `--id` | `--project-id`, `--scope` | JSON |
| `archive` | `--id` | `--project-id`, `--scope` | JSON |
| `restore` | `--id` | `--project-id`, `--scope` | JSON |
| `--version` | None | None | Plain text |
| `help` | None | None | Plain text |
