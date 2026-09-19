# 07 (EN). Plain-Language Glossary

> **Stage:** TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 1.0.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
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
Like an experienced librarian who organizes books on the front counter, giving priority to those frequently referenced and recently reviewed, without needing to X-ray them or run complex neural networks: a mathematical ranking mechanism that weights BM25 lexical matches by multiplying them by pinned boosts (`pinned`), 30-day recency boosts (`recencyBoost`), and cumulative stability boosts (`stabilityBoost`). *(For an exhaustive, plain-language breakdown and comparison against traditional vector search, see our dedicated guide: [What are Embeddings and why does Forge614 Engram work WITHOUT them?](concepts/what-are-embeddings.md)).*

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

### Antigravity (Supported Developer Coding Assistant / `antigravity`)
Supported coding assistant replacing Gemini CLI. Connects via standard Model Context Protocol (MCP) using `~/.gemini/config/mcp_config.json`, allowing the model to consult context (`memory_context`), search memories (`memory_search`), and save decisions (`memory_save`). Configured as *MCP only* with no automatic hooks (*Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified*).

### Windows Path Guard / Reparse Points Validation
A Windows-specific security validation mechanism that verifies configuration paths do not point to symbolic links, directory junctions, or reparse points before writing data, preventing malicious path redirection attacks. (Status: CI functional validation on x64 successfully passed in GitHub Actions Verify Run ID 35427426902, and standalone release embedding on x64 and ARM64 passed in Release Run ID 35427429725 and reference run 35428406085; external clean machine testing pending for v1.0.0).

### Native Reparse-Point Guard (Node-API C++ Addon / `windows_reparse_guard.node`)
Like a bilingual customs officer stationed at the border inspecting official passports directly without slow intermediaries: an ultralightweight native C++ module loaded by Bun directly into memory that queries the Windows kernel function `GetFileAttributesW` in microseconds to certify whether a directory or file is a redirection point.

### NTFS Reparse Points (Reparse Points, Directory Junctions, and Volume Mount Points)
Like a detour sign on a highway misleading drivers into thinking they are staying on the main avenue while redirecting them into a private alley: special NTFS filesystem objects in Windows (symbolic links, directory junctions, and volume mount points) that redirect I/O to an alternate physical location, which Engram strictly rejects (`UNSAFE_PATH`) to prevent unauthorized writes.

### Atomic Guarded Write Protocol (Guarded Write / `guardedWrite`)
Like a surgeon carefully sterilizing all instruments, photographing the surgical site beforehand, performing the procedure within an isolated sterile field, verifying that vital signs match the plan byte-for-byte, and only then finalizing the incision: a 10-step atomic protocol that validates path safety, compares against interactive plan previews (`write.before`), writes a UUID-stamped exclusive backup (`flag: 'wx'`), commits and flushes a temporary file (`fsyncSync`), performs an atomic rename, and verifies read bytes against planned bytes (`readSafeFile`), halting with `PUBLISHED_UNVERIFIED` if any external deviation is detected.

### Exclusive On-Disk Creation Mode (Exclusive File Mode / `"wx"`)
Like attempting to claim a numbered locker with a lock that immediately jams if a padlock is already present: a file opening flag on Windows that combines write intent (`"w"`) with strict exclusivity (`"x"`), ensuring that if the temporary or backup file already exists on disk, the operating system call immediately fails with `EEXIST` rather than overwriting existing data.

### Standalone Node-API Bundling (Native Addon Embedding)
Like packing a specialized precision tool directly into a technician's sealed case: Bun's standalone compiler capability (`bun build --compile`) that bundles compiled `.node` native binary addons into a single distributable executable when referenced by a literal `require()`, allowing end users to run a self-contained `.exe` without adjacent files, Node.js, or compiler toolchains.

### Manual Non-Publishing Release (workflow_dispatch)
Like conducting a full dress rehearsal behind closed doors before opening night: a manual trigger mode in GitHub Actions that compiles all six platform installers, executes isolated packaged smoke checks, computes and validates `SHA256SUMS`, and packages artifacts without publishing a GitHub Release or creating git tags, reserving official releases strictly for deliberate `v*` tag pushes.

### Idempotent PATH Publishing
Like neatly inserting a new business card into an organized rolodex without duplicate entries or scratching out other cards: the automated procedure whereby installers configure the binary directory in Unix startup dotfiles (`.zshrc`, `.bashrc`, `.bash_profile` when safe, or `forge614-engram.fish`) using bounded blocks, or in the Windows user PATH variable via the .NET API without `setx` or Administrator privileges. Repeated installations do not duplicate PATH entries. Symbolic-link and custom-managed dotfiles are left untouched and receive manual guidance instead. Requires opening a new terminal window for changes to take effect.

### Setup Onboarding Flow (`setup` -> `assistantTui`)
Like finishing the outfitting of a new workspace and immediately welcoming team members inside: the guided interactive workflow where `forge614-engram setup` first configures the central SQLite storage and, upon explicit confirmation, seamlessly transitions to the interactive Assistant Selection TUI to connect up to 5 AI development tools (Claude Code, Codex, Cursor, OpenCode, and Antigravity) with configuration path previews and explicit confirmation (zero silent modifications).

### Strengthened Addon Release Smoke Test
Like firing up an engine on a clean test bench with zero leftover residue to verify every valve moves correctly: an automated verification in release CI where compiled Windows executables run `assistant-list` inside an empty temporary profile (`RUNNER_TEMP`), requiring that all 5 supported assistants report status `absent` and failing on any `blocked` status, thereby certifying that the embedded native C++ addon is genuinely loaded and operating in memory without storage pollution.

### Automatic Private Workspace Permission Repair (`repairExistingRoot`)
Like a trusted locksmith who, upon inspecting the door to your private records archive, immediately tightens the lock so only your key can open it without asking you to fetch tools: the automated mechanism whereby `forge614-engram setup` and `init` restrict an existing `~/.forge614` directory owned by the current user to `0700` (`rwx------`) if its permissions were previously open (such as `0755`), ensuring the absolute privacy of memories, SQLite databases, and `.env` credentials without forcing the user to understand or run `chmod` manually, while strictly blocking symbolic links, files, and foreign-owned directories fail-closed.

### Assistant Detection & Inspection SDK (Public Detection Surface for Atlas)
Like the concierge of an office building who checks the lobby directory to inform visitors which offices are occupied and on which floor, without opening anyone's desk drawers or unlocking rooms: the read-only public API surface exported from the root of `forge614-engram` (`CLIENT_IDS`, `LABELS`, `isClientId`, `inspectAssistant`, `resolveAssistantPaths`, `coverageWarnings`) that enables companion orchestration products (such as Forge614 Atlas) to audit which AI assistant engines are installed on the host machine and determine their expected configuration paths, without modifying files, without touching MCP configurations, and without opening local databases.
