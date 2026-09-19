# Forge614 Engram — Official Documentation (English)

> **Stage:** Engram Product Home (`~/.forge614/engram/`), Safe Legacy Workspace Migration, Guarded Uninstall (`uninstall`), TUI Control Center, Reinforced FTS5 ([no embeddings](concepts/what-are-embeddings.md)), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, 10 MCP Tools, Assistant Detection for Atlas, Local Memory & PostgreSQL Sync
> **Release Versions:** Program 1.1.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & reinforced ordering) | PostgreSQL Formats 1, 2 & 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Status:** Current & Verified (572 passed, 15 skipped platform/local PG, 0 failures, 2786 assertions across 90 files on macOS ARM64 with Bun 1.3.8; native release validation for 6 release binaries in GitHub Actions)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | Strict TypeScript 5.9 | Git available (mandatory for project identity resolution)
> **Standalone Binary:** `forge614-engram` in `~/.forge614/engram/bin/` (macOS/Linux) or `%USERPROFILE%\.forge614\engram\bin\forge614-engram.exe` (Windows) (operates autonomously without Bun or Node at runtime)
> **User Storage:** Shared family container `~/.forge614/` with dedicated isolated product home `~/.forge614/engram/` (`.env` single global configuration and `engram.db` single database; strict permissions `0700` for directories and `0600` for files; safe migration of legacy loose files without touching sibling products such as `shell/` or `atlas/`)

> [!TIP]
> **New to local AI memory or wondering what "without embeddings" means?**
> Check out our plain-language illustrated guide (technical terms explained in parentheses): **[What are Embeddings and why does Forge614 Engram work WITHOUT them?](concepts/what-are-embeddings.md)**.

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal, local memory system residing in its own dedicated product home (`~/.forge614/engram/` with its binary in `~/.forge614/engram/bin/`), coexisting seamlessly within the shared family container `~/.forge614/` alongside sibling products like Forge614 Shell and Forge614 Atlas without touching their folders, structured internally as a **feature-oriented modular monolith** (separating pure domain rules, application flow coordination, concrete infrastructure adapters, and user/assistant delivery interfaces), designed for your developer coding assistants (Claude Code, Codex, Cursor, OpenCode, and Antigravity) and applications to retain durable technical decisions and shared preferences via a native stdio Model Context Protocol (MCP) server featuring 10 tools, progressive memory sessions, ranked context retrieval, Git-based local project bindings, an interactive **Terminal Control Center (TUI)** with safe read-only navigation by default and strict two-step action confirmation (`confirm` + Enter), a guarded multi-product uninstaller (`uninstall`) coordinated with Atlas and featuring surgical PATH cleanup, automatic safe migration from legacy installations, immutable version history, explainable local FTS5 search reinforced by repetitions [without embeddings](concepts/what-are-embeddings.md), and an optional direct PostgreSQL replica with safe Format 3 promotion.

---

## 2. The Real-World Problem It Solves

When developing software alongside artificial intelligence assistants in your daily workflow, several critical continuity and management problems emerge:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session or context compaction forgets architectural decisions, preferred libraries, or previously investigated bug fixes.
2. **Context bloat and token exhaustion (*Context Window Pollution*):** Ingesting raw multi-thousand-word conversation logs or unranked search dumps saturates LLM context limits and wastes developer budget.
3. **Session disorganization (*Unanchored Decisions*):** Notes are recorded as isolated fragments without knowing which work session, goal, or sequence of steps produced them.
4. **Destructive overwrites and redundant duplicate versions (*Destructive Overwrites & Redundant Versions*):** Modifying an agreement overwrites prior notes in traditional stores. If an assistant records the exact same note again, typical tools generate meaningless versions 2, 3, and 4 that bloat history. Engram records **immutable confirmation events** that reaffirm search stability without creating redundant versions.
5. **Dashboard blindness and blind management (*Dashboard Blindness*):** Learning which projects are enrolled, which directories are bound, which schema capabilities are active, or how many memories exist previously required direct SQL queries or memorized CLI flags. Engram introduces a full-screen **TUI Control Center** providing a live, aggregated terminal overview without modifying storage or leaking secrets.
6. **Black-box search engines (*Opaque Scoring*):** Most retrieval tools return snippets without explaining why specific notes ranked higher or which exact terms matched.
7. **Configuration drift across assistants (*Configuration Fragmentation*):** Manually editing MCP server parameters and hooks across five different editors causes subtle syntax errors, broken configs, and credential leaks.
8. **Project and branch ambiguity (*Worktree/Subdirectory Confusion*):** Working in subdirectories or Git linked worktrees often causes assistants to treat them as separate orphan projects.
9. **Device isolation (*Device Siloing*):** Decisions remain trapped on one machine's disk without a private, automated way to mirror them to your other computers.

Forge614 Engram solves this with **a single local SQLite database**, progressive memory sessions, ranked context retrieval with strict byte caps, a native stdio MCP server exposing 10 tools, an interactive TUI Control Center, explainable local FTS5 search reinforced by repetitions without embeddings, canonical Git project resolution, and direct PostgreSQL snapshot synchronization with Format 3 promotion.

---

## 3. The Master Analogy: The Meticulous Clerk, the Dedicated Product Home, and the Control Center Dashboard

Imagine hiring a meticulous office archivist to safeguard knowledge across all your coding projects:

- **The Shared Family Building and the Dedicated Office (`~/.forge614/engram/`):** The clerk operates within a shared building housing other Forge614 family products (`~/.forge614/`). Inside this building, separate suites belong to Forge614 Shell (`shell/`), Forge614 Atlas (`atlas/`), and Forge614 Engram (`engram/`). The clerk manages exclusively their own office suite (`~/.forge614/engram/`), keeping the door locked with private permissions (`0700`) and the record books secured (`0600`). They never assume ownership of the entire building, never touch belongings in sibling suites, and never delete sibling directories.
- **The Careful Automatic Move (Safe Legacy Workspace Migration):** When first arriving at the building, if the clerk finds their legacy documents left loose in the common corridor (`~/.forge614/.env`, `engram.db`), they carefully move only those specific items into their dedicated suite (`~/.forge614/engram/`). If they discover any hazards—such as deceptive symlinks pointing outside, files owned by other system users, pre-existing files in the new suite, or orphaned SQLite WAL/SHM temporary files without a master database—they immediately stop without moving or modifying anything.
- **The Master Cabinet (`~/.forge614/engram/engram.db`):** The clerk stores all records in a single secure cabinet inside their private office with strict permissions (`0600`). Reads, searches, and sessions always run directly against this cabinet, regardless of network availability. Each project is cleanly distinguished by its unique `projectId`, sharing a single efficient database.
- **The Terminal Control Center Dashboard (TUI Control Center / `forge614-engram tui`):** At the entrance of the office, the clerk mounts an interactive terminal dashboard (`Summary | Projects | Shared | Storage | Actions | Assistants | Exit`).
  - *Read-only by default:* Opening the screen, scrolling, or navigating with arrow keys is 100% read-only. It never creates configuration files, databases, or project records simply by being opened.
  - *Visible vs. protected metadata:* Displays project names, short UUIDs (and full UUIDs in detail view), SQLite paths, schema versions 3–7, and whether PostgreSQL is configured. It strictly conceals `.env` contents, PostgreSQL passwords and URLs, and raw memory text.
  - *Two-step action confirmation:* Requesting an action (creating a project, renaming, binding a directory, enabling a capability, or synchronizing) displays a clear preview and requires typing `confirm` (case-insensitive) followed by Enter. Pressing Enter alone never executes mutations.
  - *Sequential assistant subflow:* Choosing "Assistants" pauses the control center, restores raw terminal mode, invokes the assistant configurator with its preview, backups, and self-test, and upon returning reloads a fresh snapshot without nested raw terminal modes.
- **The Guarded Departure Protocol (`uninstall`):** If you decide to decommission the clerk, you cannot simply wipe out the suite with a casual command. The clerk requires typing an exact confirmation phrase in capital letters (`REMOVE FORGE614-ENGRAM`). If Forge614 Atlas also lives in the building (`~/.forge614/atlas/`), the clerk alerts you that Atlas depends on shared memory and mandates a combined phrase (`REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS`), requiring Atlas to uninstall cleanly first. Afterwards, the clerk surgically removes only its own bounded lines from your terminal PATH and its registered hooks/MCP configs in your coding assistants—halting if it detects any manual user modifications—and finally deletes only its own room (`~/.forge614/engram/`), leaving the rest of the building completely unharmed.
- **The Standardized Service Window (`mcp` via stdio):** In the office wall, the clerk operates a standardized sliding tray implementing the open Model Context Protocol over standard input/output (`stdio`). AI assistants can approach the window, identify themselves, and invoke 10 specialized tools (`memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, `memory_timeline`).
- **The Work Session Logbook (`sessions` & `session_entries`):** When you begin a task, the clerk opens a dedicated session logbook (`session-start`). Every technical decision or rule recorded during that shift is stamped with its exact sequence, allowing you to reconstruct later what happened before and after (`timeline`).
- **The Immutable Repetition Stamp (Schema 7 & `reinforcement-enable`):** If an assistant re-observes and records the exact same active note (identical title, content, type, topic, and pinned flag), the clerk does not print an unnecessary version 2. Instead, they stamp an **immutable confirmation event** with a unique identifier (`confirmationId`), exact timestamp, and current session. This repetition slightly reinforces search ranking, but **the clerk never claims that the note is absolute truth or that a human verified it**.
- **The 15-Minute Observation Window (Deduplication Without Topic):** For general notes without a topic key (`topicKey: null`), the clerk only treats notes observed within the last 15 minutes (900,000 ms) as candidates for confirmation. After 15 minutes, the clerk files a separate new note to avoid merging observations distant in time.
- **The Executive Dossier (`context` / `memory_context`):** When a new assistant joins or when memory resets after compaction, the clerk hands over an organized dossier: pinned essential rules (`pinned`), recent project agreements (`recent`), and executive summaries from past work sessions (`summaries`), strictly bounded to fit within your briefcase's carrying capacity (`maxBytes`).
- **The Secure Courier Pouch (PostgreSQL Sync & Format 3 Promotion):** If PostgreSQL replication is enabled, the clerk prepares a sealed snapshot pouch. Running `sync` or `sync-watch` performs a deterministic 3-way merge across base, local, and remote states. Upgrading the replica to Format 3 is performed via an explicit, atomic CAS-protected upgrade (`sync --upgrade-format`).

---

## 4. Fundamental Design Principles

- **SQLite & FTS5 are ALWAYS Local:** PostgreSQL never replaces SQLite or local search. All operations run synchronously against `engram.db`.
- **Isolated Product Home and Shared Family Coexistence:** Engram resides strictly in `~/.forge614/engram/` inside `~/.forge614/`. It never alters, renames, or deletes sibling suites such as `shell/` or `atlas/`. It applies strict permissions `0700` to its directories and `0600` to its configuration files and databases.
- **Safe, Read-Only-First TUI Control Center:**
  - `forge614-engram tui` requires an interactive terminal (TTY); non-TTY environments halt safely with `INTERACTIVE_REQUIRED`.
  - Navigation, resizing, or invalid input never creates files or mutates database state. If uninitialized, it instructs the user to run `setup` or `init`.
  - Mutative actions require typing `confirm` and pressing Enter. Pressing Enter alone or cancelling via Escape or Ctrl+C restores the terminal leaving zero modified bytes.
  - While an action is in-flight, duplicate keypresses are ignored. The terminal is restored cleanly on exit, though an already started confirmed action is not promised to roll back.
  - The TUI delegates directly to application facade methods (`MemoryWorkspace`, `MemoryStore`, `syncWorkspace`), closing connections inside `finally` blocks; it never executes SQL or filesystem writes directly.
- **Guarded and Coordinated Decommissioning (`uninstall`):**
  - Requires exact textual confirmation (`REMOVE FORGE614-ENGRAM` or `REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS` when Atlas is present).
  - If Atlas exists, mandates that Atlas uninstalls first via its executable; if Atlas fails or is missing, Engram stops without deleting anything.
  - Surgically removes only Engram's exact marked PATH entries and managed assistant configurations. If user manual modifications are detected, it aborts with a conflict to preserve user data.
  - Deletes strictly its own product directory `~/.forge614/engram/`.
- **Explicit Additive Enrollments:**
  - Schema 5 (assistants and local directory bindings): enabled exclusively via `integration-enable` or TUI.
  - Schema 6 (progressive memory sessions and timelines): enabled exclusively via `sessions-enable` or TUI.
  - Schema 7 (immutable confirmations and reinforced search): enabled exclusively via `reinforcement-enable`, TUI, or `setup`.
  - Migrations are strictly additive and irreversible (no downgrade). Ordinary CLI commands and MCP tools never auto-migrate databases.
- **[No Embeddings](concepts/what-are-embeddings.md) and No Truth-Verifying Models:** Search is 100% textual and mathematical via SQLite FTS5 trigram. There are no vector embeddings, model training, or secondary LLMs auditing contradictions. A confirmation reflects solely that an assistant re-recorded identical knowledge; it is never a guarantee of factual truth.
- **Idempotent Request Keys (`requestKey`):** Assistants should reuse a stable `requestKey` for retries of a logical operation (replaying the stored response without increasing confirmations) and a new key for independent observations. Reusing an existing key with altered payload aborts with `REQUEST_CONFLICT`.
- **Unicode Code Point and UTF-8 Byte Caps (Not Token Budgets):** Previews are bounded in Unicode code points (300 for search/context; 500 for focus and 150 for neighbors in timeline). The `--max-bytes` parameter strictly bounds total serialized UTF-8 JSON bytes (1024..65536, default 16384). Neither is an LLM token budget.
- **Reinforced Mathematical Ranking Formula (Schema 7):** BM25 lexical weighting combined with recency, stability, and pinned status:
  $$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \text{ageDays}/30} + 0.04 \times \frac{n}{n + 4}$$
  where $n = \text{revisionCount} + \text{duplicateCount}$ and $\text{ageDays} = \max(0, (\text{now} - \text{lastSeenAt}) / 86400000)$. Sorting is performed in ASCENDING order by `bm25 * multiplier` with `id ASC` as tie-breaker.
- **Terminal Output Sanitization:** All external strings rendered in the TUI undergo filtering that replaces ANSI escape codes, control characters, bidi overrides, zero-width characters, and unvetted URLs, preventing terminal visual injection attacks.
- **Local Machine Project Bindings (`project_bindings` in Schema 5):** Each machine maintains its own mapping between filesystem directories and `projectId` values. Linked worktrees share common Git identity. Local filesystem paths are never synchronized across machines.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Official release installer commands (`curl`/`irm`), cryptographic verification against `SHA256SUMS`, automatic and idempotent PATH publishing, dedicated product home in `~/.forge614/engram/`, safe automatic migration of legacy workspace files, strict permissions `0700`/`0600`, developer source compilation script (`install-from-source.sh`), interactive `setup` onboarding, TUI Control Center (`forge614-engram tui`), 5 supported assistants, and explicit Schemas 5, 6, and 7 enablement.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): Complete lifecycle walkthrough: product home layout in `~/.forge614/engram/`, interactive TUI Control Center overview, session lifecycle (`session-start`, `session-end`, `session-summary`), associated notes, repeated saves without redundant versions, 15-minute sliding window, reinforced previews, timeline, context retrieval, safe OpenCode plugin conflict resolution, and PostgreSQL replication to Format 3.
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Detailed command reference: guarded `uninstall` command with strict confirmation and Atlas coordination, `setup`, `init`, `tui`, `reinforcement-enable`, `sessions-enable`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `search [--preview]`, `get [--version]`, `save [--request-key, --session-id, --session-project-id]`, `sync [--upgrade-format]`, `mcp`, etc. with flags, exit codes, and JSON schemas.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): TypeScript SDK guide: stable public exports from `src/index.ts`, `EngramProductHome` class, `WorkspaceConfig` (with `repairExistingRoot()`), `MemoryStore` facade class in `app/`, public read-only assistant detection and path inspection API for sibling products (Atlas) with `CLIENT_IDS`, `inspectAssistant`, `resolveAssistantPaths`, and infrastructure `coverageWarnings`, and synchronous local engine architecture.
5. [**05. Internal Architecture, Modular Monolith, and Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): Feature-oriented modular monolith (`infrastructure/filesystem/product-home.ts`, `app/uninstall.ts`, `infrastructure/filesystem/path-publication.ts`, `modules/control-center`), pure state machine, bounded and sanitized rendering, colocated tests (572 tests across 90 files), Schema 7 DDL, mathematical FTS5 ranking formulas, Format 3 payload, and Gentleman attribution.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Comprehensive error catalog: new migration and uninstall errors (`LEGACY_UNSAFE`, `LEGACY_CONFLICT`, `LEGACY_MIGRATION_FAILED`, `UNINSTALL_CONFIRMATION`, `UNINSTALL_UNSAFE`, `ATLAS_UNINSTALL_REQUIRED`, `ATLAS_UNINSTALL_FAILED`, `ASSISTANT_REMOVE_FAILED`, `PATH_REMOVE_FAILED`, `PATH_CONFLICT`) alongside existing errors (`INTERACTIVE_REQUIRED`, `REINFORCEMENT_REQUIRED`, `SYNC_UPGRADE_REQUIRED`, `CLOCK_SKEW`, `REQUEST_CONFLICT`, `MIGRATION_REQUIRED`, etc.) with root causes and recovery steps.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday definitions with real-world analogies and formal technical terms in parentheses: dedicated product home, safe legacy migration, guarded uninstall coordinated with Atlas, surgical PATH cleanup, TUI Control Center, read-only by default, two-step action confirmation, immutable confirmation, FTS5 reinforcement without embeddings, sliding deduplication window, etc.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Consolidated delivery features (Phases 1 to 4.4 / Release 1.1.0), active boundaries (strict Engram isolation without touching siblings, uninstall requiring literal confirmation and prior Atlas removal, TUI without GUI/daemon/remote health check, confirmation is not truth verification), and the evolutionary roadmap.

---

## 💡 Fundamental Concepts Explained for Everyone
- 📘 [**What are Embeddings and why does Forge614 Engram work WITHOUT them? (`concepts/what-are-embeddings.md`)**](concepts/what-are-embeddings.md): Illustrated guide featuring the library analogy, detailing why local memory without embeddings is free ($0), instantaneous (<2ms), private (100% offline), and surgically precise for codebases.
