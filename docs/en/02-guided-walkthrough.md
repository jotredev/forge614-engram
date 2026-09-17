# 02 (EN). Guided System Walkthrough

> **Stage:** Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, 10 MCP Tools, Local Memory & Optional PostgreSQL Synchronization
> **Schemas:** SQLite Schemas 3 (local) / 4 (sync) / 5 (assistants & local bindings) / 6 (progressive sessions) / 7 (immutable confirmations & reinforced ranking) | PostgreSQL Replica Formats 1, 2, and 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Status:** Current & Active (439 total tests across 76 files: 430 passed and 9 skipped without isolated PostgreSQL test binaries; 439 passed, 0 failures, 2,274 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 38.62s)
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This practical walkthrough guides you step-by-step through the complete lifecycle of Forge614 Engram: from setting up global storage interactively with `setup`, connecting developer coding assistants using the terminal UI menu `tui`, interacting across the 10 native Model Context Protocol (MCP) tools with automatic Git project resolution, managing progressive memory work sessions with event timelines (`timeline`), recording repeated memories as immutable confirmations without fabricating redundant revisions (Schema 7), assembling ranked prompt context dossiers (`context`), executing reinforced FTS5 searches with transparent mathematical factors without embeddings, safely managing OpenCode plugin updates, and synchronizing PostgreSQL replicas with explicit promotion to Format 3.

---

## 1. The Project Concept & Identity (`projectId`)

In Forge614 Engram, **all projects share a single database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are formally registered with two attributes:
1. **`projectId` (Immutable Unique Identifier):** An automatically generated lowercase UUIDv4 (e.g., `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It permanently links all memories and sessions to that project.
2. **`name` (Cosmetic Display Name):** A human-readable label (e.g., `"Online Store"`). Renaming with `project-rename` never changes the `projectId` or affects stored memories.

> [!WARNING]
> **Logical isolation, not multi-tenant authorization:** Isolation by `projectId` organizes your data so one project never reads private notes belonging to another. However, it is not a multi-user operating system boundary. Any program running under your local user account can access the storage. **Never store plain-text passwords, private API secrets, or access tokens in memories.**

---

## 2. The Two Memory Scopes (`scope`)

The `scope` property dictates where a stored note applies:

| Scope (`scope`) | Identifier (`projectId`) | Purpose & Application |
| :--- | :--- | :--- |
| **`project`** | UUID of a registered project | Decisions, facts, or rules applying **strictly to that specific project**. |
| **`shared`** | `null` (no project) | Universal preferences or developer practices applying across **all projects**. |

### Everyday examples:
- *"This application uses SQLite"* $\rightarrow$ **Project** scope (`scope: project`).
- *"I prefer technical explanations in English"* $\rightarrow$ **Shared** scope (`scope: shared`).

A shared memory is stored **once in the central database**; it is never duplicated or cloned across individual projects.

---

## 3. Step-by-Step Lifecycle Walkthrough

### Step 1: Initialize Global Storage (`setup` or `init`)

To configure your central storage interactively:

```bash
forge614-engram setup
```

**Interactive terminal walkthrough:**
1. Explains central file locations: `~/.forge614/.env` and `~/.forge614/engram.db`.
2. Prompts whether to enable PostgreSQL synchronization:
   - Option 1: `No` (default, purely local mode).
   - Option 2: `Yes, configure PostgreSQL` (prompts for masked connection URL and explains full workspace replication).
3. Prompts whether to enable search reinforcement (Schema 7, immutable confirmations):
   - Option 1: `Yes` (default, activates Schema 7 and reinforcement ranking).
   - Option 2: `No` (keeps baseline Schema 6).
4. Displays a plan summary and asks for confirmation (`Yes, apply changes` or `Cancel and exit`).
5. On confirmation, sets directory permissions `0700`, writes `.env` in `0600`, and initializes `engram.db`.
6. Exiting with `Ctrl+C` or `q` exits with **code 130** without touching disk.

---

### Step 2: Interactive Assistant Configuration Menu (`tui`)

To configure your coding assistants (Claude Code, Codex, Cursor, OpenCode, and Gemini CLI) without manually editing JSON or TOML files, open the interactive terminal menu:

```bash
forge614-engram tui
```

> [!NOTE]
> `tui` requires a real interactive terminal (`TTY` with raw mode support). When invoked in a non-interactive environment (such as a pipe or automated script), it immediately fails with `INTERACTIVE_REQUIRED`. For scriptable inspection, use the read-only command `assistant-list`.

#### Keyboard Controls:
- **Up / Down Arrows (`↑` / `↓`):** Move cursor through the menu and assistant list.
- **Spacebar (`Space`):** Select or deselect assistants for configuration.
- **`r` key or "Rescan":** Rescans system PATH and default directories to update detected binary and configuration states.
- **`c` key or "Customize":** Prompts for custom executable paths and configuration directories via masked inputs.
- **`t` key or "Test own server":** Triggers an **asynchronous self-test** of Engram's installed MCP server:
  - Spawns the installed executable (`forge614-engram`) via the official MCP SDK over stdio.
  - Verifies that the server identifies as `forge614-engram` and registers all 10 tools.
  - Governed by a strict **5-second deadline**. If timed out, reports `TIMED_OUT` and forcibly reaps the child process.
  - Pressing `Escape` during the test cancels only the self-test and preserves user assistant selections.
- **`Enter` key:** Advances through `List` $\rightarrow$ `Preview` $\rightarrow$ `Confirmation` $\rightarrow$ `Apply`.
- **`Escape` key:** Steps back to the previous screen.
- **`Ctrl+C`:** Cancels the session immediately, restores terminal state, and returns exit code **130**.

#### Safety Guarantees:
1. **Zero-write preview:** Selecting assistants and previewing never modifies files on disk.
2. **Preflight verification:** Rejects unsafe symlinks, validates directory permissions, and checks file sizes.
3. **Private backups:** Before modifying an existing configuration, creates an exact byte-for-byte backup in mode `0600` with a UUID suffix (e.g., `settings.json.019183ab-....bak`).
4. **Comment preservation:** Uses tolerant parsers (JSONC and TOML) to preserve comments and foreign entries.
5. **Post-publication byte verification:** After publishing, Engram re-reads the file and validates exact planned bytes. If modified concurrently, reports `PUBLISHED_UNVERIFIED`.

---

### Step 3: The Native MCP Server and its 10 Tools

When your AI client starts, it launches Engram's MCP server over standard input/output streams (`stdio`):

```bash
forge614-engram mcp
```

The server reserves `stdout` exclusively for JSON-RPC frames. It provides **ten official tools**:

1. **`memory_current_project` (`directory?`):** Resolves the Git context of the current project without creating a database record.
2. **`memory_context` (`directory?`, `scope?`, `compact?`, `maxBytes?`):** Assembles a structured, ranked context view of pinned, recent, and summary items respecting strict serialized byte budgets.
3. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`, `preview?`):** Searches active memories using BM25 trigram FTS5 with transparent explanation factors.
4. **`memory_get` (`id`, `directory?`, `scope?`, `version?`):** Retrieves a complete note by its UUID, allowing inspection of specific historical versions.
5. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`, `sessionId?`, `sessionProjectId?`):** Saves or updates durable knowledge, associating it explicitly or inferredly to a work session.
6. **`memory_history` (`id`, `directory?`, `scope?`):** Chronologically lists all immutable past revisions of a note.
7. **`memory_session_start` (`sessionId`, `directory?`):** Initiates an active work session in the current project.
8. **`memory_session_end` (`sessionId`, `directory?`):** Formally closes an active work session.
9. **`memory_session_summary` (`sessionId`, `summary`, `requestKey`, `directory?`, `expectedVersion?`):** Records a structured closing summary for the session under reserved topic `session/<sessionId>/summary`.
10. **`memory_timeline` (`sessionId`, `id`, `version`, `directory?`, `before?`, `after?`):** Displays the narrative window of memories recorded before and after a decision within the same session.

---

### Step 4: Canonical Git Identity & Manual Binding (`project-bind`)

#### Canonical Resolution:
Engram executes `git rev-parse --path-format=absolute --git-common-dir`.
- **Linked worktrees:** Point to the same common `.git` directory, sharing identical project identity and memories.
- **Subdirectories:** Resolve automatically to the shared repository root.
- **Directories without Git:** Require an explicit `--directory` or a single MCP root; the binary directory is never used as an implicit project.

#### Conservative Safeguards and Manual Binding:
If any directory path registered in `project_bindings` no longer exists on disk (moved folder or unmounted volume), Engram halts defensively with `PROJECT_BINDING_REQUIRED` to avoid creating duplicate projects. You can inspect and manually bind paths with:

```bash
forge614-engram project-list
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

---

### Step 5: Native Assistant Hooks (`memory-hook`)

For supported assistants (Claude Code, Codex, Cursor, OpenCode, Gemini CLI), Engram injects contextual guidance on lifecycle events such as session start (`SessionStart`) or prompt submission (`UserPromptSubmit`):

```bash
forge614-engram memory-hook --client codex
```

- Emits native JSON advisory blocks encouraging the model to invoke `memory_context` and `memory_current_project`.
- **Does not write memories directly.**
- **Codex Approval Notice:** New hooks registered in Codex require explicit user approval via `/hooks` inside Codex before they can execute.

---

### Step 6: The Progressive Memory Sessions Lifecycle

A progressive session groups notes generated during a specific task and allows auditing them in chronological sequence. It requires Schema 6 (`forge614-engram sessions-enable`).

#### 1. Start a Session (`session-start`):
Session identifiers must contain 1 to 200 Unicode characters without control codes or leading/trailing whitespace:

```bash
forge614-engram session-start \
  --directory "/Users/usuario/Desktop/my-project" \
  --session-id "session-auth-refactor-01"
```

Output:
```json
{
  "sessionId": "session-auth-refactor-01",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "kind": "runtime",
  "startedAt": "2026-09-17T12:00:00.000Z",
  "endedAt": null
}
```

#### 2. Save Memories with Session Inference:
When an assistant or user saves a project note without specifying `--session-id`:
- **0 candidate sessions:** If no runtime session has been started in the last 7 days for that directory, Engram assigns it to the local manual notebook (`local_manual_sessions`), returning `sessionSource: "manual"`.
- **1 candidate session:** If exactly one runtime session has been started in the last 7 days for that bound directory, Engram automatically links it, returning `sessionSource: "inferred"`.
- **2+ candidate sessions:** If multiple runtime sessions remain open concurrently, Engram safely halts with `AMBIGUOUS_SESSION`, requiring an explicit `--session-id`.

```bash
# Explicit save specifying the session:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --title "Asymmetric JWT Tokens" \
  --content "Tokens will be signed using Ed25519 private keys." \
  --type decision \
  --topic "jwt-signing"
```

Output:
```json
{
  "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "jwt-signing",
  "type": "decision",
  "title": "Asymmetric JWT Tokens",
  "content": "Tokens will be signed using Ed25519 private keys.",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-17T12:05:00.000Z",
  "updatedAt": "2026-09-17T12:05:00.000Z",
  "sessionId": "session-auth-refactor-01",
  "sessionSource": "explicit"
}
```

#### 3. Saving Shared Memories with Session Association:
To associate a universal rule (`scope: shared`) with a project session:
- Specify `--globalIntent` explaining why the rule applies universally.
- Specify `--session-id` and `--session-project-id <UUID>`.
- The shared note is stored with `projectId: null`, and the response **never reveals the `sessionId` or private origin**, safeguarding user privacy.

```bash
forge614-engram save \
  --scope shared \
  --title "Token Expiration Policy" \
  --content "Access tokens must expire within at most 15 minutes." \
  --type preference \
  --session-id "session-auth-refactor-01" \
  --session-project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --globalIntent "Applies to all authentication microservices in the organization."
```

#### 4. Record a Structured Session Summary (`session-summary`):
Upon finishing work, record a closing log with six strict fields (`goal` required; `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`):

```bash
forge614-engram session-summary \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --request-key "req-sum-01" \
  --summary-json '{
    "goal": "Migrate authentication to asymmetric Ed25519 keys",
    "instructions": "Maintain backward compatibility for 30 days",
    "discoveries": "The legacy validator did not support JWK headers",
    "accomplishments": "Ed25519 token issuance operational and verified",
    "nextSteps": "Deploy key rotation middleware",
    "files": ["src/auth/jwt.ts", "src/auth/middleware.ts"]
  }'
```

The summary is persisted under reserved topic `session/session-auth-refactor-01/summary` and indexed in `session_summaries`.

#### 5. Close the Session (`session-end`):
```bash
forge614-engram session-end \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01"
```

---

### Step 7: Reinforced FTS5 Search and Immutable Confirmations (Schema 7)

Schema 7 equips Forge614 Engram with the capability to record repeated observations as **immutable confirmations** and weight FTS5 search ranking without using embeddings or secondary LLM evaluator models.

#### 1. Local Activation (`reinforcement-enable`):
```bash
forge614-engram reinforcement-enable
```
Output: `{"enabled": true, "schema": 7}`.

#### 2. Saving an Initial Memory with a Request Key (`--request-key`):
To ensure operations are idempotent and resilient across network timeouts or process interruptions, the assistant assigns a `requestKey`:

```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Background Task Queues" \
  --content "We will use SQLite WAL-based queues for asynchronous tasks." \
  --type decision \
  --request-key "req-queue-01"
```

The memory is created at version 1, with 0 prior revisions and 0 confirmations.

#### 3. Idempotent Replay with the Same Key (`Replay`):
If the connection or assistant process is interrupted and the **exact same request is re-executed with key `req-queue-01`**:
- The system recognizes the key stored in `requests`.
- It immediately returns the previously cached response.
- **No confirmations are added and no versions are incremented.**

#### 4. Payload Conflict on Key Reuse (`REQUEST_CONFLICT`):
If the same key `req-queue-01` is reused while sending different content or title:
- The system detects a discrepancy in the SHA-256 cryptographic hash of the payload.
- It immediately aborts with the error `REQUEST_CONFLICT`.

#### 5. Repeated Save with New Key: Confirmation Event:
If at a later time (within a **15-minute** sliding deduplication window for notes without a topic) the assistant observes and saves the exact same active note (identical title, content, type, and pinned status) using a **new key** `req-queue-02`:

```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Background Task Queues" \
  --content "We will use SQLite WAL-based queues for asynchronous tasks." \
  --type decision \
  --request-key "req-queue-02"
```

**Engram Behavior:**
- **Does not create a redundant version 2.**
- Records an immutable event in the `confirmations` table with its own UUID `confirmationId`, referenced version, UTC timestamp, and current session.
- Returns version 1 intact with its updated session.
- Inspecting history (`forge614-engram history --id <id>`) confirms there is **exactly 1 version**, keeping the revision history clean of artificial duplicates.
- **Honest Semantic Meaning:** This records that the fact was observed again; **it does not certify absolute truth nor human verification**.

#### 6. 15-Minute Sliding Deduplication Window (Notes without Topic):
For general memories without a topic (`topicKey: null`), deduplication considers only active candidate notes observed within the last 15 minutes (between `now - 900,000 ms` and `now`). If more than 15 minutes have passed, Engram creates a separate new memory to avoid merging temporally distant events. If multiple candidates exist within the window, it selects the most recently observed and breaks ties with `id ASC`.

---

### Step 8: Progressive Retrieval & Reinforced Search (Previews, Timeline, Context)

Engram implements a progressive retrieval model (inspired by **Gentleman** with **Forge614** adaptations):

#### 1. FTS5 Search with Reinforcement Factors (`--preview`):
Text search in SQLite FTS5 computes BM25 relevance and applies the ranking formula with recency and stability multipliers:

```bash
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "sqlite queues" \
  --preview
```

Representative output with detailed factor explanation:
```json
[
  {
    "memory": {
      "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": null,
      "type": "decision",
      "title": "Background Task Queues",
      "preview": "We will use SQLite WAL-based queues for asynchronous tasks.",
      "truncated": false,
      "pinned": false,
      "version": 1,
      "createdAt": "2026-09-17T12:00:00.000Z",
      "updatedAt": "2026-09-17T12:00:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -2.145,
      "multiplier": 1.069,
      "orderScore": -2.293,
      "reinforcement": {
        "revisionCount": 0,
        "duplicateCount": 1,
        "lastSeenAt": "2026-09-17T12:12:00.000Z",
        "ageDays": 0.005,
        "pinnedBoost": 0,
        "recencyBoost": 0.059,
        "stabilityBoost": 0.008
      }
    }
  }
]
```

> [!NOTE]
> In SQLite FTS5, ranking sorts ascending by `orderScore = bm25 * multiplier`. Since BM25 values are negative, a higher multiplier (from pinned notes, recency, or confirmations) results in a more negative number, ordering the note earlier in search results.

#### 2. Reading a Specific Version (`get --version`):
To inspect the full content of a past historical revision:

```bash
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1
```

#### 3. Session Event Timeline (`timeline`):
Audits the train of thought by retrieving earlier and later notes recorded within the same session:

```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1 \
  --before 3 \
  --after 3
```

Returns `{ "sessionId", "focus", "before", "after" }`, where `focus` displays up to 500 Unicode code points and neighboring notes display up to 150 Unicode code points.

#### 4. Ranked Context Dossier (`context`):
Automatically gathers the project's cognitive state at task startup or post-compaction:
- Up to 20 prioritized pinned memories (`pinned`).
- Up to 20 unpinned recent memories (`recent`).
- Up to 5 past session summaries (`summaries`).
- Strictly bounded by a serialized **UTF-8 JSON byte budget** (`--max-bytes`, default 16384; range 1024..65536) and allows omitting previews with `--compact`:

```bash
forge614-engram context \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --compact \
  --max-bytes 8192
```

---

### Step 9: Safe Plugin Updates in OpenCode

In OpenCode, Engram generates an integration plugin at `plugins/forge614-engram.js` using upstream experimental callbacks.

> [!IMPORTANT]
> **Plugin Conflict Management:**
> If an Engram plugin already exists in an active OpenCode directory with content differing from the planned version, the system flags a configuration conflict (`CONFLICT`) and **never overwrites it automatically**.
>
> **Reconciliation Procedure:**
> 1. Open `forge614-engram tui` and inspect the preview.
> 2. If a conflict is reported, create a manual backup of your existing `plugins/forge614-engram.js` file.
> 3. Remove or reconcile local changes in the file.
> 4. Re-run `forge614-engram tui`, confirm the changes, and verify clean application.

---

### Step 10: PostgreSQL Synchronization and Format 3 Promotion (`sync --upgrade-format`)

If PostgreSQL replication was configured in `setup`:

#### Ordinary Synchronization:
```bash
forge614-engram sync
```

#### Explicit Promotion to Format 3:
When your local database is at Schema 7 (search reinforcement with confirmations) and you want the PostgreSQL replica to synchronize confirmation events and requests:
- Ordinary synchronization without flags rejects promotion if the remote replica is in an older format, returning `SYNC_UPGRADE_REQUIRED`.
- To intentionally promote the replica to **Format 3**, run:
```bash
forge614-engram sync --upgrade-format
```
- Promotion is validated atomically using optimistic CAS (*Compare-And-Swap*) locking on the remote snapshot hash.
- **Requirement Across All Peer Devices:** Before promoting to Format 3, **all peer devices must be updated** and have executed `reinforcement-enable`. If an unreinforced client attempts to sync a Format 3 package, it halts with `REINFORCEMENT_REQUIRED` to protect local storage from unrecognized confirmation tables.
- **`sync-watch` Rejects Promotions:** `sync-watch --upgrade-format` is prohibited; promotion must be executed via the one-shot `sync` command.
