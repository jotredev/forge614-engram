# Modular Architecture Implementation Plan

> Follow-up approved after execution: replace the centralized unit/integration test taxonomy below with colocated `<implementation>.test.ts` for every file with behavior, plus additional collaboration suites in the owning functionality's `__tests__`. Keep only genuinely cross-cutting system/architecture checks and shared fixtures at root `tests/`. Type-only/static/re-export files and the minimal CLI bootstrap do not need artificial tests. The original task record below remains historical; the delivery handoff documents the corrected final tree. No product behavior or public API changes are authorized by this correction.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task; this execution mode is already chosen by the user. Do not pause to request another execution choice.

**Goal:** Reorganize the existing program into feature modules, application coordination, external adapters and interfaces without changing its observable behavior.

**Architecture:** Preserve src/index.ts and src/cli.ts as stable entry points. Extract pure rules into modules and concrete SQL/file/process operations into infrastructure. Keep one atomic write coordinator on the existing SQLite connection, with MemoryStore as the compatible facade.

**Tech Stack:** TypeScript, Bun >=1.3.8, existing SQLite/PostgreSQL/MCP dependencies; TypeScript compiler API for architecture tests. No new dependency or framework.

**Spec:** `docs/superpowers/specs/2026-09-17-modular-architecture-design.md` (approved).

## Global Constraints

- Branch refactor/modular-architecture from e28ca32; no commit, staging or push.
- Existing user preference: work in this checkout, not an extra worktree.
- No personal configuration/database reads or writes; use isolated fixtures and disposable PostgreSQL.
- Preserve public src/index.ts symbols, MemoryStore constructor/method signatures, synchronous semantics and src/cli.ts installation entry point.
- Preserve SQLite versions 3/4/5/6, DDL/application_id, snapshots 1/2, hashes, request replay, transaction order, scopes, scoring and errors.
- No semantic search, new behavior, release bump, formatting campaign or generated client-content change.
- Modules must not import app/interfaces/infrastructure or external I/O; infrastructure must not import app/interfaces; app must not import interfaces; interfaces use app and public module entries, not infrastructure.
- No production internal import from src/index.ts. Cross-module imports target that module's index.ts. Use explicit exports and one MemoryError class.
- No duplicate implementations. Temporary root re-export shims are permitted only between tasks and must be removed in Task 4.
- Do not modify docs/es, docs/en or Notion; create docs/handoffs/10-modular-architecture.md including the requested explanatory documentation prompt.

## Files and task boundaries

Task 1 creates modules/{memory,projects,sessions,search,synchronization,workspace,assistants}, shared/errors.ts, architecture checking helpers and SDK contract tests; adapts current imports using temporary root compatibility exports.

Task 2 creates app/memory-store.ts and infrastructure/sqlite/{connection,schema,projects,memory,sessions,search,snapshots,writes}.ts; facade delegates concrete operations instead of moving the old large store unchanged.

Task 3 creates app/{workspace,project-context,synchronization,setup,assistants,index}.ts and infrastructure/{filesystem,git,postgres,assistants} adapters. It splits process/terminal concerns into interfaces/terminal and leaves callable exports for Task 4.

Task 4 creates interfaces/{cli,mcp,tui,terminal}, rewires stable entry points, moves tests into architecture/unit/integration/e2e plus fixtures, enforces the final tree and removes all temporary root shims. It delivers the handoff and final actual-binary verification.

## Task 1: Pure modules and public contract protection

**Files:** Create explicit index/type/rule files under the seven modules in the spec, `src/shared/errors.ts`, `tests/architecture/import-rules.ts`, `tests/architecture/import-rules.test.ts`, `tests/unit/public-api.test.ts`, and a compile-time SDK contract fixture. Modify domain.ts, identity.ts, sessions.ts, retrieval.ts, sync-snapshot.ts, memory-protocol.ts, workspace-config.ts, assistants/catalog.ts/hooks.ts and index.ts as necessary to extract their pure portions. Retain root wrappers temporarily so other tasks stay runnable.

**Interfaces:** Preserve exact existing exported domain/session/retrieval types. modules/projects exports projectIdentity; modules/sessions exports sessionIdentity and summaryContent; modules/search exports searchTerms and validateSearchLimit; modules/synchronization exports the current snapshot types/validation/hash/reconcile functions. modules/workspace owns WorkspaceSettings. modules/assistants owns client metadata/protocol and pure generated hook/plugin templates. Infrastructure-dependent detection/configuration stays outside modules. shared/errors owns the single MemoryError definition.

- [ ] Before edits, capture the public runtime export names and public MemoryStore method signatures from base e28ca32. Create a committed-to-worktree test fixture with these literal expectations (not calculated from the implementation under test); exclude TypeScript private methods from the public manifest.
- [ ] Add import-policy tests using the following new test-helper contract; run them RED before implementation:

```ts
// tests/architecture/import-rules.ts
export function auditImports(files: Record<string, string>): string[];
// paths are repository-relative; values are TypeScript source texts.
// Test literals:
expect(auditImports({"src/modules/memory/index.ts":
  'import {Database} from "bun:sqlite";'})).not.toEqual([]);
expect(auditImports({"src/modules/projects/index.ts": "export type ProjectId = string;",
  "src/modules/memory/index.ts": 'import type {ProjectId} from "../projects";'})).toEqual([]);
```

- [ ] Implement the helper with TypeScript AST traversal, not regex matching. Collect import/export declarations, import-equals/require and literal dynamic imports; resolve relative `.ts`/`index.ts` targets and compiler options, report unresolved local source imports, forbidden boundary edges and component cycles. Type-only edges count. Explicit pure built-in dependencies such as node:crypto/node:util are permitted in modules; external effectful packages are not implicitly trusted. Test positive/negative cross-module barrel/deep imports, type-only imports, reexports, dynamic literals, cycles and forbidden interface/infrastructure edges using virtual files. Final real-tree assertion arrives in Task 4, not a broad legacy allowlist.
- [ ] Extract the existing pure logic without rewriting it. Example public entry contract:

```ts
// src/modules/projects/index.ts
export type { Project } from "./types";
export { projectIdentity } from "./identity";
// src/shared/errors.ts keeps the existing class implementation verbatim.
// Temporary src/identity.ts:
export { projectIdentity } from "./modules/projects";
```

- [ ] Keep user-visible text, validation order, summary rendering and hash construction byte-compatible. Modules import other modules only via public entries. Update fixture imports without altering copied format-1 validator logic or attribution.
- [ ] Add SDK behavioral checks through src/index.ts: error instanceof identity, project/save/read/version/replay and exported type fixture compiled by tsc. Avoid asserting on implementation-private prototype members. Assert module validation rejects the same invalid IDs and accepts the same Unicode boundary.
- [ ] Run `bun test tests/architecture tests/unit tests/store.test.ts tests/sessions.test.ts tests/retrieval.test.ts tests/sync.test.ts`, `bun run typecheck` and `git diff --check`. Gate: pure modules with exact public behavior, legacy callers still work; no commits.

## Task 2: SQLite operations and compatible facade

**Files:** Create `src/app/memory-store.ts`, `src/infrastructure/sqlite/connection.ts`, `schema.ts`, `projects.ts`, `memory.ts`, `sessions.ts`, `search.ts`, `snapshots.ts`, `writes.ts`; modify src/store.ts to a temporary re-export, source callers and affected tests. Move existing SQLite implementation pieces, not copies.

**Consumes:** Task 1 module entries and shared MemoryError. **Produces:** app/memory-store exports the same MemoryStore class constructor and complete public methods captured by Task 1. SQLite helpers take one private Database and return existing module contracts; no Database in public SDK signatures.

- [ ] Add a facade regression extending existing atomicity fixtures: force session-entry or summary-pointer insertion to fail, compare memory/history/events/requests/session tables before/after, then close/reopen through MemoryStore to verify persisted state. Use existing real Database trigger fixtures, never production test hooks. Run focused regression before extraction as characterization; architecture boundary test for new app facade must initially fail if it directly imports bun:sqlite.
- [ ] Extract connection/open/close/schema helpers with the same create/readonly/permission behavior. Preserve exact DDL strings: schema validation compares stored SQL definitions. Keep constructor cleanup on initialize failure.
- [ ] Separate read/project/session/snapshot helpers from the write coordinator. The coordinator consumes the same connection and captures the same request clock. Its sequence must remain:

```text
BEGIN IMMEDIATE
  optional project resolution/binding
  validate request and resolve exact replay before session selection
  verify expected version and selected session
  write memory/version/event/request/session entry
  if new summary, update pointer (never on replay)
COMMIT
```

Retain existing relative validation order within that sequence. Leaf helpers must not independently commit; composite operations must roll back everything. Do not add one connection per file.
- [ ] Implement MemoryStore as explicit typed forwarding methods to the private SQLite operations, not inheritance exposing adapter internals or a generic dynamic dispatcher. Existing signatures/defaults/error paths remain. Do not add a generic repository/unit-of-work framework. Coordinate cross-feature SQL under writes.ts because atomicity is a storage responsibility.
- [ ] Move full and preview search onto shared scoped predicate/order helpers. Preserve SQL now behavior, FTS projection limits, literal streaming and archived/shared visibility. No performance or formula redesign.
- [ ] Run `bun test tests/store.test.ts tests/sessions.test.ts tests/retrieval.test.ts tests/projects.test.ts tests/shared.test.ts tests/sync.test.ts tests/unit`, `bun run typecheck`, and actual disposable PostgreSQL sync tests. Gate: same API/transactions, facade no SQL, source modules no I/O; no commits.

## Task 3: Application coordination and external adapters

**Files:** Create app/workspace.ts, project-context.ts, synchronization.ts, setup.ts, assistants.ts, index.ts; infrastructure/filesystem/{paths,workspace-config,private-files}.ts; infrastructure/git/project-directory.ts; infrastructure/postgres/replica.ts; infrastructure/assistants/{catalog,configuration,self-test}.ts; interfaces/terminal/sync-watch.ts. Adapt existing root paths as temporary re-exports until Task 4 and all affected imports.

**Consumes:** Task 1 public module entries and Task 2 MemoryStore facade. **Produces:** app/index explicitly exposes existing workspace/configuration, project-context, sync and assistant use cases for interfaces. WorkspaceConfig remains the same public class re-exported from its concrete adapter. runSetup keeps SetupIO. syncWorkspace/synchronize retain their argument/return shapes; watchSync retains terminal behavior in interfaces/terminal.

- [ ] Add boundary regressions before moving: architecture tests reject infrastructure importing app MemoryStore and app importing terminal implementation. Ensure existing workspace-database dependency is resolved by returning a validated/open adapter handle or an injected opener, never importing the app facade backward. Example rule fixture:

```ts
expect(auditImports({
  "src/infrastructure/sqlite/open.ts": 'import {MemoryStore} from "../../app/memory-store";',
  "src/app/memory-store.ts": "export class MemoryStore {}",
})).not.toEqual([]);
```

- [ ] Move filesystem operations and Git subprocesses behind adapters, preserving canonical common/worktree paths, timeouts, environment filtering and all safe-file checks. Application project-context calls those adapters and the store without weakening atomic project/save resolution.
- [ ] Move PostgreSQL transport unchanged; keep snapshot normalization/hash/reconciliation in the pure module. app synchronization owns open/close and publish/apply sequencing. Move watch output, signal handlers and delays to terminal interface; preserve foreground exit codes and retry messages.
- [ ] Split assistant metadata/pure generation from executable/path/config I/O. Module catalog contains data and validation only; infrastructure reads files and launches bounded self-test; app coordinates. The self-test must consume tool-name contract without importing interfaces: put transport-neutral expected tool names in an appropriate module contract, re-export from interface catalog if necessary, without duplicating literals in production. Independent test expected names remain literals.
- [ ] Keep app/setup orchestration and injected SetupIO, with terminal adapter outside app. Expose app entry functions for TUI; remove TUI filesystem/process spawning only in Task 4 where its callers move. Preserve generated plugin bytes, backups, cancellation and secret-redaction behavior.
- [ ] Run workspace/config/setup/project-context/assistant-config/assistant-hooks/TUI/postgres focused suites, typecheck and diff check. All moved code remains callable from existing CLI. Gate: no infrastructure→app cycles; no app output/process-terminal ownership; no commits.

## Task 4: Interfaces, organized tests, enforced tree and documentation handoff

**Files:** Create interfaces/cli/{main,arguments,help,commands}.ts (split commands by family only when substantial), interfaces/mcp/{server,schemas,tools}.ts plus focused handler families, interfaces/tui/{controller,render}.ts and interfaces/terminal/setup.ts/hooks.ts; reduce src/cli.ts and update src/index.ts. Move all old tests to architecture/unit/integration/e2e; keep fixtures and update scripts/install.sh only if required to preserve src/cli.ts. Remove obsolete root compatibility wrappers. Add docs/handoffs/10-modular-architecture.md.

**Consumes:** Task 3 app/index and module public entries. **Produces:** Same standalone CLI and SDK, enforced acyclic boundaries, no legacy root production files except cli.ts/index.ts.

- [ ] Write actual-tree architecture assertion and stable runtime export/API assertion first, confirm legacy tree/imports fail until fully wired. Existing CLI/MCP/installation tests characterize all observable behaviors; preserve independent expected tool lists and generated-config behavior assertions.
- [ ] Split CLI parser/help from command dispatch and MCP lifecycle/schema/handler responsibilities without changing JSON schemas, errors or stdio cleanup. The root entry remains minimal:

```ts
// src/cli.ts (main owns existing error/exit handling)
import { main } from "./interfaces/cli/main";
await main(process.argv.slice(2));
```

No top-level storage creation. Avoid app↔interfaces cycles when switching mcp/tui commands: interface CLI can import sibling interface entry points, while app never imports them. Preserve installer build path and binary name.
- [ ] Move TUI and terminal I/O, using app functions for assistant discovery/configuration/server self-test; retain responsive cancellation, raw-mode restoration and bounded render. Move hook command stdin/stdout handling to interface; pure templates and protocol stay in modules.
- [ ] Organize tests by what they execute: pure validators/reconciler under unit; actual SQLite/files/PostgreSQL/component tests under integration; spawned CLI/MCP/install/PTY under e2e. Split mixed files only when it preserves all cases/cleanup. Update import.meta.dir and child-process source/preload paths explicitly; keep fixtures shared. Do not change test environment safety.
- [ ] Remove temporary root wrappers and update all remaining imports, including compiled test fixtures and the attributed format1 fixture. Add final real-source `auditImports` gate and positive/negative tests for every enforced boundary; no generic allowLegacy switch in the final gate.
- [ ] Run full suite with `FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test`, typecheck, diff check and installed-binary tests. If the disposable binary path is absent, prepare an isolated replacement, never use user PostgreSQL. Confirm all baseline behaviors retained, no copied old/new implementations, public API/type manifest stable, no package version/dependency/DB format change. Include actual failures/skips honestly in report.
- [ ] Write handoff with actual final tree, source move map, pattern rationale/alternatives/tradeoffs, import rules, save/search/sync flow, safe extension examples, test groups/commands/results, API/deep-import compatibility, and no functional-change statement. Include a ready-to-paste bilingual-docs/Notion prompt explicitly satisfying all ten documentation requirements from spec section9; do not edit those docs yourself. State architecture is modular monolith, not full hexagonal/DDD/microservices.
- [ ] Complete independent task review, broad final review and controller fresh verification. Leave all changes uncommitted in branch; user handles docs/commit/push.

## Self-review

All spec sections map to tasks: modules/dependencies Task1 and finalgate4; SQLite/atomicity Task2; external I/O/application Task3; interfaces/test organization/handoff Task4. Temporary wrappers are a sequencing mechanism, not final compatibility policy. Exact existing public signatures are captured before extraction instead of redefined in this plan. No change requires a new database migration or dependency. No execution-mode question remains: the user explicitly requested implementation with the agreed workflow.
