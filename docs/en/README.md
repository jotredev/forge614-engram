# Forge614 Engram — Official Documentation (English)

> **Stage:** Reinforced FTS5 (no embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & reinforced ordering) | PostgreSQL Formats 1, 2 & 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Status:** Current & Verified (439 total tests across 76 files: 430 passed and 9 skipped without isolated PostgreSQL test binaries; 439 passed, 0 failures, 2274 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 38.62s)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | Strict TypeScript 5.9 | Git available (mandatory for project identity resolution)
> **Standalone Binary:** `forge614-engram` in `$HOME/.local/bin/` (operates autonomously without Bun or Node at runtime)
> **Central User Storage:** `~/.forge614/` (`.env` single global configuration and `engram.db` single database)

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal, local memory system residing in your user directory (`~/.forge614/`), structured internally as a **feature-oriented modular monolith** (separating pure domain rules, application flow coordination, concrete infrastructure adapters, and user/assistant delivery interfaces), designed for your developer coding assistants (Claude Code, Codex, Cursor, OpenCode, and Gemini CLI) and applications to retain durable technical decisions and shared preferences via a native stdio Model Context Protocol (MCP) server featuring 10 tools, progressive memory sessions, ranked context retrieval, Git-based local project bindings, an interactive terminal UI menu (TUI), immutable version history, explainable local FTS5 search reinforced by repetitions without embeddings, and an optional direct PostgreSQL replica with safe Format 3 promotion.

---

## 2. The Real-World Problem It Solves

When developing software alongside artificial intelligence assistants in your daily workflow, several critical continuity problems emerge:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session or context compaction forgets architectural decisions, preferred libraries, or previously investigated bug fixes.
2. **Context bloat and token exhaustion (*Context Window Pollution*):** Ingesting raw multi-thousand-word conversation logs or unranked search dumps saturates LLM context limits and wastes developer budget.
3. **Destructive overwrites and redundant duplicate versions (*Destructive Overwrites & Redundant Versions*):** Modifying an agreement overwrites prior notes in traditional stores. If an assistant records the exact same note again, typical tools generate meaningless versions 2, 3, and 4 that bloat history. Engram records **immutable confirmation events** that reaffirm search stability without creating redundant versions.
4. **Session disorganization (*Unanchored Decisions*):** Notes are recorded as isolated fragments without knowing which work session, goal, or sequence of steps produced them.
5. **Black-box search engines (*Opaque Scoring*):** Most retrieval tools return snippets without explaining why specific notes ranked higher or which exact terms matched.
6. **Configuration drift across assistants (*Configuration Fragmentation*):** Manually editing MCP server parameters and hooks across five different editors causes subtle syntax errors, broken configs, and credential leaks.
7. **Project and branch ambiguity (*Worktree/Subdirectory Confusion*):** Working in subdirectories or Git linked worktrees often causes assistants to treat them as separate orphan projects.
8. **Device isolation (*Device Siloing*):** Decisions remain trapped on one machine's disk without a private, automated way to mirror them to your other computers.

Forge614 Engram solves this with **a single local SQLite database**, progressive memory sessions, ranked context retrieval with strict byte caps, a native stdio MCP server exposing 10 tools, explainable local FTS5 search reinforced by repetitions without embeddings, an interactive terminal configuration dashboard with safe preflight backups and byte verification, canonical Git project resolution, and direct PostgreSQL snapshot synchronization with Format 3 promotion.

---

## 3. The Master Analogy: The Meticulous Clerk, the Work Logbook, and the Repetition Stamp

Imagine hiring a meticulous office archivist to safeguard knowledge across all your coding projects:

- **The Master Cabinet (`~/.forge614/engram.db`):** The clerk stores all records in a single secure cabinet in your local office with strict private permissions (`0600`). Reads, searches, and sessions always run directly against this cabinet, regardless of network availability.
- **The Work Session Logbook (`sessions` & `session_entries`):** When you begin a task, the clerk opens a dedicated session logbook (`session-start`). Every technical decision or rule recorded during that shift is stamped with its exact sequence, allowing you to reconstruct later what happened before and after (`timeline`).
- **The Immutable Repetition Stamp (Schema 7 & `reinforcement-enable`):** If an assistant re-observes and records the exact same active note (identical title, content, type, topic, and pinned flag), the clerk does not print an unnecessary version 2. Instead, they stamp an **immutable confirmation event** with a unique identifier (`confirmationId`), exact timestamp, and current session. This repetition slightly reinforces search ranking, but **the clerk never claims that the note is absolute truth or that a human verified it**.
- **The 15-Minute Observation Window (Deduplication Without Topic):** For general notes without a topic key (`topicKey: null`), the clerk only treats notes observed within the last 15 minutes (900,000 ms) as candidates for confirmation. After 15 minutes, the clerk files a separate new note to avoid merging observations distant in time.
- **The Executive Dossier (`context` / `memory_context`):** When a new assistant joins or when memory resets after compaction, the clerk hands over an organized dossier: pinned essential rules (`pinned`), recent project agreements (`recent`), and executive summaries from past work sessions (`summaries`), strictly bounded to fit within your briefcase's carrying capacity (`maxBytes`).
- **Lightweight Index Cards (`MemoryPreview`):** When searching for notes, the clerk first shows concise 300-character index cards with a truncation flag, letting you inspect candidate items before requesting full text cards.
- **The Standardized Service Window (`mcp` via stdio):** In the office wall, the clerk operates a standardized sliding tray implementing the open Model Context Protocol over standard input/output (`stdio`). AI assistants can approach the window, identify themselves, and invoke 10 specialized tools to read, record, summarize, and navigate durable knowledge.
- **The Assistant Connection Dashboard (`tui`):** To connect your assistants safely, the clerk provides an interactive terminal board. Using arrow keys and the spacebar, you select your tools, inspect proposed configuration changes, trigger an async server self-test, and apply settings with private backups and post-publication byte verification.
- **The Git Identity Tracker (`project_bindings` and Git):** When an assistant calls from a folder or linked worktree, the clerk checks the Git common root directory (`--git-common-dir`). On the first save, it binds the local folder and creates the project atomically. If paths are unresolvable or missing, the clerk conservatively halts to prevent misattribution.
- **The Shared Tray (`scope: "shared"`):** At the top sits a universal tray for global rules (e.g., *"I prefer explanations in English"*). To file a note here, the assistant must explicitly explain its global intent (`globalIntent`).
- **The Topic Exception Rule (*Topic Override*):** If universal policy specifies *"Use Bun as default runtime"*, but an active project note with the exact same topic states *"Use Node.js 20 LTS for this project"*, the clerk delivers the project's exception and suppresses the shared rule.
- **The Version Audit Binder:** When updating a topic (`--topic`), the clerk never shreds the existing card: they snapshot the prior version, store it in the immutable history ledger, and file the revision in front.
- **The Secure Courier Pouch (PostgreSQL Sync & Format 3 Promotion):** If PostgreSQL replication is enabled, the clerk prepares a sealed snapshot pouch. Running `sync` or `sync-watch` performs a deterministic 3-way merge across base, local, and remote states. Upgrading the replica to Format 3 (syncing sessions, summaries, confirmations, and requests) is performed via an explicit, atomic CAS-protected upgrade (`sync --upgrade-format`).

---

## 4. Fundamental Design Principles

- **SQLite & FTS5 are ALWAYS Local:** PostgreSQL never replaces SQLite or local search. All `save`, `get`, `search`, `history`, `timeline`, `context`, and session operations run synchronously against `engram.db`.
- **Explicit Additive Enrollments:**
  - Schema 5 (assistants and local directory bindings): enabled exclusively via `integration-enable` or `tui`.
  - Schema 6 (progressive memory sessions and timelines): enabled exclusively via `sessions-enable`.
  - Schema 7 (immutable confirmations and reinforced search): enabled exclusively via `reinforcement-enable` or in `setup`.
  - Standard opens, searches, and MCP tools **never auto-migrate existing databases**. Peer devices must update software, run `reinforcement-enable`, and promote the replica with `sync --upgrade-format`.
- **No Embeddings and No Truth-Verifying Models:** Search is 100% textual and mathematical via SQLite FTS5 trigram. There are no vector embeddings, model training, or secondary LLMs auditing contradictions. A confirmation reflects solely that an assistant re-recorded identical knowledge; it is never a guarantee of factual truth.
- **Idempotent Request Keys (`requestKey`):** Assistants should reuse a stable `requestKey` for retries of a logical operation (replaying the stored response without increasing confirmations) and a new key for independent observations. Reusing an existing key with altered payload aborts with `REQUEST_CONFLICT`.
- **Unicode Code Point and UTF-8 Byte Caps (Not Token Budgets):** Previews are bounded in Unicode code points (300 for search/context; 500 for focus and 150 for neighbors in timeline). The `--max-bytes` parameter strictly bounds total serialized UTF-8 JSON bytes (1024..65536, default 16384). Neither is an LLM token budget.
- **Reinforced Mathematical Ranking Formula (Schema 7):** BM25 lexical weighting combined with recency, stability, and pinned status:
  $$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \text{ageDays}/30} + 0.04 \times \frac{n}{n + 4}$$
  where $n = \text{revisionCount} + \text{duplicateCount}$ and $\text{ageDays} = \max(0, (\text{now} - \text{lastSeenAt}) / 86400000)$. SQLite BM25 scores are negative; sorting is performed in ASCENDING order by `bm25 * multiplier` with `id ASC` as tie-breaker. Short literal searches (<3 characters) use their literal path with multiplier 1 and null BM25.
- **Ten Native MCP Tools:** Exposes `memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, and `memory_timeline`.
- **Stdio MCP Server with Clean Output:** The `mcp` command strictly reserves standard output (`stdout`) for JSON-RPC messages. It never emits ANSI escapes or human logs that would break client protocol parsing.
- **Interactive TUI with Preflight, Backups, and Conflict Protection:** The `tui` command provides keyboard navigation, multi-assistant selection, a 5-second async MCP self-test, zero-write preview, explicit confirmation, `0600` private backups with UUID suffixes, and post-publication byte verification. In OpenCode, existing divergent plugins are treated as `CONFLICT` and never blindly overwritten.
- **Local Machine Project Bindings (`project_bindings` in Schema 5):** Each machine maintains its own mapping between filesystem directories and `projectId` values. Linked worktrees share common Git identity. Local filesystem paths are never synchronized across machines.
- **Autonomous Compiled Binary:** Packaged as a standalone native binary (`forge614-engram`) in `$HOME/.local/bin/`. Does not require Bun or Node in PATH for daily operation.
- **Direct & Optional PostgreSQL Sync with Format 3 Promotion:** Employs 3-way snapshot merge, an 8 MiB size limit, and CAS optimistic locking on PostgreSQL. Formats 1, 2, and 3 are promoted exclusively via `sync --upgrade-format`.
- **Strict File Permissions:** Storage directory `0700`, files `.env` and `engram.db` in `0600`. Assistant configs and backups written in `0600`. Insecure symlinks are rejected.
- **Design Lineage and Attribution:** Search factors and weights (5/1/3) are inspired by Gentleman-Programming/engram (commit `2cdda9041c1bff86f6b769171fd407fa677027cb`), with weights verified in `internal/store/store.go`. Forge614 adapts these ideas to custom immutable confirmation events, a 15-minute sliding window, additive schema compatibility, and identity-based sync without model dependencies.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Build requirements (Bun >=1.3.8, mandatory Git), dependencies, install script, standalone executable, interactive `setup` with reinforcement offer, assistant discovery, `integration-enable`, `sessions-enable`, `reinforcement-enable`, peer device coordination, and `sync --upgrade-format`.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): Complete lifecycle: `tui` menu, 5-second server self-test, preview and confirmation, manual project binding, AI assistant MCP usage across 10 tools, session inference scenarios, repeated saves without redundant versions, 15-minute sliding window, reinforced previews, timeline, context retrieval, safe OpenCode plugin conflict resolution, and PostgreSQL replication to Format 3.
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Detailed command reference (`reinforcement-enable`, `sessions-enable`, `setup`, `tui`, `mcp`, `assistant-list`, `integration-enable`, `project-bind`, `memory-hook`, `project-create`, `project-list`, `project-rename`, `save [--request-key]`, `search`, `get`, `history`, `archive`, `restore`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `sync [--upgrade-format]`, `sync-watch`) with flags, exit codes, and JSON schemas.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): TypeScript SDK guide: stable public exports from `src/index.ts`, compatible `MemoryStore` facade in `app/` (`enableSearchReinforcement()`, `reinforcementEnabled()`), confirmation types, and synchronous local engine architecture.
5. [**05. Internal Architecture, Modular Monolith, and Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): Feature-oriented modular monolith (`app`, `modules`, `infrastructure`, `interfaces`, `shared`), import rules and AST auditor, before/after mapping, composite transactions in `writes.ts`, colocated tests (439 tests across 76 files), Schema 7 DDL, mathematical FTS5 ranking formulas (negative BM25, 0.10/0.06/0.04 factors, 30-day scale, n/(n+4) saturation), Format 3 payload, and Gentleman attribution.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Comprehensive error catalog (`REINFORCEMENT_REQUIRED`, `SYNC_UPGRADE_REQUIRED`, `CLOCK_SKEW`, `REQUEST_CONFLICT`, `MIGRATION_REQUIRED`, `AMBIGUOUS_SESSION`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `NO_SESSION_CONTEXT`, `CONFLICT`, `INTERACTIVE_REQUIRED`, `PROJECT_IDENTITY_UNAVAILABLE`, `PROJECT_BINDING_REQUIRED`, `PUBLISHED_UNVERIFIED`, `SYNC_CONFLICT`, `SYNC_TOO_LARGE`, etc.) with root causes and recovery steps.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday definitions with real-world analogies and formal technical terms in parentheses: immutable confirmation, FTS5 reinforcement without embeddings, sliding deduplication window, clock skew, idempotent request key, asymptotic stability saturation, etc.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Consolidated delivery features (Phases 1 to 4.2), active boundaries (pure textual search without embeddings, confirmation is not truth verification, voluntary model compliance, 15-minute window, 8 MiB sync limit), and the remaining roadmap phases.
