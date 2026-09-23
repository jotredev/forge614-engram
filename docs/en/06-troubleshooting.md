# 06 (EN). Troubleshooting

## Installation or update

Use a supported macOS/Linux terminal with Bash, `curl`, and a SHA-256 utility. `forge614-engram update` uses the official `latest` installer and preserves the previous binary when verification or installation fails. Retry after restoring connectivity; do not manually replace `engram.db`.

For automation, use `forge614-engram update --json`. Its success is one compact JSON object on stdout and must not contain progress. On failure it exits with code `1` and writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr. That deliberately safe message does not reveal installer diagnostics, URLs, credentials, or secrets.

## Initialization

`init` requires an interactive terminal. Use `init --json` in automation. `--postgres-url` is valid only with `init --json`; connection failures return structured JSON without exposing the URL and without leaving partial configuration.

## Storage

Do not delete or move `~/.forge614/engram/engram.db` manually. Engram repairs permissions inside its own product directory only. If a configuration exists but its database is missing, it fails safely instead of silently creating a replacement.

## Search and topics

Search is literal FTS5 matching. Provide a `projectId` for project searches, or use `--scope shared`. Updating a topic needs its current `--expected-version`; use `get` or `history` first.

## PostgreSQL

SQLite/FTS5 remains local even after PostgreSQL is configured. Run `sync` explicitly. Before `sync --upgrade-format`, update every participating device to a compatible release.

A PostgreSQL URL is a secret. Engram never returns it in results, CLI errors, or MCP responses. If a domain error were to contain a `postgres://` or `postgresql://` URL, Engram replaces it with `[URL de PostgreSQL oculta]`; it does not expose the user, password, host, port, database name, or parameters. Unexpected errors use a generic message without internal details.

## Groups, project identity, and database upgrade

Since 1.6.0. The `group-*` commands, `memory-move`, and the codes in this section return `{schemaVersion,code,error}` on stderr (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)).

- `GROUP_NAME_INVALID`: the group name must use lowercase letters, digits, and single hyphens (`mi-tienda`), 1 to 64 characters.
- `GROUP_EXISTS`: a group with that name already exists; use `group-list`.
- `GROUP_NOT_FOUND`: the group does not exist in this database (also when the database does not know groups yet). Create it with `group-create`.
- `GROUP_AMBIGUOUS`: several groups have that name; use the `id` shown by `group-list`.
- `GROUP_REQUIRED`: the `ecosystem` scope needs a group: pass `--group` or use a project that belongs to one (`group-bind`).
- `GROUP_INTENT_REQUIRED`: saving to `ecosystem` through MCP requires a truthful `groupIntent`.
- `TOPIC_CONFLICT`: `memory-move` does not overwrite; the group already has a memory with that topic. Archive it or change the topic.
- `PROJECT_FILE_INVALID`: `.forge614/project.json` is not valid (corrupt JSON, unknown schema or fields, symbolic link, too large). Engram does not modify it: fix it or delete it so it is regenerated.
- `PROJECT_FILE_CONFLICT`: `project-bind` tried to bind a folder whose file declares another project; use that identity or delete the file.
- `MIGRATION_VERIFY_FAILED`: the migration check failed and everything was rolled back. The database did not change and the `.bak` backup next to `engram.db` is kept; do not delete it and report the case.
- `SYNC_ECOSYSTEM_UNSUPPORTED`: `sync` stops while group memories exist: `ecosystem` memories are not replicated yet (coming in 1.7.0, "format 4"). Local and remote data are not touched.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") when Engram 1.5.x opens a database upgraded by 1.6.0: update Engram. The database is not modified; the pre-migration `.bak` backup remains readable by 1.5.x. A 1.5.x process that was already running (for example an MCP server) must be restarted after updating.

## AI integrations

Engram does not detect or configure AI clients. If an MCP client is unavailable, use the public Forge614 Engines/Shell setup path; do not look for an Engram TUI or assistant command.

## Uninstall

Use the exact confirmation phrase printed by help. If Atlas exists, Engram requires the combined confirmation and removes only `~/.forge614/engram/` and `~/.forge614/atlas/`.
