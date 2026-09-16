# Internal Architecture, Storage Engine, and Ranking Formulas

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/05-arquitectura-interna-y-formulas.md)

This document details the internal design of Forge614 Engram: database pragmas, relational table structures, synchronization triggers, and the mathematical formulas powering the search engine.

---

## 1. Database Pragmas and Concurrency

Forge614 Engram relies on Bun's embedded SQLite driver (`bun:sqlite`), initialized with strict consistency settings:

1. **`PRAGMA foreign_keys = ON;`**  
   Enforces relational integrity. Historical versions in `memory_versions` cannot exist without a corresponding row in `memories`.
2. **`PRAGMA busy_timeout = 5000;`**  
   If multiple processes attempt to write concurrently, SQLite will wait up to **5,000 milliseconds** (5 seconds) for the active transaction to commit before throwing `SQLITE_BUSY`.
3. **`PRAGMA application_id = 1177956660;`**  
   Unique application identifier. Validated on open to guarantee that Forge614 does not open or alter unrelated SQLite files.
4. **`PRAGMA user_version = 1;`**  
   Schema version gatekeeper. Incompatible future schema versions (`user_version > 1`) are rejected immediately.
5. **`PRAGMA journal_mode = WAL;`**  
   Enables Write-Ahead Logging for high-throughput concurrent reads and writes.
   - **Auxiliary Files:** Generates `-wal` (pending write log) and `-shm` (shared memory index) files alongside `memory.sqlite`.
   - ⚠️ **Backup Notice:** Never copy only the `.sqlite` file while writing processes are active. Wait for connections to close.

---

## 2. Relational Schema Architecture

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            memories             │       │         memory_versions         │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ rowid (Internal PK)             │       │ memory_id (FK -> memories.id)   │◄──┐
│ id (UUID string)                │◄──┐   │ version (Integer >= 1)          │   │
│ project (Normalized lowercase)  │   │   │ snapshot (Validated JSON)       │   │
│ topic_key (Scoped unique key)   │   │   └─────────────────────────────────┘   │
│ type (Category)                 │   │                     ▲                   │
│ title (String)                  │   │                     │                   │
│ content (String)                │   │                     │                   │
│ pinned (0 or 1)                 │   │   ┌─────────────────┴───────────────┐   │
│ version (Current integer)       │   │   │            requests             │   │
│ state ('active' | 'archived')   │   │   ├─────────────────────────────────┤   │
│ created_at / updated_at         │   │   │ project (String)                │   │
└─────────────────────────────────┘   │   │ request_key (String)            │   │
                 ▲                    │   │ payload_hash (SHA-256)          │   │
                 │                    │   │ memory_id, version (FK) ────────┼───┘
┌────────────────┴────────────────┐   │   └─────────────────────────────────┘
│             events              │   │
├─────────────────────────────────┤   │   ┌─────────────────────────────────┐
│ id (Autoincrement PK)           │   │   │          memories_fts           │
│ memory_id (FK -> memories.id)   ├───┘   ├─────────────────────────────────┤
│ action ('save'|'archive'|'rest')│       │ FTS5 Virtual Table (trigram)    │
│ version (Integer)               │       │ External content -> memories    │
│ created_at (ISO timestamp)      │       └─────────────────────────────────┘
└─────────────────────────────────┘
```

### Table Breakdown:
- **`memories`:** Represents the live, current state of every memory. Enforces `UNIQUE(project, topic_key)`.
- **`memory_versions`:** Stores immutable content snapshots guarded by `CHECK(json_valid(snapshot))`.
- **`requests`:** Idempotency ledger mapping `(project, request_key)` to a cryptographic SHA-256 payload hash and memory version.
- **`events`:** Chronological audit trail logging `'save'`, `'archive'`, and `'restore'` actions.
- **`memories_fts`:** SQLite FTS5 full-text virtual table using the `trigram` tokenizer.

---

## 3. Automated Synchronization Triggers

SQLite database triggers keep the FTS5 virtual table synchronized automatically without application-layer overhead:
- `memory_insert`: Adds newly saved memories to the FTS index.
- `memory_delete`: Removes entries if a record is deleted.
- `memory_update`: Replaces the search tokens whenever `title`, `content`, or `topic_key` are updated.

---

## 4. Search Ranking Formulas and Algorithms

Search executes in one of two modes:

### Mode 1: FTS5 Trigram with Weighted BM25 and Multiplier

Triggered when **all search terms have at least 3 characters** (e.g. `"sqlite database"`).

#### Step A: Weighted Column BM25
The BM25 formula weights text matches across fields:
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$
- **`title`:** Weight `5.0` (title matches carry 5x importance).
- **`content`:** Weight `1.0` (base relevance).
- **`topic_key`:** Weight `3.0` (topic matches carry 3x importance).

> [!NOTE]
> SQLite BM25 returns **negative numbers**, where more negative values indicate stronger textual relevance.

#### Step B: Recency Decay Factor ($r$)
Recency is computed using a 30-day half-life decay function:

$$r = \frac{1}{1 + \frac{\max(0, \text{days elapsed})}{30}}$$

- Updated **today** ($\text{days} = 0$): $r = 1.0$.
- Updated **30 days ago**: $r = 0.5$.
- Updated **90 days ago**: $r = 0.25$.

#### Step C: Combined Multiplier
$$\text{multiplier} = 1 + (0.10 \times \text{pinned}) + (0.06 \times r)$$

- Pinned memories (`pinned = true`) receive a `+0.10` boost.
- Freshness contributes up to `+0.06` when $r=1.0$.

#### Step D: Final Order Score (`orderScore`)
$$\text{orderScore} = \text{BM25} \times \text{multiplier}$$

Because BM25 is negative, multiplying by a factor $> 1$ makes the score **more negative**, ranking it higher in `ORDER BY orderScore ASC`.

---

### Mode 2: Literal Fallback Search (Short Terms)

When **any** search word has fewer than 3 characters (e.g. `"UI"`, `"DB"`):
1. SQLite trigram cannot index words under 3 characters.
2. The engine scans active project rows using a prepared cursor (`statement.iterate`).
3. Uses case-insensitive Unicode folding (`toLowerCase()`) to match accented characters and short terms.
4. Sets `bm25: null`, `multiplier: 1`, `orderScore: null`.
5. Orders by `pinned DESC, updated_at DESC, id ASC`.

---

## 5. Atomic Transactions and Rollbacks

All mutations are wrapped inside immediate transactions:
```typescript
this.db.transaction(() => { ... }).immediate();
```
If an error occurs while writing the version snapshot, updating the FTS index, or recording the event, SQLite rolls back every change, ensuring zero partial writes or corrupted state.
