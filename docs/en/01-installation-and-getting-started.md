# 01 (EN). Installation and Getting Started

## Supported systems

Official releases currently support macOS and Linux. The installer downloads a platform-specific binary, validates it against `SHA256SUMS`, and installs it under `~/.forge614/engram/bin/`. It also installs the required Forge614 Engines dependency from its verified release when it is absent. Windows support is not currently published.

## Install

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

Open a new terminal, then verify:

```bash
forge614-engram --version
forge614-engram help
```

The installer only creates or repairs Engram's product directory and executable path. It never initializes a memory database, creates memories, or silently configures an AI client.

## Initialize memory

Engram uses one database for all projects:

```text
~/.forge614/engram/.env
~/.forge614/engram/engram.db
```

For an interactive, terminal-only memory initialization flow:

```bash
forge614-engram init
```

For automation without a TTY:

```bash
forge614-engram init --json
```

To configure an optional PostgreSQL replica during non-interactive initialization:

```bash
forge614-engram init --json --postgres-url 'postgresql://user:password@host/database'
```

The URL is not printed in normal output or structured errors. SQLite and FTS5 remain local even when PostgreSQL is configured.

`init` does not create/select a project or detect/configure AI clients. It only establishes memory storage, optional PostgreSQL synchronization, and optional reinforcement.

## Create and use a project

```bash
forge614-engram project-create --name "My application"
forge614-engram project-list
forge614-engram save --project-id <UUID> --title "Database" --content "Use SQLite locally" --topic architecture/database
forge614-engram search --project-id <UUID> --query "SQLite"
```

Shared memories have no project owner:

```bash
forge614-engram save --scope shared --title "Team convention" --content "Use conventional commits"
forge614-engram search --scope shared --query "conventional"
```

## MCP and everyday AI work

Start the local stdio server with `forge614-engram mcp`. AI-client detection and configuration are not Engram features; Forge614 Engines and Shell own them. Once an integration has been configured through their public contracts, work can continue in ADE Orca, Claude Code, Codex, or another native environment without keeping Shell open.

## Update and uninstall

The normal mode is for a person in a terminal and shows installer progress. `--json` is for another tool that needs to understand the result without interpreting text or progress.

```bash
forge614-engram update
forge614-engram update --json
forge614-engram uninstall --confirm 'REMOVE FORGE614-ENGRAM'
```

`update` downloads the latest stable installer, verifies the release, and replaces only the Engram executable while showing normal progress. `update --json` suppresses that progress and, on success, writes only compact JSON: `{"updated":true,"previousVersion":"<previous version>","installedVersion":"<installed version>"}`. If the installed version did not change, `updated` is `false`.

Both modes preserve `.env`, `engram.db`, memories, and configuration. With `--json`, failure writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr and exits with code `1`; it does not expose installer diagnostics, URLs, or secrets. This interface is available from stable release `v1.4.0`.

If Atlas exists, uninstall requires `REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS` and removes only those two product directories.
