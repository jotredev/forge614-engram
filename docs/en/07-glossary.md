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

An optional synchronized copy of the local Engram state, in a PostgreSQL project (for example, on Neon). There are two independent paths: formats 1–3, a versioned snapshot configured with `init --json --postgres-url <URL>` and synchronized with `sync --upgrade-format` (deprecated since 1.8.0, does not replicate `ecosystem`), and the `cloud on` cloud (since 1.8.0), which does replicate all three scopes. Neither replaces SQLite or FTS5, which remain local.

## Cloud (`cloud`)

The new 1.8.0 synchronization that keeps the same memory on two Macs: turned on with `cloud on`, it runs on its own in the background inside the MCP server, and turns off with `cloud off` without deleting anything local. Without turning it on, Engram behaves exactly as it always has.

## Neon

The hosted PostgreSQL service Engram uses for syncing between Macs (`cloud on`). The connection string is created by the owner of the Neon project, never by Engram.

## Connection string

The full URL Engram uses to connect to Neon (`postgresql://<user>:<password>@<host>/<database>?sslmode=require&channel_binding=require`). It is a key: it is never stored in a memory or in a file inside the repository, only in `~/.forge614/engram/.env`; `cloud on` asks for it in the terminal without echoing it.

## Installation id

A UUID per Mac (`FORGE614_ENGRAM_INSTALLATION_ID`), generated the first time `cloud on` runs on that Mac. It identifies where each change uploaded to Neon came from; it does not change if you run `cloud on` again.

## Pending queue

The local list (`cloud_outbox`) of changes not yet uploaded to Neon. Every save enters it in the same transaction as the save itself, so nothing is lost if the Mac closes before uploading; `cloud status` shows how many there are and how long the oldest one has been waiting.

## Change

A numbered row of `forge614_sync.changes` on Neon: an insert, update, or delete of a row of a table that travels, with the id of the installation that produced it. Each Mac remembers the highest number it already applied and asks only for later ones.

## First download

What happens on each Mac the first time it runs `cloud on` (or when it points to a different base): it uploads all of its local memory that travels and downloads from change 0 what the other Mac had already uploaded. If this Mac already had its own memory, both end up with the sum of both.

## Reinforcement

An optional local ordering signal based on repeated observations. It can improve search ordering; it does not establish whether a memory is true.

## Session

A project-scoped record of work in progress. Sessions support structured summaries, timelines, and context retrieval after `sessions-enable` has been run.

## MCP server

The local Model Context Protocol server started with `forge614-engram mcp`. It uses standard input/output and exposes memory tools. A model can choose not to save; Engram does not capture transcripts automatically.

## Forge614 Engines and Shell

Engines owns installed-AI discovery and adapters. Shell owns Forge614's visual setup and lifecycle experience. Engram owns neither a TUI nor client configuration.

## `forge614-engram update`

Downloads the latest stable official installer and runs it with `--force`: it verifies the release checksum and replaces Engram's binary. Like a first install, it needs Node.js 22.19+ and `tar` (if either is missing it changes nothing and keeps the previous binary) and installs Forge614 Shell (and Engines) if they are missing. It does not change the database, configuration, or memories.

Without options, it is the people-facing mode and shows installer progress. With `--json`, it is a non-interactive tool interface: it emits only `updated`, `previousVersion`, and `installedVersion` as compact JSON, or the safe `UPDATE_FAILED` error on stderr. This interface is available from stable release `v1.4.0`.
