# 05. Internal Architecture, FTS5, and Ranking Formulas

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Verified
> **Sister translation:** [05. Arquitectura Interna, SQLite FTS5 y Fórmulas](../es/05-arquitectura-interna-y-formulas.md)

This document provides a comprehensive technical breakdown of Forge614 Engram: SQLite engine configuration parameters, relational schema version 3, WAL initialization adjustment, reactive triggers, SQL topic override logic, and the mathematical formulas governing **BM25**, recency decay, and ranking order.

---

## 1. SQLite Engine Configuration (Pragmas), Concurrency, and WAL Initialization

Forge614 Engram operates on Bun's embedded SQLite engine (`bun:sqlite`), initialized with strict integrity directives:

1. **`PRAGMA foreign_keys = ON;`**
   Enforces relational integrity. For example, entries in `memory_versions` cannot exist without a parent in `memories`, and memories cannot reference a non-existent `projectId` in `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   If concurrent processes attempt to write simultaneously, SQLite waits **up to 5,000 milliseconds (5 seconds)** for the active writer to complete before raising a busy error.
3. **`PRAGMA application_id = 1177956660;`**
   Forge614 Engram application signature. Verified on connection to prevent opening foreign databases.
4. **`PRAGMA user_version = 3;`**
   Schema version identifier for this release. Databases with version 1 or 2 are halted with `MIGRATION_REQUIRED` to prevent corruption.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Readers access the main database file while writes append to `engram.db-wal`.
   - Readers and writers do not block each other.
   - **Concurrency Note:** SQLite writes remain serialized (one active writer at a time).

### WAL Initialization Adjustment (Empty Immediate Transaction)
Upon initializing a fresh database, the engine executes:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
- **Technical Rationale:** In Bun 1.3.8 on macOS, opening a newly initialized SQLite database immediately in read-only mode (`readonly: true`, as used by `workspace.open(true)` during `setup` to validate storage without mutating) failed if the WAL file had never had a physical transaction written to disk.
- Executing an empty, immediate transaction (`BEGIN IMMEDIATE; COMMIT;`) materializes internal WAL bookkeeping headers on disk immediately, ensuring subsequent read-only connections succeed reliably even on fresh databases without projects or memories.
- **No Schema Change:** This operational adjustment changes no tables, columns, or triggers; **it is not a schema migration or version bump** (the schema remains `user_version = 3`).
- **Auxiliary Files:** The `engram.db-wal` and `engram.db-shm` files are auxiliary runtime journals; they are not independent databases. Inspecting storage may cause normal operating system file activity on these files.

---

## 2. Relational Schema (Version 3)

```text
┌─────────────────────────────────┐
│            projects             │
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
│ topic_key TEXT (Nullable)       │                         ▲                   │
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
│ id INTEGER (PK Autoincrement)   │       │          memories_fts           │
│ memory_id TEXT (FK memories.id) │       ├─────────────────────────────────┤
│ action ('save'|'archive'|'rest')│       │ FTS5 Virtual Table (trigram)    │
│ version INTEGER                 │       │ title (5.0), topic_key (3.0),   │
│ created_at TIMESTAMP            │       │ content (1.0)                   │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

### Schema Constraints in SQL:
1. **Mutual Scope Exclusion (`scope`):**
   The `memories` table enforces that `project` memories require a `projectId`, while `shared` memories require `projectId` to be null:
   ```sql
   CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
   ```
2. **Partial Unique Indexes by Topic:**
   Ensures unique topics within each project and within the shared space:
   ```sql
   CREATE UNIQUE INDEX memories_project_topic ON memories(projectId, topic_key) WHERE scope='project';
   CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
   ```
3. **Idempotency Request Isolation:**
   The `requests` table isolates request keys per scope:
   ```sql
   CREATE UNIQUE INDEX requests_project_key ON requests(projectId, request_key) WHERE scope='project';
   CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
   ```

### Reactive Triggers
The FTS5 virtual table stays in sync via three automatic SQLite triggers:
- `memory_insert`: Appends new entries to `memories_fts`.
- `memory_delete`: Purges removed rows from `memories_fts`.
- `memory_update`: Atomically updates `memories_fts` when `title`, `content`, or `topic_key` change.

---

## 3. SQL Topic Override Logic

When querying from a project in combined scope (`--scope all`), the engine uses a correlated subquery to determine whether a shared rule should yield to a project-specific exception:

```sql
SELECT m.*, bm25(memories_fts, 5.0, 1.0, 3.0) AS bm25,
  (1 + 0.10 * m.pinned + 0.06 / (1 + MAX(0, julianday('now') - julianday(m.updated_at)) / 30)) AS multiplier
FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
WHERE memories_fts MATCH ? AND (
  m.projectId = ? OR (
    m.scope = 'shared' AND NOT EXISTS (
      SELECT 1 FROM memories p
      WHERE p.projectId = ?
        AND p.scope = 'project'
        AND p.state = 'active'
        AND p.topic_key = m.topic_key
    )
  )
) AND m.state = 'active'
ORDER BY bm25 * multiplier ASC, m.id ASC LIMIT ?;
```

### How the `NOT EXISTS` Subquery Operates:
1. If the candidate memory belongs to the project (`m.projectId = ?`), it is included immediately.
2. If the memory is shared (`m.scope = 'shared'`), SQLite verifies if the project possesses a memory satisfying three conditions:
   - Same `projectId`.
   - Active state (`state = 'active'`).
   - Identical topic key (`p.topic_key = m.topic_key`).
3. If an active project exception exists, `NOT EXISTS` evaluates to false, and the shared rule is **omitted from results**.
4. If the project archives its exception (`state = 'archived'`), `NOT EXISTS` evaluates to true, and the shared guideline reappears.

---

## 4. Understanding BM25 and Negative Values

**BM25** (*Best Matching 25*) evaluates relevance based on three factors:
1. **Term Frequency (TF):** Repetitions of search words, scaled with an asymptotic saturation curve.
2. **Inverse Document Frequency (IDF):** Penalizes ubiquitous words and rewards rare, specific terms.
3. **Length Normalization:** Prevents long notes from outranking concise notes simply due to total word count.

### Why does SQLite FTS5 return negative BM25 numbers?
SQL query engines sort in ascending order (`ASC`) by default. To return the highest-scoring documents first without secondary inversions:
- **SQLite FTS5 negates the score: more negative values indicate higher relevance.**
- A memory with BM25 `-3.8` is **more relevant** than one with `-1.2` or `-0.1`.

---

## 5. Mathematical Ranking Formulas

### Formula 1: BM25 Field Weighting
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$
- **Title (`title`):** Weight `5.0` (highest prominence).
- **Content (`content`):** Weight `1.0` (base text weight).
- **Topic Key (`topic_key`):** Weight `3.0` (classification weight).

---

### Formula 2: Multiplier (Priority & Recency Decay)
$$\text{multiplier} = 1 + (0.10 \times \text{pinned}) + \frac{0.06}{1 + \frac{\max(0, \text{julianday('now')} - \text{julianday}(\text{updated\_at}))}{30}}$$

Where:
- $\text{pinned}$ is `1` if marked priority, `0` otherwise ($+10\%$ boost).
- $r = \max(0, \text{julianday('now')} - \text{julianday}(\text{updated\_at}))$ represents memory age in days.
- The recency component delivers a $+6\%$ boost for brand-new memories ($r = 0$), tapering to $+3\%$ after 30 days.

---

### Formula 3: Final Order Score (*orderScore*)
$$\text{orderScore} = \text{bm25} \times \text{multiplier}$$

Multiplying a negative `bm25` score by a factor greater than `1` makes the result **more negative**. When sorted by `ORDER BY bm25 * multiplier ASC`, superior matches with recency and pinned flags sort to the top.

---

### Formula 4: Literal Fallback for Short Terms
SQLite FTS5's `trigram` tokenizer requires terms of at least 3 characters. For shorter queries (e.g. `"UI"`, `"DB"`):
- The engine falls back to **literal mode (`mode: "literal"`)**.
- Applies Unicode lowercase folding (`toLowerCase()`).
- Iterates over active rows in target scope without loading the full database into RAM.
- Sets `bm25 = null`, `multiplier = 1`, `orderScore = null`.
- Sorts by: `ORDER BY m.pinned DESC, m.updated_at DESC, m.id ASC`.
