# 08 (EN). Current Boundaries and Roadmap

## Current product boundary

Forge614 Engram is the persistent-memory engine of the Forge614 ecosystem. It owns one local SQLite/FTS5 database, project identities, shared memories, sessions, search, its stdio MCP server, and its public TypeScript SDK.

It is intentionally **not** a visual workspace, assistant detector, assistant configurator, hook manager, or AI chat client. Those responsibilities belong to Forge614 Shell and Forge614 Engines through public contracts.

## Capabilities available in v1.2.0

- A private product home at `~/.forge614/engram/` with `engram.db`, `.env`, and `bin/`.
- Local SQLite and FTS5 for every project and shared memory. Local search works without a network connection.
- Optional PostgreSQL replica configured non-interactively with `init --json --postgres-url <URL>`.
- Project-scoped and shared memories, exact topic lookup, history, archive/restore, FTS5 search, previews, context, sessions, and reinforcement.
- A local stdio MCP server started with `forge614-engram mcp`.
- A public SDK for consumers such as Forge614 Atlas, including `MemoryWorkspace`, `MemoryStore`, initialization APIs, and `MemoryStore.getByTopic()`.
- Safe installation, update, and uninstall operations. `forge614-engram update` installs the latest stable release after checksum verification.

## Explicit non-goals

- No Engram TUI or full-screen terminal control center.
- No installed-AI detection, client selection, hooks, plugins, or MCP configuration writes.
- No OpenCode, Antigravity, Cursor, Claude Code, Codex, or Gemini adapter catalogue in this product.
- No Windows release or installer at this stage. Official release binaries currently target macOS and Linux.
- No embeddings or cloud-only search. FTS5 and SQLite remain the primary local path.
- No automatic creation or selection of projects during initialization.

## Operational model

`forge614-engram init` remains a small terminal-only memory initialization flow for compatibility. It asks only about PostgreSQL synchronization and search reinforcement; it does not configure AI clients. `forge614-engram init --json` is the automation contract.

Forge614 Shell is the Forge614-owned visual setup and lifecycle experience. After integrations have been configured through the appropriate public contracts, a person may continue daily work directly in ADE Orca, Claude Code, Codex, or another native environment. Shell does not need to remain open.

## Roadmap dependencies

1. Forge614 Engines publishes the public installed-engine detection and confirmed-application contract.
2. Forge614 Shell consumes that contract for human-guided setup, previews, confirmations, repair, and removal.
3. Forge614 Atlas consumes Engines and Engram's public SDK, uses `getByTopic()` to resume repository contextualization, and writes validated structured knowledge to Engram.
4. Forge614 AI, when released, will coordinate compatible products through the future global `forge614 init` command. Engram must not claim that command before then.

Historic plans and handoffs remain in this repository as engineering records. They do not describe the current public product surface.
