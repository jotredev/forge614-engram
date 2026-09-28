# Cross-platform distribution and English setup — Design

Status: approved direction awaiting review before implementation. Date: 2026-09-17.
Branch: `feat/cross-platform-setup`, based on `main` commit `c3b293a`.

## Goal

Make Forge614 Engram installable as a normal standalone command on macOS, Linux,
and Windows without cloning this repository, installing Bun, installing npm, or
installing Git. After installation, `forge614-engram setup` prepares the global
memory store and offers one explicit, inspectable configuration flow for every
supported assistant.

The runtime product speaks English only. Gemini CLI support is replaced by
Antigravity support. Forge614 Shell remains the future daily human interface;
this delivery does not add any new Engram control-center screen and does not
remove the existing `tui` until Shell has confirmed feature parity.

## Non-goals

- No embedding model, vector database, cloud service, second database, or LLM.
- No automatic assistant configuration, storage initialization, synchronization,
  format promotion, or background service.
- No deletion or modification of an existing Gemini configuration on a user's
  machine. Engram merely stops managing it.
- No removal of `forge614-engram tui` in this delivery.
- No claim that an assistant always calls `memory_save`.
- No use of a user's configuration, databases, credentials, PostgreSQL service,
  or assistant configuration in tests.

## Distribution

### Release artifacts

GitHub Actions builds release artifacts natively and publishes a GitHub Release
with a `SHA256SUMS` manifest. The initial supported matrix is:

| OS | Architecture | Artifact |
| --- | --- | --- |
| macOS | arm64 | `forge614-engram-darwin-arm64` |
| macOS | x64 | `forge614-engram-darwin-x64` |
| Linux | x64 | `forge614-engram-linux-x64` |
| Linux | arm64 | `forge614-engram-linux-arm64` |
| Windows | x64 | `forge614-engram-windows-x64.exe` |
| Windows | arm64 | `forge614-engram-windows-arm64.exe` |

The release workflow must build with the pinned Bun version, attach the exact
artifacts and checksums, and fail before publishing if an artifact is absent or
its checksum cannot be generated. A release tag is the only publication trigger;
ordinary pull requests run verification but publish nothing.

### End-user installers

`install.sh` is a small macOS/Linux downloader. `install.ps1` is its Windows
PowerShell equivalent. Each installer:

1. Detects only its supported OS and architecture.
2. Resolves one explicit release version or the GitHub `latest` release.
3. Downloads only the corresponding binary and `SHA256SUMS` over HTTPS.
4. Verifies the binary checksum before publishing it.
5. Publishes atomically into a user-owned directory with executable permissions.
6. Explains how to add that directory to the user's PATH when necessary.
7. Does not create `~/.forge614`, start setup, inspect assistants, or modify any
   assistant configuration.

The development script that compiles a checkout remains a separate developer
tool. It is not the end-user installation path.

Default destinations are `~/.local/bin` on macOS/Linux and a user-owned local
application bin directory on Windows. Existing commands are never overwritten
without an explicit `--force` option. A failed download, checksum mismatch, or
unsupported platform leaves no published executable behind.

## Setup

The user runs exactly:

```text
forge614-engram setup
```

Setup is a compact first-run wizard, not an everyday full-screen control center.
All runtime text is English. It first explains the global store, asks about the
existing explicit PostgreSQL and reinforcement choices, and then detects every
supported assistant without writing files.

The assistant list is one shared selector. It does not give Antigravity a special
command or a separate connection flow:

```text
Detected assistants:

[ ] Claude Code
[ ] Codex
[ ] Cursor
[ ] OpenCode
[ ] Antigravity

Up/Down to move · Space to select · Enter to continue
```

Before any write, setup shows a complete safe preview for the selected assistants:
their MCP server entry, supported hooks, configuration file locations allowed by
their adapter, and the private backup action. It does not print secrets or file
contents. Its last question is a keyboard selection, not `y/n`, `s/n`, or typed
confirmation:

```text
Apply this configuration?

> Yes
  No

Up/Down to select · Enter to confirm
```

`No`, Escape, Ctrl+C, EOF, invalid input, non-TTY invocation, failed preflight,
or a changed workspace configuration make no Engram storage or assistant-config
writes. Before the final selection, all selected assistant plans are preflighted
and PostgreSQL connectivity is checked. After `Yes`, storage creation and
assistant-file application are coordinated but cannot be one filesystem/database
transaction; a partial assistant-file failure is reported precisely with its
backup paths, never hidden or rolled back destructively.

Running setup again is the supported way to detect an assistant installed later.
It preserves the existing global database and existing selected configurations
unless the user explicitly selects assistants and accepts a new preview.

## Assistant adapters

The supported registry becomes Claude Code, Codex, Cursor, OpenCode, and
Antigravity. Every occurrence of `gemini-cli` in product registry, detection,
templates, configuration planning, hooks, tests, generated text, installer output,
help, and runtime documentation is removed or replaced.

Antigravity receives its own adapter; it is not a string rename of Gemini. The
adapter uses Antigravity's documented global MCP configuration location
`~/.gemini/config/mcp_config.json`, with optional workspace configuration only
when explicitly supported by the existing setup scope. The MCP entry invokes the
installed absolute `forge614-engram` path with `mcp` as its sole argument.

Antigravity hooks use only the official event schema and configuration locations
validated during implementation. If no compatible durable-memory reminder event
can be confirmed from official documentation and a real isolated fixture, setup
still supports the MCP entry but labels hooks as unavailable rather than inventing
Gemini-compatible events.

All adapters preserve unrelated keys/comments when their native configuration
format supports them, reject unsafe links/files, take private 0600 backups, and
verify published bytes. A detected assistant is never configured merely because
it appears in the list.

## Runtime English policy

All user-visible product text in source, installers, CLI help, setup, terminal
adapters, errors, generated configuration previews, and generated assistant
instructions is English. Machine-readable error codes and public JSON field names
remain stable. Existing bilingual documentation is not destructively removed by
this code delivery; the documentation handoff must explicitly reconcile it with
the user's current English-only product policy.

## TUI transition

The existing `forge614-engram tui` remains temporarily for backwards-compatible
technical administration. It receives no new feature. Forge614 Shell will become
the daily terminal UI by consuming safe non-interactive Engram contracts. Only
after Shell proves feature parity for project administration and assistant
configuration may a later, separate delivery remove the command, its code, tests,
installer offer, and documentation.

## Architecture

```text
GitHub Actions release
  -> native binaries + SHA256SUMS
  -> install.sh / install.ps1
  -> installed forge614-engram
       -> setup terminal adapter (keyboard selector only)
       -> app setup coordinator
            -> WorkspaceConfig / MemoryWorkspace
            -> assistant detection, plan, preflight, apply
            -> Antigravity adapter
```

The release workflow owns artifact construction. Installers own download and
checksum verification only. The terminal adapter owns key navigation and safe
screen cleanup. The app coordinator owns setup ordering and no-write-before-final-
confirmation policy. Assistant infrastructure owns each client-specific path,
format, plan, backup, and write. Modules own client IDs and pure configuration
templates. No interface opens SQLite directly.

## Tests and verification

- Unit/colocated tests cover target selection, release checksum parsing, unsupported
  platform refusal, no-overwrite/default destination logic, and installer output.
- Installer tests use a local fixture release server or injected downloader and
  disposable destinations; they never call a real GitHub Release or change PATH.
- Windows installer behavior is tested in Windows CI using PowerShell; macOS and
  Linux installers are tested in their native CI jobs.
- Setup tests cover keyboard selection, multiple selected assistants, Yes/No,
  Escape/Ctrl+C/EOF, no configuration before final acceptance, stale detection,
  malformed configurations, partial application, and English-only product output.
- Antigravity tests use temporary homes/config files and validate MCP structure,
  safe backups, detection, hooks only when officially supported, and absence of
  all Gemini client identifiers.
- Existing project/shared/session/FTS5/synchronization contracts stay unchanged.
- Full suite, typecheck, whitespace check, artifact build checks, release manifest
  verification, and independent code review must pass before handoff.

## Baseline note

The branch started clean at `c3b293a`. A full baseline run with
`FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin` found
495 passing tests and 5 environment failures because that old temporary directory
no longer contains `initdb` and `pg_ctl`. This is not a product regression. Full
PostgreSQL verification must use newly provisioned disposable binaries and must
not use a user's PostgreSQL service or `DATABASE_URL`.
