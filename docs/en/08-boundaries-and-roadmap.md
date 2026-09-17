# 08. Stage Boundaries and Evolutionary Roadmap

> **Stage:** Stage 1 — Local Memory (Single Database, Shared Memories, and Interactive Setup)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Verified (75 tests passed, 0 failures on macOS with Bun 1.3.8)
> **Sister translation:** [08. Límites de la Etapa y Hoja de Ruta Futura](../es/08-limites-y-roadmap.md)

This document declares with complete transparency which capabilities are fully implemented in this release (including the new interactive `setup` wizard), active technical boundaries, the approved future policy for intelligent assistants, architectural comparisons with Gentleman Programming and Softmax Data, and the official 4-stage evolutionary roadmap pending implementation.

---

## 1. Completed and Verified Capabilities (Current Delivery)

The following capabilities are 100% implemented in `src/` and verified by the automated test suite of 75 tests:

- [x] **Interactive Onboarding Setup Wizard (`setup`):** Step-by-step console guide for first-time users running on an interactive terminal (TTY), displaying global target paths (`~/.forge614/.env` and `~/.forge614/engram.db`), prompting for explicit confirmation (`¿Confirmar? [si/NO]:`), returning standard exit code `130` on cancellation, and halting non-interactive environments with `INTERACTIVE_REQUIRED` (code `1`).
- [x] **Robust SQLite WAL Journal Initialization:** An empty immediate transaction (`BEGIN IMMEDIATE; COMMIT;`) executed upon enabling WAL mode (`PRAGMA journal_mode=WAL;`), materializing auxiliary header files on disk so read-only connections (`workspace.open(true)`) succeed immediately on Bun 1.3.8 on macOS even before any project is registered.
- [x] **Single Configuration and Single Database:** Central user storage in `~/.forge614/` with a single `.env` file (mode `0600`) and a single SQLite database `engram.db` (mode `0600`) inside a private directory (mode `0700`).
- [x] **Stable Project Identity (`projectId`):** Registered projects in the `projects` table using lowercase UUIDv4 identifiers. Display name is cosmetic; renaming via `project-rename` never affects identity or memories.
- [x] **Two Memory Scopes (`scope`):** Clear logical separation between project memories (`scope: "project"`, linked to `projectId`) and universal shared memories (`scope: "shared"`, with `projectId: null`, stored once).
- [x] **Combined Search with Smart Topic Overrides:** Project queries (`search --project-id <UUID>`) default to `--scope all`. If the project possesses an active memory with the identical `topicKey` as a shared guideline, the project decision overrides the shared rule for that project.
- [x] **Reversible Topic Overrides:** Archiving the project's exception re-exposes the shared guideline; restoring the exception re-applies project priority.
- [x] **Immutable History and Auditing:** Snapshot copies saved in `memory_versions` upon each topic update, with audit records logged in `events`.
- [x] **Optimistic Concurrency Control:** Enforced `--expected-version` on topic updates, guarding against stale overwrites.
- [x] **Idempotency and Duplicate Prevention:** Native support for `--request-key` with SHA-256 payload hashing and partial unique indexes.
- [x] **Explainable SQLite FTS5 Search:** Trigram index with field weighting (title 5.0, topic 3.0, content 1.0), priority boost (`pinned`), and recency decay curve (30-day half-life).
- [x] **Literal Search Fallback:** Transparent Unicode-folded iteration for queries shorter than 3 characters.
- [x] **Robust Terminal CLI:** Commands `setup`, `init`, `project-create`, `project-list`, `project-rename`, `save`, `search`, `get`, `history`, `archive`, `restore`, with argument validation before database access and structured JSON outputs (except `setup` which uses conversational plain text).
- [x] **TypeScript SDK:** Module `runSetup` and classes `MemoryWorkspace`, `WorkspaceConfig`, and `MemoryStore` ready for source code integration.
- [x] **Atomic Security Hardening:** Rejection of symlinks, hard links, non-owner permissions, legacy `projects/` directories (`LEGACY_CONFIG`), and obsolete schema versions (`MIGRATION_REQUIRED`).

---

## 2. Active Technical Boundaries and Limits

To maintain realistic expectations, keep in mind these operational boundaries:

1. **`setup` is strictly for global initialization (does not manage projects):**
   The `setup` command does not list, create, rename, or link local directories to project IDs. Associating workspaces with a `projectId` is performed exclusively via `init` and `project-create`.
2. **`setup` requires an interactive terminal (TTY):**
   It cannot be invoked inside unix pipes, redirected standard input (`cat | forge614-engram setup`), or unattended CI pipelines. For headless automation, use `forge614-engram init`.
3. **Manual or Code-Driven Saving (No Background Daemon):**
   The engine saves only when you execute `forge614-engram save` or call `store.save(...)`. No background process or daemon passively records conversations.
4. **Literal Keyword Search (No AI Vector Embeddings):**
   The search engine matches exact character sequences using trigrams and BM25. It lacks semantic understanding (e.g., searching for *"car"* will not locate notes about *"automobile"*).
5. **No Context Token Budgeting:**
   The `search` command returns complete matching notes without truncating or budgeting them to fit specific LLM context window token limits.
6. **No MCP Server or Network Socket:**
   No MCP (*Model Context Protocol*) or local HTTP daemon exists yet for connecting external desktop tools via sockets.
7. **No Multi-User Authentication:**
   The `projectId` organizes memories within the database but is not a user password or security barrier. Any process executed by your local OS user can access the database.
8. **No Destructive Erasure:**
   There is no destructive `delete` command; obsolete notes are retired using `archive` to preserve full audit traceability.
9. **No Automatic In-Place Schema Migration:**
   Databases with schema version 1 or 2 halt with `MIGRATION_REQUIRED`. No automatic destructive transformation is applied to existing data.

---

## 3. Architecture Comparison: Gentleman, Softmax, and Forge614

<table header-row="true">
<tr>
<td>Criterion</td>
<td>🎩 Gentleman Programming</td>
<td>🧩 Softmax Data</td>
<td>🧠 Forge614 Engram</td>
</tr>
<tr>
<td>**Data Location**</td>
<td>Per-project SQLite databases or local folders.</td>
<td>Central cloud server.</td>
<td>**Single database (`~/.forge614/engram.db`) and single `.env` in user home directory.**</td>
</tr>
<tr>
<td>**Initial Setup**</td>
<td>Manual or ad-hoc scripts.</td>
<td>Cloud sign-up and provisioning.</td>
<td>**Friendly interactive wizard (`setup`) with explicit confirmation and standard cancellation.**</td>
</tr>
<tr>
<td>**Shared Memories**</td>
<td>Not native (project-isolated).</td>
<td>Cloud organization workspaces.</td>
<td>**Native (`scope: shared`): stored once, accessible across all projects.**</td>
</tr>
<tr>
<td>**Rule Override**</td>
<td>Manual user instructions in prompts.</td>
<td>Vector weight adjustments.</td>
<td>**SQL Topic Overrides with immediate reversibility via archive/restore.**</td>
</tr>
<tr>
<td>**Who Decides What to Save?**</td>
<td>AI assistant via skills and `mem_save` tool.</td>
<td>Background extraction model (*Reflector*).</td>
<td>**Current:** Manual / SDK.<br>**Future:** Proactive assistant capture via `memory_save` with strict scoping policy.</td>
</tr>
<tr>
<td>**Cost and Privacy**</td>
<td>0 USD storage; consumes chat tokens.</td>
<td>Requires paid cloud API calls (OpenAI embeddings).</td>
<td>**0 USD:** 100% local, zero tokens, zero network requests, zero telemetry.</td>
</tr>
</table>

---

## 4. Approved Future Policy for Intelligent Assistants

> [!IMPORTANT]
> **STATUS: APPROVED POLICY PENDING IMPLEMENTATION.**
> When AI coding assistants (Claude Code, Cursor, Antigravity) gain autonomous tool access (`memory_save` / MCP), they must follow these strict operational rules to avoid memory contamination:

1. **Project Scope by Default (`scope: "project"`):**
   Any technical discovery, architectural choice, build command, file path, or bug workaround discovered during a session must be stored under the `projectId` of the active workspace.
2. **Promotion to Shared (`scope: "shared"`) Exclusively on Clear Global Intent:**
   A memory may only be recorded as shared if the user explicitly indicates cross-project or universal validity (evaluated in conversation context, never by isolated keyword matches such as *"always"* or by mere repetition).
3. **No Blind Fallback on Ambiguity:**
   If the assistant cannot determine the active `projectId` or whether a rule should be universal, it is strictly forbidden to fall back to `scope: "shared"`. The assistant must prompt the user for clarification before persisting.

---

## 5. Official Evolutionary Roadmap (4 Pending Phases)

> [!NOTE]
> The previous milestone **Interactive setup wizard** was successfully completed in version **0.3.0**. The following 4 milestones define the strict chronological development sequence for upcoming releases:

```mermaid
flowchart LR
    E1["Stage 1: Single DB,<br>shared memories & setup<br>(IMPLEMENTED v0.3.0)"] --> P1["1. Global PostgreSQL<br>storage"]
    P1 --> P2["2. Assistant integration<br>(memory_save / MCP)"]
    P2 --> P3["3. Advanced retrieval<br>& scoring"]
    P3 --> P4["4. Terminal TUI<br>interface"]
```

### 1. Global PostgreSQL Storage Option
An option to configure a centralized PostgreSQL connection string via `DATABASE_URL` in `~/.forge614/.env` to replace local SQLite for teams requiring shared network storage.

### 2. Assistant Integration via `memory_save`
Implementation of Model Context Protocol (MCP) server endpoints and hooks enabling AI assistants (Claude Code, Cursor, Antigravity) to proactively extract and record learnings under the approved scoping policy.

### 3. Advanced Retrieval and Scoring Enhancements
Mathematical context pruning algorithms, token budgeting, dictionary synonym mapping, and ranking score refinements.

### 4. Terminal User Interface (TUI)
A keyboard-navigable console application (*Text User Interface*) for visually exploring projects, inspecting memories, and auditing revisions without typing commands.

---

## 6. Official Test Verification Report

This release is verified by automated integration tests on **macOS with Bun 1.3.8**:

- **Unit & Integration Suite:** **75 tests passed (0 failures)** across **563 assertions** in 9 test files (`store.test.ts`, `install.test.ts`, `workspace.test.ts`, `projects.test.ts`, `setup-terminal.test.ts`, `shared.test.ts`, `cli.test.ts`, `setup.test.ts`, `workspace-config.test.ts`).
- **Static Type Checking (TypeScript):** `bun run typecheck` completed with **0 errors**.
- **Code Cleanliness:** `git diff --check` passed cleanly without whitespace anomalies.
- **Concurrency & File Safety:** Multi-round concurrent tests on real SQLite instances, verifying atomic creation, lock timeouts, WAL journal header initialization, interactive cancellation (code 130), non-TTY rejection (code 1), and rejection of symlinks and legacy directories.
