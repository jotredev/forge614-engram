# 03 (EN). CLI Reference

All data commands write JSON to stdout. Errors write `{code,error}` JSON to stderr and exit with code `1`. `help` and `--version` create no storage.

The commands introduced in 1.6.0 (`group-*` and `memory-move`) and the new error codes follow the ecosystem machine-contract convention: the output carries `schemaVersion` at the root and an error is `{schemaVersion,code,error}` with a `code` in `UPPER_SNAKE_CASE`. Every earlier command and code keeps exactly its previous shape.

## Lifecycle

```text
init [--json] [--postgres-url <URL>] [--directory <path>]
                                        initialize local memory; URL and --directory require --json
update [--json]                         install latest stable release; --json returns a structured result
uninstall --confirm <exact phrase>      remove Engram only, or Engram and Atlas
mcp                                     start local stdio MCP server
sync [--upgrade-format]                 synchronize configured PostgreSQL replica
sync-watch [--interval <1..3600>]       retry synchronization while the process remains open
sessions-enable                         explicitly enable session lifecycle
reinforcement-enable                    explicitly enable local repeated-memory ordering
intelligence-enable                     explicitly enable memory intelligence (schema 11); backs up before migrating
memory-protocol --json [--protocol-version 1|2|3]
                                        print the public memory contract; version 1 is the default
startup-context --directory <path> --json
                                        preload context for a host before a session and keep the repository identity in step
```

`setup` is retired and returns `COMMAND_RETIRED`. There is no `tui`, `assistant-list`, `integration-enable`, or `memory-hook` command.

`init --json --directory <path>` is the explicit, non-interactive binding of a folder: it registers the project (by the `id` in its `.forge614/project.json` when the repository already carries one), writes that file silently, and adds `project` to the result (`{ "projectId", "directory", "source" }`, plus `group` when it belongs to a group). Repeating it changes nothing: the file keeps the same bytes. `--directory` cannot be combined with `--postgres-url`.

## Memory protocol contract

```text
forge614-engram memory-protocol --json
```

This non-interactive command publishes the versioned JSON contract that Forge614 Engines can use to prepare a safe installation in compatible AI clients. It requires `--json`; without it, or with unknown flags, it writes the standard `{code,error}` JSON error to stderr and exits with code `1`.

It does not require a TTY, create or open `~/.forge614/engram/`, initialize SQLite, or query projects, PostgreSQL, or user data. The contract is available from release `v1.3.0`; that does not mean Engram configures AI clients directly. Version 3 (since 1.6.0) announces the `ecosystem` scope; versions 1 and 2 do not change. See [09. Public Memory Protocol](09-public-memory-protocol.md) for lifecycle, security, and boundaries.

## Updating for people and tools

```bash
forge614-engram update
forge614-engram update --json
```

Without options, `update` keeps the terminal experience and shows official-installer progress. With `--json`, it does not mix progress with output and writes only `{"updated":true,"previousVersion":"<previous version>","installedVersion":"<installed version>"}` to stdout. `previousVersion` is the version before the update; `installedVersion` is read from the installed executable at the end. If they match, `updated` is `false`.

An `update --json` failure writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr and exits with code `1`. It does not include raw diagnostics, URLs, credentials, or secrets. This interface is available from stable release `v1.4.0`.

## Projects

```text
project-create --name <name>
project-list
project-rename --project-id <UUID> --name <name>
project-bind --directory <path> --project-id <UUID>
```

`project-rename` also updates the name inside the `.forge614/project.json` of every folder bound to that project on this machine; the `id` never changes. `project-bind` writes the file when it does not exist and returns `PROJECT_FILE_CONFLICT` if the folder already declares another project identity.

## Groups and ecosystem

Available since version 1.6.0. A **group** gathers related repositories that share memory (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)).

```text
group-create --name <name>
group-list
group-bind --project-id <UUID> --group <name|id>
group-unbind --project-id <UUID>
group-rename --group <name|id> --name <name>
memory-move --id <memory-id> --to-scope ecosystem --group <name|id> [--project-id <UUID> | --scope shared]
group-source-set --group <name|id> --project-id <UUID>
memory-demote --id <memory-id> --project-id <UUID>
```

`<name>` uses lowercase letters, digits, and single hyphens (`mi-tienda`), 1 to 64 characters. `--group` accepts the identifier (UUID) or a name that identifies exactly one group; if several share the name it returns `GROUP_AMBIGUOUS` and you pass the identifier shown by `group-list`. A project belongs to at most one group.

```text
// group-create --name mi-tienda
{ "schemaVersion": 1, "group": { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>" } }
// group-list
{ "schemaVersion": 1, "groups": [ { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>", "projects": [ { "projectId": "<uuid>", "name": "repo" } ] } ] }
// group-bind
{ "schemaVersion": 1, "projectId": "<uuid>", "group": { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>" }, "changed": true, "identityFilesUpdated": 1 }
// group-unbind
{ "schemaVersion": 1, "projectId": "<uuid>", "unbound": true, "identityFilesUpdated": 1 }
// group-rename
{ "schemaVersion": 1, "group": { "id": "<uuid>", "name": "tienda-2", "createdAt": "<ISO-8601>" }, "identityFilesUpdated": 1 }
```

The first time creating a group upgrades the database, `group-create` adds `"notices": [ { "code": "DATABASE_MIGRATED", "message": "…", "backup": "<backup path>" } ]` (no `backup` when the database was empty); afterwards it does not appear. `changed` is `false` when the project was already in that group. `identityFilesUpdated` counts the `.forge614/project.json` files on this machine that were updated (the group or its name). Changing or removing the group is recorded as a local event.

`memory-move` moves an existing memory into a group **keeping its id, history, and versions**: it appends a new version that records the scope change and a `MEMORY_MOVED` event. It never copies or deletes silently: if the group already has a memory with the same topic it answers `TOPIC_CONFLICT` and changes nothing; a session summary cannot be moved (`SUMMARY_TOPIC_RESERVED`). The source is a project (`--project-id`, the default) or shared (`--scope shared`).

With schema 11 (memory intelligence, since 1.7.0), `group-source-set` stores or replaces the group's **source project**, the only one that can write the `ecosystem/estado-actual` status note, and records the `GROUP_SOURCE_SET` event; it prints `{ "schemaVersion": 1, "source": { "groupId", "projectId", "setAt" } }` and answers `GROUP_NOT_FOUND`, `PROJECT_NOT_FOUND`, or `GROUP_REQUIRED` (the project is not a member of the group). The CLI does not send which project is writing, so a `save --scope ecosystem` with that topic always answers `ECOSYSTEM_STATUS_FORBIDDEN`: the status note is written through MCP (`memory_save`) or the SDK. `memory-demote` is the inverse of `memory-move`: it returns to the project a memory from the board of that project's group **keeping its id, all its versions, and its metadata**, appends a version that records the scope change and a `MEMORY_DEMOTED` event, and prints `{ "schemaVersion": 1, "memory", "from": { "scope": "ecosystem", "groupId" }, "to": { "scope": "project", "projectId" } }`. Its errors, in this order: `GROUP_REQUIRED` (the project is not in a group), `NOT_FOUND` (the memory is not on that board), `TOPIC_CONFLICT` (the project already has that topic), and `REQUEST_CONFLICT`. Both commands answer `INTELLIGENCE_REQUIRED` without schema 11. With schema 11, `memory-move` into a group and every `save --scope ecosystem` also follow the board rules (chapter 11), and the six `ECOSYSTEM_*` codes carry `schemaVersion` on any command.

```text
// memory-move
{ "schemaVersion": 1, "memory": { "id": "<uuid>", "projectId": null, "scope": "ecosystem", "groupId": "<uuid>", "version": 2, "state": "active", "…": "…" },
  "from": { "scope": "project", "projectId": "<uuid>" }, "to": { "scope": "ecosystem", "groupId": "<uuid>" } }
```

The first time a command creates or uses a group in a database created by 1.5.x, Engram upgrades the database after an automatic backup (see chapter 11).

```text
save --project-id <UUID> --title <text> --content <text> [--type fact|decision|procedure|warning|preference]
     [--topic <key>] [--expected-version <n>] [--request-key <key>] [--pinned true|false]
     [--session-id <id>] [--session-project-id <UUID>]
     [--affects <project-a,project-b,...>]
search --project-id <UUID> --query <text> [--scope all|project|shared|ecosystem] [--limit <1..100>] [--preview]
search --scope shared --query <text>
search --scope ecosystem --group <name|id> --query <text>
get --project-id <UUID> --id <memory-id> [--version <n>]
history --project-id <UUID> --id <memory-id>
archive|restore --project-id <UUID> --id <memory-id>
save|get|history|archive|restore --scope ecosystem --group <name|id> …
```

Use `--scope shared` rather than `--project-id` for a shared memory. Updating an existing topic requires `--expected-version`.

`--affects` lists, comma-separated, the names of the projects a memory affects; the ecosystem board requires at least two (chapter 11). Without schema 11 it answers `INTELLIGENCE_REQUIRED`.

Use `--scope ecosystem --group <name|id>` (without `--project-id`) for a group's memory; it has the same topics, versions, archive/restore, and reinforcement as the other scopes, and its JSON adds `groupId`. In `search`, `--scope ecosystem` accepts `--group` or the `--project-id` of a project that belongs to a group (otherwise `GROUP_REQUIRED`). `--group` is accepted only with `--scope ecosystem`. With `--project-id` and `--scope all`, the search automatically includes the project's group; when a topic repeats, the project's wins, then the group's, and finally the shared one.

## Sessions and context

```text
session-start --directory <path> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json> --request-key <key> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <memory-id> --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
context --scope ecosystem --group <name|id> [--compact] [--max-bytes <1024..65536>]
```

`context --project-id` for a project that belongs to a group adds an `ecosystem` key to the result (`{ "status": "member", "group": { "id", "name" }, "context": <ContextResult> }`) with its own byte ceiling; for any other project the result is unchanged.

With schema 11, `session-start` adds `previous` (`{ sessionId, interruptedAt, summary }`) when the call creates the session and the project has an interrupted previous session; a repeated start with the same `session-id` never adds it.

Run `forge614-engram help` for the executable's exact current syntax.

## Startup context for a host

```bash
forge614-engram startup-context --directory /absolute/path/to/repository --json
```

This is the only public interface through which Forge614 Engines or Shell may read memory before starting an agent; they must never read SQLite directly. It is a non-interactive, idempotent query. It returns one JSON object with `format: 1`, normal `shared` context, `ecosystem` (`{ "status": "member", "group", "context" }` when the project belongs to a group, or `{ "status": "none" }`), and `project` (with `source`: `file`, `path`, or `unbound`): a valid, bound project preserves its previous behavior with `status: "bound"`, `projectId`, and project context; when it cannot be resolved or linked as a project, it does not fail and returns `project: { "status": "unbound" }` with the remaining project values set to null per schema (`projectId: null, context: null`). Any existing readable directory is valid: `$HOME`, `/`, an unversioned folder without Git, an unlinked Git repository, and a linked folder; unbound cases return `unbound`.

Each section uses `context()`'s own ceiling (16,384 bytes by default) and includes bounded previews. It creates no memories, sessions, or databases, and no project for an unlinked folder; it only upgrades the database (with a backup first) the first time a repository declares a group, and reports it as `DATABASE_MIGRATED` in `project.notices`. It does keep the repository identity in step: it registers by `id` a clone that carries its `.forge614/project.json`, and writes that file for a project bound only by path (the result says so in `project.notices`). For that reason it opens the database read-only and reopens it for writing only when it has to register something (see [10. Startup Context for Hosts](10-startup-context.md)). Only a nonexistent path, non-directory path, or unreadable path fails; failures leave stdout empty, emit `{code,error}` JSON on stderr, and exit with code 1, without secrets or raw paths. A workspace without prior `init` or any other real error retains the same error handling. Available since version 1.5.0.
