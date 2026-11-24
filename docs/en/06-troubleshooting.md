# 06 (EN). Troubleshooting

## Installation or update

The single installer requires Node.js 22.19.0 or newer; on Windows, `-ExecutionPolicy Bypass` affects only that PowerShell process. If a download or checksum fails, retry with a stable connection and do not run an unverified file. When `FORGE614_HOME` is set, check that it is an absolute path.

When updating from 1.9.0, the new gatekeeper migrates memory in one run on macOS/Linux. On Windows, run `forge614-engram update` twice: the first updates the 1.9.0 executable and the second, now on 1.10.0, migrates data. `update --version X.Y.Z` selects a specific release; Shell uses `update --json`.

<!-- Inherited 1.9.0 installer messages are retained for historical release notes only.

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

On Windows x64, use the installation command in [01. Installation and Getting Started](01-installation-and-getting-started.md). These literal installer messages identify what to resolve:

- `Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer. Nothing was installed.`: Node.js is unavailable. Install it from https://nodejs.org or run `winget install OpenJS.NodeJS.LTS`, then run the installer again.
- `Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer; found <version>. Nothing was installed.`: Node.js is old or unreadable. Update it to 22.19 or newer and retry.
- `Forge614 Engram installs Forge614 Shell, which needs tar. Nothing was installed.`: install `tar.exe` and run the installer again.
- `Release checksum verification failed.`: the downloaded digest does not match. Do not run the downloaded file; retry from the official command when the network is available.
- `The command already exists. Use -Force to replace it explicitly.`: the executable already exists. Use `-Force` only when you intend to replace that installation.
- `INVALID_FORGE614_HOME: FORGE614_HOME must be a non-empty absolute path.`: set `FORGE614_HOME` to a non-empty absolute path or remove it before installing.
- The installer finishes with `Installed:` but `forge614-engram` is not recognized: open a new terminal so it reads the published user PATH.
- If execution policy blocks the script, run the documented command with `-ExecutionPolicy Bypass`; that option affects only that PowerShell process.

For automation, use `forge614-engram update --json`. Its success is one compact JSON object on stdout and must not contain progress. On failure it exits with code `1` and writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr. That deliberately safe message does not reveal installer diagnostics, URLs, credentials, or secrets.

-->

## Initialization

`init` requires an interactive terminal. Use `init --json` in automation. `--postgres-url` is valid only with `init --json`; connection failures return structured JSON without exposing the URL and without leaving partial configuration.

## Storage

The database, `.env`, and backups live in `~/.forge614/memory/` or `FORGE614_HOME/memory/`. Do not delete or move these files manually. If an Engram 1.9.0 MCP session still has the old database open, 1.10.0 keeps using it and retries migration the next time Engram opens.

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
- `GROUP_REQUIRED`: the `ecosystem` scope needs a group: pass `--group` or use a project that belongs to one (`group-bind`). `memory_search` and `memory_context` with scope `ecosystem` no longer give it (since 1.8.6): a bound project without a group has no group memories, so `memory_search` answers `results: []` and `memory_context` the empty group context, both with an `ecosystem: { status: "none", message }` field and a note whose text is always in Spanish: «Este proyecto no pertenece a ningún grupo, así que no hay recuerdos de grupo. Se vincula a uno con forge614-engram group-bind.» (it says the project belongs to no group, so there are no group memories, and that it is bound to one with `forge614-engram group-bind`). `memory_save`, `memory_get`, `memory_history` and `memory_session_summary` with scope `ecosystem`, and the CLI `search --scope ecosystem`, still give it in a bound project without a group (and, for `memory_save` and `memory_session_summary`, once `groupIntent` is given).
- `GROUP_INTENT_REQUIRED`: saving to `ecosystem` through MCP requires a truthful `groupIntent`.
- `TOPIC_CONFLICT`: `memory-move` does not overwrite; the group already has a memory with that topic. Archive it or change the topic.
- `PROJECT_FILE_INVALID` indicates corrupt JSON, an unknown format, or an unsafe legacy file. Engram preserves its bytes. Fix the file or remove it if you no longer need its declaration.
- `PROJECT_FILE_CONFLICT` means the file declares another project. Verify the UUID and use `project-bind --replace-from` to correct the binding without editing the file.
- `MIGRATION_VERIFY_FAILED`: the migration check failed and everything was rolled back. The database did not change and the `.bak` backup next to `engram.db` is kept; do not delete it and report the case.
- `SYNC_ECOSYSTEM_UNSUPPORTED` means formats 1–3 snapshot sync found group memories. Incremental sync with `cloud on` replicates them.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") when Engram 1.5.x opens a database upgraded by 1.6.0: update Engram. The database is not modified; the pre-migration `.bak` backup remains readable by 1.5.x. A 1.5.x process that was already running (for example an MCP server) must be restarted after updating.

## Unbound folders and recovery

- `PROJECT_BINDING_REQUIRED` indicates conflicting evidence, multiple candidates, an unverified historical origin, or a pending cloud catalog. It can also mean the folder name matches an existing project or its missing folder. Startup and orientation still return shared context. Project writes and session starts wait for a decision.
- If the catalog is pending, run `forge614-engram sync` and reopen the context. If you know the correct project, check `project-list` and run `project-bind --directory <path> --project-id <UUID>`. Add `--replace-from <previous-UUID>` to correct a binding or an incompatible file. To start an independent project, use `project-create --name <name> --directory <path>`.
- `PROJECT_ORIGIN_CONFIRMATION_REQUIRED` means a bound folder kept its UUID after its origin changed to an unclaimed address. Confirm the address for future clones with `project-bind --accept-origin`.
- `PROJECT_BINDING_CONFLICT` means that the folder is already bound or `--replace-from` does not match the expected UUID. Check the local identity and retry the correction with the correct value.
- `PROJECT_NOT_BOUND` means the folder has no identified project. `memory_search` and `memory_context` return an `unbound` note without an error. Searches scoped to project or ecosystem are empty. Shared scope is available without a folder binding.
- `SESSION_CONFLICT` can occur when a corrected folder tries to open an earlier session. Start a session with a new identifier. Review memories written before correction under their previous UUID.
- `PROJECT_FILE_TRACKED` means Git tracks the legacy file. Engram can read it and preserves its bytes. To remove it from the index while keeping your local copy, add `/.forge614/` to the root `.gitignore` and run these commands from the checkout root.

```bash
git rm --cached -- .forge614/project.json
git status --short
```

- `PROJECT_FILE_NOT_WRITTEN` means legacy publication was skipped. The SQLite change remains available. Check that the root `.gitignore` is a regular file and that the exclusion applies to the whole directory.

### Recovering on another machine or upgrading from 1.10.0

With cloud sync enabled, configure the same replica on the other installation and run `sync`. Wait for the first download to finish, then read the context again. Without cloud sync, use a consistent SQLite backup at the other installation's `FORGE614_HOME/memory/engram.db` and check the UUID before saving. An empty database cannot recover memories from Git.

Before enabling the catalog, make a consistent SQLite backup, close processes that open the database, and update those readers, including any Atlas binary that embeds Engram 1.10.0. The first `sync` after an update can prepare the catalog and leave a `.bak` backup. Engram 1.10.0 returns `DATABASE_VERSION` when it opens the migrated database. To return to that version, close the newer processes and restore a copy of the pre-migration backup. Keep the migrated database and the original backup.

See [03. CLI reference](03-cli-reference.md) for the full commands.

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
- `DATABASE_VERSION` means the binary does not support this database schema. Close its readers and use a compatible version. Keep the `.bak` backup for the previous schema.
- `SYNC_WATCH_DEPRECATED` and `SYNC_UPGRADE_FORMAT_DEPRECATED`: warnings on stderr, not errors that stop anything; `sync-watch` and `sync --upgrade-format` (formats 1–3) keep working the same way while they wait to retire on 2027-03-31.

## AI integrations

Engram does not detect or configure AI clients. If an MCP client is unavailable, use the public Forge614 Engines/Shell setup path; do not look for an Engram TUI or assistant command.

## Uninstall

`uninstall` prints its confirmation phrase in a terminal and keeps `memory/`. If Atlas is installed, the phrase names both products and uninstalls both. `--json` or a run without a terminal skips the prompt. `--purge-data` requires an interactive terminal, removes local memory and its configuration, and does not remove the PostgreSQL copy; with `--json` or without a terminal it is rejected without changes. `uninstall --self` removes only Engram integrations managed by Engines and leaves Atlas installed. On Windows, if WMI cannot schedule deletion of the parked executable, Engram finishes uninstalling and reports the path where the file remains.

On Windows, the uninstaller can remove `engram/` while an assistant keeps the MCP open. Locked executables stay in the temporary directory until you close the assistant; with `--json`, check their paths in `remainingExecutablePaths`. Memory remains in `memory/`.
