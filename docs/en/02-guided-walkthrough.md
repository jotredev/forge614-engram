# 02. System Walkthrough Guide

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This guided walkthrough demonstrates the complete lifecycle of a memory in Forge614 Engram: from initial storage to revision updates, explainable search, historical auditing, and reversible archiving.

> [!NOTE]
> All examples use the compiled `forge614-engram` command. If developing inside the repository without installing, replace `forge614-engram` with `bun run cli`.

---

## 1. Project Scoping within Centralized Storage

In Forge614 Engram, **every operation is strictly bound to a project name** via `--project`.

Project names are automatically normalized: whitespaces are trimmed, and letters are lowercased (`Demo-App` becomes `demo-app`).

All project memories reside within a single user database (`~/.forge614/engram.db`). The `--project` flag ensures that searches executed in `frontend-web` never leak memories from `backend-api`.

<callout icon="⚠️" color="yellow_bg">
**Data Separation, Not User Authentication:** Project scoping organizes records logically. Anyone with local file access to your hard drive can inspect the SQLite file. **Never store secret passwords or tokens**.
</callout>

> [!NOTE]
> **Approved Future Design (`idProject`):** In the current Stage 1 release, project scoping relies on the textual name in `--project`. An approved future architecture (pending implementation) introduces a unique and stable identifier named `idProject` with private per-project configuration in `~/.forge614/projects/<idProject>/.env`. See [08. Stage 1 Boundaries and Planned Roadmap](08-boundaries-and-roadmap.md) for technical details.


---

## 2. Standalone Memories vs. Topic Memories

You can record memories in two distinct ways:

### Option A: Standalone Memory (Without a Topic)
Omit `--topic` to store an independent memory card:
```bash
forge614-engram save --project demo --title "Team Meeting" --content "Team agreed to hold weekly sprint reviews on Fridays" --type fact
```
Executing this command twice (without `--request-key`) creates two distinct memories with separate UUIDs.

### Option B: Topic Memory (With Revision Tracking)
Assign a topic key (`--topic`) when recording evolving architectural or operational decisions:
```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
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
forge614-engram search --project demo --query SQLite
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
1. **Conjunctive Matching (AND):** Searching `SQLite localmente` requires both words to exist within the memory.
2. **Rank Explanation (`explanation`):**
   - `mode: "fts5"`: Evaluated via SQLite's FTS5 full-text search.
   - `bm25`: BM25 score. More negative numbers indicate stronger textual matches.
   - `multiplier`: Factor boosting recent memories and prioritized notes (`pinned`).
   - `orderScore`: Final ranking score (`bm25 * multiplier`), ordered ascending (most negative first).

---

## 4. Updating a Decision: Optimistic Concurrency Control

When updating a topic, you **must explicitly specify the version you previously read** using `--expected-version`:

```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

### Key Update Behaviors:
1. **Stable Identifier:** The `id` remains unchanged.
2. **Version Incremented:** Advanced from `1` to `2`.
3. **Full Replacement:** The new body completely replaces previous text.
4. **Preserving Fields:** The CLI resets omitted flags to defaults (`fact` and `false`). Specify flags explicitly to retain them.
5. **Collision Protection:** If another process modified the topic to version 2 first, sending `--expected-version 1` aborts with `VERSION_CONFLICT`.

---

## 5. History Inspection: Auditing Historical Snapshots

Retrieve past snapshots using `history`:

```bash
forge614-engram history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

## 6. Duplicate Prevention with Request Keys (Idempotency)

- Re-sending identical payload data with the same `--request-key demo-v1` returns the original record without writing duplicate rows.
- Re-using `--request-key demo-v1` with altered text throws `REQUEST_CONFLICT`.

---

## 7. Archiving and Restoring

### Archive:
```bash
forge614-engram archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- Transitions to `state: "archived"`.
- Hidden from regular search, preserved in `get` and `history`.

### Restore:
```bash
forge614-engram restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```
- Transitions back to `state: "active"` and reappears in search.
- **Note:** `restore()` only toggles search visibility; it does not roll back text to older revisions.

---

## 8. Short-Word Fallback: Literal Search Mode

When searching words shorter than 3 characters (e.g. `"UI"`, `"DB"`):
```bash
forge614-engram search --project demo --query "UI árbol"
```
- Scans active memories using Unicode lowercasing (`toLowerCase()`).
- Matches short terms and accented characters.
- Sets `mode: "literal"`, `bm25: null`, `multiplier: 1`, `orderScore: null`.
