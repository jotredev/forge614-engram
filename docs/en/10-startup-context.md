# 10. Startup Context for Hosts

> **Status:** available since version 1.5.0. The `ecosystem` block, `project.source`, and repository-identity maintenance are available since version 1.6.0.

Think of a host handing an agent a welcome folder before the conversation opens. Rather than waiting for the model to remember to request it, `startup-context` supplies that initial context safely and within a limit.

## Command and purpose

```bash
forge614-engram startup-context --directory /absolute/path/to/repository --json
```

This is the **only public interface** through which Forge614 Engines or Forge614 Shell may read Engram memory before an agent session begins. They must never open or read SQLite directly. It is a non-interactive, idempotent query; it does not require a TTY and suits automation, CI, and hosts.

## Output contract

On success it writes one JSON object to stdout, with keys in this order:

```json
{
  "format": 1,
  "shared": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
  "ecosystem": {
    "status": "member",
    "group": { "id": "<uuid>", "name": "mi-tienda" },
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false }
  },
  "project": {
    "status": "bound",
    "projectId": "<uuid>",
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
    "source": "file"
  }
}
```

`shared`, `ecosystem.context`, and `project.context` use the same `ContextResult` shape as the `context` command and include bounded previews, not titles alone. Each block uses its own byte ceiling.

- **`ecosystem`** is `{ "status": "member", "group": { "id", "name" }, "context": … }` when the project belongs to a group (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)) and `{ "status": "none" }` otherwise: a loose project, an unlinked folder, or a database created by an earlier version.
- **`project.source`** says how the project was identified: `"file"` (by the `id` in its `.forge614/project.json`), `"path"` (by the folder binding recorded in the database), or `"unbound"` (no project).
- **`project.notices`** appears only when there is something to report, as a list of `{ "code", "message" }`: `PROJECT_FILE_CREATED` (a project that was already bound by path received its file), `PROJECT_REBOUND_FROM_FILE` (the folder was re-bound to the project its file declares), `PROJECT_FILE_NOT_WRITTEN` (the file could not be written; the operation continues), or `DATABASE_MIGRATED` (this command upgraded the database for the first time because the repository declares a group; `backup` says where the previous backup went, if there was data, and later calls do not notify again).

When it cannot be resolved or linked as a project, it does not fail: it returns `"project": { "status": "unbound", "projectId": null, "context": null, "source": "unbound" }` and `"ecosystem": { "status": "none" }`. Any existing readable directory is valid: `$HOME`, `/`, an unversioned folder without Git, an unlinked Git repository, and a linked folder.

## Why `format` stays at 1

`ecosystem`, `project.source`, and `project.notices` are **additive fields**: no existing field changed its name, type, or meaning, so a consumer that ignores unknown fields keeps working unchanged. Raising `format` would have forced every host, including those that never use groups, to recognize a new shape. A consumer must **ignore unknown fields** and treat an `ecosystem` block it does not understand as absent; Engines and Shell must accept it as optional and sanitized. If the shape of an existing field ever changed, `format` would be raised.

## What it keeps in step and what it never does

The command opens the database **read-only** first and reopens it for writing only when it has to register something, because it keeps the repository identity and the local database in step:

- If the repository carries `.forge614/project.json` and its `id` does not exist in the local database (for example, a clone on another machine), it registers the project —and its group— with that `id`, without asking.
- If the database had that folder bound to another project, **the file wins**: it re-binds, records the `PROJECT_REBOUND_FROM_FILE` event, and does not touch the file.
- If a project was already bound only by path, it writes its `.forge614/project.json` (silently; the result reports it in `project.notices`).
- If `forge614.node.json` declares `ecosystem`, or the file carries its `ecosystem` section, it binds the group without asking. Nothing is inferred from folder names, disk proximity, or Git remotes.

It never creates memories, sessions, or databases, and never creates a project for a folder that has neither a binding nor a file: that folder is `unbound` and nothing is written in it. A project memory using the same `topicKey` supersedes the shared one only inside `project.context`; the top-level `shared` section is unchanged. The `shared`, `ecosystem`, and `project` blocks are not deduplicated against each other.

Each block uses `context()`'s own ceiling —16,384 bytes by default— so the combined payload remains bounded (three times that ceiling at most).

## Safe errors

`--directory` and `--json` are required. A nonexistent path, a path that is not a directory, an unreadable path, an uninitialized workspace, or any other real failure fails, and so does an invalid `.forge614/project.json` (`PROJECT_FILE_INVALID`: corrupt JSON, an unknown schema version, or unknown fields), which Engram never overwrites. The failure leaves stdout empty, writes JSON only to stderr, and exits with exit code 1: `{ "code": "…", "error": "…" }`, or `{ "schemaVersion": 1, "code": "…", "error": "…" }` for the codes introduced in 1.6.0. It does not print secrets, tokens, credentials, or raw paths in an error message.

**For hosts:** an invalid `.forge614/project.json` is a visible error, not an empty context: `startup-context` exits with code 1 and returns no block at all (not even `shared`). It is repaired by fixing the file or deleting it; if it is deleted, Engram regenerates it on the next run when the project is already bound by path, and a folder with no binding stays `unbound`.

## Relationship to the memory protocol

`memory-protocol --json --protocol-version 1` does not change. Version 2 adds `startupContext` to announce this command to Engines and Shell without changing the instructions or lifecycle. Version 3 also announces the `ecosystem` scope and describes this command including the group block. Announcing it does not prove that any host already consumes it.
