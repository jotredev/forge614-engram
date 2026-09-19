# 02 (EN). Guided System Walkthrough

> **Stage:** TUI Control Center, Reinforced FTS5 (no embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 3
> **Release Versions:** Program 1.0.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & reinforced ordering) | PostgreSQL Formats 1, 2 & 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Status:** Current & Active (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This practical walkthrough guides you through the full operational lifecycle of Forge614 Engram: initializing global configuration via `setup`, supervising and managing the workspace through the interactive **Terminal Control Center (`tui`)**, connecting AI coding assistants via its safe subflow with an asynchronous 5-second self-test, interacting across 10 native MCP tools with Git-based canonical project resolution, tracking progressive sessions with event timelines (`timeline`), recording repeated observations as immutable confirmations without creating redundant versions (Schema 7), assembling ranked context dossiers (`context`), executing explainable FTS5 searches without embeddings, managing safe OpenCode plugin conflict resolution, and synchronizing snapshots with PostgreSQL using Format 3 promotion.

---

## 1. Project Concept and Identity (`projectId`)

In Forge614 Engram, **all projects share a single local SQLite database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are registered with two attributes:
1. **`projectId` (Immutable UUID Identifier):** An automatically generated lowercase UUIDv4 (e.g., `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It forms the primary relational foreign key anchoring all project memories.
2. **`name` (Descriptive Display Label):** A human-readable label (e.g., `"Online Store"`). Renaming a project with `project-rename` never alters `projectId` nor affects pre-existing memories.

> [!WARNING]
> **Logical Partitioning, Not Multi-User Security:** Project isolation structures your local workspace so one project never reads private notes from another. It is not an encrypted multi-tenant boundary. Any process running under your operating system user can access the store. **Never store API keys, private passwords, or security secrets in memory notes.**

---

## 2. Memory Scopes (`scope`)

The `scope` parameter governs memory visibility:

| Scope (`scope`) | Identifier (`projectId`) | Purpose and Behavior |
| :--- | :--- | :--- |
| **`project`** | Registered project UUID | Decisions, facts, or procedures that apply **strictly to this project**. |
| **`shared`** | `null` (no project) | Universal preferences or standards that apply **across all projects**. |

### Practical Examples:
- *"This application uses SQLite in WAL mode"* $\rightarrow$ **Project** scope (`scope: project`).
- *"All documentation must be in Spanish with engineering rigor"* $\rightarrow$ **Shared** scope (`scope: shared`).

A shared memory is stored **exactly once in the database**; it is never duplicated or copied into individual projects.

---

## 3. Step-by-Step Lifecycle Walkthrough

### Step 1: Initialize the Central Workspace (`setup` or `init`)

To initialize your workspace with interactive guidance:

```bash
forge614-engram setup
```

**Interactive Terminal Flow:**
1. Displays central file paths (`~/.forge614/.env` and `~/.forge614/engram.db`) and **automatically tightens permissions to `0700`** on any pre-existing user-owned directory before asking questions, eliminating the need for manual `chmod`.
2. Asks whether to configure PostgreSQL synchronization:
   - Option 1: `No` (default, 100% local and offline).
   - Option 2: `Sí, configurar PostgreSQL` (prompts for masked connection string).
3. Offers search reinforcement (Schema 7):
   - Default: `NO`.
   - Replying `sí` / `yes` stages Schema 7 immutable confirmations and reinforced ranking without embeddings.
4. Displays plan summary and asks for pre-flight confirmation (`¿Confirmar? [si/NO]`).
5. Upon confirmation, prepares `~/.forge614/` to `0700` (creating or securing it), writes `.env` to `0600`, and initializes `engram.db`.
6. **Automatic Transition to Assistant Onboarding:** Following storage completion, `setup` cleanly closes the terminal reader and automatically launches the Assistant Selection TUI (`assistantTui`). It detects the 5 supported assistants (Claude Code, Codex, Cursor, OpenCode, Antigravity), allowing selective enrollment, path previews, automatic private backups, and explicit confirmation (zero silent file modifications).
7. **Safe Cancellation Semantics:** Cancelling during memory setup (`Ctrl+C` or `no`) exits with code **130** without launching the assistant TUI and without creating `.env` or `engram.db` (only securing `0700` permissions on an existing directory). Cancelling inside the assistant TUI after memory setup leaves the initialized memory store intact.

---

### Step 2: The Interactive Terminal Control Center (`tui`)

To supervise storage, projects, shared counters, and assistant configurations without memorizing commands or exposing secrets, open the Terminal Control Center:

```bash
forge614-engram tui
```

> [!NOTE]
> `tui` strictly requires an interactive terminal (`TTY`). Running without a TTY immediately aborts with `INTERACTIVE_REQUIRED`.

#### 1. Read-Only by Default Principle:
The Control Center launches strictly in **passive read-only mode**:
- Does not create databases or `.env` files. If unconfigured, it explains that you should run `setup` or `init` and exits cleanly without creating storage.
- Never creates ghost projects or mutates counters simply by navigating.
- You can inspect all tabs without risking unintended modifications.

#### 2. Menu Navigation and Core Tabs:
```text
Summary | Projects | Shared | Storage | Actions | Assistants | Exit
```
- **Summary:** Shows overall initialization status, current SQLite schema version (3 to 7), enabled capabilities (Assistants, Sessions, Search Reinforcement), total enrolled projects, and shared memory counts.
- **Projects:** Lists every registered project with descriptive name, short UUID (e.g., `7c9e6679...`), and memory counts (active/archived). Pressing **Enter** opens the **Detail View**:
  - Full canonical UUID (`7c9e6679-7425-40de-944b-e07fc1f90ae7`).
  - Creation and update timestamps.
  - Bound local directory paths (`bindings`) registered on this physical machine.
- **Shared:** Displays active and archived shared memory counters and last update timestamp, reminding users that this is a single global collection rather than per-project storage.
- **Storage:** Shows the exact local SQLite file path (`~/.forge614/engram.db`), schema version (3 to 7), capability statuses, and PostgreSQL status (`configured` or `not-configured`).
  - **Zero Secret Exposure:** Strictly conceals PostgreSQL URLs, passwords, API secrets, memory titles, and memory content.

#### 3. Two-Step Confirmed Actions (`Actions`):
The `Actions` tab provides safe operational tasks:
- `Create project`: Prompts for a descriptive name and assigns a fresh UUID.
- `Rename project`: Updates the descriptive display name while preserving UUID and existing memories.
- `Bind directory`: Binds an absolute directory path to an explicit UUID without guessing by name.
- `Enable assistant integration`: Additive migration to Schema 5.
- `Enable sessions`: Additive migration to Schema 6.
- `Enable search reinforcement`: Additive migration to Schema 7.
- `Synchronize now`: Displayed only if PostgreSQL is configured. Runs single-shot sync without format promotion or background services.

**The Strict Confirmation Protocol:**
1. Selecting an action renders a full preview detailing consequences.
2. Required inputs (project name or absolute path) are captured and pre-validated.
3. The interface requires **typing `confirm`** (case-insensitive) followed by Enter.
4. **Pressing Enter alone never executes actions.**
5. Pressing Escape or Ctrl+C immediately cancels the action and restores the screen, leaving storage bytes identical.

#### 4. Sequential Assistant Subflow (`Assistants`):
Selecting `Assistants`:
- Suspends the Control Center and restores standard terminal mode.
- Sequentially launches the assistant configurator (`assistantTui`).
- Select clients with Space (Claude Code, Codex, Cursor, OpenCode, Antigravity), run the 5-second async self-test with `t`, review config diffs, and apply with private `0600`/UUID backups.
- Exiting the assistant configurator restores the terminal and reloads a fresh snapshot in the Control Center.
- **Zero nested raw modes:** Two event loops never execute simultaneously.

---

### Step 3: Native Stdio MCP Server and 10 Tools

When launching your AI coding assistant, it starts the background stdio MCP server:

```bash
forge614-engram mcp
```

The server reserves `stdout` exclusively for JSON-RPC messages, exposing **ten official tools**:

1. **`memory_current_project` (`directory?`):** Resolves current Git project context without creating records.
2. **`memory_context` (`directory?`, `scope?`, `compact?`, `maxBytes?`):** Returns ranked context dossiers (pinned, recent, session summaries) bounded by serialized byte limit.
3. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`):** BM25 trigram FTS5 search with mathematical ranking explanations.
4. **`memory_get` (`id`, `directory?`, `scope?`, `version?`):** Fetches full memory records, including historical revisions.
5. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`, `sessionId?`, `sessionProjectId?`):** Creates or updates memories with optional or inferred session association.
6. **`memory_history` (`id`, `directory?`, `scope?`):** Lists immutable historical revisions for a memory ID.
7. **`memory_session_start` (`sessionId`, `directory?`):** Opens an active session in the current project.
8. **`memory_session_end` (`sessionId`, `directory?`):** Formally closes an active session.
9. **`memory_session_summary` (`sessionId`, `summary`, `requestKey`, `directory?`, `expectedVersion?`):** Stores structured closing summaries under `session/<sessionId>/summary`.
10. **`memory_timeline` (`sessionId`, `id`, `version`, `directory?`, `before?`, `after?`):** Displays before/after neighbor memories within a session.

---

### Step 4: Canonical Git Project Identity and Binding (`project-bind`)

#### Canonical Resolution:
Resolves directories via `git rev-parse --path-format=absolute --git-common-dir`:
- **Linked worktrees:** Share common `.git` root and access identical project memories.
- **Subdirectories:** Resolve automatically to common repository root.
- **Non-Git directories:** Require explicit `--directory` or single MCP workspace root; never defaults to binary path.

#### Conservative Halting and Binding:
If a path registered in `project_bindings` disappears, Engram halts with `PROJECT_BINDING_REQUIRED`. Bind manually via the TUI (`Actions > Bind directory`) or CLI:

```bash
forge614-engram project-list
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

---

### Step 5: Native Assistant Prompt Hooks (`memory-hook`)

Injects native prompt orientation blocks for supported clients (Claude Code, Codex, and Cursor via native hooks, and OpenCode via dedicated plugin). For **Antigravity**, it currently operates as **MCP only**; no automatic hook is installed (*Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified*):

```bash
forge614-engram memory-hook --client codex
```

- Injects guidance prompting the model to query `memory_context` and `memory_current_project`.
- **Never writes memories directly.**
- **Codex Approval:** New hooks in Codex must be explicitly approved by typing `/hooks`.

---

### Step 6: Progressive Memory Sessions Lifecycle

Enables chronological task tracking. Requires `sessions-enable` or enabling sessions via TUI.

#### 1. Starting a Session (`session-start`):
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

#### 2. Saving Memories with Session Inference:
When saving a project note without `--session-id`:
- **0 candidate sessions:** Bound to manual project session (`local_manual_sessions`), returning `sessionSource: "manual"`.
- **1 candidate session:** Inferred automatically, returning `sessionSource: "inferred"`.
- **Multiple candidate sessions:** Halts with `AMBIGUOUS_SESSION`, requiring explicit `--session-id`.

```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --title "Asymmetric JWT Signing" \
  --content "We will sign access tokens using Ed25519 private keys." \
  --type decision \
  --topic "jwt-signing"
```

#### 3. Saving Shared Memories within Sessions:
To associate a universal rule with a project's session:
- Specify `--globalIntent`, `--session-id`, and `--session-project-id <UUID>`.
- Preserves privacy: response sets `projectId: null` and **omits `sessionId`**.

#### 4. Structured Session Summaries (`session-summary`):
```bash
forge614-engram session-summary \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --request-key "req-sum-01" \
  --summary-json '{
    "goal": "Migrate authentication to Ed25519 asymmetric keys",
    "instructions": "Maintain backwards compatibility for 30 days",
    "discoveries": "Legacy validator lacked JWK header support",
    "accomplishments": "Ed25519 issuance fully operational and tested",
    "nextSteps": "Deploy key rotation middleware",
    "files": ["src/auth/jwt.ts", "src/auth/middleware.ts"]
  }'
```

#### 5. Ending a Session (`session-end`):
```bash
forge614-engram session-end \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01"
```

---

### Step 7: Reinforced FTS5 Search and Immutable Confirmations (Schema 7)

Schema 7 introduces **immutable confirmations** and deterministic FTS5 ranking multipliers without embeddings:

#### 1. Enablement:
Enable via TUI (`Actions > Enable search reinforcement`) or CLI:
```bash
forge614-engram reinforcement-enable
```

#### 2. Initial Save with Request Key (`--request-key`):
```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Background Queue" \
  --content "We will use SQLite WAL tables for async background jobs." \
  --type decision \
  --request-key "req-queue-01"
```

#### 3. Idempotent Replay:
Replaying the identical request with the same `request-key`:
- Replays cached response without incrementing versions or confirmations.

#### 4. Payload Conflict Guard (`REQUEST_CONFLICT`):
Reusing `req-queue-01` with modified content triggers `REQUEST_CONFLICT`.

#### 5. Repeated Observation as Confirmation:
Re-recording the same note with a fresh key `req-queue-02` within the 15-minute window:
- Stays at version 1 without inflating history.
- Appends an immutable confirmation event in `confirmations`.
- Confers stability boost in search; **never certifies ontological truth**.

#### 6. 15-Minute Sliding Window:
For notes without topic keys (`topicKey: null`), deduplication evaluates candidates observed within the last 15 minutes (`now - 900,000 ms` to `now`). Notes separated by more than 15 minutes are created as distinct records.

---

### Step 8: Progressive Retrieval (Previews, Timeline, Context)

#### 1. Reinforced FTS5 Preview Search (`--preview`):
```bash
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "sqlite queue" \
  --preview
```

Returns previews with exact mathematical explanations:
```json
[
  {
    "memory": {
      "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": null,
      "type": "decision",
      "title": "Background Queue",
      "preview": "We will use SQLite WAL tables for async background jobs.",
      "truncated": false,
      "pinned": false,
      "version": 1,
      "createdAt": "2026-09-17T12:05:00.000Z",
      "updatedAt": "2026-09-17T12:05:00.000Z"
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

#### 2. Specific Version Reading (`get --version`):
```bash
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1
```

#### 3. Session Timeline Inspection (`timeline`):
```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "session-auth-refactor-01" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1 \
  --before 3 \
  --after 3
```

#### 4. Ranked Context Dossier (`context`):
```bash
forge614-engram context \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --compact \
  --max-bytes 8192
```

---

### Step 9: Safe OpenCode Plugin Conflict Resolution

If an existing plugin differs in OpenCode:
1. Open `forge614-engram tui` and navigate to `Assistants`.
2. Review the conflict warning.
3. Manually back up `plugins/forge614-engram.js`.
4. Reconcile differences and re-apply cleanly via `Assistants`.

---

### Step 10: PostgreSQL Sync & Format 3 Promotion (`sync --upgrade-format`)

#### Routine Sync:
Run from TUI (`Actions > Synchronize now`) or CLI:
```bash
forge614-engram sync
```

#### Explicit Promotion to Format 3:
To replicate confirmations to PostgreSQL:
```bash
forge614-engram sync --upgrade-format
```
- Atomic CAS lock ensures single-winner promotion.
- Unreinforced peer clients halt safely with `REINFORCEMENT_REQUIRED` until upgraded.
- `sync-watch` strictly rejects `--upgrade-format`.
