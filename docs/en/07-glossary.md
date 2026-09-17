# 07. Plain-Language Glossary

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Active
> **Sister translation:** [07. Glosario de Conceptos en Lenguaje Cotidiano](../es/07-glosario.md)

This glossary explains every technical concept using everyday real-world analogies, followed by its formal technical terminology in parentheses.

---

### Interactive onboarding assistant (Interactive Setup Wizard / `setup`)
A human-facing command that explains system storage paths, validates existing setups in read-only mode, and asks for a single confirmation before creating global storage, without asking for, creating, or selecting projects.

### Interactive terminal channel (Interactive TTY / `isTTY`)
A direct terminal connection allowing a human to type answers on the keyboard and view formatted text on screen. If absent (e.g. in pipes or automated scripts), `setup` halts with `INTERACTIVE_REQUIRED`.

### Voluntary cancellation exit code (Exit Code 130 / User Interruption)
The standard numerical code returned to the operating system when an interactive operation is aborted or cancelled by the user (`no`, `cancelar`, `q`, `Ctrl+C`, or EOF).

### Central user storage directory (User storage directory / `~/.forge614/`)
The private folder located in your computer's personal home directory where configuration and memory databases reside, protected with strict owner-only access permissions (`0700`).

### Single global configuration file (Global configuration file / `.env`)
The sole system settings file (`~/.forge614/.env`), generated automatically in private mode (`0600`). Defines format version and storage engine without scattering configurations across projects.

### Single central SQLite database (Single SQLite database / `engram.db`)
The relational database file (`~/.forge614/engram.db`) that holds all projects, memories, revision snapshots, and idempotency request logs in a unified schema.

### Immutable project identifier (`projectId`)
A permanent, unchangeable alphanumeric code (lowercase UUIDv4) assigned to each registered project. It definitively links all memories to that project, ensuring that changing the display name never alters project identity or severs access to memories.

### Descriptive project display name (`name`)
A human-readable text label (e.g. *"Online Store"*). Purely cosmetic; multiple projects may share the same display name without conflict because their true identity is defined by `projectId`.

### Scope of a note (`scope`)
The property determining where a saved memory applies. Can be project-scoped (`project`), applying strictly to a specific project; or shared (`shared`), applying as universal knowledge across all projects.

### Universal shared memory (Shared memory)
A note or preference stored once in the database with null `projectId` (e.g. *"I prefer clear explanations in English"*), immediately available to guide AI assistants across all projects without duplicating storage.

### Topic exception / substitution (Topic override)
A mathematical and logical rule triggered when a project stores an active memory with the exact same topic key (`topicKey`) as a shared memory. In the project's combined search, the project's decision substitutes for the shared rule, temporarily concealing the general rule for that project.

### Combined search (`scope: all`)
The default search mode when querying from a project (`search --project-id <UUID>`), returning both project-specific notes and relevant universal shared memories while respecting topic overrides.

### Immutable historical snapshot (Snapshot / Version)
An exact, unalterable digital copy (stored in JSON) of a memory's text and metadata at the precise moment it was saved. Allows auditing earlier decisions before revisions occurred.

### Optimistic revision check (`expectedVersion`)
A safety requirement demanding that you declare which version number you previously read before updating a topic, preventing concurrent processes from overwriting changes without reviewing intermediate revisions.

### Duplicate prevention stamp (Idempotency / `requestKey`)
A mechanism ensuring that submitting the same command multiple times with the same dispatch key returns the existing record without generating duplicate notes or polluting history.

### Full-text search engine (SQLite FTS5 / `memories_fts`)
An internal high-speed indexing engine that organizes all words across your notes to find matches in milliseconds without AI token costs or cloud dependencies.

### Three-letter fragment search (Trigram tokenizer)
A technique splitting words into consecutive three-letter chunks (e.g., `sqlite` splits into `sql`, `qli`, `lit`, `ite`), allowing searches to locate notes even when matching substrings.

### Textual relevance scoring (BM25 algorithm)
The classic ranking formula (*Best Matching 25*) that scores document relevance by balancing term frequency, rarity, and document length. In SQLite FTS5, it produces negative numbers where more negative values denote higher relevance.

### Pinned priority note (`pinned`)
A flag (`pinned: true`) that awards a fixed ranking boost in the scoring formula so high-priority notes appear at the top of search results.

### Recency decay curve ($r$)
A mathematical factor with a 30-day half-life that gently boosts newly updated notes, ensuring fresh decisions take precedence over dated records.

### Write-Ahead Logging (WAL mode)
An SQLite storage mode where writes append to a secondary journal (`engram.db-wal`), allowing readers to query data without being blocked by active writers.

### WAL header materialization (Empty immediate transaction)
A technique that flushes physical WAL bookkeeping structures to disk via `BEGIN IMMEDIATE; COMMIT;`, allowing read-only connections to open a fresh database immediately in Bun/macOS without projects.

### Reversible archival and restoration (`archive` and `restore`)
Operations that hide a note from standard searches without deleting data, with the ability to reactivate it at any time while preserving complete version history.

### High-level workspace manager (`MemoryWorkspace`)
The TypeScript SDK class responsible for initializing global configuration, administering projects, and opening secure database connections.

### Low-level storage engine (`MemoryStore`)
The TypeScript SDK class interacting directly with SQLite to perform save, search, history, and archival operations.
