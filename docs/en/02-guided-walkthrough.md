# 02 (EN). Guided System Walkthrough

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This practical walkthrough guides you step-by-step through the complete lifecycle of Forge614 Engram: setting up global storage with `setup`, configuring developer coding assistants using the terminal UI menu `tui`, managing progressive memory sessions, inspecting timelines, querying ranked context, interacting via the native stdio Model Context Protocol (MCP) server across 10 tools, safe OpenCode plugin conflict resolution, and promoting PostgreSQL replicas to Format 2.

---

## 1. The Project Concept & Identity (`projectId`)

In Forge614 Engram, **all projects share a single database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are formally registered with two attributes:
1. **`projectId` (Immutable Unique Identifier):** An automatically generated lowercase UUIDv4 (e.g. `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It permanently links all memories and sessions to that project.
2. **`name` (Cosmetic Display Name):** A human-readable label (e.g. `"Online Store"`). Renaming with `project-rename` never changes the `projectId` or affects stored memories.

> [!WARNING]
> **Logical isolation, not multi-tenant authorization:** Isolation by `projectId` organizes your data so one project never reads private notes belonging to another. However, it is not a multi-user operating system boundary. Any program running under your local user account can access the storage. **Never store plain-text passwords, private API secrets, or access tokens in memories.**

---

## 2. The Two Memory Scopes (`scope`)

The `scope` property dictates where a stored note applies:

| Scope (`scope`) | Identifier (`projectId`) | Purpose & Application |
| :--- | :--- | :--- |
| **`project`** | UUID of a registered project | Facts, decisions, or procedures applying **strictly to that specific project**. |
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
   - Option 2: `Sí, configurar PostgreSQL` (prompts for masked connection URL and explains full workspace replication).
3. Displays a plan summary and asks for confirmation (`Sí, aplicar cambios` or `Cancelar y salir`).
4. On confirmation, sets directory permissions `0700`, writes `.env` in `0600`, and initializes `engram.db`.
5. Exiting with `Ctrl+C` or `q` exits with **code 130** without touching disk.

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
- **`r` key or "Redetectar":** Rescans system PATH and default directories to update detected binary and configuration states.
- **`c` key or "Personalizar":** Prompts for custom executable paths and configuration directories via masked inputs.
- **`t` key or "Probar servidor propio (opcional)":** Triggers an **asynchronous self-test** of Engram's installed MCP server:
  - Spawns the installed executable (`forge614-engram`) via the official MCP SDK over stdio.
  - Verifies that the server identifies as `forge614-engram` and registers all 10 tools.
  - Governed by a strict **5-second deadline**. If timed out, reports `TIMED_OUT` and forcibly reaps the child process.
  - Pressing `Escape` during the test cancels only the self-test and preserves user assistant selections.
- **`Enter` key:** Advances through `List` $\rightarrow$ `Preview` $\rightarrow$ `Confirmation` $\rightarrow$ `Apply`.
- **`Escape` key:** Steps back to the previous screen.
- **`Ctrl+C`:** Cancels the session immediately, restores terminal state, and returns exit code **130**.

#### Safety Guarantees and OpenCode Safe Conflict Resolution:
1. **Zero-write preview:** Selecting assistants and previewing never modifies files on disk.
2. **Preflight verification:** Rejects unsafe symlinks, validates directory permissions, and checks file sizes.
3. **Private backups:** Before modifying an existing configuration, creates an exact byte-for-byte backup in mode `0600` with a UUID suffix (e.g., `settings.json.019183ab-....bak`).
4. **Comment preservation:** Uses tolerant parsers (JSONC and TOML) to preserve comments and foreign entries.
5. **Post-publication byte verification:** After publishing, Engram re-reads the file and validates exact planned bytes. If modified concurrently, reports `PUBLISHED_UNVERIFIED`.
6. **OpenCode Conflict Handling (`CONFLICT`):** If an existing `plugins/forge614-engram.js` contains divergent code, Engram treats it as a configuration conflict and halts safely without overwriting it. Users should preview the planned changes in TUI, back up the existing file, remove or reconcile it, and re-run configuration.

---

### Step 3: Enabling Progressive Memory Sessions (`sessions-enable`)

To unlock work session tracking, structured summaries, and ranked context retrieval, enable Schema 6:

```bash
forge614-engram sessions-enable
```

Output:
```json
{
  "enabled": true,
  "schema": 6
}
```

This migration is additive and permanent, creating tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`.

---

### Step 4: Assistant Interaction via MCP (10 Native Tools)

Once an assistant is configured, it launches Engram's MCP server over stdio:

```bash
forge614-engram mcp
```

#### The 10 Native Tools:

1. **`memory_context` (`directory?`, `scope?`, `compact?`, `maxBytes?`):**
   Retrieves structured, ranked context partitioned into `pinned`, `recent`, and `summaries`, bounded by strict byte serialization caps (`maxBytes`, 1024..65536, default 16384).
2. **`memory_current_project` (`directory?`):**
   Resolves the current project context based on Git without creating a database record.
3. **`memory_get` (`id`, `directory?`, `scope?`, `version?`):**
   Retrieves an active memory or historical revision by its UUID.
4. **`memory_history` (`id`, `directory?`, `scope?`):**
   Audits the immutable version history of a memory across past revisions.
5. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`, `sessionId?`, `sessionProjectId?`):**
   Saves or updates durable knowledge with session tracking.
6. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`, `preview?`):**
   Executes explainable search across active memories with optional lightweight previews.
7. **`memory_session_start` (`directory`, `sessionId`):**
   Explicitly starts a runtime work session tied to the project directory.
8. **`memory_session_end` (`directory?`, `sessionId`):**
   Formally ends an active runtime session, setting its completion timestamp.
9. **`memory_session_summary` (`directory?`, `sessionId`, `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`, `requestKey`, `expectedVersion?`):**
   Persists a structured 6-field session summary under reserved topic `session/<sessionId>/summary`.
10. **`memory_timeline` (`directory?`, `sessionId`, `id`, `version`, `before?`, `after?`):**
    Reconstructs the chronological event window surrounding a focus memory within a work session.

#### Session Inference Scenarios on Memory Save:
- **Independent Mode (CLI `save`):**
  - If `--session-id` is provided: explicitly binds the note to that session.
  - If `--session-id` is omitted for a project note: falls back to the local manual fallback session (`local_manual_sessions`, `sessionSource: "manual"`).
  - If `--session-id` is omitted for a shared note: saves with `sessionSource: null` and `sessionId: null`.
- **Assistant Mode (MCP `memory_save`):**
  - If `sessionId` is omitted: searches for active runtime sessions started in the last 7 days on the bound directory:
    - 0 candidates: falls back to the local manual session (`sessionSource: "manual"`).
    - 1 candidate: automatically binds to that session (`sessionSource: "inferred"`).
    - 2+ candidates: halts with `AMBIGUOUS_SESSION`, requiring the model or user to supply an explicit `sessionId`.
- **Shared Memories with Session Association:**
  - Requires explicit `globalIntent`.
  - Requires both `sessionId` and `sessionProjectId`.
  - In storage: `projectId` remains `null`. The external response and queries from other projects omit private session origin metadata to prevent leaking private project context.

---

### Step 5: Progressive Retrieval: Previews, Timeline, and Ranked Context

#### 1. Lightweight Search Previews:
Avoid saturating the LLM context by requesting compact previews (bounded to 300 Unicode code points):
```bash
forge614-engram search --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --query "postgresql" --preview
```

#### 2. Session Event Timeline:
Reconstruct the sequence of discoveries surrounding an architectural decision:
```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-arch-01" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851" \
  --version 1 \
  --before 3 \
  --after 3
```

#### 3. Ranked Context Dossier:
Assemble prioritized context at task startup or post-compaction:
```bash
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --max-bytes 16384
```
> [!NOTE]
> `--max-bytes` strictly measures the serialized UTF-8 JSON payload in bytes, not model tokens.

---

### Step 6: Canonical Git Identity & Manual Binding (`project-bind`)

Engram runs `git rev-parse --path-format=absolute --git-common-dir` to identify the canonical repository root.
- **Linked worktrees:** Worktrees created with `git worktree add` point to the same common `.git` directory, sharing identical project identity and memories.
- **Subdirectories:** Running from deep nested folders resolves to the same root repository.
- **Manual binding:** When cloning to a new machine or reorganizing folders:
  ```bash
  forge614-engram project-bind \
    --directory "/Users/usuario/Desktop/my-project" \
    --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
  ```

---

### Step 7: Topic Overrides and Explainable Search

When saving a universal rule alongside a project-specific exception:

```bash
# Universal rule:
forge614-engram save \
  --scope shared \
  --topic "preferred-runtime" \
  --title "General Runtime" \
  --content "Use Bun for all new services." \
  --type preference

# Project exception:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "preferred-runtime" \
  --title "Runtime Exception" \
  --content "Use Node.js 20 LTS due to client requirements." \
  --type decision
```

Searching from the project (`--scope all` default):
```bash
forge614-engram search --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --query "runtime"
```
Engram applies **topic override**: the project's active note overrides the shared rule with the same `topicKey`. Archiving the project exception causes the shared rule to automatically reappear in subsequent searches.

---

### Step 8: PostgreSQL Replication and Format 2 Promotion

If PostgreSQL replication was configured in `setup`:

#### Normal Single Round:
```bash
forge614-engram sync
```

#### Promoting a Replica to Format 2:
To promote a Format 1 PostgreSQL replica so that it replicates sessions and summaries:
```bash
forge614-engram sync --upgrade-format
```
- Protected by optimistic CAS locking on `forge614_sync.state`.
- Rejected by `sync-watch` with `INVALID_INPUT` to ensure promotions are intentional and supervised.
- Peer devices must install the updated build, execute `sessions-enable`, and sync.
