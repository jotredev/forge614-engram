# 03 (EN). CLI Reference

All data commands write JSON to stdout. Errors write `{code,error}` JSON to stderr and exit with code `1`. `help` and `--version` create no storage.

## Lifecycle

```text
init [--json] [--postgres-url <URL>]    initialize local memory; URL requires --json
update                                  verify and install latest stable release
uninstall --confirm <exact phrase>      remove Engram only, or Engram and Atlas
mcp                                     start local stdio MCP server
sync [--upgrade-format]                 synchronize configured PostgreSQL replica
sync-watch [--interval <1..3600>]       retry synchronization while the process remains open
sessions-enable                         explicitly enable session lifecycle
reinforcement-enable                    explicitly enable local repeated-memory ordering
```

`setup` is retired and returns `COMMAND_RETIRED`. There is no `tui`, `assistant-list`, `integration-enable`, or `memory-hook` command.

## Projects

```text
project-create --name <name>
project-list
project-rename --project-id <UUID> --name <name>
project-bind --directory <path> --project-id <UUID>
```

## Memories

```text
save --project-id <UUID> --title <text> --content <text> [--type fact|decision|procedure|warning|preference]
     [--topic <key>] [--expected-version <n>] [--request-key <key>] [--pinned true|false]
     [--session-id <id>] [--session-project-id <UUID>]
search --project-id <UUID> --query <text> [--scope all|project|shared] [--limit <1..100>] [--preview]
search --scope shared --query <text>
get --project-id <UUID> --id <memory-id> [--version <n>]
history --project-id <UUID> --id <memory-id>
archive|restore --project-id <UUID> --id <memory-id>
```

Use `--scope shared` rather than `--project-id` for a shared memory. Updating an existing topic requires `--expected-version`.

## Sessions and context

```text
session-start --directory <path> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json> --request-key <key> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <memory-id> --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
```

Run `forge614-engram help` for the executable's exact current syntax.
