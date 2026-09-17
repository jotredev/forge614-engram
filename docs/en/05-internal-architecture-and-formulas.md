# 05 (EN). Internal Architecture, Modular Monolith, FTS5, and Ranking Formulas

> **Stage:** Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (439 total tests across 76 files: 430 passed and 9 skipped without isolated PostgreSQL test binaries; 439 passed, 0 failures, 2,274 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 38.62s)
> **Sister translation:** [05. Arquitectura Interna, Monolito Modular por Funcionalidad, SQLite FTS5 y Fórmulas Matemáticas](../es/05-arquitectura-interna-y-formulas.md)

This document presents the internal architecture of Forge614 Engram with thesis-level technical rigor: the foundations of the **Feature-Oriented Modular Monolith**, the concrete problems resolved, the physical directory structure and responsibilities, strict dependency rules enforced via TypeScript AST auditing, compound atomic transactions, directory change guidelines, colocated testing conventions, relational SQLite Schemas 3 to 7, the PostgreSQL Formats 1 to 3 replication protocol, and the exact mathematical formulas for weighted BM25, 30-day recency, asymptotic stability saturation via immutable confirmations, and sliding window deduplication without embeddings.

---

## 1. The Chosen Pattern: Feature-Oriented Modular Monolith

### 1.1. Name and Definition of the Pattern
The architectural pattern implemented in Forge614 Engram is the **Feature-Oriented Modular Monolith**.

- **Monolith:** The system is compiled, packaged, and distributed as a single executable binary (`forge614-engram`) running within a single local OS process. It is not partitioned into distributed network microservices, does not require internal IPC over networks, and requires no background daemon processes.
- **Feature-Oriented Modular:** Internal source code is partitioned along cohesive domain boundaries (memory, confirmations, projects, sessions, search, synchronization, workspace, assistants) rather than purely by technical layer. Each module encapsulates its business logic and exposes an explicit public boundary (`index.ts`).

> [!NOTE]
> **Contextual Design Choice, Not Universal Dogma:** The adoption of a feature-oriented modular monolith is a deliberate, contextual engineering decision tailored for a local CLI and synchronous SDK operating on a single environment file (`~/.forge614/.env`) and a single SQLite database (`~/.forge614/engram.db`). It is not presented as an abstract dogma for every software system.

### 1.2. Concrete Historical Problems and Reorganization Drivers
Prior to modularization, Engram's codebase suffered from cohesion degradation:
1. **Indiscriminate Root Sprawl in `src/`:** SQL persistence, data types, session validation, FTS5 queries, configuration adapters, terminal menus, and MCP handlers all resided in a flat root folder.
2. **`MemoryStore` Hypertrophy:** The `MemoryStore` class acted as a God Object, consolidating DDL schema migrations, project records, version trees, audit events, session tracking, ranking math, and replication snapshots into a single file.
3. **Presentation & Infrastructure Coupling:** Terminal TUI code directly inspected disk binaries, spawned self-test child processes, and modified assistant configurations, preventing isolated UI unit testing.
4. **Fragile Deep Test Imports:** Tests imported deeply nested internal paths, breaking under simple refactoring.

### 1.3. Evaluated Architectural Alternatives and Real Trade-offs

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     COMPARATIVE ARCHITECTURAL ASSESSMENT                        │
├───────────────────────┬───────────────────────────────┬─────────────────────────┤
│ Approach              │ Advantages                    │ Costs / Drawbacks       │
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Global Layered        │ Intuitive initial technical   │ Functional fragmentation:│
│ (models/, services/,  │ separation.                   │ a single feature        │
│ repos/)               │                               │ spans 4 distant folders.│
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Strict Hexagonal      │ Complete abstract             │ Massive over-engineering:│
│ (Ports & Adapters     │ substitutability via pure     │ generic repos, DI       │
│ with DI Container)    │ interfaces.                   │ containers, and 3x class│
│                       │                               │ overhead for a local CLI│
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Feature-Oriented      │ Conceptual cohesion, low      │ Requires import         │
│ Modular Monolith      │ coupling, synchronous SDK,    │ discipline, explicit    │
│ (CHOSEN)              │ direct SQL, and automated     │ barrels, and continuous │
│                       │ AST validation.               │ AST lint enforcement.   │
└───────────────────────┴───────────────────────────────┴─────────────────────────┘
```

- **Why Global Layered Architecture Was Rejected:** Grouping by technical layer (`src/models/`, `src/services/`, `src/repositories/`) scatters features across the tree. Modifying memory confirmations or sessions required touching files across multiple remote directories, destroying cohesive context.
- **Why Strict Hexagonal Architecture Was Rejected:** Creating abstract repository interfaces, generic port boundaries, and dependency injection containers for a synchronous local SQLite CLI introduced excessive boilerplate without delivering tangible user value.
- **Not Purist DDD or Microservices:** Engram adopts domain boundaries without distributed saga patterns, domain event buses, or microservice operational complexity.

---

## 2. Production Source Tree and Directory Responsibilities

The production code in `src/` is structured across four concentric layers, plus an entry binary and a public shared library:

```text
src/
├── cli.ts                         # [Minimal Startup] Exactly 2 lines of delegation
├── index.ts                       # [Public SDK API] Stable, immutable public barrel
│
├── app/                           # [Flow Orchestration]
│   ├── index.ts                   # Coordination exports
│   ├── memory-store.ts            # Backwards-compatible MemoryStore Facade
│   ├── workspace.ts               # Central workspace lifecycle & connection
│   ├── project-context.ts         # Git identity & directory binding resolution
│   ├── synchronization.ts         # Replica & snapshot coordination (no CLI I/O)
│   ├── setup.ts                   # Guided setup flow (SetupIO interface)
│   └── assistants.ts              # Assistant detection and configuration coordination
│
├── modules/                       # [Pure Domain Rules & Types] (Zero I/O)
│   ├── memory/                    # Types, validation, confirmations, and ranking
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── validation.ts
│   │   ├── confirmations.ts       # Pure confirmation interfaces & logic
│   │   └── ranking.ts             # Ranking formulas & explanation builders
│   ├── projects/                  # Immutable project identity (UUIDv4)
│   ├── sessions/                  # Session lifecycle, stamping, & inference
│   ├── search/                    # Query terms, Unicode code point/byte budgets
│   ├── synchronization/           # Snapshot validation & 3-way merge logic
│   │   ├── index.ts
│   │   ├── snapshot.ts
│   │   └── confirmations.ts       # Confirmation snapshot serialization & merge
│   ├── workspace/                 # Workspace environment configuration contracts
│   └── assistants/                # Assistant catalog, protocol & hook contracts
│
├── infrastructure/                # [Concrete I/O Adapters]
│   ├── sqlite/                    # SQLite connection, schemas, & queries
│   │   ├── connection.ts          # WAL mode, busy timeout, strict pragmas
│   │   ├── schema.ts              # Schemas 3, 4, 5, 6, and 7 DDL migrations
│   │   ├── projects.ts            # Project queries & bindings
│   │   ├── memory.ts              # Memory queries & version history
│   │   ├── confirmations.ts       # Confirmations & request persistence
│   │   ├── writes.ts              # Outer compound atomic transactions
│   │   ├── sessions.ts            # Session records & chronological entries
│   │   ├── search.ts              # SQLite FTS5 queries & projections
│   │   ├── snapshots.ts           # Format 3 local snapshot read/write
│   │   └── workspace-database.ts  # Database lifecycle manager
│   ├── postgres/                  # CAS optimistic replica adapter (replica.ts)
│   ├── filesystem/                # File I/O (.env, permissions 0700/0600, locks)
│   └── assistants/                # Client adapters, JSONC, TOML, & async self-test
│
├── interfaces/                    # [Presentation & Ingress Adapters]
│   ├── cli/                       # Argument parser, commands, & JSON formatters
│   ├── mcp/                       # Native stdio MCP server (10 tools)
│   ├── terminal/                  # Native assistant hook adapters
│   └── tui/                       # Full-screen interactive terminal UI
│
└── shared/                        # [Cross-Cutting Primitives]
    └── errors.ts                  # MemoryError class and official error codes
```

---

## 3. Dependency Hierarchy and Automated AST Auditing

To maintain modular decoupling, source code follows a strictly unidirectional import flow:

```text
interfaces  ──►  app  ──►  modules  ──►  shared
     │            │
     ▼            ▼
infrastructure ───┘
```

### Strict Import Rules:
1. `modules/` never imports from `infrastructure/`, `app/`, or `interfaces/`. It contains pure domain TypeScript without disk or network I/O.
2. `infrastructure/` implements concrete persistence adapters; it never depends on `interfaces/` or `app/`.
3. `app/` orchestrates use cases by invoking `modules/` and `infrastructure/`.
4. `interfaces/` receives user/assistant requests and delegates to `app/`.
5. `src/index.ts` is the sole entry point for external SDK consumers; internal production modules are forbidden from importing from `src/index.ts`.

### AST Architecture Auditor (`tests/architecture/import-rules.ts`):
- Parses TypeScript AST for all `import`, `export`, `import(...)`, and `require` statements.
- Builds a directed dependency graph (`graph.set(from, to)`).
- Executes Depth-First Search (DFS) tracking active traversal using `visiting` and `visited` sets.
- Detects cycles immediately and fails the test suite with: `component cycle: A -> B -> C -> A`.

---

## 4. SQLite Relational Schemas (Schemas 3 to 7)

SQLite tracks schema state via `PRAGMA user_version`.

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       SQLITE SCHEMA EVOLUTION IN ENGRAM                         │
├─────────┬───────────────────────────────────┬───────────────────────────────────┤
│ Schema  │ Added Tables                      │ Purpose                           │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 3       │ projects, memories,               │ Baseline local storage with       │
│         │ memory_versions, events, requests │ immutable version history.        │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 4       │ sync_checkpoints                  │ PostgreSQL replica support.       │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 5       │ project_bindings                  │ Assistant hooks and directory     │
│         │                                   │ bindings to projects.             │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 6       │ sessions, session_entries,        │ Progressive work sessions, event  │
│         │ session_summaries,                │ timelines, and 3-tier ranked      │
│         │ local_session_bindings,           │ context dossiers.                 │
│         │ local_manual_sessions             │                                   │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 7       │ confirmations,                    │ Immutable confirmation tracking   │
│         │ confirmation_requests             │ and reinforced FTS5 search        │
│         │                                   │ ranking without embeddings.       │
└─────────┴───────────────────────────────────┴───────────────────────────────────┘
```

### 4.1. Schema 7 DDL (Confirmations and Reinforced Ranking)

```sql
-- Immutable confirmation records for repeated memory observations
CREATE TABLE IF NOT EXISTS confirmations (
  confirmation_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(session_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmations_memory_id ON confirmations(memory_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_recorded_at ON confirmations(recorded_at);

-- Idempotent request replay tracking
CREATE TABLE IF NOT EXISTS confirmation_requests (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_version INTEGER,
  confirmation_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_confirmation_requests_key ON confirmation_requests(request_key);
```

---

## 5. Mathematical Formulas for Reinforced FTS5 Search (No Embeddings)

Engram's search engine optimizes textual retrieval in SQLite FTS5 by combining lexical BM25 matching with recency decay and asymptotic stability saturation derived from immutable confirmations.

### 5.1. Lexical BM25 Scoring in SQLite FTS5

SQLite FTS5 computes document relevance using the BM25 formula:

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- **Engine Parameters:** $k_1 = 1.2$, $b = 0.75$.
- **Column Weights in Engram:**
  - `title`: weight $5.0$
  - `topic_key`: weight $3.0$
  - `content`: weight $1.0$
- **Score Polarity in SQLite FTS5:** SQLite's native `bm25(memories_fts, 5.0, 3.0, 1.0)` function yields **negative values**, where more negative scores denote stronger lexical matches.

### 5.2. The Three Factors of the Reinforcement Multiplier

For each candidate note, Engram computes five support variables against a single deterministic query clock (`request_clock = nowMs`):
1. $\text{revisionCount} = \text{version} - 1$ (historical revisions excluding creation).
2. $\text{duplicateCount} = \text{count}(\text{confirmations})$ (number of immutable confirmations recorded).
3. $\text{lastSeenAt} = \max(\text{updatedAt}, \max(\text{recordedAt}))$ (most recent observation or confirmation timestamp).
4. $\text{ageDays} = \max\left(0, \frac{\text{nowMs} - \text{lastSeenAtMs}}{86,400,000}\right)$ (decimal age in days).
5. $n = \text{revisionCount} + \text{duplicateCount}$ (aggregate observations and revisions).

The total reinforcement multiplier is formulated as:

$$\text{multiplier} = 1 + \underbrace{0.10 \times \text{pinned}}_{\text{Pinned Boost}} + \underbrace{\frac{0.06}{1 + \frac{\text{ageDays}}{30}}}_{\text{Recency Boost}} + \underbrace{0.04 \times \frac{n}{n + 4}}_{\text{Stability Boost}}$$

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     REINFORCEMENT MULTIPLIER BREAKDOWN                          │
├─────────────────────┬──────────────┬──────────────┬─────────────────────────────┤
│ Component           │ Max Boost    │ Range        │ Behavior                    │
├─────────────────────┼──────────────┼──────────────┼─────────────────────────────┤
│ Baseline            │ 1.00         │ 1.00         │ Minimum neutral multiplier. │
│ Pinned Boost        │ +0.10        │ {0, 0.10}    │ 0.10 if pinned is true;     │
│                     │              │              │ 0 if false.                 │
│ Recency Boost       │ +0.06        │ (0, 0.06]    │ 30-day half-life scale:     │
│                     │              │              │ 0.06 at age 0;              │
│                     │              │              │ 0.03 at 30 days;            │
│                     │              │              │ smoothly decays toward 0.   │
│ Stability Boost     │ +0.04        │ [0, 0.04)    │ Asymptotic saturation:      │
│                     │              │              │ n=0 -> 0.00                 │
│                     │              │              │ n=1 -> 0.008                │
│                     │              │              │ n=4 -> 0.020                │
│                     │              │              │ n=8 -> 0.0267               │
│                     │              │              │ converges to 0.04 at inf.   │
├─────────────────────┼──────────────┼──────────────┼─────────────────────────────┤
│ Total Multiplier    │ 1.20         │ [1.00, 1.20] │ Bounded dynamic range.      │
└─────────────────────┴──────────────┴──────────────┴─────────────────────────────┘
```

### 5.3. Order Score and Ascending (ASC) Direction

$$\text{orderScore} = \text{BM25} \times \text{multiplier}$$

**Why Sorting Uses ASC Direction:**
- Because BM25 scores in SQLite are **negative** (e.g., $-2.0$), multiplying by $\text{multiplier} > 1.0$ makes the product **more negative** (algebraically smaller).
- **Worked Tie-Breaking Example:**
  - Note A: $\text{BM25} = -2.0$, $\text{multiplier} = 1.18 \implies \text{orderScore} = -2.36$.
  - Note B: $\text{BM25} = -2.0$, $\text{multiplier} = 1.06 \implies \text{orderScore} = -2.12$.
  - Comparison: $-2.36 < -2.12$.
  - When ordered ascending (`ORDER BY orderScore ASC, id ASC`), Note A (higher multiplier) appears **first** in the results.

### 5.4. Deterministic Single-Clock Evaluation and Order Before LIMIT
- **Single Query Clock:** Engram evaluates a single timestamp `request_clock(nowMs)` per search query. It avoids repetitive system clock invocations per row, preventing mid-query drift on large databases.
- **Ordering Before LIMIT:** Multiplier computation and `orderScore ASC` ordering are applied in SQL **before any `LIMIT` clause**. This guarantees that the top-$K$ results represent globally optimal matches rather than an arbitrary pre-truncated sample.
- **Literal Search Fallback:** When a search does not match FTS5 terms or executes a literal query, `bm25` and `orderScore` are `null`. Ordering falls back to:
  ```sql
  ORDER BY m.pinned DESC, last_seen_at DESC, m.id ASC
  ```

---

## 6. Sliding Window Deduplication, Request Replay, and Conflict Handling

### 6.1. 15-Minute Sliding Window for Memories Without Topic
When saving a memory note without a topic (`topicKey: null`):
- Engram searches active candidates with identical title, content, type, and pinned status.
- **Strict Temporal Bound:** Only candidates observed within the last **15 minutes** are considered (inclusive interval between `nowMs - 900,000` and `nowMs`).
- Future timestamps are discarded.
- If multiple candidates exist within the window, the candidate with the latest `lastSeenAt` is selected, breaking ties with `id ASC`.
- If more than 15 minutes have passed, Engram creates a separate new memory to preserve temporal independence.

### 6.2. Idempotent Request Replay (*Request Key Replay*)
- If a request is submitted with an existing `requestKey` and the SHA-256 cryptographic hash of its payload matches the entry in `confirmation_requests`, Engram returns the cached response immediately.
- **No confirmations are added and versions are not incremented.**

### 6.3. Payload Conflict on Key Reuse (`REQUEST_CONFLICT`)
- If an existing `requestKey` is reused with divergent content or title (mismatched SHA-256 hash), the operation aborts with `REQUEST_CONFLICT`.

### 6.4. Clock Skew Protection (`CLOCK_SKEW`)
- If the local system clock is earlier than the timestamp recorded on the confirmed memory version, the operation halts with `CLOCK_SKEW` to maintain strictly monotonic chronological causality.

---

## 7. PostgreSQL Replication Protocol and Format 3

### 7.1. Stable Remote Physical Schema (`state.format = 1`)
On the remote PostgreSQL server, the synchronization table `forge614_sync.state` retains its structural column `format = 1`:
- The physical database schema requires no disruptive DDL alterations or production migrations.
- Format progression is managed within the JSON snapshot envelope payload.

### 7.2. Format 3 Snapshot Payload
Format 3 expands the snapshot envelope by adding two collections:
- `confirmations`: Array of immutable confirmation records (`confirmationId`, `memoryId`, `version`, `recordedAt`, `sessionId`).
- `confirmationRequests`: Array of cached idempotent requests.

### 7.3. Atomic CAS Promotion and `sync-watch` Guardrail
- **Controlled Promotion:** Promoting a replica to Format 3 requires executing `forge614-engram sync --upgrade-format`.
- **Rejected in Continuous Mode:** `sync-watch` strictly rejects `--upgrade-format` with `INVALID_INPUT` to prevent automated unattended processes from promoting formats without operator supervision.
- **Peer Device Compatibility:** All peer machines must be upgraded to Schema 7 (`reinforcement-enable`) prior to syncing against a Format 3 replica. If an unreinforced client attempts to sync a Format 3 snapshot, it safely halts with `REINFORCEMENT_REQUIRED`.

---

## 8. Colocated Tests and Official Verification Metrics

### 8.1. One-to-One Colocated Test Layout
All **53 production files containing business logic** have a colocated sibling test file (`<name>.test.ts`):
- `src/infrastructure/sqlite/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- `src/modules/memory/ranking.ts` $\leftrightarrow$ `ranking.test.ts`
- `src/modules/memory/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- `src/modules/synchronization/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- Collaborative integration test suites in `src/app/__tests__/`:
  - `confirmations.integration.test.ts`
  - `confirmations-sync.integration.test.ts`

### 8.2. Test Suite Progression

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TEST VERIFICATION HISTORY                                │
├───────────────────────────────┬──────────────┬───────────────┬──────────────────┤
│ Milestone                     │ Tests        │ Files         │ Assertions       │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ Baseline (Handoff 09)         │ 250 pass     │ 18 files      │ 1,506 assertions │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ Modular Monolith (Handoff 10) │ 369 pass*    │ 69 files      │ 1,891 assertions │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ Reinforced FTS5 (Stage 11)    │ 439 pass**   │ 76 files      │ 2,274 assertions │
│                               │ (430 pass /  │               │ (38.62s)         │
│                               │  9 skip PG)  │               │                  │
└───────────────────────────────┴──────────────┴───────────────┴──────────────────┘
* Note: With temporary isolated PG binary configured (361 passed / 8 skipped without binary).
** Note: 430 passed and 9 skipped without isolated PG binary. With FORGE614_TEST_POSTGRES_BIN
   configured, runs and passes 439 pass, 0 fail, 2,274 assertions in 38.62s.
```

---

## 9. Design Attribution and Lineage

- **Gentleman Programming Inspiration:** The progressive retrieval model featuring bounded previews, on-demand version reads, session timelines, and relevance reinforcement is inspired by concepts developed by Gentleman (linked to commit `2cdda9041c1bff86f6b769171fd407fa677027cb`).
- **Forge614 Innovations:**
  - Exact mathematical ordering formula $\text{BM25} \times \text{multiplier}$ with asymptotic saturation $\frac{n}{n+4}$ and smooth 30-day half-life decay.
  - Single evaluation clock `request_clock(nowMs)` per search query to prevent mid-query drift.
  - Dedicated `confirmations` table recording immutable observations without fabricating redundant versions.
  - 15-minute sliding window deduplication for memories without a topic.
  - Cryptographic SHA-256 idempotent request cache with `REQUEST_CONFLICT` detection.
  - Atomic CAS Format 3 promotion with physical schema stability on PostgreSQL (`state.format = 1`).
  - Feature-oriented modular monolith with 53 logical components supported by colocated tests and AST import enforcement.
