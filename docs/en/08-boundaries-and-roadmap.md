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
