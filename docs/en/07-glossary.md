# 07 (EN). Glossary

## Engram product home

The private directory `~/.forge614/engram/`. It contains Engram's configuration, local database, and installed binary. Engram never deletes the shared `~/.forge614/` parent directory.

## Project ID (`projectId`)

A UUID that identifies one project's memories. It is not a project name or a path. A project may be bound to a canonical Git directory with `project-bind`.

## Shared memory

A memory whose `scope` is `shared` and whose owner is `null`. It is available across projects; an active project topic can override the same shared topic in combined search.

## Scope (`scope`)

The "shelf" where a memory lives: `project` (one repository), `ecosystem` (a group of related repositories), or `shared` (the person, across all their projects). With a repeated `topicKey`, the combined search prefers `project`, then `ecosystem`, and finally `shared`.

## Group and ecosystem

A **group** is a named set of related projects (microservices, microfrontends, a split monorepo, the Forge614 ecosystem) that share the `ecosystem` scope. A project belongs to at most one group. Its identity is its `id` (UUID); the name (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) is for people. It is managed with `group-create`, `group-list`, `group-bind`, `group-unbind`, and `group-rename`.

## Portable project identity

The `.forge614/project.json` file at the root of a repository, versioned in Git and owned exclusively by Engram: it stores the project's `id` and name and, if it belongs to one, its group's `id` and name. It lets moving, renaming, or cloning the repository keep its memory: the identity travels with the repository, not with the path.

## Topic key (`topicKey`)

A stable name for a memory topic, such as `architecture/database`. Saving an existing topic requires its expected version. `MemoryStore.getByTopic(projectId, topicKey)` retrieves it exactly for SDK consumers.

## SQLite and FTS5

SQLite is the durable local database. FTS5 is its lexical full-text search index. They always remain local, including when PostgreSQL synchronization is enabled.

## PostgreSQL replica

An optional synchronized copy of the local Engram state. It does not replace SQLite or FTS5. Configure it with `init --json --postgres-url <URL>` and synchronize explicitly. It does not replicate `ecosystem` memories yet (coming in 1.7.0, "format 4").

## Reinforcement

An optional local ordering signal based on repeated observations. It can improve search ordering; it does not establish whether a memory is true.

## Session

A project-scoped record of work in progress. Sessions support structured summaries, timelines, and context retrieval after `sessions-enable` has been run.

## MCP server

The local Model Context Protocol server started with `forge614-engram mcp`. It uses standard input/output and exposes memory tools. A model can choose not to save; Engram does not capture transcripts automatically.

## Forge614 Engines and Shell

Engines owns installed-AI discovery and adapters. Shell owns Forge614's visual setup and lifecycle experience. Engram owns neither a TUI nor client configuration.

## `forge614-engram update`

Downloads the latest stable official installer, verifies the release checksum, and replaces only Engram's installed binary. It does not change the database, configuration, or memories.

Without options, it is the people-facing mode and shows installer progress. With `--json`, it is a non-interactive tool interface: it emits only `updated`, `previousVersion`, and `installedVersion` as compact JSON, or the safe `UPDATE_FAILED` error on stderr. This interface is available from stable release `v1.4.0`.
