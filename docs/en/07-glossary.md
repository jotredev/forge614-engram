# 07 (EN). Plain-Language Glossary

> **Stage:** TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2,566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [07. Glosario de Conceptos en Lenguaje Cotidiano](../es/07-glosario.md)

This glossary explains each technical concept using everyday life analogies and metaphors first, followed immediately by its formal technical term in parentheses.

---

### TUI Control Center (`controlCenterTui` / `forge614-engram tui`)
Like a master dashboard in a vessel's central engine room: a full-screen interactive terminal interface that centralizes project inspection, local directory bindings, global shared memory oversight, SQLite and PostgreSQL storage status, and deliberate administrative action execution without needing to remember individual CLI subcommands.

### Read-Only by Default
Like visiting an archival museum where you can inspect artifacts through display cases without any risk of altering them: an architectural guarantee where opening the TUI Control Center, switching tabs, inspecting projects, or resizing windows executes exclusively in read-only mode, guaranteeing that inspection never writes a single byte to disk.

### Two-Step Action Confirmation (`confirm` + Enter)
Like a high-security vault door requiring a key turn followed by a distinct confirmation button: an interactive safety protocol where no destructive or state-altering write action (creating projects, binding directories, applying migrations, or triggering sync) can execute simply by pressing `Enter`. Operators must inspect the displayed impact preview, explicitly type `confirm` (or `CONFIRM`) into a prompt, and press `Enter`.

### Terminal Output Sanitization (`sanitizeTerminalOutput`)
Like an air-purification filter removing particulates before entering a sterile cleanroom: a string sanitization routine that filters project display names, directory paths, and external text, stripping ANSI escape sequences, non-printable control characters, bidirectional override markers (bidi overrides), zero-width characters, and URL hyperlinks to shield the terminal against injection exploits or visual layout corruption.

### Sequential Terminal Subflow
Like placing a call on hold to handle a secondary task cleanly before resuming the main conversation right where you left off: the operational technique where the Control Center pauses its own event loop, fully restores standard terminal mode, launches the assistant integration flow (`assistantTui`) as a clean sequential subflow, and upon return reloads a fresh snapshot and reactivates the Control Center without nested concurrent raw modes.

### Strict Secret Concealment
Like an executive summary disclosing company financial metrics without publishing bank account passwords: the privacy principle whereby the TUI Control Center never displays raw passwords, full connection URLs (`POSTGRES_URL`), unredacted `.env` contents, or sensitive memory note contents or titles, restricting output strictly to structural metrics and metadata.

---


### Immutable Memory Confirmation (`Confirmation` / `confirmations`)
Like making a pencil tally mark on the cover of a workshop manual every time you consult it, without tearing out pages or reprinting the whole book: a timestamped, immutable historical event recording that an existing active memory was observed again by an assistant, without creating artificial versions 2 or 3 or duplicating content. It denotes a repeated observation; it does not certify absolute truth or human verification.

### FTS5 Reinforced Search Without Embeddings
Like an experienced librarian who organizes books on the front counter, giving priority to those frequently referenced and recently reviewed, without needing to X-ray them or run complex neural networks: a mathematical ranking mechanism that weights BM25 lexical matches by multiplying them by pinned boosts (`pinned`), 30-day recency boosts (`recencyBoost`), and cumulative stability boosts (`stabilityBoost`).

### 15-Minute Sliding Deduplication Window
Like remembering what someone told you ten minutes ago in the same conversation without mixing it up with what they mentioned last month: a strict temporal rule for general memories without a topic (`topicKey: null`), where notes observed within the last 15 minutes (`now - 900,000 ms` to `now`) are treated as candidate duplicates. If more than 15 minutes elapse, Engram creates an independent new memory to keep distant facts separate.

### Idempotent Request Key Replay (`requestKey` / `Replay`)
Like showing the same stamped ticket stub at the box office after a power outage: if a save operation is interrupted and re-attempted with the same key and identical content (matching SHA-256 cryptographic hash), the system immediately returns the cached response without altering revision histories or appending redundant confirmations.

### Request Payload Conflict (`REQUEST_CONFLICT`)
Like attempting to cash an already-issued check with a different amount or payee written in pen: a security error that aborts immediately when an existing request key (`requestKey`) is reused with differing title, content, scope, or type.

### System Clock Skew (`CLOCK_SKEW`)
Like looking at a slow wall clock that claims it is 2:00 PM when you already stamped a receipt at 3:00 PM: a chronological safeguard that rejects a confirmation when the local system clock reads earlier than the timestamp recorded on the confirmed memory version.

### Asymptotic Stability Saturation ($\frac{n}{n+4}$)
Like a student building mastery in a topic through practice: the first few review sessions yield major confidence boosts, but after many repetitions the incremental benefit smoothly levels off without expanding infinitely. In Engram, stability boost starts at 0.00, reaches halfway (0.02) at 4 cumulative observations, and converges toward an asymptotic ceiling of 0.04.

### PostgreSQL Replica Format 3 Promotion (`sync --upgrade-format`)
Like opening a new archival section in a shared bank vault: a deliberate procedure via `sync --upgrade-format` that updates the remote PostgreSQL replica to transfer immutable confirmations and cached requests, preserving the physical table schema unchanged (`state.format = 1`) and protecting peer clients that have not yet enabled Schema 7 (`REINFORCEMENT_REQUIRED`).

---

### Progressive Memory Session (`Session`)
Like a dedicated shift in an artisan workshop: a bounded period of focused effort where a developer and an AI assistant collaborate on a specific task within a project, capturing technical decisions as they happen.

### Runtime Session (`kind: "runtime"`)
Like starting and stopping a project stopwatch: a session explicitly initiated via `session-start` that records a start timestamp (`startedAt`), the bound working folder, and remains active until formally concluded via `session-end` (`endedAt`).

### Manual Fallback Session (`kind: "manual"` / `local_manual_sessions`)
Like a persistent scratchpad sitting on your desk: a permanent, machine-local fallback notebook created automatically for each project. If you save a note from the CLI without specifying an active session, Engram logs it in this fallback notebook so context is never lost.

### Session Event Timeline (`timeline` / `memory_timeline`)
Like reviewing the photos taken immediately before and after a key picture in a photo album: a retrieval tool centered on a focus memory (`focus`) that chronologically reveals notes captured immediately before (`before`) and after (`after`) within the same work session.

### Ranked Context Dossier (`context` / `memory_context`)
Like an executive briefing folder neatly organized into tabs before entering an important meeting: a synthesized dossier grouping memories into three essential sections: critical pinned notes (`pinned`), recent working decisions (`recent`), and previous session logs (`summaries`).

### Lightweight Memory Preview (`MemoryPreview`)
Like reading a newspaper's headline and lead paragraph before buying the paper: a compact representation of a memory whose text is capped at **300 Unicode code points** with a boolean flag indicating truncation (`truncated: true`), allowing models to skim dozens of notes without context bloat.

### Strict Serialization Byte Budget (`maxBytes`)
Like the maximum baggage weight allowance on an aircraft: a strict numerical budget (1024 to 65536 bytes) measuring **the exact UTF-8 byte weight of the final serialized JSON payload**. **It is not an LLM token budget**, but a physical inter-process transport ceiling.

### Structured Session Summary (`session-summary`)
Like an official project handover document: a standardized log containing six mandatory fields: objectives (`goal`), rules (`instructions`), lessons learned (`discoveries`), milestones (`accomplishments`), pending tasks (`nextSteps`), and modified files (`files`), stored under reserved topic `session/<id>/summary`.

### Session Contextual Inference (Session Inference)
Like an attentive assistant who already knows what you are working on: when an AI model saves a note without an explicit session ID, Engram checks whether exactly one runtime session was started in the last 7 days for that folder. If found, it links the note automatically (`sessionSource: "inferred"`). If multiple candidates exist, it halts with `AMBIGUOUS_SESSION`.

### OpenCode Plugin Conflict (`CONFLICT`)
Like finding a lock replaced on a door you prefer not to force open: a safety safeguard where Engram, detecting that `plugins/forge614-engram.js` already exists with custom modifications, halts safely without overwriting it, allowing the developer to review and reconcile changes manually.

### Model Context Protocol (MCP)
An open standard protocol enabling AI models to interact uniformly with external tools. In Forge614 Engram, the native stdio server exposes 10 official memory tools.

### Terminal User Interface (TUI / `tui`)
An interactive full-screen terminal dashboard where developers can navigate with arrow keys, select assistants, run MCP self-tests, preview configuration diffs, and apply changes cleanly.

### MCP Server Self-Test
An asynchronous automated test executed by the TUI on the installed binary, confirming that the server spawns, handshakes, and exposes all 10 tools within a strict 5-second deadline.

### Local Project Directory Binding (`project_bindings`)
A machine-local database record binding a directory path on this computer to a `projectId`. It is strictly local to each machine and never replicated over the network.

### Git Canonical Common Directory (`--git-common-dir`)
The canonical root of a Git repository that allows subdirectories and linked worktrees (`git worktree add`) to share identical project identity and memories without duplicate records.

---

### Feature-Oriented Modular Monolith
Like a professional modular toolbox where each drawer serves a clean, dedicated purpose while traveling inside a single portable chest: a software architecture compiled into a single executable binary, partitioning internal logic by domain concepts (`memory`, `sessions`, `projects`, `search`) with explicit boundaries (`index.ts`) without distributed network microservices.

### Compatible Facade Pattern (`MemoryStore`)
Like the reception desk of a grand hotel: a familiar, welcoming face providing an immutable public contract to SDK callers, while behind the desk specialized subsystems handle storage without breaking existing integration code.

### TypeScript AST Architecture Auditor (`import-rules`)
Like a strict customs officer checking every parcel before admitting it across the border: an automated tool that parses the TypeScript Abstract Syntax Tree, analyzes all `import` declarations, enforces unidirectional flow, and fails tests if cyclical dependencies arise.

### Colocated Sibling Tests (`<file>.test.ts`)
Like keeping the fire extinguisher directly beside the machine that could overheat: placing unit tests directly adjacent to the production implementation file they verify, ensuring every logical component has an immediate quality guardian.

### Composite Outer Transaction (`writes.ts`)
Like signing a formal deed where either all stamps, signatures, and payments register together, or the entire transaction is canceled cleanly without leaving partial records: an atomic SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`) registering projects, memories, versions, audit events, request hashes, and session entries in a single step.

### Optimistic Compare-and-Swap Locking (CAS)
Like two notaries stamping a sequentially numbered ledger: each checks the current hash before stamping; the first to stamp advances the sequence, while the second notices the hash changed and halts safely without damaging the record.
