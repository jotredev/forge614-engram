# 07 (EN). Plain-Language Glossary

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Active (Verified with 191 tests on macOS with Bun 1.3.8)
> **Sister translation:** [07. Glosario de Conceptos en Lenguaje Cotidiano](../es/07-glosario.md)

This glossary explains every technical concept using real-world analogies and everyday language, followed by its formal technical term in parentheses.

---

### Model Context Protocol (MCP)
An open communication standard allowing artificial intelligence models to safely connect to external tools and data sources. In Forge614 Engram, it operates locally via computer standard input/output (`stdio`).

### Terminal User Interface (TUI / `tui`)
An interactive full-screen panel inside the terminal where a human navigates using arrow keys and the spacebar, previews configuration changes, runs server self-tests, and confirms updates without manually editing configuration files.

### MCP Server Self-Test
An automated asynchronous test executed by the TUI menu against Engram's installed binary. It uses the official MCP SDK to spawn the server over stdio, verifies that it identifies as `forge614-engram`, and confirms that it exposes the 5 expected memory tools within a strict 5-second deadline. **It never tests live AI client sessions**, which must be verified inside each editor.

### Machine-Local Project Binding (`project_bindings` / Schema 5)
A record in local SQLite storage associating a physical directory path on this machine with a project UUID (`projectId`). It is machine-specific and is never synchronized across devices.

### Git Common Directory (`--git-common-dir`)
The canonical physical location of the primary Git repository. Allows nested subdirectories and linked worktrees to automatically recognize that they belong to the same software project, accessing the same memories.

### Linked Worktree (`git worktree add`)
An advanced Git feature allowing multiple branches of a single repository to be checked out simultaneously in separate folders. Thanks to Engram's canonical Git resolver, all linked worktrees share the exact same memories.

### Preflight Safety Check
A rigorous inspection executed before modifying any client configuration file. Validates permissions, rejects symlinks, and ensures files do not exceed safety size thresholds.

### UUID-Suffixed Private Backup
A backup file created automatically before modifying client configurations (e.g., `~/.claude.json.3a8f...bak`). Written with private permissions (`0600`) and containing the exact prior bytes for reliable rollback.

### Published Unverified (`PUBLISHED_UNVERIFIED`)
A safety notice emitted when Engram successfully applies configuration changes, but immediate byte verification reveals that another process or editor modified the file concurrently. Engram retains the backup file and avoids destructive blind rollbacks.

### Native Assistant Hook (`memory-hook`)
An adapter command invoked by developer clients on lifecycle triggers (such as session start or prompt submission). Injects contextual reminders prompting models to search memory before re-investigating, without saving memories directly.

### Explicit Global Intent (`globalIntent`)
Mandatory text justification required when saving a shared memory (`scope: "shared"`). Formally explains why a decision or preference applies universally across all projects on the machine.

### Detected vs Configured vs Tested Session
Three distinct states recognized by the system:
1. **Detected:** The client executable exists in system PATH.
2. **Configured:** Client configuration files contain Engram launch commands.
3. **Tested Session:** The live interactive client session was launched and verified calling MCP tools.

### Codex Trust Policy (`/hooks`)
A native Codex security requirement where newly installed hooks must be reviewed and approved explicitly by the user via the `/hooks` command inside Codex before they are allowed to execute.

### Interactive Terminal (TTY / `isTTY`)
A direct console channel where a human types answers and views prompt outputs. If absent, `setup` and `tui` halt with `INTERACTIVE_REQUIRED`.

### User Cancellation Exit Code (Exit Code 130)
The standard numerical code returned to the operating system when an interactive operation (`setup`, `tui`, `sync-watch`, or `mcp`) is canceled via `Ctrl+C`, `Escape`, or `q`.

### Central User Storage Directory (`~/.forge614/`)
The private user folder housing configuration and the single database, guarded by owner-only permissions (`0700`).

### Master Relational Database (`engram.db`)
The single SQLite database file storing all projects, memories, versions, requests, and machine-local project bindings.

### Stable Project Identity (`projectId`)
A permanent UUIDv4 assigned to each project upon creation, ensuring that updating cosmetic display names never breaks memory access.

### Memory Scope (`scope`)
Property dictating whether a memory applies strictly to one project (`project`) or universally across all projects (`shared`).

### Topic Exception Override (*Topic Override*)
SQL logic where an active project memory shadows a universal shared memory sharing the exact same `topicKey` during project searches.

### BM25 Ranking Formula
A probabilistic retrieval algorithm scoring keyword matches against term and document frequencies, rewarding rare terms and concise notes.

### Optional PostgreSQL Replica (Direct Sync)
A remote database configured by the operator to mirror workspace snapshots across developer machines without third-party cloud intermediaries.

### Deterministic 3-Way Snapshot Merge
An algorithm comparing the base checkpoint, local state, and remote state to cleanly merge non-conflicting changes from independent projects.
