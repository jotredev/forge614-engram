# Application worker report

## Implementation → own-file test

All paths below are relative to src. Each test imports its sibling implementation directly.

| Implementation | Test | Behavior exercised |
| --- | --- | --- |
| app/assistants.ts | app/assistants.test.ts | Absent previews cause no writes; malformed client configuration is classified while other clients continue |
| app/memory-store.ts | app/memory-store.test.ts | Facade default shared/project search scope; explicit project filtering; archive/restore forwarding; owned connection close is idempotent and disables operations |
| app/project-context.ts | app/project-context.test.ts | Boolean create validation; explicit binding; session start/save retains selected project |
| app/setup.ts | app/setup.test.ts | All seven existing setup cases, real temporary workspace and scripted SetupIO |
| app/synchronization.ts | app/synchronization.test.ts | Local additions publish/checkpoint, unchanged state does not republish; disabled PostgreSQL rejected before storage open |
| app/workspace.ts | app/workspace.test.ts | All twelve existing workspace cases, real filesystem and SQLite |
| modules/assistants/catalog.ts | modules/assistants/catalog.test.ts | Supported client IDs; OpenCode source-dependent warnings and client-specific warnings |
| modules/assistants/templates.ts | modules/assistants/templates.test.ts | Shell escaping executed in sh; client hook events/timeouts; generated OpenCode module actually executes idempotent callbacks |
| modules/projects/identity.ts | modules/projects/identity.test.ts | UUID version/variant, case, nontext and name rejection |
| modules/search/rules.ts | modules/search/rules.test.ts | Escaping, whitespace, Unicode literal mode, invalid query and inclusive limits |
| modules/sessions/rules.ts | modules/sessions/rules.test.ts | Unicode length boundary/control rejection; summary bytes and invalid structured inputs |
| modules/synchronization/snapshot.ts | modules/synchronization/snapshot.test.ts | Original CAS format normalization; nested canonical ordering; invalid/duplicate snapshots; independent additions and conflicting edits |
| shared/errors.ts | shared/errors.test.ts | Machine code, Error identity and diagnostic name/message/stack |

## No-logic exemptions (complete scope inventory)

- app/index.ts: re-export barrel only.
- modules/assistants/index.ts: re-export barrel only.
- modules/assistants/protocol.ts: static protocol prose only.
- modules/assistants/tools.ts: static tool-name array and derived type only.
- modules/memory/index.ts: re-export barrel only.
- modules/memory/types.ts: type declarations and static memoryTypes array only.
- modules/projects/index.ts: re-export barrel only.
- modules/projects/types.ts: Project interface only.
- modules/search/index.ts: re-export barrel only.
- modules/search/types.ts: type declarations only.
- modules/sessions/index.ts: re-export barrel only.
- modules/sessions/types.ts: type declarations only.
- modules/synchronization/index.ts: re-export barrel only.
- modules/workspace/index.ts: type re-export only.
- modules/workspace/types.ts: WorkspaceSettings interface only.
- src/index.ts: SDK re-export barrel exempt from implementation coverage; src/index.test.ts intentionally preserves public runtime identity/inventory and SDK behavior contracts.

## Existing case preservation and placement

- tests/integration/setup.test.ts → src/app/setup.test.ts, all 7 cases unchanged beyond relative imports.
- tests/integration/workspace.test.ts → src/app/workspace.test.ts, all 12 cases unchanged beyond relative imports. Their principal target is MemoryWorkspace, so these qualify as its direct own-file tests despite real dependencies.
- tests/integration/project-context.test.ts → src/app/__tests__/project-context.integration.test.ts, all 17 executed cases preserved. This broad suite collaborates across app, Git, SQLite and CLI. Repaired all imports, child-process source paths, CLI path and child-only preload path for its new directory. Existing store close-before-directory-removal order remains intact.
- tests/unit/sync.test.ts → src/modules/synchronization/snapshot.test.ts, original normalization case retained; imports now target snapshot.ts directly.
- tests/unit/public-api.test.ts → src/index.test.ts, original SDK inventory and shared error identity retained.
- Original combined case `preserves Unicode session boundary and summary/search bytes` was split without dropping assertions: Unicode 200-character acceptance/201-character rejection → `session IDs count Unicode characters and reject blank, control and exterior whitespace` in modules/sessions/rules.test.ts; exact summary bytes → `summary rendering preserves structured field ordering and file lines` in the same file; exact quoted search result → `search terms trim whitespace and escape quoted literals without treating them as FTS syntax` in modules/search/rules.test.ts.
- tests/integration/public-api.test.ts → src/index.test.ts, original `preserves project save, read, version and request replay through the SDK` remains via actual SDK import.

## Test safety and validation

Read approved context and TDD/writing-good-tests. Characterization only, no production mutation or artificial RED. Controller owns placement RED. All new filesystem fixtures use mkdtemp; SQLite connections close in finally; generated plugin temp file is removed in finally. No global module mocks added, no test imports another test, no personal files used. Existing user-directory preload remains child-process-only. Synchronization uses a local in-memory remote boundary implementing read/publish and checking expected CAS hashes; real SQLite, reconcile and checkpoint paths execute. PostgreSQL integration remains the infrastructure worker's responsibility.

Final focused command:

`bun test src/app/setup.test.ts src/app/workspace.test.ts src/app/memory-store.test.ts src/app/project-context.test.ts src/app/assistants.test.ts src/app/synchronization.test.ts src/app/__tests__/project-context.integration.test.ts src/modules src/shared src/index.test.ts`

Result: 63 pass, 0 fail, 293 expect calls, 15 files, 1.81s.

`bun run typecheck`: no application-owned errors; latest run still reports two concurrent interfaces/mcp/context.test.ts typed expectation errors (lines 11 and 14), notified controller. Full suite is controller-owned and was not run here.

During development, fixture mistakes were corrected after focused runs: remote boundary private constructor replaced by explicit local structural boundary; session fixture starts its session before save; generated module loaded from a temporary .mjs because this Bun version rejected data-URL import; search projection reads item.memory.id. No production behavior was changed to satisfy tests.

No source implementation, config, architecture guard, shared fixture, docs/es, docs/en, personal file, Git staging or commit changes made. Own-file presence does not imply exhaustive branches; tests focus on concrete behavioral failures described above.

## Review correction: assistant template case consolidation

Transferred both ORIGINAL cases from modules/assistants/__tests__/assistant-hooks.integration.test.ts into modules/assistants/templates.test.ts, importing ./templates directly. The original names, assertions, generated module execution and afterEach temporary-root cleanup remain intact:

- `generated OpenCode plugin executes independently and preserves custom system and compaction state idempotently`
- `native hook commands quote binary paths and clients use their own timeout units`

Removed the two overlapping newly introduced case wrappers (`generated OpenCode plugin executes idempotent system and compaction guidance` and `shell quoting makes apostrophes and command substitution literal arguments`). Retained their distinct assertions inside the original cases: explicit double-newline separation, memory_session_start guidance, and executed literal dollar-parentheses shell substitution with exit-status checking. The separate hook-configuration case retains its distinct event routing and full payload assertions. Five cases across two files became three cases in the sibling test: total suite count decreases by exactly two, with both original behavioral cases preserved.

Removed the now-redundant integration file and its empty __tests__ directory. No support files existed there. No production changes.

Verification after consolidation: `bun test src/modules/assistants/templates.test.ts` → 3 pass, 0 fail, 24 expect calls, 1 file, 17ms. `bun run typecheck` → exit 0. Earlier concurrent interface type errors are resolved. Full-suite rerun remains controller-owned.
