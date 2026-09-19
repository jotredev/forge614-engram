# Installer PATH and Setup Onboarding Design

## Goal

Make the public installation experience work as a normal CLI installation:

1. A person runs one official bootstrap command.
2. The installer downloads the matching, checksum-verified release binary.
3. The installer makes `forge614-engram` available in a newly opened terminal.
4. The person runs `forge614-engram setup`.
5. Setup initializes memory and then opens the existing assistant-selection UI.
6. Assistant configuration is written only after the person selects clients, reviews the preview, and confirms it.

This design applies to macOS, Linux, and Windows. It does not create a public
release, tag a version, or change memory data formats.

## Current State

`scripts/install.sh` and `scripts/install.ps1` already select the current
release, choose the operating-system/architecture artifact, require HTTPS,
download `SHA256SUMS`, compare the artifact digest, and publish the executable
atomically. They intentionally do not configure the command search path.

`setup` already initializes the one global memory workspace. Assistant
detection, review, confirmation, MCP publication, supported hooks, backups,
and schema-5 enrollment already live in the assistant TUI. Duplicating that
behavior in setup would create two different configuration paths and is out of
scope.

## Official User Entry Points

After a public release exists, the documented commands will be:

```bash
curl -fsSL https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.ps1 | iex
```

The bootstrap scripts select the latest GitHub Release unless the person passes
an explicit release version to the downloaded script. The binary itself is
always checksum-verified before publication. The bootstrap command is an
explicit user action; no installer runs by itself.

## PATH Publication

### Unix-like systems

The Bash installer will retain `$HOME/.local/bin` as its default binary
directory. Following a successful binary publication it will make that exact
directory available to future interactive shells:

* zsh: an idempotent marked block in `~/.zshrc`.
* Bash: an idempotent marked block in `~/.bashrc` on Linux and `~/.bash_profile`
  on macOS.
* fish: a dedicated idempotent file at
  `~/.config/fish/conf.d/forge614-engram.fish`.

The installer will never append a duplicate entry. It will report the exact
file it changed and state that the current terminal remains unchanged; opening
a new terminal makes the command available. A custom `--bin-dir` receives the
same treatment.

If the user's shell cannot be identified as Bash, zsh, or fish, the binary is
still installed and verified. The installer will not guess at an unrelated
configuration file. It will print the exact command needed to add the selected
directory to PATH manually and exit successfully.

### Windows

The PowerShell installer will retain `%LOCALAPPDATA%\\Forge614\\bin` as the
default binary directory. Following successful binary publication it will add
that exact directory to the **current user's** PATH only:

* It never changes the machine-wide PATH and never asks for administrator
  permission.
* It compares entries without case sensitivity and does not add duplicates.
* It writes the user environment value through the supported .NET user-scope
  API and broadcasts the ordinary Windows environment-change notification.
* It reports the change and explains that a newly opened terminal will see it;
  the current PowerShell process is not modified secretly.

If Windows refuses the user PATH write, installation is still left intact and
the installer prints the exact directory to add manually. It must not erase the
new executable or alter any existing PATH entry.

## Setup and Assistant Onboarding

`forge614-engram setup` remains an interactive, human-only command. It first
runs its current memory-storage setup conversation. If the person cancels that
conversation, it exits with the existing cancellation behavior and never opens
assistant configuration.

If memory setup succeeds, `setup` launches the existing assistant TUI in the
same terminal. The TUI is the single owner of all assistant behavior:

* Detect Claude Code, Codex, Cursor, OpenCode, and Antigravity.
* Permit redetection when a person installed an assistant later.
* Let the person select zero or more assistants.
* Show the exact MCP files, hooks, warnings, backups, and capability changes
  before any write.
* Apply changes only after explicit confirmation.
* Leave existing memory intact when assistant selection is cancelled.

There is deliberately no silent MCP enrollment during curl/PowerShell
installation, `init`, or the initial memory questions in `setup`. Installing a
CLI grants permission to install the CLI; it does not grant permission to
modify unrelated AI-assistant configuration files. `setup` makes the next
choice immediate, but retains visible selection and confirmation.

New user-facing strings introduced by this delivery are English. Existing
unrelated localized strings are not rewritten as part of this scope.

## Files and Boundaries

* `scripts/install.sh`: Unix release download, checksum verification, and
  idempotent shell PATH publication.
* `scripts/install.ps1`: Windows release download, checksum verification, and
  idempotent user PATH publication.
* `scripts/__tests__/install.sh.test.ts`: disposable Unix installer fixtures
  for PATH file creation, deduplication, unsupported shells, custom directories,
  and existing release safety behavior.
* `scripts/__tests__/install.ps1.test.ps1`: isolated Windows fixtures for user
  PATH behavior without changing the real runner user's PATH.
* `src/interfaces/terminal/setup.ts`: hand off to the already existing
  assistant TUI only after successful storage setup.
* `src/interfaces/terminal/setup.test.ts`: prove cancellation does not open
  assistant onboarding and successful setup hands off exactly once.
* `src/interfaces/cli/commands.ts` and its sibling tests only change if a
  narrow injectable runner is required to test the handoff without a real TTY.

No MCP template, assistant configuration service, TUI selection state, storage
schema, database file, project identity, or release artifact name is redesigned.

## Failure Rules

* A bad release response, missing artifact, invalid digest, or checksum mismatch
  continues to prevent binary publication exactly as it does today.
* A PATH configuration failure does not convert a successful verified binary
  installation into a destructive rollback. It reports manual next steps.
* Existing user PATH values and shell configuration remain preserved. Only the
  named, idempotent Forge614 Engram insertion may be created or updated.
* A failed or cancelled assistant TUI does not remove initialized memory and
  does not make partial assistant configuration writes.
* `init` remains non-interactive and does not open the assistant TUI.
* `assistant-list` remains read-only and must not create `~/.forge614`.

## Validation Contract

Automated tests must cover:

1. Unix path insertion for Bash, zsh, and fish; repeat installation makes no
   duplicate insertion.
2. Unsupported Unix shell leaves shell files untouched and returns the manual
   PATH instruction.
3. Custom `--bin-dir` is the path published, rather than the default.
4. Existing checksum, overwrite, HTTPS-only, and unsupported-platform failures
   remain unchanged.
5. Windows compares PATH values case-insensitively, appends once only, never
   replaces existing entries, and does not require administrator scope.
6. Windows PATH-write failure leaves the verified executable present and emits
   manual guidance.
7. Setup cancellation never invokes assistant onboarding.
8. Successful setup invokes the existing assistant TUI once; canceling that TUI
   preserves the initialized workspace without assistant configuration writes.
9. `init` and noninteractive commands remain noninteractive and storage-safe.

Full verification before integration will include `bun test`, `bun run
typecheck`, `git diff --check`, the existing cross-platform Verify workflow,
and manual smoke checks of the generated installer behavior where each host is
available.

## Out of Scope

* Publishing `v1.0.0` or any public GitHub Release.
* Adding package-manager distribution through npm, Homebrew, Scoop, Winget, or
  Chocolatey.
* Configuring every detected assistant without a person selecting and confirming
  it.
* Changing `forge614-shell`.
* Rewriting all existing command text or documentation language.
