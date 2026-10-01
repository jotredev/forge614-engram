# 06 (EN). Troubleshooting

## Installation or update

Use a supported macOS/Linux terminal with Bash, `curl`, a SHA-256 utility, `tar`, and Node.js 22.19 or newer. `forge614-engram update` uses the official `latest` installer and preserves the previous binary when verification or installation fails. Retry after restoring connectivity; do not manually replace `engram.db`.

The published installer checks its requirements before downloading anything. If a requirement is missing (first three items) it **installed nothing**. If Shell or Engines fails (last six items) only Engram is guaranteed unchanged (Forge614 Engines or part of Shell may already be installed). In every case you can run the installer again once you fix the cause:

- `…which needs Node.js 22.19 or newer. Nothing was installed…` (Node is missing): install Node.js from https://nodejs.org (or `brew install node`) and run the installer again.
- `…which needs Node.js 22.19 or newer; found <version>…` (Node is too old or unreadable): update Node.js (for example `brew upgrade node`) until `node --version` shows v22.19 or newer, then run the installer again.
- `…which needs tar…` (`tar` is missing): install `tar` with your system's package manager and run the installer again.
- `Could not download the Forge614 Shell installer.`: the Forge614 Shell installer could not be downloaded; check connectivity and retry. Engram was not changed.
- `Forge614 Shell could not be installed; Engram was not changed.`: the Shell installer exited with an error (its messages appear just above); fix what it reports and run the installer again. Engram was not changed.
- `Forge614 Shell installation did not provide its required command.`: the Shell installer finished without leaving `<FORGE614_HOME>/shell/bin/forge614-shell` (by default `~/.forge614/shell/bin/forge614-shell`); retry and, if it repeats, report it in the Forge614 Shell repository.
- `Could not download the Forge614 Engines installer.`: the Forge614 Engines installer could not be downloaded; check connectivity and retry. Engram was not changed.
- `Forge614 Engines could not be installed; Engram was not changed.`: the Engines installer exited with an error (its messages appear just above); fix what it reports and run the installer again. Engram was not changed.
- `Forge614 Engines installation did not provide its required command.`: the Engines installer finished without leaving `<FORGE614_HOME>/engines/bin/forge614-engines` (by default `~/.forge614/engines/bin/forge614-engines`); retry and, if it repeats, report it in the Forge614 Engines repository.

With `update --json` these messages are not shown; run `forge614-engram update` without `--json` to see them.

For automation, use `forge614-engram update --json`. Its success is one compact JSON object on stdout and must not contain progress. On failure it exits with code `1` and writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr. That deliberately safe message does not reveal installer diagnostics, URLs, credentials, or secrets.

## Initialization

`init` requires an interactive terminal. Use `init --json` in automation. `--postgres-url` is valid only with `init --json`; connection failures return structured JSON without exposing the URL and without leaving partial configuration.

## Storage

Do not delete or move `~/.forge614/engram/engram.db` manually. Engram repairs permissions inside its own product directory only. If a configuration exists but its database is missing, it fails safely instead of silently creating a replacement.

## Search and topics

Below schema 11, search is literal FTS5 matching (unchanged). From schema 11 (memory intelligence) it is hybrid: it splits the query across whole words and trigrams, fuses the results by reciprocal rank fusion, and weights them by the reinforcement multiplier; a result needs at least 2 of the query terms, and a query with no usable terms returns nothing (see chapter 5). Provide a `projectId` for project searches, or use `--scope shared`. Updating a topic needs its current `--expected-version`; use `get` or `history` first.

## PostgreSQL

SQLite/FTS5 remains local even after PostgreSQL is configured. Run `sync` explicitly. Before `sync --upgrade-format`, update every participating device to a compatible release.

A PostgreSQL URL is a secret. Engram never returns it in results, CLI errors, or MCP responses. If a domain error were to contain a `postgres://` or `postgresql://` URL, Engram replaces it with `[URL de PostgreSQL oculta]`; it does not expose the user, password, host, port, database name, or parameters. Unexpected errors use a generic message without internal details.

## Groups, project identity, and database upgrade

Since 1.6.0. The `group-*` commands, `memory-move`, and the codes in this section return `{schemaVersion,code,error}` on stderr (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)).

- `GROUP_NAME_INVALID`: the group name must use lowercase letters, digits, and single hyphens (`mi-tienda`), 1 to 64 characters.
- `GROUP_EXISTS`: a group with that name already exists; use `group-list`.
- `GROUP_NOT_FOUND`: the group does not exist in this database (also when the database does not know groups yet). Create it with `group-create`.
- `GROUP_AMBIGUOUS`: several groups have that name; use the `id` shown by `group-list`.
- `GROUP_REQUIRED`: the `ecosystem` scope needs a group: pass `--group` or use a project that belongs to one (`group-bind`). `memory_search` and `memory_context` with scope `ecosystem` no longer give it (since 1.8.6): a bound project without a group has no group memories, so `memory_search` answers `results: []` and `memory_context` the empty group context, both with an `ecosystem: { status: "none", message }` field and a note whose text is always in Spanish: «Este proyecto no pertenece a ningún grupo, así que no hay recuerdos de grupo. Se vincula a uno con forge614-engram group-bind.» (it says the project belongs to no group, so there are no group memories, and that it is bound to one with `forge614-engram group-bind`). `memory_save`, `memory_get`, `memory_history` and `memory_session_summary` with scope `ecosystem`, and the CLI `search --scope ecosystem`, still give it.
- `GROUP_INTENT_REQUIRED`: saving to `ecosystem` through MCP requires a truthful `groupIntent`.
- `TOPIC_CONFLICT`: `memory-move` does not overwrite; the group already has a memory with that topic. Archive it or change the topic.
- `PROJECT_FILE_INVALID`: `.forge614/project.json` is not valid (corrupt JSON, unknown schema or fields, symbolic link, too large). Engram does not modify it: fix it or delete it so it is regenerated.
- `PROJECT_FILE_CONFLICT`: `project-bind` tried to bind a folder whose file declares another project; use that identity or delete the file.
- `MIGRATION_VERIFY_FAILED`: the migration check failed and everything was rolled back. The database did not change and the `.bak` backup next to `engram.db` is kept; do not delete it and report the case.
- `SYNC_ECOSYSTEM_UNSUPPORTED`: `sync` stops while group memories exist: `ecosystem` memories are not replicated yet (coming in 1.8.0, "format 4"). Local and remote data are not touched.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") when Engram 1.5.x opens a database upgraded by 1.6.0: update Engram. The database is not modified; the pre-migration `.bak` backup remains readable by 1.5.x. A 1.5.x process that was already running (for example an MCP server) must be restarted after updating.

## Unbound folders (since 1.8.4)

- `PROJECT_BINDING_REQUIRED`: Engram does not register on its own a new folder that might be an existing project, so as not to split that project's memory in two. It has two messages, and both carry the project's name and `id`, the working folder (never the internal `…/.git` path) and the exact command. They are printed in Spanish, as their neighbors are:
  - "Ya existe un proyecto llamado «{name}» ({id}). Si esta carpeta es ese proyecto, vincúlala con: forge614-engram project-bind --directory {this folder} --project-id {id}. Si es otro, créalo con forge614-engram project-create --name <otro nombre> y vincúlalo con project-bind." It appears when the folder's name (in a Git repository, the name of the folder that contains `.git`) is the name of an existing project and neither a `.forge614/project.json` nor, with the cloud on, a Git remote that exactly one project has recorded recognizes it.
  - "Esta carpeta podría ser el proyecto «{name}» ({id}), cuya carpeta registrada ({lost folder}) ya no existe. Si es el mismo proyecto, vincúlala con: forge614-engram project-bind --directory {this folder} --project-id {id}. Si es otro proyecto, créalo con forge614-engram project-create --name <nombre> y vincúlalo con project-bind." It appears when every registered folder of a project no longer exists (or cannot be read) and the new folder has the same name as one of them or, with the cloud on, the same Git remote as that project while another project shares that remote (if only one has it, the folder binds to it on its own). The lost folder of a project unrelated to the new folder no longer blocks.
  - What to do: if it is the same project, run the `project-bind` command from the message; if it is another one, create it with `project-create` and bind it with `project-bind`. `project-list` shows the projects and their `id`. If several lost projects match, the message names the first by name and then by `id`.
- `PROJECT_NOT_BOUND`: the folder is not bound to any project yet and the command does not create projects and needs a real one: it reads a specific memory (`memory_get`, `memory_history`; with scope `shared` no project is needed) or continues an existing session or group (`memory_session_end`, `memory_session_summary`, `memory_timeline` or `memory_save` with scope `ecosystem`). `memory_search` and `memory_context` no longer give it (since 1.8.5): a folder without a project has no project or group memories, so they answer without an error and with a `project` field with `status: "unbound"` and a note whose text is always in Spanish: «Esta carpeta todavía no tiene proyecto en Engram, así que no hay recuerdos de proyecto ni de grupo. Se crea al iniciar sesión (memory_session_start) o al guardar.» (it says there are no project or group memories, and that the project is created when a session starts or on save). `memory_search` with scope `project` or `ecosystem` gives `results: []`, and with scope `all` or no scope gives what is in `shared`; `memory_context` with no scope gives the `shared` context and with scope `ecosystem` an empty group context; with scope `shared` nothing changes (no note). Those reads do not register the folder. A folder with a `.forge614/project.json` registers itself even on a read. It is not another failure: the first `memory_session_start` or project save in that folder fixes it by registering the folder, or `project-bind` does. If that first start or save answered `PROJECT_BINDING_REQUIRED`, solve that first as explained above.

## Memory intelligence

Since 1.7.0. In the CLI these codes return `{schemaVersion,code,error}` on stderr.

- `SECRET_REJECTED`: the title, content, topic, short version or an affected project (`affects`) looks like it contains a secret (the message names its kind, never the value). Remove the value and save only where it lives, for example `password: <redacted>` or the environment variable name. Applies at any database level.
- `INTELLIGENCE_REQUIRED`: `short`, `supersedes` or `affects` were sent and the database does not have memory intelligence yet. Enable it with `forge614-engram intelligence-enable` (it backs up before migrating) or save without those fields.
- `SUPERSEDES_NOT_FOUND`: `supersedes` points to a memory that does not exist, is archived, or belongs to another scope or project. Find the right id with `memory_search`.
- `AMBIGUOUS_SESSION`: with schema 11 this no longer comes from stale open sessions (sessions idle for more than 6 hours, or still carrying a mark left by a database that ran 1.7.0, are ignored for inference); if it still appears, two sessions of the same folder are genuinely live and open at once: pass `sessionId`.
- `ECOSYSTEM_TYPE_NOT_ALLOWED`: the memory for the ecosystem board is not `decision`, `procedure`, or `warning` (the status note also admits `fact`). The board is for rules and contracts: change the type or leave the memory in the project.
- `ECOSYSTEM_AFFECTS_REQUIRED`: the effective `affects` (the ones sent or, if none, the ones already stored) are fewer than 2. Send at least 2 names of projects in the group (CLI: `--affects project-a,project-b`); when moving with `memory-move`, the memory must already have them stored.
- `ECOSYSTEM_AFFECTS_UNKNOWN`: some name in `affects` is not the exact name of a project that is a member of the group; the message names the unknown ones and the valid ones. Fix the names.
- `ECOSYSTEM_BOARD_FULL`: the board already has 40 active memories (the status note and session summaries do not count); the message carries the count and the titles. Consolidate memories or demote one with `memory-demote`. It only appears when a new memory is added, never when updating an existing one.
- `ECOSYSTEM_STATUS_FORBIDDEN`: the status note (topic `ecosystem/estado-actual`) is written only by the group's source project, which must still be a member; a memory with that topic cannot be moved into a group either. Set the source project with `group-source-set` and save through MCP or the SDK with `fromProjectId`; through the CLI it always answers this code.
- `ECOSYSTEM_STATUS_TOO_LONG`: the status note content exceeds 600 characters. Shorten it.

**Another session appears as left open (`previous`) while it is still working.** It has gone more than 30 minutes without going through Engram (starting or replaying, saving or confirming with a runtime session, updating its summary, or closing); chat messages do not count. It is not closed, and it stops appearing as soon as it saves something or updates its summary (since 1.7.1).

## Cloud (`cloud on/off/status`, since 1.8.0)

See [01. Installation and Getting Started](01-installation-and-getting-started.md) for the step-by-step guide and [05. Internal Architecture and Formulas](05-internal-architecture-and-formulas.md) for how it works.

**Conflicts and notices, they never stop synchronization:**

- The same memory changed on both Macs without syncing in between: both versions stay (the most recent one active, the other in history) and a notice appears once in the next `session-start`/`memory_session_start`, inside `sessionNotice`. History numbering can end up different between the two Macs; that is normal.
- A downloaded change with a secret, or with an invalid or unknown shape, is skipped, with a grouped notice in the same session; the rest of the queue keeps applying.
- If a local pending change has waited more than 24 hours to upload, a notice appears in the next session; `cloud status` also always shows it (`oldestPendingAt`).

**Errors that are new, or can now appear once the cloud is on:**

- `CONFIG_NOT_FOUND`: you asked for `cloud on` before `init`. Run `init` before `cloud on`.
- `POSTGRES_URL`: the connection string is invalid (missing protocol, user, host, or database; outside loopback it requires `sslmode=require` or `verify-full`; it only accepts the `sslmode` and `channel_binding` parameters, with `channel_binding` set to `require`, `prefer`, or `disable`). The message names what is accepted; it never echoes the string you sent.
- `POSTGRES_SCHEMA`: Neon's `forge614_sync` schema does not have exactly the expected shape (someone modified it from outside, or it was left half-built). PostgreSQL 16 through 18 are supported; on 18, catalogued `NOT NULL` constraints do not count as a difference.
- `POSTGRES_UNAVAILABLE`: PostgreSQL is unavailable or lacks permissions; local data is kept as is. Check the connection and TLS without sharing credentials.
- `SYNC_DISABLED`: you asked for `sync`/`sync-watch` on the new mechanism without having run `cloud on` first (or `.env` has the connection string but the local database never reached the cloud schema level). Run `cloud on`.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión"): a version of Engram earlier than 1.8.0 tried to open a database already prepared for the cloud. Update that Mac to 1.8.0 and first close any earlier session still open.
- `SYNC_WATCH_DEPRECATED` and `SYNC_UPGRADE_FORMAT_DEPRECATED`: warnings on stderr, not errors that stop anything; `sync-watch` and `sync --upgrade-format` (formats 1–3) keep working the same way while they wait to retire on 2027-03-31.

## AI integrations

Engram does not detect or configure AI clients. If an MCP client is unavailable, use the public Forge614 Engines/Shell setup path; do not look for an Engram TUI or assistant command.

## Uninstall

Use the exact confirmation phrase printed by help. If Atlas exists, Engram requires the combined confirmation and removes only `~/.forge614/engram/` and `~/.forge614/atlas/`.
