# Terminal Command Reference (CLI)

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/03-referencia-03-cli-reference.md)

This reference documents the command-line interface (CLI) for Forge614 Engram.

---

## 1. General Command-Line Rules

1. **Strict Syntax Order:** The subcommand must appear immediately after `cli`:
   ```bash
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
| `--db <path>` | No | `.forge614/memory.sqlite` | File path to SQLite database. Relative to current working directory. Automatically created if missing. |

---

## 3. Subcommand Reference

---

### 3.1. `help`
Displays built-in quick reference manual.

```bash
bun run cli help
```

- **Options:** Accepts no additional arguments.
- **Side effects:** Does not touch disk or create folders.

---

### 3.2. `save`
Stores a new memory card or saves a new revision to an existing topic.

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
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
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
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

**Output (stdout):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```

---

### 3.3. `search`
Finds active memories in the specified project.

#### Specific Options:
| Option | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--query <text>` | **Yes** | *(None)* | Search terms. All words must match. |
| `--limit <n>` | No | `10` | Maximum results to return (range: 1..100). |

#### Example:
```bash
bun run cli search --project demo --query SQLite --limit 5
```

**Output (stdout):**
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "project": "demo",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Base de datos",
      "content": "Usamos SQLite y conservamos revisiones",
      "pinned": false,
      "version": 2,
      "state": "active",
      "createdAt": "2026-09-16T16:19:51.746Z",
      "updatedAt": "2026-09-16T16:20:31.248Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.0599996,
      "orderScore": -0.00000105999
    }
  }
]
```

---

### 3.4. `get`
Retrieves the current record of a specific memory by ID.

#### Specific Options:
| Option | Required | Description |
| :--- | :--- | :--- |
| `--id <uuid>` | **Yes** | Target memory UUID. |

#### Example:
```bash
bun run cli get --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.5. `history`
Returns chronological array of all historical content snapshots for the memory.

#### Specific Options:
| Option | Required | Description |
| :--- | :--- | :--- |
| `--id <uuid>` | **Yes** | Target memory UUID. |

#### Example:
```bash
bun run cli history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.6. `archive`
Hides memory from search results without destroying version snapshots.

```bash
bun run cli archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.7. `restore`
Restores an archived memory back to `active` search visibility.

```bash
bun run cli restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
