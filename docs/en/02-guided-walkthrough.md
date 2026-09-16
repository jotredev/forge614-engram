# System Walkthrough Guide

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/02-recorrido-guiado.md)

This guided walkthrough demonstrates the entire lifecycle of a memory in Forge614 Engram: from initial storage to revision updates, word-matching search, historical auditing, and reversible archiving.

---

## 1. The Concept of Project Scope

In Forge614 Engram, **every operation is strictly bound to a project name** via `--project`.

Project names are automatically normalized: leading and trailing whitespaces are trimmed, and letters are converted to lowercase (`Demo-App` becomes `demo-app`).

> [!IMPORTANT]
> **Data Separation, Not User Authentication:** Project scoping organizes records so different workspaces do not cross-contaminate. However, it is not an authentication system. Anyone with access to the SQLite file on disk can inspect its content. Therefore, **never store passwords or sensitive private credentials**.

---

## 2. Standalone Memories vs. Topic Memories

You can store memories in two distinct ways:

### Option A: Standalone Memory (Without a Topic)
If you omit `--topic`, the system records an independent memory card:
```bash
bun run cli save --project demo --title "Team Meeting" --content "Team agreed to hold weekly sprint reviews on Fridays" --type fact
```
Executing this command twice (without `--request-key`) will create two distinct memories with separate UUIDs.

### Option B: Topic Memory (With Revision Tracking)
When an observation represents an evolving concept (e.g. database choice, coding conventions, or architecture patterns), assign a topic key (`--topic`):
```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

**Returned JSON:**
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

Assigning `architecture/database` reserves that topic within project `demo` at **version 1** with a permanent unique ID.

---

## 3. Searching Memories: Word Matching and Explainable Scoring

Search active memories in the project:
```bash
bun run cli search --project demo --query SQLite
```

### Response:
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "project": "demo",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Base de datos",
      "content": "Usamos SQLite localmente",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T16:19:51.746Z",
      "updatedAt": "2026-09-16T16:19:51.746Z"
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

### Search Mechanics:
1. **All Words Must Match (Conjunctive AND):** Searching `SQLite localmente` requires both words to exist within the memory (across title, content, or topic).
2. **Rank Explanation (`explanation`):**
   - `mode: "fts5"`: Query evaluated via SQLite's full-text search engine (FTS5).
   - `bm25`: BM25 algorithm score. In SQLite, **more negative numbers indicate stronger textual matches**.
   - `multiplier`: Factor boosting recent memories and prioritized notes (`pinned`).
   - `orderScore`: Final ranking score (`bm25 * multiplier`), ordered ascending (most negative value first).

---

## 4. Updating a Decision: Optimistic Concurrency Control

When updating a topic, you **must explicitly specify the version you previously read** using `--expected-version`:

```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

### Response:
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

### Key Update Behaviors:
1. **Stable Identifier:** The `id` remains unchanged.
2. **Version Incremented:** Advanced from `1` to `2`.
3. **Full Replacement:** The new body completely replaces previous text (not a partial patch).
4. **Preserving Type and Priority:** The CLI resets omitted fields to defaults (`fact` and `false`). To retain `decision` and `pinned: true`, specify them explicitly during update.
5. **Collision Protection:** If another process modified the topic to version 2 first, sending `--expected-version 1` will abort with `VERSION_CONFLICT`.

---

## 5. History Inspection: Auditing Historical Snapshots

Retrieve past snapshots of the memory using the `history` command:

```bash
bun run cli history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

### Response:
```json
[
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
  },
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
]
```

---

## 6. Duplicate Prevention with Request Keys (Idempotency)

When automated scripts save memories, connection drops or retries can occur:
- Re-sending identical payload data with the same `--request-key demo-v1` returns the original record without adding new database entries.
- Re-using `--request-key demo-v1` with altered text will throw `REQUEST_CONFLICT`.

---

## 7. Archiving and Restoring

Stage 1 does not implement permanent destructive deletion. When a memory is obsolete, archive it:

### Archive:
```bash
bun run cli archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- State transitions to `state: "archived"`.
- Excluded from regular `search` results.
- Still accessible via direct `get` or `history`.
- Trying to save a revision to an archived topic throws `ARCHIVED` until restored.

### Restore:
```bash
bun run cli restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- Transitions back to `state: "active"`.
- Instantly reappears in search results.
- Does not modify content text, version number, or `updatedAt` date.

---

## 8. Short-Word Fallback: Literal Search Mode

Because FTS5 trigrams require tokens of at least 3 characters, searching short terms like `"UI"` or `"DB"` automatically engages the **literal search mode**:

```bash
bun run cli search --project demo --query "UI árbol"
```

- Scans active memories in the project using case-insensitive Unicode (`toLowerCase()`).
- Matches accented characters and short abbreviations.
- Sets `mode: "literal"`, `bm25: null`, `multiplier: 1`, `orderScore: null`.
- Orders results by `pinned DESC, updated_at DESC, id ASC`.
