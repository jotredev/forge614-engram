# 02 (EN). Guided System Walkthrough

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Active (Verified with 191 tests on macOS with Bun 1.3.8)
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This practical walkthrough guides you step-by-step through the complete lifecycle of Forge614 Engram: from setting up global storage interactively with `setup`, configuring developer coding assistants using the terminal UI menu `tui`, interacting via the native stdio Model Context Protocol (MCP) server with Git-based canonical project resolution, to performing explainable searches, managing topic overrides, and synchronizing replicas with PostgreSQL.

---

## 1. The Project Concept & Identity (`projectId`)

In Forge614 Engram, **all projects share a single database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are formally registered with two attributes:
1. **`projectId` (Immutable Unique Identifier):** An automatically generated lowercase UUIDv4 (e.g. `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It permanently links all memories to that project.
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
- **`c` key or "Personalizar":** Prompts for custom executable paths and configuration directories via masked inputs (do not paste secrets).
- **`t` key or "Probar servidor propio (opcional)":** Triggers an **asynchronous self-test** of Engram's installed MCP server:
  - Spawns the installed executable (`forge614-engram`) via the official MCP SDK over stdio.
  - Verifies that the server identifies as `forge614-engram` and registers the 5 expected tools (`memory_current_project`, `memory_search`, `memory_get`, `memory_save`, `memory_history`).
  - Governed by a strict **5-second deadline**. If timed out, reports `TIMED_OUT` and forcibly reaps the child process with a 250 ms grace period.
  - Pressing `Escape` during the test cancels only the self-test and preserves user assistant selections.
  - **Important:** The self-test tests only Engram's own installed binary; **it never tests live client sessions nor executes commands extracted from client configurations**. Client sessions remain untested until verified inside each client application.
- **`Enter` key:**
  - On the client list with selected assistants: plans configuration and opens the **Preview Screen**.
  - On the preview screen: opens the **Confirmation Screen**.
  - On the confirmation screen: runs preflight checks on all plans, enables Schema 5 in SQLite, and applies configurations.
- **`Escape` key:** Steps back to the previous screen (`Confirm` $\rightarrow$ `Preview` $\rightarrow$ `Client List` $\rightarrow$ `Menu` $\rightarrow$ `Exit`).
- **`Ctrl+C`:** Cancels the session immediately, terminates any spawned child process, restores terminal state, and returns exit code **130**.
- **`PgUp` / `PgDn` and Arrows in Preview:** Scroll warnings, coverage details, and policy notices in compact viewports.

#### Safety Guarantees During Configuration:
1. **Zero-write preview:** Selecting assistants and previewing never modifies files on disk.
2. **Preflight verification:** Rejects unsafe symlinks, validates directory permissions, and checks file sizes.
3. **Private backups:** Before modifying an existing configuration, creates an exact byte-for-byte backup in mode `0600` with a UUID suffix (e.g., `settings.json.019183ab-....bak`).
4. **Comment preservation:** Uses tolerant parsers (JSONC and TOML) to preserve comments and foreign entries.
5. **Post-publication byte verification:** After publishing, Engram re-reads the file and validates exact planned bytes. If modified concurrently by another process, reports `PUBLISHED_UNVERIFIED`, retains backups, and avoids destructive rollback.
6. **Partial failure reporting:** If one assistant fails in a multi-client batch, Engram reports applied files, unverified paths, retained backups, and specific errors without undoing successful clients.

---

### Step 3: Assistant Interaction via MCP

Once an assistant is configured (e.g. Claude Code or Codex), it launches Engram's MCP server over stdio:

```bash
forge614-engram mcp
```

> [!IMPORTANT]
> The `mcp` server communicates via standard input/output (`stdio`) JSON-RPC. It reserves `stdout` exclusively for protocol messages, never emitting ANSI escapes or human logs.

#### The 5 Native Tools:

1. **`memory_current_project` (`directory?`):**
   Resolves the current project context based on Git without creating a database record. Returns the bound `projectId` or indicates the folder is unbound.
2. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`):**
   Executes explainable search across active memories. Read-only and never creates projects. Defaults to searching project and shared memories (`all`).
3. **`memory_get` (`id`, `directory?`, `scope?`):**
   Retrieves a memory by its UUID after verifying ownership in the active project or shared scope.
4. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`):**
   Saves or updates durable knowledge.
   - **Project scope by default:** When `scope` is omitted, defaults to `project`.
   - **Atomic project creation:** When saving the first memory in an unbound Git repository, Engram atomically creates the project record, registers the local folder binding in `project_bindings`, and saves the memory within a single database transaction.
   - **Explicit shared scope:** Saving with `scope: "shared"` **strictly requires explaining user intent in `globalIntent`**. Missing `globalIntent` throws `SHARED_INTENT_REQUIRED`.
5. **`memory_history` (`id`, `directory?`, `scope?`):**
   Audits the immutable version history of a memory across past revisions.

---

### Step 4: Canonical Git Identity & Manual Binding (`project-bind`)

#### How does Engram resolve project identity?
Engram runs `git rev-parse --path-format=absolute --git-common-dir` to identify the canonical repository root.
- **Linked worktrees:** Worktrees created with `git worktree add` point to the same common `.git` directory, sharing identical project identity and memories.
- **Subdirectories:** Running from deep nested folders resolves to the same root repository.
- **Non-git folders:** Require an explicit `directory` parameter or a single MCP root. Engram never guesses project identity from the binary location.

#### Conservative Path Ambiguity & Manual Binding (`project-bind`):
- When moving a repository or cloning onto a new machine, the `projectId` exists in the database, but local filesystem paths are not yet recorded.
- Before creating a new project identity for an unknown folder, Engram checks recorded bindings. If all bindings for any existing project are missing on disk, resolution conservatively halts with `PROJECT_BINDING_REQUIRED`.
- To resolve ambiguity, link the directory explicitly:

```bash
# 1. List registered projects to find UUID
forge614-engram project-list

# 2. Bind local folder to existing project UUID
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/my-project" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

Output:
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "directory": "/Users/usuario/Desktop/my-project",
  "source": "binding"
}
```

---

### Step 5: Native Assistant Hooks (`memory-hook`)

For compatible clients supporting hooks, Engram injects contextual reminders upon session start or prompt submission:

```bash
forge614-engram memory-hook --client codex
```

- Emits client-specific native JSON context reminding models to check `memory_current_project` and `memory_search` before repeating research.
- **Never saves memories directly.** Memory saves are performed by the model via `memory_save`.

> [!IMPORTANT]
> **Codex Trust Requirement:** In Codex, newly installed hooks must be inspected and trusted explicitly using the `/hooks` command inside Codex before they are allowed to execute.

---

### Step 6: Topic Overrides and Explainable Search

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

### Step 7: PostgreSQL Synchronization (`sync` & `sync-watch`)

If PostgreSQL replication was configured in `setup`:

#### On-Demand Single Round:
```bash
forge614-engram sync
```
Output:
```json
{
  "synchronized": true,
  "projects": 3,
  "memories": 12
}
```

#### Foreground Continuous Sync:
```bash
forge614-engram sync-watch --interval 30
```
- Performs an immediate round and retries every 30 seconds.
- Runs in the foreground; exiting with `Ctrl+C` exits cleanly with code 130 while keeping local SQLite data safe.
