# 03. Terminal CLI Command Reference

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [03. Referencia Completa de Terminal (CLI)](../es/03-referencia-cli.md)

This reference documents the command-line interface (CLI) for Forge614 Engram.

---

## 1. General Command-Line Rules

1. **Strict Syntax Order:** The subcommand must appear immediately after the executable:
   ```bash
   forge614-engram <command> [options...]
   # or inside repository during development:
   bun run cli <command> [options...]
   ```
2. **Option Spacing:** Each flag (`--option`) must be followed by a space and its value. The `--option=value` syntax is not accepted.
   - ✅ Correct: `--project demo --limit 5`
   - ❌ Invalid: `--project=demo`, `--limit=5`
3. **Quotes for Spaced Text:** Any text containing spaces must be enclosed in double quotes (`"..."`).
4. **No Unknown or Duplicate Flags:** Reusing a flag or specifying an unrecognized argument causes immediate rejection before opening SQLite.
5. **Output Channels and Status Codes:**
   - **Success:** JSON output emitted to standard output (`stdout`) with exit code `0`.
   - **Failure:** JSON error object emitted to standard error (`stderr`) with exit code `1`.

---

## 2. Universal Options

These options apply to **all data subcommands**:

| Option | Required | Default | Description and Behavior |
| :--- | :--- | :--- | :--- |
| `--project <name>` | **Yes** | *(None)* | Target project scope. Whitespace is trimmed and characters are lowercased (`My Project` $\rightarrow$ `my project`). |
| `--db <path>` | No | `~/.forge614/engram.db` | File path to SQLite database. Defaults to the centralized user storage database. Automatically created if missing on valid operations. |

---

## 3. Subcommand Reference

---

### 3.1. `--version`
Displays package name and installed version.

```bash
forge614-engram --version
```
- **Output:** `forge614-engram 0.1.0`
- **Options:** Accepts no additional options.
- **Side effects:** Does not touch filesystem or open SQLite.

---

### 3.2. `help`
Displays built-in quick reference manual.

```bash
forge614-engram help
```
- **Options:** Accepts no additional arguments.
- **Side effects:** Does not touch disk or create folders.

---

### 3.3. `save`
Stores a new memory card or saves a new revision to an existing topic.

> [!NOTE]
> `save` is an explicit manual operation in Stage 1. Automated assistant-driven recording via MCP is planned for Stage 2.

#### Specific Options:
| Option | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--title <title>` | **Yes** | *(None)* | Descriptive heading. Trimmed. |
| `--content <text>` | **Yes** | *(None)* | Memory body text. |
| `--type <type>` | No | `fact` | Conceptual category. Allowed: `fact`, `decision`, `procedure`, `warning`, `preference`. |
| `--topic <key>` | No | `null` | Unique topic key for versioning (e.g. `architecture/database`). Case-sensitive. |
| `--expected-version <n>` | Conditional | `null` | Integer ($\ge 1$). **Mandatory if `--topic` already exists**. Must match current version in DB. |
| `--request-key <key>` | No | `null` | Idempotency key. Re-sending identical payload with the same key returns previous record without writing. |
| `--pinned <true\|false>` | No | `false` | Priority flag. Only accepts literal `true` or `false`. |

#### Example 1: Initial save with topic and request key
```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

**Output (stdout):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite localmente",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:19:51.746Z"
}
```

#### Example 2: Update topic to revision 2
```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

---

### 3.4. `search`
Finds active memories in the specified project.

#### Specific Options:
| Option | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--query <text>` | **Yes** | *(None)* | Search terms. All words must match. |
| `--limit <n>` | No | `10` | Maximum results to return (range: 1..100). |

#### Example:
```bash
forge614-engram search --project demo --query SQLite --limit 5
```

---

### 3.5. `get`
Retrieves the current record of a specific memory by ID.

```bash
forge614-engram get --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.6. `history`
Returns chronological array of all historical content snapshots for the memory.

```bash
forge614-engram history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.7. `archive` and `restore`
- `archive`: Hides memory from search results without destroying version snapshots.
  ```bash
  forge614-engram archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
  ```
- `restore`: Restores an archived memory back to active search visibility.
  ```bash
  forge614-engram restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
  ```
