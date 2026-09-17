# 05 (EN). Internal Architecture, FTS5, PostgreSQL Sync, and Ranking Formulas

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Verified (90 total tests on macOS with Bun 1.3.8)
> **Sister translation:** [05. Arquitectura Interna, SQLite FTS5, PostgreSQL Sync y Fórmulas Matemáticas](../es/05-arquitectura-interna-y-formulas.md)

This document provides a rigorous technical specification of the internal architecture of Forge614 Engram: SQLite engine pragmas, relational local schemas v3 and v4, the remote PostgreSQL `forge614_sync` schema, the 3-way snapshot reconciliation protocol, reactive triggers, the SQL topic override mechanism, and exhaustive mathematical formulas for **BM25**, recency decay, and explainable search ordering.

---

## 1. SQLite Engine Pragmas, Concurrency, and WAL Initialization

Forge614 Engram builds upon the native SQLite engine bundled in Bun (`bun:sqlite`), initialized with strict security and data integrity directives:

1. **`PRAGMA foreign_keys = ON;`**
   Enforces referential integrity at all times. A record in `memory_versions` cannot exist without referencing an `id` in `memories`, and a project memory cannot reference a `projectId` absent from `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   If concurrent processes attempt to write simultaneously, SQLite waits up to **5,000 milliseconds (5 seconds)** for the active transaction to commit before raising a busy error.
3. **`PRAGMA application_id = 1177956660;`**
   Unique identification signature for Forge614 Engram databases, preventing accidental manipulation of foreign SQLite files.
4. **`PRAGMA user_version = 3` or `4`;**
   - **Version 3:** Pure local SQLite storage without synchronization.
   - **Version 4:** Storage with PostgreSQL replica sync enabled. The `sync_checkpoints` table is added through an additive migration without rewriting or dropping existing tables.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Readers access the main database file while writes append to the auxiliary write-ahead log (`engram.db-wal`).
   - Readers do not block writers and writers do not block readers.
   - Writes remain serialized across processes.

### WAL Initialization Adjustment (Empty Immediate Transaction)
When initializing a new database, the engine runs:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
In Bun under macOS, opening a newly created SQLite database in read-only mode (`readonly: true`, as done by `workspace.open(true)` during `setup`) failed if the WAL file had never materialized an actual physical transaction on disk. This empty transaction forces header synchronization across `engram.db-wal` and `engram.db-shm`.

---

## 2. Local SQLite Relational Schema (Versions 3 and 4)

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
```

### SQL Coherence Constraints:
1. **Scope Mutual Exclusion:**
   ```sql
   CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
   ```
2. **Partial Unique Topic Indexes:**
   ```sql
   CREATE UNIQUE INDEX memories_project_topic ON memories(projectId, topic_key) WHERE scope='project';
   CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
   ```
3. **Partial Idempotency Request Indexes:**
   ```sql
   CREATE UNIQUE INDEX requests_project_key ON requests(projectId, request_key) WHERE scope='project';
   CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
   ```

---

## 3. Remote PostgreSQL Schema (`forge614_sync`) & CAS Concurrency

When PostgreSQL synchronization is configured, Forge614 Engram creates and validates exclusively the `forge614_sync` schema:

```sql
CREATE SCHEMA forge614_sync;

CREATE TABLE forge614_sync.revisions (
  hash text PRIMARY KEY CHECK (length(hash) = 64),
  payload text NOT NULL
);

CREATE TABLE forge614_sync.state (
  id integer PRIMARY KEY CHECK (id = 1),
  format integer NOT NULL CHECK (format = 1),
  replica uuid NOT NULL,
  head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);
```

### PostgreSQL Concurrency and Safety Mechanisms:
1. **Advisory Lock for DDL Schema Initialization:**
   During schema creation in `setup`, the process acquires `SELECT pg_advisory_xact_lock(1177956660, 7)`, preventing race conditions during concurrent setup executions.
2. **Exhaustive Schema Validation:**
   Forge614 validates column names, exact types, nullability, constraints, foreign keys, and asserts that no triggers, stored procedures, or rewrite rules exist in `forge614_sync`. Altered or corrupted schemas raise `POSTGRES_SCHEMA`.
3. **Compare-And-Swap (CAS) Head Locking:**
   When publishing a new revision, the engine locks the state row:
   ```sql
   SELECT head FROM forge614_sync.state WHERE id = 1 FOR UPDATE;
   ```
   If `head` does not match the local expectation (another replica published first), it aborts with `SYNC_REMOTE_CHANGED`.
4. **Immutable Revision Storage:**
   Snapshots are keyed by canonical SHA-256 hash: `INSERT INTO revisions ... ON CONFLICT (hash) DO NOTHING`. Published revision history is never overwritten or deleted.

---

## 4. Deterministic 3-Way Snapshot Reconciliation Protocol

Synchronization compares three full workspace snapshots:
- **`base`:** The snapshot agreed upon during the previous sync with that replica (`sync_checkpoints`).
- **`local`:** The snapshot exported from current local SQLite state.
- **`remote`:** The snapshot corresponding to the active `head` in PostgreSQL.

### Canonical Snapshot Data Contract
```typescript
interface SyncSnapshot {
  format: 1;
  projects: Project[];
  memories: MemoryBundle[];
}

interface MemoryBundle {
  memory: Memory;
  versions: MemoryVersion[];
  requests: { request_key: string; payload_hash: string; version: number }[];
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
```

### Reconciliation Rules & Strict Limits:
1. **8 MiB Hard Size Limit:**
   Every snapshot is checked prior to processing. If `Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024`, the round halts with `SYNC_TOO_LARGE`.
2. **Vanished Record Prohibition:**
   Physical deletion is unsupported. If a record existed in `base` but is missing in `local` or `remote`, reconciliation halts with `SYNC_CONFLICT`.
3. **Entity-by-Entity Merge:**
   - If an entity did not change locally (`local === base`), the remote version is accepted.
   - If an entity did not change remotely (`remote === base`), the local version is preserved.
   - If both local and remote diverged differently relative to `base`, an irresolvable conflict is raised (`SYNC_CONFLICT`).
4. **Immutable Extension Invariant (`assertExtension`):**
   Before and after reconciliation, the system asserts that the merged snapshot is an immutable historical extension of previous states: past versions, creation timestamps, and audit events cannot be modified or truncated.
5. **Atomic SQLite Application (`applySnapshot`):**
   Runs inside an `IMMEDIATE` transaction. Asserts `snapshotHash(current) === snapshotHash(expected)` to ensure no local writes occurred while waiting for network I/O. If local state mutated, it raises `SYNC_LOCAL_CHANGED` and keeps data intact.

---

## 5. Core Architectural Principle: SQLite & FTS5 are ALWAYS Local

> [!IMPORTANT]
> **There is NO `postgres-fts`, NO `tsvector`, and NO `ts_rank_cd`.**
> All searches (`search`) and reads (`get`) are **always resolved in local SQLite**. PostgreSQL serves strictly as a synchronization and snapshot replica backend.
> When remote memories are imported during a sync round, SQLite's reactive triggers automatically update the local `memories_fts` index on your machine.

---

## 6. Reactive FTS5 Triggers in SQLite

```sql
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, topic_key)
  VALUES(new.rowid, new.title, new.content, new.topic_key);
END;

CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, topic_key)
  VALUES('delete', old.rowid, old.title, old.content, old.topic_key);
END;

CREATE TRIGGER memory_update AFTER UPDATE OF title, content, topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, topic_key)
  VALUES('delete', old.rowid, old.title, old.content, old.topic_key);
  INSERT INTO memories_fts(rowid, title, content, topic_key)
  VALUES(new.rowid, new.title, new.content, new.topic_key);
END;
```

---

## 7. Search Query and Topic Override SQL Logic

When querying from a project with `--scope all`:

```sql
SELECT m.*, bm25(memories_fts, 5.0, 1.0, 3.0) AS bm25,
  (1 + 0.10 * m.pinned + 0.06 / (1 + MAX(0, julianday('now') - julianday(m.updated_at)) / 30)) AS multiplier
FROM memories_fts
JOIN memories m ON m.rowid = memories_fts.rowid
WHERE memories_fts MATCH ?
  AND (
    m.projectId = ?
    OR (
      m.scope = 'shared'
      AND (
        m.topic_key IS NULL
        OR m.topic_key NOT IN (
          SELECT topic_key FROM memories
          WHERE projectId = ? AND scope = 'project' AND topic_key IS NOT NULL AND state = 'active'
        )
      )
    )
  )
  AND m.state = 'active'
ORDER BY bm25 * multiplier ASC, m.id ASC
LIMIT ?;
```

---

## 8. Mathematical BM25 Algorithm Breakdown

$$\text{Score}_{\text{BM25}}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- $f(q_i, D)$: Term frequency in document.
- $|D|$: Document token length.
- $\text{avgdl}$: Average document length across collection.
- $k_1 = 1.2$: Term frequency saturation parameter.
- $b = 0.75$: Length normalization parameter.
- Field weights: Title ($5.0$), Topic ($3.0$), Content ($1.0$).

---

## 9. Priority Multiplier & Recency Decay Formula

$$\text{Multiplier} = 1 + 0.10 \cdot \text{pinned} + \frac{0.06}{1 + \frac{\max(0, \Delta t)}{30}}$$

Where:
- $\text{pinned} \in \{0, 1\}$: $0.10$ boost for pinned memories.
- $\Delta t$: Elapsed days since `updated_at`.
- 30-day half-life: A newly saved memory receives a 6% boost, decaying to 3% after 30 days.
- Final rank score: $\text{orderScore} = \text{BM25} \cdot \text{Multiplier}$ (most negative values sort first).
