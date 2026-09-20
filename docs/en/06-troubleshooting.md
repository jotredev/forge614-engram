# 06 (EN). Troubleshooting

## Installation or update

Use a supported macOS/Linux terminal with Bash, `curl`, and a SHA-256 utility. `forge614-engram update` uses the official `latest` installer and preserves the previous binary when verification or installation fails. Retry after restoring connectivity; do not manually replace `engram.db`.

## Initialization

`init` requires an interactive terminal. Use `init --json` in automation. `--postgres-url` is valid only with `init --json`; connection failures return structured JSON without exposing the URL and without leaving partial configuration.

## Storage

Do not delete or move `~/.forge614/engram/engram.db` manually. Engram repairs permissions inside its own product directory only. If a configuration exists but its database is missing, it fails safely instead of silently creating a replacement.

## Search and topics

Search is literal FTS5 matching. Provide a `projectId` for project searches, or use `--scope shared`. Updating a topic needs its current `--expected-version`; use `get` or `history` first.

## PostgreSQL

SQLite/FTS5 remains local even after PostgreSQL is configured. Run `sync` explicitly. Before `sync --upgrade-format`, update every participating device to a compatible release.

A PostgreSQL URL is a secret. Engram never returns it in results, CLI errors, or MCP responses. If a domain error were to contain a `postgres://` or `postgresql://` URL, Engram replaces it with `[URL de PostgreSQL oculta]`; it does not expose the user, password, host, port, database name, or parameters. Unexpected errors use a generic message without internal details.

## AI integrations

Engram does not detect or configure AI clients. If an MCP client is unavailable, use the public Forge614 Engines/Shell setup path; do not look for an Engram TUI or assistant command.

## Uninstall

Use the exact confirmation phrase printed by help. If Atlas exists, Engram requires the combined confirmation and removes only `~/.forge614/engram/` and `~/.forge614/atlas/`.
