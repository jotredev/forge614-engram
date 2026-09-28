# Engram Memory Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one versioned, machine-readable Forge614 Engram memory protocol through the SDK and a non-interactive CLI command.

**Architecture:** A pure `modules/memory-protocol` module owns the immutable version-1 contract and canonical instruction text. SDK and CLI read that one module, so Engines receives the same protocol through either transport and no user data, database, or configuration is opened.

**Tech Stack:** TypeScript, Bun test runner, existing JSON CLI conventions.

**Spec:** `docs/superpowers/specs/2026-09-20-memory-protocol-design.md`

## Global Constraints

- Add no TUI, assistant configuration writer, database schema change, or PostgreSQL autosync service.
- The command is exactly `forge614-engram memory-protocol --json` and never requires a terminal.
- Version-1 protocol ID is exactly `forge614-engram-memory`; version is exactly `1`.
- Shared preferences use existing `shared` scope plus `globalIntent`; project knowledge uses project scope.
- Protocol content forbids passwords, tokens, private keys, credentials, and connection strings containing credentials.
- Existing JSON errors remain stderr with exit code 1; protocol output contains no user memory, path, PostgreSQL setting, or secret.

## Review Focus

- The public command must not initialize `~/.forge614/engram` or create files.
- CLI and SDK must serialize the same exact protocol object.
- Canonical instructions must name compaction recovery and session closure, not only normal saves.
- Command typo or omitted `--json` must fail before reading config or storage.
- Focused tests must catch an accidental change to ID, version, security policy, scopes, or lifecycle requirements.

---

### Task 1: Canonical protocol module and SDK export

**Files:**
- Create: `src/modules/memory-protocol/protocol.ts`
- Create: `src/modules/memory-protocol/protocol.test.ts`
- Create: `src/modules/memory-protocol/index.ts`
- Modify: `src/index.ts`
- Test: `src/index.test.ts`

**Interfaces:** Produces `MemoryProtocol` and `memoryProtocol(): MemoryProtocol`; Task 2 consumes this getter.

- [x] Write a failing test asserting fixed ID/version, canonical `memory_save`, compaction `memory_session_summary`, resume `memory_context`, and the password secret rule.
- [x] Run `bun test src/modules/memory-protocol/protocol.test.ts`; verified failure because the module/export was absent.
- [x] Implement the smallest pure, readonly module. Its instructions cover start, explicit save, shared/project scope, topic keys, compaction, resume, end and secrets.
- [x] Create the module barrel, re-export type/getter from `src/index.ts`, add SDK export test, and run `bun test src/modules/memory-protocol/protocol.test.ts src/index.test.ts`.
- [x] Commit with `feat: publish canonical memory protocol`.

### Task 2: Non-interactive public CLI retrieval

**Files:**
- Modify: `src/interfaces/cli/arguments.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/interfaces/cli/help.ts`
- Modify: `src/interfaces/cli/__tests__/cli.e2e.test.ts`
- Test: `src/interfaces/cli/arguments.test.ts`

**Interfaces:** Consumes `memoryProtocol()` from Task 1 and produces `forge614-engram memory-protocol --json` for Engines.

- [x] Write failing CLI tests that the command returns ID/version JSON without creating `~/.forge614`, and that missing `--json` or an unknown flag returns `INVALID_INPUT` JSON on stderr.
- [x] Run `bun test src/interfaces/cli/__tests__/cli.e2e.test.ts src/interfaces/cli/arguments.test.ts`; verified failure because `memory-protocol` was unknown.
- [x] Add `memory-protocol: ["json"]` to the allowlist; require `--json`; dispatch `memoryProtocol()` before creating `MemoryWorkspace`; add concise help text.
- [x] Run the same focused CLI tests and verify they pass.
- [x] Commit with `feat: expose memory protocol through CLI`.

### Task 3: Whole-contract verification

**Files:**
- Modify: this plan only to mark completed checkboxes.

- [x] Run `bun test`, `bun run typecheck`, `git diff --check`, and `bun src/cli.ts memory-protocol --json`.
- [x] Verify the final CLI output contains only the version-one protocol and leaves product storage absent in a temporary test environment.
- [x] Commit the completed plan record with `docs: record memory protocol implementation plan`.
