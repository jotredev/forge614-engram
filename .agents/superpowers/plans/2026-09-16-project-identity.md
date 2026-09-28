# Project identity implementation plan

> Historical/superseded by `2026-09-16-shared-memory.md`: the user requires one
> global .env/database and projectId + project/shared scopes, not project configs.

> Execute inline with executing-plans and test-driven-development. The user
> explicitly prepared `feat/project-identity` in this checkout; preserve it.

**Goal:** stable `idProject` and private configuration, without cloud or migration.
**Architecture:** version-2 SQLite project registry plus identity-scoped memories;
strict private configuration module; configured-project service shared by CLI/SDK.
**Tech Stack:** TypeScript strict, Bun >=1.3.8, bun:sqlite, node filesystem API.
**Spec:** docs/superpowers/specs/2026-09-16-project-identity-design.md

## Constraints

No real database operations, commits, push or bilingual documentation edits.
No automatic migration, reset, replacement of configuration or database fallback.
Use temporary test directories. Keep current retrieval/history behavior.
UUID identity is not authentication. PostgreSQL, wizard, MCP and TUI are deferred.

## Task 1 — Database identity

Files: src/domain.ts, src/identity.ts, src/schema.ts, src/store.ts,
tests/store.test.ts, tests/projects.test.ts.
Interfaces: Project {idProject,name,createdAt,updatedAt};
MemoryStore.createProject(name), getProject(idProject), listProjects(),
renameProject(idProject,name); SaveInput/MemoryVersion.idProject.

- [x] Add tests for generated unique IDs, duplicate names, rename/replay/history,
  unknown identities, and reopening old/malformed databases without changes.
- [x] Run `bun test tests/projects.test.ts` and confirm missing behavior fails.
- [x] Implement schema v2 and strict schema verification without migrations.
  Keep foreign keys, history, scoped request keys and FTS triggers.
- [x] Adapt existing memory tests to real registered UUID projects. Run both suites.

## Task 2 — Private configuration and configured-project service

Files: src/project-config.ts, src/projects.ts, src/paths.ts, src/index.ts,
tests/project-config.test.ts, tests/configured-projects.test.ts.
Interfaces: ProjectConfig {idProject,storage:'sqlite',databasePath};
ProjectConfigs(root?) with save/read/listIds;
ConfiguredProjects(configs?) with create/connect/list/rename/open.
open validates the configured identity and returns an existing low-level
MemoryStore; each memory operation still requires its explicit idProject.

- [x] Add failing tests for private permissions, no replacement, safe parsing,
  traversal/symlink rejection, read-only listing and separate connections.
- [x] Implement strict JSON-quoted dotenv values; do not execute or expand them.
  Atomically publish via exclusive temporary file + no-replace hard link.
- [x] Implement creation and reconnection. If local registration fails after DB
  creation, report the created project ID for explicit reconnect; never delete it.
- [x] Test missing database refusal and unchanged data on repeated connection.

## Task 3 — CLI, regression and handoff

Files: src/cli.ts, tests/cli.test.ts, tests/install.test.ts,
docs/handoffs/04-project-identity.md.

- [x] Add failing CLI tests for project-create/connect/list/rename and memory
  operations using --id-project. Old --project must fail before touching storage.
- [x] Implement commands with argument validation before side effects. Database
  override belongs to project-create/connect, not everyday memory operations.
- [x] Update installer smoke test to exercise the compiled identity-aware CLI without
  writing configuration in the real home directory.
- [x] Test parallel initialization/reconnection and missing/broken configuration.
- [x] Run `bun test`, `bun run typecheck`, `git diff --check`; request code review,
  address issues, and rerun verification.
- [x] Write bilingual documentation handoff prompt with actual commands, API
  changes, storage permissions, non-destructive guarantees and pending roadmap.

## Verification result

- Full suite: 54 passed, 0 failed, 314 assertions (macOS, Bun 1.3.8).
- `bun run typecheck` and `git diff --check`: passed.
- Compiled installer executable tested without Bun on PATH.
- Independent review findings fixed and re-reviewed: literal SQLite internal-name
  prefix matching, hard-link publication interval, configuration root preflight.
- User home and real databases were not used; no commit, push or global install.
