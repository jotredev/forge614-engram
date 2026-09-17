# 07 (EN). Plain-Language Glossary

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Active (Verified with 90 tests on macOS with Bun 1.3.8)
> **Sister translation:** [07. Glosario de Conceptos en Lenguaje Cotidiano](../es/07-glosario.md)

This glossary explains every technical concept using real-world analogies and everyday language, followed by its formal technical term in parentheses.

---

### Interactive Onboarding Wizard (`setup` / Interactive TTY Assistant)
A human-facing command that explains storage paths, checks compatibility in read-only mode, offers optional PostgreSQL synchronization configuration, and requests explicit confirmation before initializing storage, without prompting for, creating, or selecting projects.

### Interactive Terminal (TTY / `isTTY`)
A direct keyboard console channel where a human types answers and views prompt outputs. If absent (e.g. in non-interactive shell scripts or CI pipelines), `setup` halts with `INTERACTIVE_REQUIRED` to preserve safety invariants.

### User Cancellation Exit Code (Exit Code 130 / SIGINT / EOF)
The standard numerical status returned to the operating system when an interactive operation or continuous watcher (`sync-watch`) is voluntarily canceled by the operator (`no`, `cancelar`, `q`, `Ctrl+C`, or EOF `Ctrl+D`).

### Central User Storage Directory (`~/.forge614/` / Global Root)
The private folder located in your user home directory housing the system's global configuration and single database, guarded by strict private owner-only permissions (`0700`).

### Single Global Configuration File (`.env` / Workspace Settings)
The lone configuration file (`~/.forge614/.env`), generated in private mode (`0600`). Encodes storage backend format (format 2 for pure local SQLite, format 3 for PostgreSQL sync) without scattering configuration files across individual project repositories.

### Master Relational Database (`engram.db` / Local SQLite)
The primary SQLite database file (`~/.forge614/engram.db`) storing all project registrations, active memories, version trees, and request keys in a single cohesive schema.

### Stable Project Identity (`projectId` / UUIDv4)
The permanent, lowercase UUIDv4 assigned to each project upon creation. Irrevocably ties all memories to that project, ensuring that updating the cosmetic display name never alters identity or breaks memory access.

### Cosmetic Project Name (`name` / Display Label)
A descriptive, human-readable label (e.g. *"Online Store"*). Distinct projects can share identical display names without colliding because internal relational mapping relies strictly on `projectId`.

### Memory Scope (`scope`)
The architectural property dictating where a memory applies. Either restricted to a single project (`project`) or universal across all projects (`shared`).

### Universal Shared Memory (`scope: shared`)
A preference, coding convention, or developer guideline stored once with null `projectId`, immediately accessible across all projects without duplicating records on disk.

### Topic Exception Override (*Topic Override* / Dynamic Rule Shadowing)
The SQL query invariant triggered when an active project memory shares the exact same `topicKey` as a universal shared memory. In the project's combined search, the project's specific exception shadows the shared guideline. Archiving the exception instantly restores the shared rule's visibility.

### Combined Search (`scope: all`)
The default search mode when querying from a project (`search --project-id <UUID>`), seamlessly returning project-specific notes and universal shared preferences while applying topic override rules.

### Immutable Version Snapshot (Snapshot / `memory_versions`)
A byte-for-byte JSON snapshot of a memory's content, title, and metadata captured at the exact moment of a revision write, forming an append-only audit trail over time.

### Optimistic Concurrency Assertion (`expectedVersion`)
A concurrency safeguard requiring callers to state the active version number they previously read before saving a new revision, preventing blind overwrites and stale updates.

### Request Idempotency Stamp (`requestKey` / Replay Protection)
A client-provided key ensuring that re-submitting an identical save operation does not create duplicate memories or clutter the historical record.

### Full-Text Search Engine (SQLite FTS5 / `memories_fts`)
An embedded, high-performance virtual table indexing memory text into tokens for sub-millisecond retrieval without token costs or network dependencies. Runs locally even when replica sync is enabled.

### Trigram Tokenizer (FTS5 Trigram Tokenization)
A text indexing strategy that splits words into overlapping 3-character slices, allowing substring and partial-word matches without requiring language-specific stemmers.

### Relevance Ranking Formula (BM25 Algorithm)
The industry-standard *Best Matching 25* probabilistic ranking function that scores term frequency against inverse document frequency. Evaluates negative scores in SQLite FTS5 where more negative values indicate stronger relevance.

### Pinned Priority Boost (`pinned: true`)
A categorical flag granting a fixed priority bonus in the ranking formula, elevating critical architectural directives to top search ranking.

### Recency Decay Curve ($r$ / Temporal Multiplier)
A mathematical scoring bonus favoring recently updated notes over older records, modeled with a 30-day half-life.

### Write-Ahead Logging (WAL Mode / `PRAGMA journal_mode=WAL`)
An SQLite concurrency mode redirecting writes to an append-only log (`engram.db-wal`), enabling non-blocking simultaneous readers while writes proceed.

### WAL Header Materialization (Empty Immediate Transaction)
Executing `BEGIN IMMEDIATE; COMMIT;` upon WAL initialization to physically write and synchronize WAL/SHM file headers, ensuring read-only connections work reliably on Bun/macOS without existing data.

### Reversible Archival (`archive` and `restore`)
Safe soft-deletion that removes obsolete notes from default search queries while preserving their full version audit tree for future inspection or reinstatement.

### Optional PostgreSQL Replica (PostgreSQL Sync Replica)
A dedicated PostgreSQL database configured by the operator acting as an external replica for Forge614 Engram. Enables syncing workspace memories across multiple developer machines without third-party hosted cloud services.

### Deterministic 3-Way Snapshot Merge (3-Way Reconciliation Protocol)
An algorithm comparing the last agreed checkpoint (`base`), current local state (`local`), and active remote database state (`remote`) to cleanly merge non-conflicting changes from independent projects or memories.

### Synchronization Checkpoint Table (`sync_checkpoints` / Schema 4)
An internal SQLite table added during migration that records the exact snapshot hash and payload agreed upon with a given remote replica, serving as the baseline for the next 3-way merge.

### Compare-And-Swap Head Locking (CAS / `SELECT FOR UPDATE`)
A concurrency pattern in PostgreSQL ensuring that publishing a new revision succeeds only if the remote head still matches the local expectation, preventing conflicting concurrent writes.

### Foreground Continuous Watcher (`sync-watch`)
An interactive terminal command running an immediate synchronization round and polling periodically (default 30 seconds) while kept open. Does not install background system daemons or cron jobs.

### Offline Resilience (Local Operation Continuity)
The architectural principle ensuring that local Forge614 Engram operations (`save`, `get`, `search`, `archive`) never block or fail when PostgreSQL is offline or network connectivity is lost.

### Synchronization Conflict (`SYNC_CONFLICT`)
A safety abort triggered when two replicas make conflicting changes to the same memory or project, or when a previously observed record disappears. Halts the sync round without altering either database.

### Snapshot Size Limit (8 MiB Boundary / `SYNC_TOO_LARGE`)
A strict 8 MiB constraint on full workspace snapshot payloads to ensure memory safety and network stability in this release.

### Synchronization Schema (`forge614_sync`)
A dedicated namespace within PostgreSQL containing exclusively the canonical `revisions` and `state` tables.
