# MCP, assistant integration and TUI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Connect five coding assistants to local memory with a terminal UI and event-driven reminders.
**Architecture:** Embedded stdio MCP, local SQLite project bindings, independently tested configuration adapters and hook handlers, keyboard TUI. No network server and no extra model.
**Tech Stack:** TypeScript, Bun >=1.3.8, SQLite/FTS5, official MCP TypeScript SDK, pinned JSONC/TOML parsing dependencies if required.
**Spec:** docs/superpowers/specs/2026-09-16-mcp-assistant-tui-design.md

## Global Constraints

- Work in existing feat/mcp-assistant-tui branch; no commit, push, PR or real user configuration changes. Tests use temporary user roots.
- One ~/.forge614/.env and one ~/.forge614/engram.db; local reads never require PostgreSQL. No files in user projects.
- Five clients: Claude Code, Codex, Cursor, OpenCode, Gemini CLI. No silent replacement of existing settings, hooks, plugins or instructions.
- projectId by default; shared only explicit global intent. Ambiguity is an error, not permission to guess.
- Installer from repository, standalone compiled binary. No runtime requirement for npm or a second model.
- Preserve existing CLI/SDK interfaces and PostgreSQL snapshot format. Additive schema upgrades only through explicit enrollment.
- Documents in docs/es and docs/en belong to the user's documentation model. Deliver a handoff prompt, do not edit them.

### Task 1: Local project bindings and stdio MCP

**Files:** create src/project-context.ts, src/memory-protocol.ts, src/mcp.ts; modify src/schema.ts, src/store.ts, src/cli.ts, package.json, bun.lock; create tests/project-context.test.ts and tests/mcp.test.ts.

**Interfaces:** `enableAssistantIntegration()` on MemoryStore explicitly adds local binding schema; `resolveProjectContext(store, directory, create)` returns `{projectId: string|null, directory: string, source: string}`. `startMcp()` starts stdio server and owns its store lifecycle. `MEMORY_PROTOCOL` string is shared by server, hooks and instructions. `forge614-engram integration-enable` is a scriptable explicit enrollment command; TUI later calls the equivalent service after confirmation.

- [x] Write failing tests exercising real SQLite: local path registration, read-only resolution, nested git directories, worktrees, ambiguous same-name existing projects, missing directory, no shared fallback. Example assertions:
  ```ts
  const first = resolveProjectContext(store, repo, true);
  expect(resolveProjectContext(store, child, false).projectId).toBe(first.projectId);
  expect(store.listProjects()).toHaveLength(1);
  ```
- [x] Run new test files before implementation and record expected failures.
- [x] Implement schema version 5 as exact base+sync_checkpoints+project_bindings, upgrading only schema 3/4 explicitly. Support opening 3/4/5. Version5's local path rows never appear in sync snapshots. Atomic get-or-create under SQLite transaction; retain original UUIDv4 identity. Provide explicit binding operation with existing UUID and validated directory for ambiguous cases, not fuzzy name merging. Resolve Git common directory for worktrees, forbid home/filesystem root, canonicalize real directories; use spawn argument arrays and disable optional Git locks.
- [x] Pin SDK dependency and inspect its actual API before using. Register memory_current_project, memory_search, memory_get, memory_save, memory_history with strict bounded schemas. Resolution uses explicit directory, single client root, or validated project cwd. Multi-root ambiguity fails. Read-only requests do not create projects. Save creates binding and memory atomically so rejected saves leave no project. Shared requires explicit scope and a nonempty global-intent explanation; never pretend this proves user consent. Get/history enforce owner identity. memory_save retains expectedVersion and requestKey semantics.
- [x] Add MEMORY_PROTOCOL covering orientation/search, save triggers, title/what/why/where/learned, privacy, project-vs-shared, incremental update, session summary before close and recovery after compaction; no promise of flawless model adherence.
- [x] Wire mcp and integration-enable commands without affecting other dispatch paths. stdout exclusively protocol. Bounds on requests and root resolution, sanitized errors, SQLite close on EOF/signals. No PostgreSQL network from MCP. No implicit enrollment from mcp startup.
- [x] Test using official SDK client over stdio with temporary home: initialize, list tools, save/search/get/history, shared restrictions, mismatch owners, restart persistence, EOF. Repeat handshake against compiled executable. Run bun test + typecheck. Record commands/results and diff in report.

### Task 2: Five safe integration adapters and native event reminders

**Files:** create src/assistants/catalog.ts, src/assistants/configuration.ts, src/assistants/hooks.ts, src/assistants/files.ts; modify src/cli.ts; create tests/assistant-config.test.ts, tests/assistant-hooks.test.ts. Dependencies only pinned and lockfile updated.

**Interfaces:** `detectAssistants(options)` returns five descriptors and detection/configuration/automation status; `planAssistantConfiguration(id, executable, options)` returns immutable preview; `applyAssistantConfiguration(plan)` validates expected bytes and publishes only selected changes; `runMemoryHook(client)` consumes bounded stdin and writes native hook output. Paths/home/env are injectable, defaulting to ordinary user paths, not test variables. Hook CLI: `forge614-engram memory-hook --client <claude-code|codex|cursor|gemini-cli>`.

- [x] Write failing fixture tests: third-party MCP entries and hooks survive, identical plan is idempotent, changed bytes reject, corrupt/duplicate-key files reject, symlinks reject, unconfirmed preview is read-only, private backups preserve exact bytes. Real effect assertion example:
  ```ts
  const plan = planAssistantConfiguration('cursor', executable, options);
  expect(readFileSync(config, 'utf8')).toBe(original);
  applyAssistantConfiguration(plan);
  expect(JSON.parse(readFileSync(config,'utf8')).mcpServers.other).toEqual({command:'existing'});
  ```
- [x] Run failures; implement read-only detection via PATH/application locations/config evidence. Distinguish stale config from executable detected. Honor documented client path overrides; ambiguous config locations block modification. Explicit custom location works without executing its content.
- [x] Implement JSON/JSONC edits with syntax-aware preservation; TOML validate then narrowly append only absent server table, verify semantic roundtrip and original unrelated text. Reject a differing existing forge614-engram entry. Preserve user policies/trust/approvals. No generic whole-file pretty-print rewrite. Locked bounded reads, private exact backups, guarded atomic writes and revalidation. Per-file transactions, explicit partial results across files; no rollback over external edits.
- [x] Add adapters: Claude global ~/.claude.json mcpServers and ~/.claude/settings.json hooks; Codex config.toml mcp_servers plus hooks.json (detect inline-hook duplication); Cursor ~/.cursor/mcp.json plus hooks.json; OpenCode global opencode.json/jsonc mcp local entry plus own uniquely named plugin; Gemini ~/.gemini/settings.json mcpServers plus hooks. Use absolute binary path, safely quoted hook command, no secrets or fixed project cwd. Do not silently enable globally disabled hooks or excluded MCPs; report blockers.
- [x] Verify official hook contracts. Claude/Codex SessionStart+UserPromptSubmit; Gemini SessionStart+BeforeAgent; Cursor sessionStart; OpenCode system prompt transformation and experimental.session.compacting plugin. Hooks add bounded static protocol/reminders, never parse/save transcript content or invoke an LLM. Start/recovery instructions ask assistant to call memory_current_project and memory_search. OpenCode plugin uses embedded constant, preserves existing prompt/context arrays, contains no dependency requiring user install. Existing plugin file different means conflict.
- [x] Test native hook subprocesses with synthetic payloads for each event, malformed/oversized input, EOF and errors; no hang, data save, secret logging or forced continuation loop. Test plugin actual exported callbacks with synthetic official-shaped events. All config writes exclusively isolated fixtures. Run tests + typecheck, report per-client coverage and live-session limitations.

### Task 3: Keyboard TUI, installer and release verification

**Files:** create src/assistant-tui.ts and tests/assistant-tui.test.ts; modify src/cli.ts, scripts/install.sh, tests/install.test.ts, package.json; create docs/handoffs/08-mcp-assistant-tui.md.

**Interfaces:** `assistantTui()` invoked by `forge614-engram tui`; consumes Task2 detection/preview/apply services and Task1 enrollment. Reuse terminal safety patterns; raw keyboard adapter and pure state reducer separately testable.

- [x] Write failing reducer and pseudoterminal tests: arrows navigate five assistants, space toggles, refresh sees newly installed fixture, Enter previews, only explicit confirmation applies. Escape/Ctrl+C cancel and restore terminal state. No secrets in rendered output. Example:
  ```ts
  // Drive the real PTY using tests/fixtures/interactive-terminal.ts.
  // Cancelling after selecting an assistant leaves its config byte-for-byte intact.
  expect(readFileSync(config, 'utf8')).toBe(original);
  ```
- [x] Implement narrow TUI with Asistentes/Salir, selectable statuses, refresh, custom executable/config location entry, preview and confirmation. Clamp/reflow small terminals. Distinguish configured from tested; offer bounded self-test of own binary using MCP handshake, not arbitrary third-party command execution. Do not label client session connected based on that self-test.
- [x] On confirmation enroll local schema, then apply selected valid plans; report partial failures. Cancel before confirmation creates no local workspace/config. TUI on an already-configured local workspace must preserve all memories. Return after connection with restart and in-client verification instructions.
- [x] Update installer to scan read-only after compilation, offer opening TUI only in interactive terminals, print follow-up command otherwise. No implicit init/network/dependency install in ordinary noninteractive installation. Existing --bin-dir/--force safety retained. Add machine-readable assistant-list if needed for installer scan.
- [x] Bump version to 0.5.0; update help to remove obsolete blanket statements that MCP is missing, keep limitations accurate. Do not claim all clients live-tested. Produce handoff with commands/schema/errors/hook coverage and documentation prompt.
- [x] Verify bun test, bun run typecheck, git diff --check, standalone CLI installer, MCP compiled handshake, optional isolated real PostgreSQL regression. Independent task and full-branch reviews; no commit/push. Final answer reports actual evidence and remaining limitations.

## Execution record

Final whole-branch corrections: project-context supplies recorded-path availability
checks inside the store's first-creation transaction; a wholly unavailable bound
project requires explicit binding even after a basename change. Pure store calls
can retain synthetic bindings without filesystem inspection. Unrelated unknown
directories are conservatively blocked too; explicit create/bind is recovery.
Path recreation cannot be distinguished reliably using path evidence alone.

Configuration publication now safely re-reads exact planned bytes. A published
but unverified path remains in appliedPaths and appears in unverifiedPaths;
backups remain, ok=false/PUBLISHED_UNVERIFIED, with no external-edit rollback.

The optional TUI own-server action uses real SDK initialize/listTools against the
resolved installation, separates own result from untested client sessions, and
does not enroll storage. Its 5s deadline covers normal shutdown; forced child
cleanup gets at most 250ms reap grace. Tests cover compiled success, failure,
startup/shutdown deadlines, runtime refusal, responsive cancellation and terminal
EOF/error cleanup. The final-fix report contains evidence; root adds final totals.

Worktree: existing user branch workflow in the shared checkout; no second checkout
created. The user approved implementation in this branch. Reviews inspect worktree
diffs rather than commits because user has not authorized commits.
