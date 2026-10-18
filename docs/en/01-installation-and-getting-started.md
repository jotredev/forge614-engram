# 01 (EN). Installation and Getting Started

## Supported systems

Official releases support macOS, Linux, and Windows x64. The single installer downloads and validates the binary against `SHA256SUMS`, then installs it under `~/.forge614/engram/bin/` (on Windows, `%USERPROFILE%\.forge614\engram\bin\`). It also installs Forge614 Shell and Forge614 Engines when absent. Windows arm64 remains pending.

## Requirements

The installer requires **Node.js 22.19.0 or newer**. If it is missing or older, it explains how to install it and exits before changing files. The requirement also applies when updating or uninstalling through the single installer.

## Install

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

On Windows x64, open PowerShell and run:

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-engram/releases/latest/download/install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
Remove-Item install.ps1
```

`-ExecutionPolicy Bypass` applies only to the process that runs the installer; it does not change the machine's persistent policy. The installer publishes Engram's directory in the user PATH. Open a new terminal before running `forge614-engram`.

The installer verifies the gatekeepers, installer, and pointer with `SHA256SUMS`, installs any missing declared dependencies, and places Engram. The pointer limits binaries to macOS arm64/x64, Linux arm64/x64, and Windows x64.

When it finishes it prints the next step with the absolute path (by default it is the one below; if you defined `FORGE614_HOME`, it is the same path inside that folder). Open a new terminal and run it:

```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

That command already includes initializing Engram's memory, inside its own guided screens, and it needs an interactive terminal (which is why the installer only prints it), so there is no need to run `forge614-engram init` separately. Then verify:

```bash
forge614-engram --version
forge614-engram --version --json
forge614-engram help
```

The installer only creates or repairs the product directories of Engram, Shell, and Engines, and the executable path (Shell's installer also adds its own PATH line to your shell profile). It never initializes a memory database, creates memories, or silently configures an AI client.

## Initialize memory

Engram uses one database for all projects:

```text
~/.forge614/memory/.env
~/.forge614/memory/engram.db
```

Backups also live in `memory/`. On the first 1.10.0 run, Engram looks for the 1.9.0 database in `engram/`, checks that no other application has it open, checkpoints the WAL, verifies a temporary copy, and publishes it under `memory/`. If the database is still open, Engram continues using the old path and retries on the next run. If `memory/` already has a database, it takes precedence.

## Alternate storage root

`FORGE614_HOME` contains the program under `engram/` and durable data under `memory/`. If the variable is not defined, the root is `~/.forge614`; when defined, it must be an absolute path.

```bash
FORGE614_HOME=/absolute/path/forge614 forge614-engram init --json
```

With that example, configuration and the database live in `/absolute/path/forge614/engram/`. An empty or relative variable fails before reading or creating storage: stdout stays empty, stderr returns `{"code":"INVALID_FORGE614_HOME","error":"…"}`, and the process exits with code `1`. It never silently falls back to the real home directory.

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

`init` does not create/select a project or detect/configure AI clients. It only establishes memory storage and optional PostgreSQL synchronization. A new database starts with memory intelligence (it includes sessions and reinforcement); on an existing database without reinforcement, the terminal `init` still asks, and memory intelligence is enabled with `intelligence-enable` (chapter 05).

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

## Using the same memory on another Mac

If you work from two Macs, you can make both see exactly the same memories (your projects, your personal notebook, and the ecosystem board), without using them at the same time. Without this turned on, Engram behaves exactly as it always has: nothing changes until you enable it.

**1. Create a project on Neon.** [Neon](https://neon.tech) is a hosted PostgreSQL service; create an account and a new project dedicated only to Engram (any nearby region works; Engram supports PostgreSQL 16 through 18). Neon gives you a connection string: copy it as is, with `sslmode=require&channel_binding=require`, with or without `-pooler` in the host. If you want to try it first, Neon lets you create a test branch with its own connection string, which you can delete afterward.

That connection string is a key: never paste it into a chat or save it in a file inside the repository. The commands in this chapter ask for it in the terminal without echoing it, and store it only in `~/.forge614/engram/.env`, with permissions only you can read. For example: `postgresql://<user>:<password>@<host>/neondb?sslmode=require&channel_binding=require`.

**2. Install 1.8.0 and close every session.** Update Engram on both Macs (`forge614-engram update`). A database already prepared for the cloud cannot be opened by a version earlier than 1.8.0 (it answers `DATABASE_VERSION`), so before turning on the cloud, close every terminal, AI, or MCP server session that still uses Engram on that Mac.

**3. Turn on the cloud on the first Mac.**

```bash
forge614-engram cloud on
```

Without `--postgres-url`, the command asks for the connection string in the terminal (it is not echoed while you type it) and tests it by connecting before saving anything. The first time it is turned on, it uploads to Neon all the memory that Mac already had.

**4. Turn on the cloud on the second Mac, with the SAME connection string.**

```bash
forge614-engram cloud on
```

This Mac is also turning on the cloud for the first time: it uploads all of its local memory that travels and downloads from change 0 what the first Mac uploaded. If this Mac already had its own memory, both end up with the sum of both (in the background, or right away with `forge614-engram sync`).

**5. Confirm the state on both.**

```bash
forge614-engram cloud status --json
```

Once `pending` is `0` on both, the two Macs hold the same memory. From here on, every save synchronizes on its own, with no commands: while Engram is open, it uploads and downloads changes every 30 seconds and also right after a save. If you lose internet access, whatever is pending waits in a local queue and goes out as soon as the connection returns, without losing anything. See chapter [05. Internal Architecture and Formulas](05-internal-architecture-and-formulas.md) for how it works internally, and chapter [03. CLI Reference](03-cli-reference.md) for the rest of `cloud on/off/status`.

## MCP and everyday AI work

Start the local stdio server with `forge614-engram mcp`. AI-client detection and configuration are not Engram features; Forge614 Engines and Shell own them. Once an integration has been configured through their public contracts, work can continue in Claude Code, Codex, or another native environment without keeping Shell open.

## Update and uninstall

The normal mode is for a person in a terminal and shows installer progress. `--json` is for another tool that needs to understand the result without interpreting text or progress.

```bash
forge614-engram update [--version X.Y.Z] [--json]
forge614-engram uninstall [--purge-data] [--json]
forge614-engram uninstall --self [--json]
```

`update` uses the gatekeeper from the selected release, checks its SHA-256 against `SHA256SUMS`, and reads the launcher's actual version after installation. On macOS and Linux, updating from 1.9.0 migrates memory in one step. On Windows, the first 1.9.0 `update` replaces the executable with the new format; the second `update`, now on 1.10.0, migrates memory automatically. Shell calls it with `update --json`; the result preserves `updated`, `previousVersion`, `installedVersion`, and optional `pendingVersion`.

`uninstall` asks for confirmation in a terminal and keeps `memory/`. If Atlas is installed, the phrase names both products and both are uninstalled. `--json` and runs without a terminal do not prompt. `--purge-data` requires a terminal and a separate phrase; it removes local memory and `.env`, but not the PostgreSQL copy. `uninstall --self` removes only Engram integrations managed by Engines, keeps Atlas installed, and is called before the installer deletes `engram/`.
