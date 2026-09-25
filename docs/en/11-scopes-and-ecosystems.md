# 11. Scopes and Ecosystems

> **Status:** available since version 1.6.0.

Picture three shelves: one inside each office (a repository), one in the hallway that the offices of one company share (a group of related repositories), and one at home that follows you everywhere. A **scope** is the shelf where a memory lives; it decides who can see it.

## The three scopes

- **`project`**: a repository's knowledge. Only that project sees it.
- **`ecosystem`**: the knowledge that the repositories of a **group** share (microservices, microfrontends, a monorepo split into several, or the Forge614 ecosystem itself). Every project in the group sees it and no other does. It has the same topics (`topicKey`), versions, history, archive/restore, and reinforcement as the other scopes.
- **`shared`**: what the person wants available in all their projects, whatever the group.

Nobody has to save group-scope memories by hand or know the scope exists: a project declares which group it belongs to inside its own repository and Engram detects it. Saving to `ecosystem` is explicit: `--scope ecosystem --group <name|id>` in the CLI, or `scope: "ecosystem"` with a truthful `groupIntent` in the MCP tools (see [09. Public Memory Protocol](09-public-memory-protocol.md)).

## Precedence when a topic repeats

If the same active `topicKey` exists in several scopes, the combined search (`--scope all` with a project) returns only one: **`project` over `ecosystem` over `shared`**. If the project's one is archived, the group's appears; if that is archived too, the shared one. Precedence applies only to the combined search: `startup-context` and `context` return one block per scope, each with its own byte ceiling.

## Groups

A **group** is a named set of related projects. Its rules:

- The name uses lowercase letters, digits, and single hyphens (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), 1 to 64 characters.
- A project belongs to **at most one group**; a monorepo is a single project.
- A group's identity is its **`id`** (a UUID); the name is for people. That is why two groups may share a name (for example, a clone on another machine brings its group by `id` even if another one with the same name exists). `group-create` refuses a name that already exists (`GROUP_EXISTS`), and a by-name reference that matches several groups returns `GROUP_AMBIGUOUS`: use the `id` shown by `group-list`.
- They are managed with `group-create`, `group-list`, `group-bind`, `group-unbind`, and `group-rename` (see [03. CLI Reference](03-cli-reference.md)) or with `MemoryWorkspace` in the SDK. Changing or removing a project's group is recorded as a local event.

## Portable project identity

Up to 1.5.x a project was bound to the **path** of its folder: moving or renaming the folder, or cloning the repository on another machine, broke the binding and the memory seemed to vanish. Since 1.6.0 the repository carries its identity in `.forge614/project.json`, at the root of the checkout, versioned in Git:

```json
{
  "schemaVersion": 1,
  "project": { "id": "<uuid>", "name": "frontend" },
  "ecosystem": { "id": "<uuid>", "name": "mi-tienda" }
}
```

`ecosystem` is `null` for a loose project. The `id` values are the truth; the `name` values are for people.

- **It resolves by `id`, not by path.** Every operation with `--directory` reads that file first; the path remains a hint. If the `id` does not exist in the local database (a clone on another machine), Engram registers the project —and its group— with that `id`, without asking.
- **Moving, renaming the folder, or cloning needs no action.** `project-rename` and `group-rename` update the `name` in the file; the `id` values never change.
- **Engram is the sole owner of the file and writes it silently.** It never asks permission or announces writing it: it is product configuration. The write is idempotent: if the file already exists, Engram reads it, **never replaces it or changes its `id` values**, and at most completes a missing field; repeating `init --directory` or `project-bind` does not change a single byte. Inside `.forge614/` Engram writes only `project.json` and never touches other files (each Forge614 node owns its own).
- **When the database and the file disagree, the file wins.** If the database had that folder bound to another project, Engram re-binds it to the file's project, records the `PROJECT_REBOUND_FROM_FILE` event, and does not modify the file. Projects that were already bound only by path receive their `project.json` on the next `startup-context` or `session-start` in that folder, with a `PROJECT_FILE_CREATED` notice in the `startup-context` result (inside `project.notices`) and in the `session-start` result (a `notices` key).
- **An invalid file is never overwritten.** Corrupt JSON, an unknown `schemaVersion`, unknown fields, an `id` that is not a UUID, a symbolic link, a directory, or a file larger than 64 KiB produce `PROJECT_FILE_INVALID` on stderr and nothing changes. Validation is strict (a Zod `.strict()` schema) and is loaded only when the repository carries that file: a session start in a folder without a `project.json` does not pay for it. For hosts it is a **visible error**, not an empty context: `startup-context` returns no block at all (not even `shared`); it is repaired by fixing the file or deleting it.

## How a project joins a group

Without asking, in this order of priority:

1. **`forge614.node.json`** with the `ecosystem` field (the group name). Forge614 nodes ship with `"ecosystem": "forge614"`. Engram only **reads** that file (it belongs to another component) and ignores any unusable value. Since the file carries only the name, the group's `id` is derived from it, so every machine recognizes the same group without coordination; the `forge614` group has the fixed `id` `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4`.
2. **The `ecosystem` section of `.forge614/project.json`** (which Engram writes when binding and which travels through Git).

If neither exists, non-interactive commands (`init --json --directory`, `project-bind`, `startup-context`) leave the project **without a group** and write `ecosystem: null` (the result carries no `group`); they do not ask. The single question ("which group does it belong to?") belongs to Shell's visual flow, not to Engram. **Nothing is inferred**: not from folder names, not from disk proximity, not from Git remotes, not from similar names. If both sources declare a different group, `forge614.node.json` wins. Removing the `ecosystem` section from a file that established the membership removes it from the database too; a membership made with `group-bind` is not undone because a file has not caught up yet.

## Moving a memory between scopes

No memory changes scope automatically. To bring an existing one into a group use `memory-move --id <id> --to-scope ecosystem --group <name|id>`, which keeps its `id`, history, and versions, appends a new version with the new scope, and records the `MEMORY_MOVED` event. It never copies or deletes silently: a topic already taken in the group (`TOPIC_CONFLICT`), a repeated request key (`REQUEST_CONFLICT`), or a session summary (`SUMMARY_TOPIC_RESERVED`) stops the operation and changes nothing.

## Upgrading from 1.5.x

The new scopes need an extension of the database schema. It is **additive**: only tables and a nullable column are added, and `memories` and `requests` are recreated keeping name, columns, types, and every row to widen the scope restriction to three values.

- **Levels.** Schema levels 8, 9, and 10 are levels 5, 6, and 7 (bindings, sessions, reinforcement) plus the ecosystem. Enabling groups never turns on sessions or reinforcement by itself.
- **When.** A normal open never migrates. The database is upgraded the first time a command needs groups (`group-create`, reading a `project.json` or `forge614.node.json` that declares a group, or re-binding a folder because the file wins); commands that only query, or move something into a group that does not exist, answer `GROUP_NOT_FOUND` without migrating. Someone who never uses groups keeps their database as it is.
- **Automatic backup.** Before migrating, Engram copies the database to `engram.db.v<version>-pre-ecosystem-<UTC date>-<id>.bak` next to it (`0600` permissions, a consistent copy made with `VACUUM INTO`). It is skipped when the database holds no projects or memories yet. Engram never deletes those backups.
- **Notice.** The result of the command that triggers the upgrade (`startup-context`, `group-create`, `session-start`, `init --directory`, `project-bind`, or an MCP call) includes a `DATABASE_MIGRATED` notice with the backup path in `backup`. Later calls do not notify again. If that call returns a list (for example `memory_history`), the notice arrives in the first result that can carry it.
- **Verification.** The migration runs in a single transaction and compares, before and after, the row count and a SHA-256 checksum of the content of `memories` and `requests`, plus foreign keys and the text index. If anything differs it rolls everything back and answers `MIGRATION_VERIFY_FAILED`; the backup is kept. Applying it twice changes nothing. In the test with 50,000 memories it took about 0.65 s, including backup and verification (measured on macOS).
- **Backward compatibility.** A database created by 1.5.3 opens and reads completely with 1.6.0 without loss (real fixtures in the tests). In the opposite direction, Engram 1.5.3 does not open an already upgraded database: it answers `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") and **does not modify it** (verified: integrity correct, same rows). The pre-migration backup does open with 1.5.3. A 1.5.x process that was already running (for example an MCP server) must be restarted after upgrading.

## The ecosystem board (since 1.7.0)

With schema 11, a group's `ecosystem` scope works as a shared board. It is for the rules and contracts that hold for several projects of the group (an architecture decision, a common procedure, a warning), never for statuses or work progress, which stay in each project. Below schema 11 none of this applies: an `ecosystem` memory is saved and moved as in 1.6.0.

Every `ecosystem` save (CLI `save`, SDK `save` and `saveWithSession`, MCP `memory_save`) and every `memory-move` into a group follow these rules, checked in this order:

1. **Type:** only `decision`, `procedure`, or `warning` (`ECOSYSTEM_TYPE_NOT_ALLOWED`).
2. **`affects`:** the effective ones, the ones sent or, if none, the ones already stored, must be at least 2 names (`ECOSYSTEM_AFFECTS_REQUIRED`) and each the exact name of a project that is a member of the group (`ECOSYSTEM_AFFECTS_UNKNOWN`, whose message names the unknown ones and the valid ones). In the CLI they are sent with `save --affects <project-a,project-b,...>`.
3. **Limit:** the board admits 40 active memories. It is only checked when a new memory is added (`ECOSYSTEM_BOARD_FULL`, whose message carries the count and the titles so you can consolidate or demote one). The status note and session summaries do not count; memories without a topic do.

Group session summaries (`memory_session_summary` with `scope: "ecosystem"`) do not follow these rules.

**Status note and source project.** The reserved topic `ecosystem/estado-actual` holds a short note with the group's status. Only the group's **source project** writes it; it is set with `group-source-set --group <name|id> --project-id <UUID>` (SDK: `setGroupSource`) and must still be a member; any other author gets `ECOSYSTEM_STATUS_FORBIDDEN`. Through MCP, `memory_save` always sends the folder's project as the author; the CLI sends no author, so through the CLI the status note always answers that error. The note admits the types `decision`, `procedure`, `warning`, and `fact`, has a maximum of 600 characters of content (`ECOSYSTEM_STATUS_TOO_LONG`), is always pinned, does not ask for `affects`, and does not count toward the limit. Repeating the same request (`requestKey`) returns the same memory, and a memory with that topic cannot be moved into a group (`ECOSYSTEM_STATUS_FORBIDDEN`).

**Demoting a memory.** `memory-demote --id <memory> --project-id <UUID>` (SDK: `demoteMemory(projectId, id)`) returns to the project a memory from the board of that project's group, keeping its id, all its versions, and its metadata (short version, `affects`, validity). It appends a version that records the scope change and a `MEMORY_DEMOTED` event. If the project already has a memory with that topic it answers `TOPIC_CONFLICT`. The commands are detailed in [chapter 3](03-cli-reference.md).

## Current limits

- **PostgreSQL replica.** **`ecosystem` memories are not replicated yet.** Synchronization does not describe the group scope yet: if `ecosystem` memories exist, `sync` stops with `SYNC_ECOSYSTEM_UNSUPPORTED` without touching local or remote data; without group memories it works as before. Group replication will arrive in its own plan (1.8.0, "format 4").
- **`forge614.node.json` is read-only** for Engram and only its `ecosystem` field is used.
- **A group is local to this machine's database** plus each repository's `.forge614/project.json` files; there is no central group service.
- Asking which group a project without a declaration belongs to is not done by Engram (Shell does it in its visual flow).
