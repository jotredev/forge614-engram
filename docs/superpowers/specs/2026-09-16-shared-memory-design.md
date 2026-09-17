# Single workspace and shared memory — approved correction

Supersedes the per-project connection design. User approved a single .env and
single database, projectId naming, and project/shared memory scopes. No real
memories have been stored by the user. Do not migrate or delete existing files.

## Storage

One ~/.forge614/.env and one ~/.forge614/engram.db for local mode. SQLite may
create -wal/-shm auxiliary files. No projects/ configuration folders, database
overrides on project commands, multiple active connections or per-project bases.
PostgreSQL will replace the workspace backend in a later step; never a fallback
SQLite copy. This delivery supports SQLite only. Keep low-level MemoryStore path
injection for programmatic use/tests, not as a per-project setting.

Private workspace config: FORMAT_VERSION="2", STORAGE="sqlite". SQLite path is
derived from the workspace root, not user-editable per project. A legacy projects/
directory is rejected, not imported/removed. Unsupported configs, missing database
after configuration, and old schema versions fail without automatic replacement.
Keep owned-private directories, 600 dotenv, strict parser, no expansion, no
symlinks, atomic no-replace publication and sanitized errors. Tests use temp roots.
Workspace database and sidecars must be owned regular files, without symbolic or
hard links. Fresh database files are exclusively created 0600. These checks rely
on the private root, not on defense against concurrent malicious same-user access.

## Identity and memory

Project.projectId is a UUIDv4; display name can repeat or change. Memory fields:
scope='project' with registered nonnull projectId, or scope='shared' with null
projectId. Project scope is default; shared writes must explicitly specify scope.
Database CHECK/FK constraints enforce the pairing. Never a fake shared project.
Topic uniqueness and request replay are independently scoped to a project or to
shared memory. Revisions retain scope/ownership; no automatic promotion to shared.

Search(projectId, query, limit, scope) supports all/project/shared. A project
search defaults to all: its own active matching memories plus shared matching
memories, never another project's. Search without a project requires explicit
shared scope. Apply scope before limits for FTS and short-token literal paths.
For combined search, an active project memory with an exact matching nonnull
topicKey shadows that shared topic, even if its text does not match the query.
Archiving the override makes the shared topic eligible again. Explicit shared
search exposes shared records regardless of overrides. Results expose scope and
projectId. No semantic contradiction detection or instruction-authority changes.

Direct get/history/archive/restore require exact owner: UUID for project-owned
records, null for explicit shared access. Retrieving shared in combined search
does not authorize changing it through a project-only command.

## CLI / SDK

CLI: init (idempotent explicit initialization), project-create --name,
project-list, project-rename --project-id --name. project-create may initialize
the workspace once if no config exists. Existing configured missing DB must fail.
project-list before initialization returns [] without creating files; after
initialization lists all registered projects from the one DB.
Memory writes use --project-id UUID (default scope project) or --scope shared
without project-id. Reads of a particular memory use the same exact scope.
Search with --project-id defaults to all and accepts --scope all|project|shared;
without project-id only --scope shared is valid. No --db or --id-project aliases.

SDK: WorkspaceConfig(root?) and MemoryWorkspace(config?). init(), createProject,
listProjects, renameProject, open(readonly?). MemoryStore uses projectId and
scope fields, get/history/archive/restore(string|null,id), search with optional
fourth argument scope. Null is not an implicit shared write: save needs scope.

## Compatibility and verification

New SQLite schema version 3. Versions 1/2 are rejected unchanged with a migration
required error. No old config or database deletion, copying or implicit migration.
Keep 0.2.0 prerelease version because this corrects the uncommitted delivery.
No commit, push, real-user installation, cloud, TUI or MCP in this task.

Tests cover single config/database, no per-project folders, same-name projects,
rename/history, all three search scopes, FTS/literal isolation, topic overrides,
shared replay/version/archive/restore, invalid scope pairs, DB constraints,
legacy refusal, private filesystem safety, concurrent init/writes and compiled CLI.
Finish with full bun test/typecheck/diff checks, independent review, and updated
documentation handoff for the other model. Do not edit bilingual guides directly.
