# Single workspace and shared memory implementation plan

> Execute inline using executing-plans and test-driven-development in the user's
> prepared feat/project-identity checkout. Do not create another branch or commit.

**Goal:** one config/database, projectId identity, project/shared memory scopes.
**Architecture:** workspace config resolves one store; scoped SQLite persistence
enforces ownership and scope-specific uniqueness; CLI/SDK reuse the same store.
**Tech stack:** TypeScript, Bun >=1.3.8, SQLite FTS5, native filesystem API.
**Spec:** docs/superpowers/specs/2026-09-16-shared-memory-design.md

## Global constraints

No migration or deletion of real data/config. No remote backend, wizard, TUI,
MCP, commit/push or bilingual guide edits. Shared scope is always explicit for
mutations; project-only queries cannot read/write other projects or mutate shared.

## Task 1: Scoped database

Files: domain.ts, identity.ts, schema.ts, store.ts, tests/shared.test.ts and existing
store/project tests. Rename idProject to projectId consistently. SaveInput is a
discriminated union: project scope with UUID, or shared scope with projectId null.
SearchScope = 'all'|'project'|'shared'.

- [x] Add tests then run bun test tests/shared.test.ts and observe failures.
  Core assertion: search(a,'SQLite') returns A + shared, not B; scope project
  returns A only; scope shared returns shared only.
- [x] Add DB scope/project pairing CHECKs and partial unique indexes for topics
  and requests. Version 3 rejects 1/2 without modifying them.
- [x] Implement scoped writes/reads, exact ownership, combined search and exact
  topic override. Preserve existing scoring, revisions and transaction behavior.
- [x] Run shared/store/project suites.

## Task 2: One private config and workspace

Files: workspace-config.ts (replaces project-config.ts), workspace.ts (replaces
projects.ts), index.ts; rewritten config/workspace tests.

- [x] Write failing tests: init then create two projects produces only .env and
  engram.db (plus SQLite sidecars); list uses the same database for both.
- [x] Implement WorkspaceConfig read/save/prepare/exists; reject legacy projects/
  and unsupported fields. Use atomic no-replace publication, private permissions.
- [x] Implement MemoryWorkspace init/createProject/listProjects/renameProject/open.
  init validates existing database before publishing config, never recreates a
  missing database when config already exists. Add failure/reconnect tests.

## Task 3: CLI and delivery

Files: cli.ts, cli/install tests, docs/handoffs/05-single-database-shared-memory.md.

- [x] Add CLI tests then implement init and project-id/scope flags. Reject db,
  id-project, per-project connect and scope misuse before any writes.
- [x] Update compiled smoke test to use safe read-only validation without writing
  into real user storage; run concurrency tests repeatedly.
- [x] Independent code review; reproduce/fix findings with regression tests.
- [x] Full bun test, bun run typecheck, git diff --check and handoff. Mark older
  design/handoff superseded so documentation does not perpetuate per-project DBs.

## Verification evidence

- Full suite: 65 tests pass, 0 failures, 483 assertions on macOS/Bun 1.3.8.
- TypeScript and git diff --check pass.
- Post-fix concurrency rerun: 45 tests pass, 0 failures (15 repetitions).
- Independent review completed; database/sidecar link rejection finding fixed
  with regression tests and re-reviewed. No important findings remain.
- Real user storage untouched; no installation, commit, push or cloud access.
- Current handoff: docs/handoffs/05-single-database-shared-memory.md.
