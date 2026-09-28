# Installer PATH and Setup Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A verified release installer makes `forge614-engram` available in a newly opened terminal, then successful interactive setup opens the existing confirmed assistant selection.

**Architecture:** Keep both release installers as the only download-and-checksum path. Add idempotent PATH publication after atomic binary installation. Reuse the assistant TUI rather than adding another MCP configuration flow.

**Tech Stack:** Bash, PowerShell, TypeScript, Bun test, existing assistant TUI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-19-installer-path-setup-onboarding-design.md`

## Global Constraints

- Preserve release artifact names and SHA256 verification.
- Never touch `forge614-shell`.
- Never configure MCP, hooks, assistants, projects, or memory without selection, preview, and confirmation in the existing TUI.
- `init`, `assistant-list`, and noninteractive commands remain noninteractive.
- Unix default is `$HOME/.local/bin`; Windows default is `%LOCALAPPDATA%\\Forge614\\bin`.
- Support Bash, zsh, fish, and Windows user PATH without duplicates.

## Review Focus

- Preserve unrelated shell configuration and publish a custom `--bin-dir` exactly once.
- Keep a verified Windows executable when PATH configuration cannot be written.
- Never open assistant onboarding after cancelled setup, `init`, or non-TTY invocation.

### Task 1: Unix PATH publication

**Files:** Modify `scripts/install.sh` and its sibling `scripts/__tests__/install.sh.test.ts`.

**Interfaces:** Add installer-local `publish_path_for_future_shell "$bin_dir"` after verified binary publication.

- [ ] Write failing fixture tests that run the installer twice in temporary HOME directories with `SHELL=/bin/zsh`, `/bin/bash`, `/usr/bin/fish`, and `/bin/unknown`. Assert one marker block named `# >>> forge614-engram PATH >>>`, preservation of unrelated configuration, custom-directory use, and manual guidance with untouched files for unknown shells.
- [ ] Run `bun test scripts/__tests__/install.sh.test.ts`; expect the new fixtures to fail because the current installer never writes PATH configuration.
- [ ] Implement marker replacement with `awk` and a temporary file. Target `.zshrc` for zsh, `.bashrc` for Linux Bash, `.bash_profile` for macOS Bash, and only `.config/fish/conf.d/forge614-engram.fish` for fish. Use the resolved `bin_dir`, remove only an existing complete Forge614 marker block, append exactly one escaped export command, and state that a new terminal is required. Do not guess unknown shell files.
- [ ] Run `bun test scripts/__tests__/install.sh.test.ts` and `bash -n scripts/install.sh`; expect all existing checksum, overwrite, HTTPS, and no-`.forge614` tests to stay green.
- [ ] Commit with `git add scripts/install.sh scripts/__tests__/install.sh.test.ts && git commit -m "Add PATH setup to Unix release installer"`.

### Task 2: Windows user PATH publication

**Files:** Modify `scripts/install.ps1` and `scripts/__tests__/install.ps1.test.ps1`.

**Interfaces:** Add `Publish-UserPath -Directory $resolvedBinDir` with injectable reader/writer script blocks for fixture isolation.

- [ ] Write failing PowerShell fixtures using an in-memory path reader/writer. Assert existing `C:\\Tools;C:\\Existing` entries remain, `c:\\tools\\Forge614\\bin` appends once, a second `C:\\TOOLS\\forge614\\BIN` call does not duplicate it, and a writer exception after binary move retains the binary and prints manual guidance.
- [ ] Run `pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1` on Windows; expect failure because `Publish-UserPath` is missing.
- [ ] Implement `Publish-UserPath` with `[Environment]::GetEnvironmentVariable('Path', 'User')` and `[Environment]::SetEnvironmentVariable('Path', $value, 'User')`. Split on semicolons, compare normalized trailing-slash entries with `-ieq`, preserve all existing entries, append only a missing directory, then broadcast the ordinary user-environment change notification. Never use `setx`, elevation, machine scope, or overwrite PATH with one directory. Call it after `[System.IO.File]::Move`; catch its failure and retain the installed binary.
- [ ] Run the PowerShell fixture again on Windows; expect AMD64, ARM64, checksum, overwrite, PATH append, deduplication, and fallback checks to pass.
- [ ] Commit with `git add scripts/install.ps1 scripts/__tests__/install.ps1.test.ps1 && git commit -m "Add user PATH setup to Windows installer"`.

### Task 3: Setup-to-assistant-TUI handoff

**Files:** Modify `src/interfaces/terminal/setup.ts`, `src/interfaces/terminal/setup.test.ts`, `src/interfaces/cli/commands.ts`, and `src/interfaces/cli/commands.test.ts` only if runner injection is needed.

**Interfaces:** Export `completeSetup(run, openAssistants)`. It returns the existing setup cancellation result and calls `openAssistants` exactly once only after successful setup.

- [ ] Write failing tests where cancelled setup leaves `opened === 0`, while completed setup makes `opened === 1` even if assistant selection later cancels. Also pin that `init` stays JSON-only and creates no assistant configuration.
- [ ] Run `bun test src/interfaces/terminal/setup.test.ts src/interfaces/cli/commands.test.ts`; expect failure because this handoff does not exist.
- [ ] Implement `completeSetup` around the existing `runSetup` result. Let readline clean up before `assistantTui()` begins. Set exit 130 only for cancelled storage setup; escaping assistant selection after successful memory setup must leave success. Do not duplicate detection, MCP planning, schema-5 enrollment, backups, or hooks: the existing TUI remains their only owner.
- [ ] Run `bun test src/interfaces/terminal/setup.test.ts src/interfaces/cli/commands.test.ts src/interfaces/tui/__tests__/assistant-tui.integration.test.ts src/interfaces/tui/__tests__/assistant-tui.e2e.test.ts`; expect setup cancellation to remain storage-free and assistant cancellation to preserve initialized storage.
- [ ] Commit with `git add src/interfaces/terminal/setup.ts src/interfaces/terminal/setup.test.ts src/interfaces/cli/commands.ts src/interfaces/cli/commands.test.ts && git commit -m "Open assistant setup after memory onboarding"`.

### Task 4: Verify release contract and record evidence

**Files:** Create `docs/handoffs/17-installer-path-setup-onboarding.md`; modify prior files only for a narrowly observed verification defect.

- [ ] Run the complete local gates: `bun test`, `bun run typecheck`, `git diff --check`, and `bash -n scripts/install.sh scripts/install-from-source.sh`. Report PostgreSQL skips separately.
- [ ] Push the branch and verify native Windows runs `pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1` without changing the real runner user PATH.
- [ ] Run `release.yml` manually from the branch. Confirm six artifacts, Windows native addon loading, isolated Windows `assistant-list`, six valid SHA256 entries, and skipped publication.
- [ ] Write the handoff with exact changed files, official curl/PowerShell commands, PATH behavior, assistant-confirmation rule, run URLs, and clean-machine limitation. Do not claim a public release exists without a pushed `v*` tag.
- [ ] Commit with `git add docs/handoffs/17-installer-path-setup-onboarding.md && git commit -m "Document installer path and setup onboarding"`.

## Plan Self-Review

- Tasks 1–4 cover Unix PATH, Windows PATH, confirmed assistant onboarding, and release validation from the approved design.
- Each review-focus risk has an owning task and test.
- No unfilled implementation markers remain.
- New behavior is limited to installer-local helpers and a terminal-local coordinator; MCP/TUI internals are unchanged.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-19-installer-path-setup-onboarding.md`. Use **Subagent-driven** execution: platform PATH writes and terminal onboarding need independent checks after each task.
