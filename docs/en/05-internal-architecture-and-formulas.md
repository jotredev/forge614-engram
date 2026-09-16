# 05. Internal Architecture, SQLite FTS5, and Ranking Formulas

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [05. Arquitectura Interna, SQLite FTS5 y Fórmulas](../es/05-arquitectura-interna-y-formulas.md)

This document provides a thorough technical breakdown of Forge614 Engram: database pragmas, relational schema design, reactive synchronization triggers, and deep mathematical explanations of the **BM25** algorithm, recency decay curve, and ranking formulas.

---

## 1. Database Pragmas and Concurrency Model

Forge614 Engram relies on Bun's embedded SQLite driver (`bun:sqlite`), initialized with strict consistency settings:

1. **`PRAGMA foreign_keys = ON;`**  
   Enforces relational integrity. Historical version snapshots in `memory_versions` cannot exist without a valid parent record in `memories`.
2. **`PRAGMA busy_timeout = 5000;`**  
   If multiple processes attempt to write concurrently, SQLite will wait up to **5,000 milliseconds (5 seconds)** for the active transaction to commit before throwing `SQLITE_BUSY`.
3. **`PRAGMA application_id = 1177956660;`**  
   Unique application identifier. Validated on open to guarantee that Forge614 does not open or alter foreign SQLite files.
4. **`PRAGMA user_version = 1;`**  
   Schema version gatekeeper. Future schema versions (`user_version > 1`) are rejected immediately.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**  
   - Allows concurrent reads while pending writes append to a dedicated auxiliary log (`engram.db-wal`).
   - **Concurrency Reality:** Readers do not block writers, and writers do not block readers. However, **writes remain strictly serialized** (SQLite permits only one active writer transaction at a time).
   - ⚠️ **Backup Notice:** Never copy only the `.db` file while writing processes are active; wait for connections to close so that the WAL log commits into the main database.

Central storage path: `~/.forge614/engram.db` (alongside `engram.db-wal` and `engram.db-shm`).

---

## 2. Relational Schema Architecture

```text
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            memories             │       │         memory_versions         │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ rowid (Internal SQLite PK)      │       │ memory_id (FK -> memories.id)   │◄──┐
│ id (UUID string)                │◄──┐   │ version (Integer >= 1)          │   │
│ project (Normalized lowercase)  │   │   │ snapshot (Validated JSON)       │   │
│ topic_key (Scoped unique key)   │   │   └─────────────────────────────────┘   │
│ type (Category)                 │   │                     ▲                   │
│ title / content (Live text)     │   │                     │                   │
│ pinned (0 or 1)                 │   │   ┌─────────────────┴───────────────┐   │
│ version (Current integer)       │   │   │            requests             │   │
│ state ('active' | 'archived')   │   │   ├─────────────────────────────────┤   │
│ created_at / updated_at         │   │   │ payload_hash (SHA-256)          │   │
└─────────────────────────────────┘   │   │ memory_id, version (FK) ────────┼───┘
                 ▲                    │   └─────────────────────────────────┘
                 │                    │   ┌─────────────────────────────────┐
┌────────────────┴────────────────┐   │   │          memories_fts           │
│             events              │   │   ├─────────────────────────────────┤
├─────────────────────────────────┤   │   │ FTS5 Virtual Table (trigram)    │
│ action ('save'|'archive'|'rest')│   │   │ title (5.0), topic_key (3.0),   │
│ memory_id (FK -> memories.id)   ├───┘   │ content (1.0)                   │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

- **`memories`:** Current state of every memory. Guarded by `UNIQUE(project, topic_key)`.
- **`memory_versions`:** Immutable historical content snapshots protected by `CHECK(json_valid(snapshot))`.
- **`requests`:** Idempotency ledger mapping request keys to SHA-256 payload hashes.
- **`events`:** Chronological audit trail logging `'save'`, `'archive'`, and `'restore'` operations.
- **`memories_fts`:** SQLite FTS5 full-text virtual table using the `trigram` tokenizer.

### Automated Synchronization Triggers
Database triggers keep the FTS5 virtual table synchronized automatically:
- `memory_insert`: Automatically registers newly inserted memories into `memories_fts`.
- `memory_delete`: Removes deleted entries from the FTS5 index.
- `memory_update`: Replaces search tokens whenever `title`, `content`, or `topic_key` are updated.

---

## 3. What Is BM25 and How Does It Work?

**BM25** stands for **"Best Matching 25"** (iteration 25). It is the industry-standard probabilistic information retrieval algorithm developed by Stephen Robertson and Karen Spärck Jones (Okapi BM25) used by professional search engines such as Elasticsearch and SQLite FTS5.

### The Three Mathematical Pillars of BM25
1. **Term Frequency Saturation (TF):**  
   The more times a search word appears in a memory, the more relevant it is. However, BM25 applies an asymptotic curve: jumping from 0 to 1 mention provides a huge relevance boost; jumping from 10 to 20 mentions provides marginal gains, preventing spammy repeated text from dominating search results.
2. **Inverse Document Frequency (IDF):**  
   Evaluates keyword specificity. Common words appearing across many memories receive near-zero weight. Rare, distinctive terms (e.g. `"SQLite"`, `"idempotency"`, `"WAL"`) carry high discriminative scores.
3. **Document Length Normalization:**  
   Penalizes artificially long documents so they do not win simply by virtue of having more total words. A 10-word note containing `"SQLite"` twice (20% concentration) is ranked much higher than a 1,000-word essay containing `"SQLite"` twice in passing.

### Why Does SQLite FTS5 Return Negative Numbers?
In academic theory, BM25 produces positive scores where higher is better.

**In SQLite FTS5, the `bm25()` helper function returns negative numbers by design.**  
The reason is SQL query optimization: database queries naturally sort in ascending order (`ASC`, lowest to highest). To place the best match first without extra computation, SQLite negates the score:
- **More negative numbers (further left from zero on the number line) indicate stronger relevance.**
- A memory with BM25 of `-4.5` is **more relevant** than one with `-2.1` or `-0.3`.

---

## 4. Mathematical Breakdown of the 4 Ranking Formulas

```text
[User Search Query]
         │
         ▼
Formula 1: bm25(memories_fts, 5.0, 1.0, 3.0) ─────────► Negative BM25 score (e.g. -2.00)
         │
         ▼
Formula 2: r = 1 / (1 + max(0, days)/30) ─────────────► Recency factor r between 0.0 and 1.0
         │
         ▼
Formula 3: multiplier = 1 + (0.10*pinned) + (0.06*r) ──► Multiplier boost between 1.00 and 1.16
         │
         ▼
Formula 4: orderScore = BM25 * multiplier ────────────► Final ranking score (sorted ASC)
```

---

### Formula 1: Column Weighted BM25
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$

Forge614 Engram weights the three FTS5 text columns differently:
- **`title`:** Weight **`5.0`** ($\times 5$). Title matches indicate the note was specifically named after that concept.
- **`content`:** Weight **`1.0`** ($\times 1$). Base body text relevance.
- **`topic_key`:** Weight **`3.0`** ($\times 3$). Topic matches indicate a core architectural grouping.

---

### Formula 2: Recency Decay Curve ($r$)
$$r = \frac{1}{1 + \frac{\max(0, \text{days})}{30}}$$

Models memory freshness over time based on elapsed days since `updatedAt`:
- **The number 30 is the 30-day half-life:** At 30 days old, freshness decays to exactly half ($0.5$).
- **Values over time:**
  - **Day 0 (Modified today):** $\text{days} = 0 \rightarrow r = \frac{1}{1 + 0/30} = \mathbf{1.0}$ (maximum freshness).
  - **Day 30 (1 month old):** $\text{days} = 30 \rightarrow r = \frac{1}{1 + 30/30} = \frac{1}{2} = \mathbf{0.5}$.
  - **Day 60 (2 months old):** $\text{days} = 60 \rightarrow r = \frac{1}{1 + 60/30} = \frac{1}{3} \approx \mathbf{0.333}$.
  - **Day 180 (6 months old):** $\text{days} = 180 \rightarrow r = \frac{1}{1 + 180/30} = \frac{1}{7} \approx \mathbf{0.142}$.
- **`max(0, days)`:** Defensive guard against negative values from future clock drifts.

---

### Formula 3: Priority and Recency Multiplier
$$\text{multiplier} = 1 + (0.10 \times \text{pinned}) + (0.06 \times r)$$

Computes the boost factor applied to raw textual relevance:
1. **Neutral Base `1.0`:** All notes start from a baseline of 1.0.
2. **Pinned Boost (`pinned`):**
   - If `--pinned true`, `pinned = 1`. Adds a fixed boost of **`+0.10`** (10% advantage).
   - If unpinned, `pinned = 0`, adding `+0.00`.
3. **Freshness Boost ($r$):**
   - Notes modified today ($r=1.0$) add up to $0.06 \times 1.0 = \mathbf{+0.06}$ (6% advantage).
   - Notes modified 30 days ago ($r=0.5$) add $0.06 \times 0.5 = \mathbf{+0.03}$.
   - Neglected notes ($r \approx 0$) add `+0.00`.

**Multiplier Range:** Strictly bounded between **`1.00`** and **`1.16`**.

---

### Formula 4: Final Order Score (`orderScore`)
$$\text{orderScore} = \text{BM25} \times \text{multiplier}$$

Because BM25 is **negative** (e.g. `-2.00`), multiplying by a factor greater than 1 (e.g. `1.16`) produces a **more negative** number:

$$-2.00 \times 1.16 = \mathbf{-2.32}$$

In SQL:
```sql
ORDER BY bm25 * multiplier ASC, m.id ASC
```

Since sorting is ascending (`ASC`), on the negative number line:
$$\mathbf{-2.32} < -2.06$$

Thus, **`-2.32` is smaller and ranks first (#1)**.

#### Comparative Example:
Two notes with identical text match ($\text{BM25} = -2.00$):
- **Note A:** Pinned (`pinned = 1`) and modified today ($r = 1.0$).  
  $\text{multiplier} = 1 + 0.10(1) + 0.06(1.0) = 1.16$  
  $$\text{orderScore}_A = -2.00 \times 1.16 = \mathbf{-2.32}$$
- **Note B:** Unpinned (`pinned = 0`) and modified 30 days ago ($r = 0.5$).  
  $\text{multiplier} = 1 + 0.10(0) + 0.06(0.5) = 1.03$  
  $$\text{orderScore}_B = -2.00 \times 1.03 = \mathbf{-2.06}$$

**Result:** **Note A (-2.32)** wins over **Note B (-2.06)**.

---

## 5. Literal Fallback Mode (Short Terms < 3 Characters)

When **any** query term is shorter than 3 characters (e.g. `"UI"`, `"DB"`):
1. SQLite trigram cannot index 1- or 2-character tokens.
2. The engine scans active project rows using a prepared cursor (`statement.iterate`).
3. Uses case-insensitive Unicode folding (`toLowerCase()`).
4. Sets `bm25: null`, `multiplier: 1`, `orderScore: null`.
5. Orders by `pinned DESC, updated_at DESC, id ASC`.
