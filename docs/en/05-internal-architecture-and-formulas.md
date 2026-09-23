# 05 (EN). Architecture and Search

Forge614 Engram uses a feature-oriented modular monolith:

```text
src/modules/         pure domain types and rules
src/app/             use-case coordination
src/infrastructure/  SQLite, PostgreSQL, filesystem, Git, and release adapters
src/interfaces/      CLI, terminal prompts, and MCP stdio server
src/shared/          errors and shared utilities
```

Dependency rules are enforced by architecture tests. Interfaces call application public entries; they do not open SQLite or import infrastructure directly. Sibling products use Engram's public SDK or CLI, never private source folders.

SQLite is the durable source of truth. FTS5 performs literal lexical full-text search. Reinforcement changes result ordering using repeated observations and recency; it does not use embeddings and does not assert factual truth.

PostgreSQL synchronization transfers a versioned snapshot of local state. It is optional, explicit, and cannot replace the local SQLite/FTS5 read/write path. Format promotion requires `sync --upgrade-format` after every participating device is compatible. `ecosystem` memories are not replicated yet: until format 4 (its own plan, 1.7.0), `sync` stops with `SYNC_ECOSYSTEM_UNSUPPORTED` if they exist.

The product currently ships verified macOS and Linux standalone binaries. There is no Windows native addon, installer, or release artifact in the current product.
