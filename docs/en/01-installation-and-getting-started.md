# 01 (EN). Installation and Getting Started

## Supported systems

Official releases currently support macOS and Linux. The installer downloads a platform-specific binary, validates it against `SHA256SUMS`, and installs it under `~/.forge614/engram/bin/`. It also installs the required Forge614 Shell dependency (which brings Forge614 Engines) when `~/.forge614/shell/bin/forge614-shell` is not already there, and Engines if it is still absent; an existing Shell or Engines is kept as is, not updated. Windows has no Engram or Shell installer yet.

## Requirements

Because Forge614 Shell is installed, the installer needs **Node.js 22.19 or newer** and `tar`, in addition to Bash, `curl`, and a SHA-256 utility. If any is missing it **installs nothing**: it checks this before downloading any file, so a missing requirement never leaves a partial installation, and it tells you how to fix it. The check always runs, even when Shell is already installed.

## Install

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

The installer works in this order: it checks the requirements, downloads and verifies the Engram binary, installs Forge614 Shell (which brings Engines) unless it is already installed and, if Engines is still absent, Engines, and finally places Engram. If Shell cannot be installed, Engram is left unchanged.

When it finishes it prints the next step with the absolute path (by default it is the one below; if you defined `FORGE614_HOME`, it is the same path inside that folder). Open a new terminal and run it:

```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

That command already includes initializing Engram's memory, inside its own guided screens, and it needs an interactive terminal (which is why the installer only prints it), so there is no need to run `forge614-engram init` separately. Then verify:

```bash
forge614-engram --version
forge614-engram help
```

The installer only creates or repairs the product directories of Engram, Shell, and Engines, and the executable path (Shell's installer also adds its own PATH line to your shell profile). It never initializes a memory database, creates memories, or silently configures an AI client.

## Initialize memory

Engram uses one database for all projects:

```text
~/.forge614/engram/.env
~/.forge614/engram/engram.db
```

## Alternate storage root

`FORGE614_HOME` acts like a building address: everything owned by Engram —`.env`, SQLite, the executable, and auxiliary files— stays beneath that one root. If the variable is not defined, the historic address remains exactly `~/.forge614`; when it is defined, it must be an absolute path.

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
forge614-engram update
forge614-engram update --json
forge614-engram uninstall --confirm 'REMOVE FORGE614-ENGRAM'
```

`update` downloads the latest stable installer and runs it with `--force`: it verifies the release and replaces the Engram executable while showing normal progress. Like a first install, it needs Node.js 22.19+ and `tar` (if either is missing it changes nothing and keeps the previous binary) and it installs Forge614 Shell (and Engines) if they are missing. It never touches `.env`, `engram.db`, or memories. It uses the same effective root as Engram and installs in `FORGE614_HOME/engram/bin/` when the variable is defined; without it, it keeps `~/.forge614/engram/bin/`. `update --json` suppresses that progress and, on success, writes only compact JSON: `{"updated":true,"previousVersion":"<previous version>","installedVersion":"<installed version>"}`. If the installed version did not change, `updated` is `false`.

Both modes preserve `.env`, `engram.db`, memories, and configuration. With `--json`, failure writes only `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` to stderr and exits with code `1`; it does not expose installer diagnostics, URLs, or secrets. This interface is available from stable release `v1.4.0`.

If Atlas exists, uninstall requires `REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS` and removes only those two product directories.
