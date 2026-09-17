# Infrastructure colocation report

Production behavior and files were not changed. No commits/staging, personal database/configuration access, global mocks, or imports of test suites were introduced. Read the approved context, TDD skill, and writing-good-tests reference; these are characterization tests of existing implementations, with the controller owning the failing placement gate.

## Existing case ownership

Every original case remains. Compared each relocated integration file against `before.json`: exact equality after only relative-import rewriting (all nine files). Parameterized cases remain parameterized.

| Original | Current owner |
| --- | --- |
| tests/integration/store.test.ts | src/app/__tests__/store.integration.test.ts |
| tests/integration/projects.test.ts | src/app/__tests__/projects.integration.test.ts |
| tests/integration/shared.test.ts | src/app/__tests__/shared.integration.test.ts |
| tests/integration/retrieval.test.ts | src/app/__tests__/retrieval.integration.test.ts |
| tests/integration/sessions.test.ts | src/app/__tests__/sessions.integration.test.ts |
| tests/integration/sync.test.ts | src/app/__tests__/sync.integration.test.ts |
| tests/integration/postgres-sync.test.ts | src/app/__tests__/postgres-sync.integration.test.ts |
| tests/integration/workspace-config.test.ts | src/infrastructure/filesystem/workspace-config.test.ts |
| tests/integration/assistant-config.test.ts | src/infrastructure/assistants/configuration.test.ts |
| tests/unit/postgres-options.test.ts | src/infrastructure/postgres/replica.test.ts |

The first seven suites exercise facade/collaboration behavior. Workspace configuration and assistant configuration suites directly exercise their named adapters. The existing assistant configuration suite retains its detection facade checks alongside its many direct planning/preflight/apply cases; direct catalog tests also cover detection at the adapter boundary. The original PostgreSQL URL case remains and is augmented by a disposable-cluster direct replica test.

## Complete sibling map

Each path below is relative to `src/infrastructure`; every implementation maps to the sibling of the same basename ending `.test.ts`. No implementation exemptions are needed.

| Implementation | Direct behavior protected by sibling test |
| --- | --- |
| assistants/catalog.ts | executable vs stale-config detection; ambiguous OpenCode source selection |
| assistants/configuration.ts | original preview, preflight, apply, backup, stale data, unsafe files, native-client policies and layouts |
| assistants/installation.ts | executable-link resolution; rejection of runtimes/nonexecutables |
| assistants/self-test.ts | cancellation before launch; missing executable MCP failure and bounded cleanup |
| filesystem/paths.ts | user-root/default-database derivation, without opening either |
| filesystem/private-files.ts | exact backup/private publish; stale-preview and symlink rejection |
| filesystem/workspace-config.ts | original global config, permission, stale replacement and no-clobber cases |
| git/project-directory.ts | explicit non-Git identity; nested Git common/runtime identity; unavailable bindings |
| postgres/replica.ts | URL security; direct real-PG publication, stale CAS rejection and reopened persistence |
| sqlite/connection.ts | nested persistence, readonly rejection, missing noncreating open |
| sqlite/memory.ts | owner isolation, ordered immutable history, row translation, invalid text |
| sqlite/projects.ts | normalized/sorted persistence, binding reuse and collision refusal |
| sqlite/schema.ts | explicit additive migration/data preservation, malformed and foreign schema refusal |
| sqlite/search.ts | local/shared topic visibility in FTS/literal paths, archive/version projection, preview/budget bounds |
| sqlite/sessions.ts | runtime binding/repeated close, closed-session rejection, manual reuse and kind restriction |
| sqlite/snapshots.ts | real apply/export/checkpoint, stale local rejection without checkpoint mutation |
| sqlite/workspace-database.ts | private creation, configured missing DB refusal, unsafe sidecar rejection |
| sqlite/writes.ts | original request replay/conflict, archive event idempotency, composite project/binding rollback |

`__test-support__/fixtures.ts` owns disposable in-memory SQLite and filesystem lifetimes; `__test-support__/postgres.ts` owns a disposable PostgreSQL cluster. These are test utilities, exempt from sibling-test requirements. The cluster requires explicit FORGE614_TEST_POSTGRES_BIN and never reads DATABASE_URL. Existing broad-suite cleanup, subprocess paths, and shared fixture usage were preserved.

## Verification

Focused command:

```sh
FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test src/infrastructure src/app/__tests__/store.integration.test.ts src/app/__tests__/projects.integration.test.ts src/app/__tests__/shared.integration.test.ts src/app/__tests__/retrieval.integration.test.ts src/app/__tests__/sessions.integration.test.ts src/app/__tests__/sync.integration.test.ts src/app/__tests__/postgres-sync.integration.test.ts
```

Result: **169 pass, 0 fail, 813 assertions, 25 files**, including real disposable PostgreSQL (2.52 seconds). The initial infrastructure-only run caught an incorrect node:path import in the new installation test; fixed to node:fs before the successful run.

`bunx tsc --noEmit` found no infrastructure diagnostics; at that instant other workers' in-progress app/memory-store and interfaces/mcp/context tests had type errors, reported to controller. Controller owns final typecheck/full-suite verification.

Compared every preexisting `src/infrastructure` implementation against the turn baseline: zero production modifications. No claim of exhaustive branch coverage is made.

## Ownership refinement after initial handoff

Moved the two original discovery/configuration collaboration cases intact into `src/app/__tests__/assistant-configuration.integration.test.ts`: “detection distinguishes stale configs and rescans executables without starting them” and “file symlinks, directories masquerading as files, and nonexecutable overrides are refused.” The new integration owner uses a local disposable-home fixture and preserves every assertion and cleanup operation. Removed the app discovery import from the infrastructure configuration sibling, leaving its direct adapter cases. This supersedes the initial note above about retained facade checks.

Verification: `bun test src/infrastructure/assistants/configuration.test.ts src/app/__tests__/assistant-configuration.integration.test.ts` → **39 pass, 0 fail, 153 assertions**, two files. No production changes.
