# 03. Terminal CLI Command Reference

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Active
> **Sister translation:** [03. Manual Exhaustivo de Terminal (CLI)](../es/03-referencia-cli.md)

This reference documents every command, argument flag, syntax rule, exit code, and output format in the Forge614 Engram command-line interface (CLI).

---

## 1. General CLI Syntax Rules

1. **Command placement:** The command must immediately follow the executable name:
   ```bash
   forge614-engram <command> [options...]
   # Or in repository development mode:
   bun run cli <command> [options...]
   ```
2. **Option syntax:** Flags must be separated from their values with a space. The syntax `--option=value` is not accepted.
   - ✅ Valid: `--project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --limit 5`
   - ❌ Invalid: `--project-id=7c9e6679-7425-40de-944b-e07fc1f90ae7`
3. **Quoting whitespace:** Any title, content, or name with spaces must be enclosed in double quotes (`"..."`).
4. **Strict argument validation:** Unknown options, repeated flags, or conflicting flags (such as combining `--scope shared` with `--project-id` on memory operations) cause an immediate exit with error **before reading configuration or opening SQLite**.
5. **Output channels and exit codes:**
   - **Interactive command (`setup`):** Emits human-readable text to `stdout`. Returns exit code `0` upon confirmation; exit code `130` upon voluntary user cancellation (`cancelar`, `q`, `Ctrl+C`, EOF, or `no`/Enter); and exit code `1` upon error or when invoked without an interactive terminal (`isTTY` is false).
   - **Data and automation commands (`init`, `project-*`, `save`, `search`, etc.):** Output structured **JSON** to `stdout` with exit code `0` on success. On failure, error JSON is written to `stderr` with exit code `1`.
6. **Superseded flags (Disallowed):**
   - `--db`: Not accepted. Fixed location: `~/.forge614/engram.db`.
   - `--project` (by name): Not accepted. The identifier is `--project-id <UUID>`.
   - `--id-project`: Not accepted. Official name is `--project-id`.

---

## 2. Workspace and Project Commands

---

### 2.1. `--version`
Displays package name and installed version.

```bash
forge614-engram --version
```
- **Output:** `forge614-engram 0.3.0`
- **Options:** Accepts no additional options.
- **Side effects:** None. Does not read or create disk files.

---

### 2.2. `help`
Prints command-line help instructions.

```bash
forge614-engram help
```
- **Options:** Accepts no additional options.
- **Side effects:** None. Does not touch disk.

---

### 2.3. `setup`
Guided interactive onboarding assistant for human users. Explains global paths (`~/.forge614/.env` and `~/.forge614/engram.db`), validates existing installations in read-only mode, and requests a single explicit confirmation before initializing storage.

```bash
forge614-engram setup
```
- **Options:** Accepts no flags or arguments (rejects `--project`, `--yes`, storage paths, etc.).
- **Requirement:** Requires an interactive terminal for both stdin and stdout (`process.stdin.isTTY` and `process.stdout.isTTY`). If invoked without a TTY (in pipelines, automated scripts, or background processes), fails with exit code 1 and outputs structured JSON `INTERACTIVE_REQUIRED` to stderr:
  ```json
  {"error":{"code":"INTERACTIVE_REQUIRED","message":"setup necesita una terminal interactiva. Para scripts utiliza init y project-create --name <nombre>."}}
  ```
- **Single Prompt:** Shows paths and summary, asking exclusively:
  ```text
  ¿Confirmar? [si/NO]:
  ```
- **Confirmation:** Accepts `si`, `sí`, `s`, `yes`, `y` (case-insensitive).
- **Cancellation:** If you answer `no`, `n`, press Enter (empty input), type `q`, `cancelar`, press `Ctrl+C`, or send EOF (`Ctrl+D`), execution cancels with **exit code 130**. In a clean environment, no directories or files are created.
- **Zero Project Management:** `setup` **does not ask for, list, create, or select any project**.
- **Standard Output:** Human-readable plain text.

---

### 2.4. `init`
Silently initializes central user storage (`~/.forge614/`), creating `.env` (mode `0600`) and SQLite database `engram.db` (mode `0600`).

```bash
forge614-engram init
```
- **Options:** None.
- **Recommended use:** Non-interactive scripts, automation, and CI/CD pipelines.
- **Behavior:** Idempotent. Valid existing configurations and databases are preserved without modification.
- **Standard Output (JSON):**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

---

### 2.5. `project-create`
Registers a new project in the central `projects` table.

```bash
forge614-engram project-create --name <name>
```
- **Options:**
  - `--name <name>` (**Required**): Descriptive non-empty display name.
- **Behavior:** If storage is not yet initialized, `project-create` automatically initializes the environment. Returns a newly generated UUIDv4 `projectId`.
- **Example:**
```bash
forge614-engram project-create --name "My Application"
```
- **Standard Output (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "My Application",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

---

### 2.6. `project-list`
Lists all registered projects in the central database.

```bash
forge614-engram project-list
```
- **Options:** None.
- **Behavior:** If uninitialized, returns `[]` without creating files. If initialized, returns projects sorted by name.
- **Standard Output (JSON):**
```json
[
  {
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "My Application",
    "createdAt": "2026-09-16T20:00:00.000Z",
    "updatedAt": "2026-09-16T20:00:00.000Z"
  }
]
```

---

### 2.7. `project-rename`
Updates a project's display name.

```bash
forge614-engram project-rename --project-id <UUID> --name <new-name>
```
- **Options:**
  - `--project-id <UUID>` (**Required**): Project UUID.
  - `--name <new-name>` (**Required**): Non-empty new display name.
- **Behavior:** Updates only the `name` column and `updatedAt` timestamp. `projectId`, memories, versions, and request keys remain unchanged.
- **Standard Output (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Renamed Application",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:30:00.000Z"
}
```

---

## 3. Memory Management Commands

---

### 3.1. `save`
Creates a memory or records a new version of an existing topic.

#### Scoping Rules for `save`:
- **For a project memory:** Pass `--project-id <UUID>` (defaults to scope `project`).
- **For a shared memory:** Pass `--scope shared` (forbids `--project-id`).

#### Options for `save`:
| Option | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--title <title>` | **Yes** | *(None)* | Brief descriptive title. |
| `--content <text>` | **Yes** | *(None)* | Memory body content. |
| `--type <type>` | No | `fact` | Conceptual category: `fact`, `decision`, `procedure`, `warning`, `preference`. |
| `--topic <topic>` | No | `null` | Classification key for version tracking (e.g. `architecture/database`). Case-sensitive. |
| `--expected-version <n>` | Conditional | `null` | Positive integer ($\ge 1$). **Required if topic exists** in target scope. |
| `--request-key <key>` | No | `null` | Idempotency dispatch key. Re-sending identical content with the same key returns the existing entry without duplication. |
| `--pinned <true\|false>` | No | `false` | Marks memory with ranking boost during searches. |

#### Example A: Save a project-scoped memory
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database" --content "We use SQLite" --type decision --topic architecture/database
```

#### Example B: Save a shared universal memory
```bash
forge614-engram save --scope shared --title "Preferred language" --content "I prefer explanations in English" --type preference --topic preferences/language
```

---

### 3.2. `search`
Searches active memories using explainable matching (SQLite FTS5 trigram or literal fallback).

#### Scope Selection:
- **With project:** `--project-id <UUID> [--scope all|project|shared]`
  - `all` (**Default**): Returns project matches **plus** shared matches (applying topic overrides if the project defines an active exception).
  - `project`: Restricts search to project memories only.
  - `shared`: Restricts search to shared memories only.
- **Shared only (without project):** `--scope shared`
  - *(Note: Without `--project-id`, search **strictly requires** `--scope shared`. There is no universal search across all projects).*

#### Options for `search`:
| Option | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--query <text>` | **Yes** | *(None)* | Query string. All terms must match. |
| `--limit <1..100>` | No | `10` | Maximum results to return. |

#### Example: Combined project search
```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "SQLite" --limit 5
```

**Standard Output (JSON):**
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Database",
      "content": "We use SQLite",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T20:11:00.000Z",
      "updatedAt": "2026-09-16T20:11:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.059999,
      "orderScore": -0.000001059999
    }
  }
]
```

---

### 3.3. `get`
Retrieves a single memory by UUID.

```bash
# Project memory:
forge614-engram get --project-id <UUID> --id <memory-id>

# Shared memory:
forge614-engram get --scope shared --id <memory-id>
```
- Returns complete memory JSON. Returns `NOT_FOUND` if not found in specified scope.

---

### 3.4. `history`
Retrieves chronological immutable revision snapshots.

```bash
# Project memory:
forge614-engram history --project-id <UUID> --id <memory-id>

# Shared memory:
forge614-engram history --scope shared --id <memory-id>
```
- Returns JSON array of historical snapshot objects from version 1 to present.

---

### 3.5. `archive`
Hides a memory from active searches without deleting data.

```bash
# Project memory:
forge614-engram archive --project-id <UUID> --id <memory-id>

# Shared memory:
forge614-engram archive --scope shared --id <memory-id>
```
- Sets `state: "archived"` and logs an audit record in `events`.

---

### 3.6. `restore`
Reactivates an archived memory.

```bash
# Project memory:
forge614-engram restore --project-id <UUID> --id <memory-id>

# Shared memory:
forge614-engram restore --scope shared --id <memory-id>
```
- Sets `state: "active"` and logs an audit record in `events`.
