# 07 (EN). Plain-Language Glossary

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [07. Glosario de Conceptos en Lenguaje Cotidiano](../es/07-glosario.md)

This glossary explains every technical concept using everyday real-world analogies first, immediately followed by the formal technical term in parentheses.

---

### Progressive Memory Session (Progressive Memory Session / `Session`)
Like a dedicated shift in a workshop: a bounded period of focus where a developer or an AI assistant collaborates on a specific task within a project, logging technical decisions and steps as they happen.

### Runtime Work Session (Runtime Session / `kind: "runtime"`)
Like punching a clock at the start and end of a task: an active session initiated deliberately via `session-start` that records a start timestamp (`startedAt`), is associated with a working folder, and remains open until formally concluded with `session-end` (`endedAt`).

### Manual Fallback Session (Manual Fallback Session / `kind: "manual"` / `local_manual_sessions`)
Like a desktop scratchpad that never leaves your desk: a permanent local fallback ledger that exists on your computer for each project. If you save a memory from the terminal without specifying an active session, Engram automatically files it here so its temporal context is preserved.

### Session Event Timeline (Session Timeline / `timeline` / `memory_timeline`)
Like reviewing the photos taken immediately before and after a key picture on a camera roll: a feature that centers on a specific memory (`focus`) and displays the notes recorded immediately before (`before`) and after (`after`) within that same work session.

### Ranked Context Dossier (Ranked Context / `context` / `memory_context`)
Like an executive briefing folder neatly organized into labeled tabs: a synthesized report that groups memories into three essential sections: pinned essential rules (`pinned`), recent project agreements (`recent`), and past session summaries (`summaries`).

### Lightweight Memory Preview (Memory Preview / `MemoryPreview`)
Like reading a newspaper headline and lead paragraph before buying the paper: an abbreviated version of a memory whose body text is capped at **300 Unicode code points** with a flag indicating whether it was trimmed (`truncated: true`). Allows an AI model to browse dozens of notes without saturating its context window.

### Strict Serialization Byte Budget (`maxBytes`)
Like the maximum weight allowance for airline carry-on luggage: a strict numerical limit (between 1024 and 65536 bytes) that measures **the exact UTF-8 byte payload size of the resulting JSON transmission**. **This is not an LLM token budget**, but a physical inter-process communication boundary.

### Structured Session Summary (Structured Session Summary / `session-summary`)
Like an official project handover report: a standardized document containing exactly six required sections: target goal (`goal`), key directives (`instructions`), lessons learned (`discoveries`), completed milestones (`accomplishments`), next steps (`nextSteps`), and modified files (`files`). Stored under the reserved topic `session/<id>/summary`.

### Session Inference (Session Inference)
Like an attentive colleague who knows which project you are tackling: when an AI model saves a note without passing a session ID, Engram checks whether exactly one active session was started in the last 7 days on that folder. If found, it automatically links the note (`sessionSource: "inferred"`). If two or more exist, it halts to avoid mistakes (`AMBIGUOUS_SESSION`).

### Atomic Replica Format 2 Promotion (Format 2 Promotion / `sync --upgrade-format`)
Like adding an extra lane to an existing highway without halting traffic: an explicit, CAS-protected upgrade that promotes a remote PostgreSQL replica from Format 1 to Format 2 (enabling the synchronization of sessions and summaries). Must be invoked deliberately via `sync --upgrade-format`.

### OpenCode Plugin Conflict (`CONFLICT`)
Like noticing a lock has been rekeyed and choosing not to force it: a safety mechanism where Engram detects that `plugins/forge614-engram.js` already contains divergent code and halts immediately without overwriting it, allowing the developer to reconcile it manually.

### Model Context Protocol (Model Context Protocol / MCP)
An open standard protocol enabling AI models to interact uniformly with tools. In Forge614 Engram, it exposes 10 local memory tools over standard I/O streams (`stdio`).

### Terminal User Interface (Terminal User Interface / TUI / `tui`)
A full-screen interactive dashboard inside your command console where you can navigate options using keyboard arrows and the spacebar, preview changes, run self-tests, and confirm assistant configurations.

### MCP Server Self-Test (MCP Server Self-Test)
An automated asynchronous test executed by the TUI menu against the installed binary, ensuring that it responds in under 5 seconds and exposes all 10 official memory tools.

### Machine-Local Project Binding (Project Binding / `project_bindings`)
A database record that maps a local filesystem directory path on this computer to a project ID (`projectId`). It is exclusive to this machine and is never synced across the network.

### Git Common Directory (Git Common Directory / `--git-common-dir`)
The canonical root of a Git repository that allows multiple subdirectories and linked worktrees (`git worktree add`) to share identical project identity and memory without duplication.

### BM25 Algorithm and Recency Multiplier
A mathematical formula (*Best Matching 25*) evaluating search relevance by combining term frequencies, manual pinning priority (`pinned`), and progressive temporal recency decay.

---

### Feature-Oriented Modular Monolith
Like a master craftsman's portable toolbox where every drawer has a specific, labeled purpose, yet everything travels together in a single sturdy case: a software design where an entire application compiles into a single autonomous binary executable for your OS, while its internal codebase is partitioned cleanly by real-world business concepts (`memory`, `sessions`, `projects`, `search`) with explicit public interfaces (`index.ts`), avoiding network microservice overhead.

### Compatible Facade Pattern (Compatible Facade / `MemoryStore`)
Like an elegant hotel reception desk: a friendly, familiar counter that serves guests exactly as it always has, while behind the scenes a coordinated team of specialists handles storage, sessions, and queries without requiring guests to learn a new protocol.

### AST Architecture Auditor (Abstract Syntax Tree Architecture Auditor / `import-rules`)
Like a strict customs inspector inspecting cargo manifests at every checkpoint: an automated verification tool built using the TypeScript compiler API that analyzes every import and export across the project, ensuring architectural boundaries are respected and preventing deadlocks or circular dependency loops (*cycles*).

### Colocated Sibling Tests (Colocated Sibling Tests / `<file>.test.ts`)
Like keeping a fire extinguisher immediately next to the machine that could overheat, rather than locked away at the end of a long hallway: the software engineering practice of placing unit tests directly alongside the implementation file that owns that behavior (e.g., `memory.test.ts` next to `memory.ts`), ensuring immediate visibility and ownership.

### Composite Outer Transaction (Composite Outer Transaction / `writes.ts`)
Like signing a formal notary deed where all seals, signatures, and payments must be confirmed simultaneously or the entire transaction is cancelled without partial residue: an indivisible SQLite operation (`BEGIN IMMEDIATE ... COMMIT`) that records the project, memory, immutable version, audit event, request idempotency hash, and session entry in a single atomic commit.

### Compare-and-Swap (CAS / Optimistic Locking)
Like two notaries stamping the next numbered page in an official ledger: each checks the current ledger number first; the first one to arrive stamps the new page and advances the number, while the second notices the number changed and respectfully halts without overwriting the first notary's work.
