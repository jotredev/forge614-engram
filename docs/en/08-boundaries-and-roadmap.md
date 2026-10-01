# 08 (EN). Current Boundaries and Roadmap

## Current product boundary

Forge614 Engram is the persistent-memory engine of the Forge614 ecosystem. It owns one local SQLite/FTS5 database, project identities, shared memories, sessions, search, its stdio MCP server, and its public TypeScript SDK.

It is intentionally **not** a visual workspace, assistant detector, assistant configurator, hook manager, or AI chat client. Those responsibilities belong to Forge614 Shell and Forge614 Engines through public contracts.

## Capabilities available in v1.2.1

- A private product home at `~/.forge614/engram/` with `engram.db`, `.env`, and `bin/`; an absolute `FORGE614_HOME` replaces the `~/.forge614` root to isolate one complete installation. An empty or relative variable fails with `INVALID_FORGE614_HOME` and never silently falls back to the real home.
- Local SQLite and FTS5 for every project and shared memory. Local search works without a network connection.
- Optional PostgreSQL replica configured non-interactively with `init --json --postgres-url <URL>`.
- Project-scoped and shared memories, exact topic lookup, history, archive/restore, FTS5 search, previews, context, sessions, and reinforcement.
- A local stdio MCP server started with `forge614-engram mcp`.
- A public SDK for consumers such as Forge614 Atlas, including `MemoryWorkspace`, `MemoryStore`, initialization APIs, and `MemoryStore.getByTopic()`.
- Safe installation, update, and uninstall operations. `forge614-engram update` installs the latest stable release after checksum verification.

## Capabilities added in v1.6.0

- `ecosystem` scope: memory shared across the repositories of a **group**, with the same topics, versions, archive/restore, and reinforcement; precedence project, ecosystem, `shared`. See [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md).
- Portable project identity in `.forge614/project.json`, owned by Engram; it resolves by `id`, not by path.
- `group-*` and `memory-move` commands; `--scope ecosystem --group` in the CLI; `scope: "ecosystem"` with `groupIntent` in MCP; public protocol version 3; an `ecosystem` block in `startup-context` and `context`.
- Additive database upgrade with automatic backup and verification (levels 8, 9, and 10).

Limits of this delivery: `ecosystem` memories are not replicated yet: the PostgreSQL replica refuses (`SYNC_ECOSYSTEM_UNSUPPORTED`) while they exist; group replication will arrive in its own plan (1.8.0, "format 4"). Engram only reads `forge614.node.json` and never infers a group. Asking which group a project without a declaration belongs to is Shell's visual flow. Having Engines and Shell inject the `ecosystem` block is those products' work: Engram publishes the contract and does not prove they already consume it.

## Capabilities added in v1.7.0

- Schema 11 (memory intelligence): a new database is born at that level and an existing database enables it only with `intelligence-enable`, with a backup and verification. See [05. Internal Architecture and Formulas](05-internal-architecture-and-formulas.md).
- Secret filter on save and memory metadata (short version, review date, replacement, and affected projects).
- Hybrid search and similar memories on save.
- Interrupted sessions: the previous session is offered as `previous`.
- Group board rules: status note, source project, and demoting a memory back to the project. See [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md).
- Startup block (format 2), ready to inject. See [10. Startup Context](10-startup-context.md).
- Protocol v4 (the memory-intelligence manual) with MCP server instructions and field descriptions. See [09. Public Memory Protocol](09-public-memory-protocol.md).

Limit of this delivery: group replication (format 4) will arrive in 1.8.0.

## Capabilities added in v1.7.1

- Sessions open in parallel by time: `parallel` reports the project's other open sessions with activity in the last 30 minutes; `previous` is now reported only once a session has gone more than 30 minutes without activity, and nobody is marked at session start any more.
- Startup block text: the "Previous session" section now says a session "was left open".
- Protocol v4 manual: it now asks the agent to say another session is open now (`parallel`) as distinct from one left open (`previous`), and to tell the person why a similar save is kept apart.

Limits of this delivery: (1) a session that works more than 30 minutes without saving anything through Engram will look "left open" from another session; (2) after compaction, if the own session has had no Engram activity for more than 30 minutes, the startup block may name it as "left open" (it is data, and repeating `memory_session_start` does not return `previous`).

## Capabilities added in v1.7.2

- Readable session notice: when `session-start`/`memory_session_start` add `previous`, `parallel`, or both, they also add `sessionNotice` (text), a readable fact derived from those two, with `previous` first when there are both.
- Protocol v4 manual, rule 3: it now names first the session that was left open (`previous`, with when and the offer to continue) and only then, and more briefly, the one open in parallel (`parallel`). `instructions` goes from 2,381 to 2,386 characters (cap 2,500); `mcpInstructions` from 1,992 to 1,997 (cap under 2,000).
- Reason: in lab testing, an assistant did not mention the session left open even when it received `previous`; with the readable-sentence notice it mentioned it with its time in every run, and the rule's new order keeps it from offering to continue a session that is still open in parallel.
- Known limit: the notice does not guarantee that the assistant offers to continue from the summary of the session left open; in those tests, an assistant said it was left open and when, but offered it only in some runs.

## Capabilities added in v1.8.0

- The same memory (project, personal notebook, and ecosystem board, across all three scopes) on two Macs, turned on explicitly with `forge614-engram cloud on` and a PostgreSQL database on Neon; `cloud off` turns it off without touching anything local. See [01. Installation and Getting Started](01-installation-and-getting-started.md) and [05. Internal Architecture and Formulas](05-internal-architecture-and-formulas.md).
- This new path (schema 12) **does** replicate the `ecosystem` scope, something the formats 1–3 replica never did: it supersedes the promise of a group-specific "format 4" mentioned in the 1.6.0 and 1.7.0 deliveries. Formats 1–3 (`sync --upgrade-format`) become the deprecated mechanism, without being removed (acta 0024, sunset 2027-03-31).
- Without `cloud on`, Engram starts up exactly as it did in 1.7.2 (measured, median difference within ±2 ms); with the cloud on, startup waits at most 1 second before continuing with local data.
- Project identity also by normalized Git remote (`origin`), for a folder without `.forge614/project.json` on the other Mac.

Limits of this delivery: Neon's changes table (`forge614_sync.changes`) is not pruned yet; a query blocked on Neon is not cut short before its `lock_timeout` (5 s), and because of that the MCP server can take up to 5 s to close if a connection was left half-open; the text a person sees (terminal output, `help`) stays fixed in Spanish, the bilingual es/en output for that text arrives in 1.9.0.

## Capabilities added in v1.8.1

- Protocol v4 manual, rule 4 (new): it asks to tell the person, in the first answer, what a "Cloud sync:" notice in `sessionNotice` means. It goes only in `instructions` (`mcp: false`): `instructions` goes from 2,386 to 2,485 characters (cap 2,500) and `mcpInstructions` stays at 1,997 (cap under 2,000). The following rules are renumbered.

## Capabilities added in v1.8.2

- The published installer also installs Forge614 Shell (which brings Engines) if it is not already installed and ends by printing the next step (by default `~/.forge614/shell/bin/forge614-shell init --product engram`, with the absolute path under `FORGE614_HOME`), which already includes initializing Engram's memory in its own guided screens, in an interactive terminal. Before downloading anything it checks for Node.js 22.19+ and `tar`; if either is missing it installs nothing and says how to fix it.

Limits of this delivery: the Shell and Engines packages are verified against their `.sha256` (their own installers do it), but the Shell and Engines `install.sh` scripts run without verifying their own digest, because their releases do not publish a digest of those scripts; the Engram binary is verified against `SHA256SUMS`. Windows has no Engram or Shell installer.

## Capabilities added in v1.8.3

- `sync` uploads each batch of up to 500 changes with a single bulk insert (before, one per change) and, with the cloud on and only when stderr is a terminal (and `TERM` is not `dumb`), shows "Subiendo N de M cambios…" and "Bajando cambios de la nube: N leídos…" on one stderr line that is erased when it finishes. stdout does not change; the MCP server and its background task show no progress.

Limits of this delivery: the progress texts stay fixed in Spanish (the bilingual es/en output arrives in 1.9.0); `cloud on`, `sync-watch`, `sync` without the cloud on, and `sync --upgrade-format` show no progress.

## Capabilities added in v1.8.4

- A new folder is no longer blocked by another project's lost folder: `project-bind` is asked for only if the new folder might be that project (same name as its lost folder or, with the cloud on, the same Git remote shared with another project) or if a project already has the folder's name (and no `.forge614/project.json` identifies it); in any other case it registers itself. The `PROJECT_BINDING_REQUIRED` errors say which project it is (name and `id`) and the exact command to resolve it.
- `scripts/release-smoke.sh <binary>` verifies the release with its own temporary `FORGE614_HOME` and `HOME` (it stops with exit code 2 without writing to it if a `FORGE614_HOME` is already set and is not an existing folder inside the system temporary directory; one inside it is ignored and the script uses its own; it also stops with exit code 2 if the binary is missing, and with exit code 1 on the first failing case), and the release workflow runs it with each binary, in addition to `--help`.

Limits of this delivery: a folder that was moved and renamed to another name, without `.forge614/project.json` and without a recognized remote, is no longer blocked: a new project is created. There is no `project-delete`: a project whose folder was lost still appears in `project-list`.

## Capabilities added in v1.8.5

- Searching or reading the context in a folder that has no project yet no longer gives `PROJECT_NOT_BOUND`: `memory_search` (scope `project` or `ecosystem`) answers `results: []`, and with scope `all` or no scope, the `shared` results; `memory_context` with no scope returns the `shared` context and with scope `ecosystem` an empty group context. In both cases the answer carries `project: { status: "unbound", message }`, a note explaining that the project is created when a session starts (`memory_session_start`) or on save. Reads do not register the folder.

Limits of this delivery: `memory_get`, `memory_history`, `memory_timeline`, `memory_session_end`, `memory_session_summary` and `memory_save` with scope `ecosystem` still give `PROJECT_NOT_BOUND` in a folder without a project, because they need a real one. The memory manual, the MCP descriptions and the format 2 of the results do not change (the `project` field is only added when the folder has no project).

## Explicit non-goals

- No Engram TUI or full-screen terminal control center.
- No installed-AI detection, client selection, hooks, plugins, or MCP configuration writes.
- No OpenCode, Antigravity, Cursor, Claude Code, Codex, or Gemini adapter catalogue in this product.
- No Windows release or installer at this stage. Official release binaries currently target macOS and Linux.
- No embeddings or cloud-only search. FTS5 and SQLite remain the primary local path.
- No automatic creation or selection of projects during initialization.

`FORGE614_HOME` is not a second database or a per-project configuration: it is one alternate root for a complete installation. SQLite, `.env`, binaries, update, and uninstall derive from it. Relative paths are rejected so the working directory cannot change where data is stored.

## Public memory protocol: integration status

The `forge614-engram-memory` version `1` contract is available from release `v1.3.0` and can be inspected with `forge614-engram memory-protocol --json`. Its publication does not mean that an AI-client integration is already installed. Version 4 (since 1.7.0) is the memory-intelligence manual and the default stays at 1 until Engines accepts it.

It does **not yet** install MCP, instructions, hooks, or plugins in Claude Code, Codex, or Cursor. Forge614 Engines will consume the public command and apply the protocol through each assistant's safe mechanism. Forge614 Shell will show a preview and request human confirmation. Engram does not configure AI clients directly.

PostgreSQL remains an optional replica synchronized explicitly through `sync` or `sync-watch`; this delivery does not add permanent automatic synchronization or a TUI.

`update --json` is an Engram machine interface, not evidence that Forge614 Shell already consumes it. Shell or another consumer must verify and integrate that contract separately. This interface is available from stable release `v1.4.0`.

Likewise, `startup-context` enables pre-session host reads, but this branch does not prove that Shell or Engines already consume it. Engram exposes the read-only public contract; it does not configure AI clients or give them direct SQLite access.

## Operational model

`forge614-engram init` remains a small terminal-only memory initialization flow for compatibility. It asks only about PostgreSQL synchronization and search reinforcement; it does not configure AI clients. `forge614-engram init --json` is the automation contract.

Forge614 Shell is the Forge614-owned visual setup and lifecycle experience. After integrations have been configured through the appropriate public contracts, a person may continue daily work directly in ADE Orca, Claude Code, Codex, or another native environment. Shell does not need to remain open.

## Roadmap dependencies

1. Forge614 Engines publishes the public installed-engine detection and confirmed-application contract.
2. Forge614 Shell consumes that contract for human-guided setup, previews, confirmations, repair, and removal.
3. Forge614 Atlas consumes Engines and Engram's public SDK, uses `getByTopic()` to resume repository contextualization, and writes validated structured knowledge to Engram.
4. Forge614 AI, when released, will coordinate compatible products through the future global `forge614 init` command. Engram must not claim that command before then.

Historic plans and handoffs remain in this repository as engineering records. They do not describe the current public product surface.
