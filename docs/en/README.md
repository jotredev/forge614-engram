# Forge614 Engram — Official Documentation (English)

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Verified (75 tests passed, 0 failures, 563 assertions on macOS with Bun 1.3.8)
> **Sister translation:** [Documentación en Español](../es/README.md)
> **Build Runtime:** Bun >= 1.3.8 | SQLite (`bun:sqlite` with FTS5 trigram) | Strict TypeScript 5.9
> **Standalone Binary:** `forge614-engram` in `$HOME/.local/bin/` (does not require Bun in PATH for daily execution)
> **Central User Storage:** `~/.forge614/` (`.env` single global configuration and `engram.db` single database)

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal local memory notebook stored in your user directory (`~/.forge614/`), designed for artificial intelligence assistants and applications to remember project decisions and universal preferences over time, maintaining an immutable version audit tree and an explainable SQLite FTS5 search engine without token costs or cloud dependencies.

---

## 2. The Real-World Problem It Solves

When interacting with artificial intelligence assistants or developer tools, four persistent challenges arise:

1. **Amnesia when resetting conversations (*Context Window Reset*):** Every new session forgets which database you chose, your preferred coding conventions, or past architecture agreements.
2. **Destructive edits without a trace (*Destructive Overwrites*):** When modifying an important decision, conventional tools overwrite the previous note, destroying the context and rationale behind the change.
3. **Black-box search engines (*Opaque Scoring*):** Most retrieval systems return notes without explaining why they selected that data or which specific words matched.
4. **Duplication of universal preferences (*Preference Fragmentation*):** If you have a general preference (e.g. *"I prefer explanations in English"* or *"Use Bun as default runtime"*), you previously had to duplicate it across every individual project.

Forge614 Engram solves this with **a single database and a single configuration file** across all projects, cleanly separating project-specific decisions from shared universal rules, backed by explainable mathematical ranking and strict revision control.

---

## 3. The Master Analogy: The Meticulous Clerk with a Master Cabinet

Imagine hiring a meticulous office archivist to manage knowledge across all your projects:

- **The Master Cabinet (`~/.forge614/engram.db`):** The clerk stores all documents in a single secure cabinet in your office. No scattered folders or separate databases across your drive.
- **The Project Drawers (`projectId`):** Each registered project receives a stable, permanent credential (a unique UUIDv4 `projectId`). Its private memories are placed inside its drawer and never leak into other projects.
- **The Shared Tray (`scope: "shared"`):** At the top of the cabinet sits a shared tray for universal guidelines (e.g., *"I prefer explanations in English"*). This note is written once and guides all projects without duplicating storage.
- **The Topic Exception Rule (*Topic Override*):** If company-wide policy says *"Use Bun as default runtime"*, but your specific project stores an active note with the exact same topic saying *"Use Node.js for project compatibility"*, the clerk delivers the project's exception and suppresses the shared policy. If you later archive the project's exception, the shared rule automatically reappears.
- **The Version Audit Binder:** When updating a topic (`--topic`), the clerk never shreds the old note: they file a dated snapshot into the immutable history binder and place the new version in front.
- **The Idempotency Stamp:** If a script attempts to deliver the exact same note twice using the same dispatch key (`--request-key`), the clerk checks the ledger, recognizes the stamp, and returns the existing note without creating duplicates.
- **The Trigram Index & Blackboard:** When searching, the clerk scans a rapid three-letter index and delivers matching cards, writing the exact ranking formula (BM25, pinned priority, and recency decay) on the board.

---

## 4. Fundamental Design Principles

- **Single Global Configuration and Database:** Everything lives in `~/.forge614/` with one private `.env` file and one SQLite database (`engram.db`), regardless of which working directory you run from.
- **Stable Project Identity (`projectId`):** Projects are registered in the `projects` table with a lowercase UUIDv4 `projectId`. The display name is purely cosmetic; renaming a project never alters identity, history, or access to memories.
- **Two Memory Scopes (`scope`):**
  - `project`: Private decisions belonging strictly to a project (requires `--project-id`).
  - `shared`: Universal preferences applying across all projects (stored once with null `projectId`).
- **Combined Search with Smart Topic Overrides:** Searching from a project (`search --project-id <UUID>`) defaults to `--scope all`, returning project memories plus shared memories. If a project defines an active memory with the identical `topicKey` as a shared note, the project decision overrides the shared rule.
- **100% Local, Private, Zero Network Cost:** Requires no API keys, sends zero data to external servers, consumes zero tokens in this stage, and contains no telemetry.
- **Autonomous Compiled Executable:** Packaged as a standalone native binary (`forge614-engram`) in `$HOME/.local/bin/`. Does not require Bun or Node in PATH for everyday usage.
- **Strict Security & Permissions:** Directory mode `0700` and files mode `0600`. Symlinks, hard links, and foreign file owners are rejected before opening SQLite.
- **No Destructive Erasure:** Notes are retired using `archive` to hide them from active searches, remaining intact for auditing or restoration (`restore`).
- **Manual/Programmatic Operation in Stage 1:** Saves only on explicit command (`save`). Automated assistant integration via `memory_save` is scheduled for subsequent roadmap stages.

---

## 5. Sequential Documentation Table of Contents

Follow this chronological study path to master Forge614 Engram:

1. [**01. Installation, Setup, and Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Compiling with Bun, PATH configuration, interactive onboarding with `setup`, scriptable initialization with `init`, registering projects, and first saves.
2. [**02. Guided System Walkthrough (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): End-to-end lifecycle tutorial: interactive setup (`setup`), project creation, saves, combined search, topic overrides, auditing, and archival.
3. [**03. Terminal CLI Command Reference (`03-cli-reference.md`)**](03-cli-reference.md): Exhaustive command reference (`setup`, `init`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`) with exact syntax, exit codes, and output modes.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): Programmatic integration using `MemoryWorkspace`, `runSetup`, `WorkspaceConfig`, and `MemoryStore` with executable examples.
5. [**05. Internal Architecture, FTS5, and Ranking Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): SQLite schema v3, WAL initialization adjustment, triggers, trigram tokenizer, BM25 breakdown, recency multiplier, and topic override SQL logic.
6. [**06. Troubleshooting and Error Diagnostics (`06-troubleshooting.md`)**](06-troubleshooting.md): Error code reference table (`INTERACTIVE_REQUIRED`, `CONFIG_INVALID`, `LEGACY_CONFIG`, `MIGRATION_REQUIRED`, `DATABASE_MISSING`, `PROJECT_NOT_FOUND`, etc.) with root causes and fixes.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday explanations of technical terms with formal names in parentheses.
8. [**08. Stage Boundaries and Evolutionary Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Verified delivery features, active boundaries, approved future assistant policy, and the 4-phase pending backlog.
