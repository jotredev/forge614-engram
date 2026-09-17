# Delivery handoff 09: progressive memory sessions

## Final verified state

Implemented on `feat/ranked-memory-context`; no commit, staging, push, personal
assistant configuration change or personal database migration was performed.
Final independent whole-branch review and scoped fix review approved the changes.
After the final CLI-help and normalized-ID fixes, the controller ran
`FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test`:
**250 passed, 0 failed, 0 skipped, 1506 assertions, 18 files, 32.46 seconds**.
PostgreSQL 17.6 integration actually executed in disposable loopback databases.
`bun run typecheck` and `git diff --check` passed. This final result supersedes
earlier intermediate counts below, which remain labeled as historical evidence.

Implementation clarifications: oversized merged snapshots report `SYNC_TOO_LARGE`
rather than an ordinary history conflict; project MCP saves add session metadata
to the existing flat response instead of replacing it with an envelope. Strict
consumers must allow those extra fields and recognize the capacity error. Shared
responses still exclude private session origins. Local review evidence is retained
outside tracked files because the work remains uncommitted.

## Delivered surface

Sessions are an explicit schema-6 enrollment: run `forge614-engram sessions-enable`. Existing schema 3/4/5 workspaces are not migrated by `mcp`, initialize/list/read operations, or ordinary memory commands. `integration-enable` remains the schema-5 assistant/binding enrollment. Peer devices must install a compatible build, run `sessions-enable`, and then sync. A format-1 PostgreSQL replica is promoted only with `sync --upgrade-format`; `sync-watch --upgrade-format` is rejected. Promotion is CAS-protected and is never automatic. This handoff makes no release/version promise.

CLI additions are noninteractive:

```text
sessions-enable
session-start --directory <path> --session-id <id>
session-end --project-id <uuid> --session-id <id>
session-summary --project-id <uuid> --session-id <id> --summary-json <json>
                --request-key <key> [--expected-version <n>]
timeline --project-id <uuid> --session-id <id> --id <memory-id>
         --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <uuid> | --scope shared] [--compact] [--max-bytes <1024..65536>]
search <existing options> [--preview]
get <existing options> [--version <n>]
save <existing options> [--session-id <id>]
     shared session saves also require --session-project-id <uuid>
sync [--upgrade-format]
```

`--preview`, `--compact`, and `--upgrade-format` are no-value flags. Plain `search`, `get`, and `save` retain their old JSON and independent-save behavior. Preview search returns `PreviewResult[]`; versioned get returns `VersionRead`; context returns `ContextResult`. Summary JSON accepts exactly `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, and `files`. `goal` must be nonempty; the other narrative strings may be empty; `files` is a string array.

MCP registers exactly ten tools: `memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, and `memory_timeline`.

MCP parameters and defaults:

| Tool | Parameters |
| --- | --- |
| `memory_current_project` | optional `directory`; otherwise one client root or safe Git cwd |
| `memory_search` | `query`; optional `directory`, `limit` 1–50 (default 10), `scope` all/project/shared (default all) |
| `memory_get` | `id`; optional `directory`, `scope` project/shared (default project), `version` ≥1 |
| `memory_save` | `title`, `content`, `type`; optional `directory`, `scope` (default project), `topicKey`, `pinned`, `expectedVersion`, `requestKey`, `sessionId`; shared requires `globalIntent`, and a shared session requires both `sessionId` and `sessionProjectId` |
| `memory_history` | `id`; optional `directory` and `scope` (default project) |
| `memory_session_start` | `sessionId`, optional `directory`; ID is 1–200 Unicode code points with no control/format characters or exterior whitespace |
| `memory_session_end` | `sessionId`, optional `directory` |
| `memory_session_summary` | `sessionId`, strict `summary`, `requestKey`; optional `directory`, `expectedVersion` ≥1 |
| `memory_timeline` | `sessionId`, `id`, `version`; optional `directory`, `before` 0–20 (default 5), `after` 0–20 (default 5) |
| `memory_context` | optional `directory`, `scope: shared`, `compact` (default false), `maxBytes` 1024–65536 (default 16384) |

MCP response shapes use these exact public fields:

- `MemoryVersion`: `id`, `projectId`, `scope`, `topicKey`, `type`, `title`, `content`, `pinned`, `version`, `createdAt`, `updatedAt`.
- Project `memory_save`: the flat `MemoryVersion` fields plus `sessionId` and `sessionSource` (`explicit`, `inferred`, `manual`, or null). Shared save returns only flat `MemoryVersion` fields, so private origin metadata is never exposed.
- `memory_search`: `{format:2, results:[{memory, explanation}]}`. Preview memory replaces `content` with `preview` and `truncated`; explanation contains `mode`, `bm25`, `multiplier`, and `orderScore`.
- `memory_get`: `{memory: MemoryVersion, currentVersion, state}`. A historical `memory.version` is not mislabeled as current.
- `memory_timeline`: `{sessionId, focus, before, after}`; each row is `{memory: MemoryPreview, recordedAt}`.
- `memory_context`: `{format:1, pinned, recent, summaries, omitted:{pinned,recent,summaries}, truncated}`.
- Session start/end: `{sessionId, projectId, kind, startedAt, endedAt}`. Summary: `{memory, sessionId, sessionSource}`. History remains `MemoryVersion[]`; current-project remains `{projectId,directory,source}`.

Save uses assistant inference and the resolved runtime directory. Existing sessions-disabled project saves return null session metadata without migration. Shared saves still require `globalIntent`; a shared session association additionally requires `sessionProjectId`, while owner remains null.

Common errors include `MIGRATION_REQUIRED`, `PROJECT_NOT_BOUND`, `PROJECT_BINDING_REQUIRED`, `AMBIGUOUS_PROJECT`, `AMBIGUOUS_SESSION`, `NO_SESSION_CONTEXT`, `SESSION_CONFLICT`, `SESSION_NOT_FOUND`, `VERSION_CONFLICT`, `REQUEST_CONFLICT`, `SUMMARY_TOPIC_CONFLICT`, `SUMMARY_TOPIC_RESERVED`, and `INVALID_INPUT`. Root/cwd checks and owner checks remain fail-closed.

## Behavior and limitations

At conversation start the assistant should reuse a stable conversation ID or generate one, start it when sessions are enabled, and keep it through compaction. Search results are previews: call `memory_get` before relying on omitted detail. Timeline order is recorded order, not guaranteed causal order across machine clocks. Hooks only remind the model; they cannot guarantee compliance, summary creation, saving, or clean shutdown. MCP transport does not provide a native chat ID. Zero, one, or many inferred sessions respectively mean manual fallback, automatic association, or `AMBIGUOUS_SESSION` requiring an explicit ID.

Previews are bounded in Unicode code points (300 for search/context, 500 focus and 150 neighbor for timeline). `maxBytes` bounds serialized JSON bytes, including metadata. Neither is a token budget. FTS ranking computes `multiplier = 1 + 0.10*pinned + 0.06/(1+ageDays/30)`, with nonnegative `ageDays`, then sorts ascending by `bm25 * multiplier` and finally ID. Literal short-term search uses its separate pinned/updated/ID order and has no BM25 score. Progressive preview/timeline behavior is Gentleman-inspired; UUID identity, explicit/manual per-device sessions, local bindings, and sync promotion are Forge614 adaptations.

Generated OpenCode plugins use experimental callbacks. Existing differing embedded plugin content must be treated as a configuration conflict, never overwritten automatically: inspect the preview, back up the existing file, remove or reconcile it explicitly, then rerun assistant configuration and review the new preview.

## Documentation-model prompt

```text
Update the Forge614 Engram documentation from docs/handoffs/09-progressive-memory-sessions.md. Work on docs/es and docs/en separately, then update the matching Notion pages. Use plain language and put technical terms in parentheses. Do not edit product code, do not commit, and do not push. Document explicit sessions-enable prerequisites, peer-device schema-6 enrollment, and explicit sync --upgrade-format promotion; never imply automatic migration or a guaranteed/new release version. Cover every CLI and MCP command, its output schema, important errors, and examples for zero inferred sessions (manual fallback), one inferred session (automatic association), and many inferred sessions (AMBIGUOUS_SESSION and explicit sessionId). Include explicit globalIntent for shared examples and explain sessionProjectId without changing shared owner=null. State honestly that assistants and hooks may omit saves and cannot guarantee final summaries. Explain preview Unicode code points versus serialized JSON bytes versus client tokens. Correct ranking to 1 + 0.10*pinned + 0.06/(1+ageDays/30), with nonnegative ageDays. Label progressive lookup/timeline behavior as Gentleman-inspired and UUID/manual-per-device/sync behavior as Forge614 adaptations. Include safe OpenCode plugin update guidance: an existing differing generated plugin is a conflict and is not auto-overwritten.
```

## Verification delivered

The installer-produced standalone binary was exercised through the official SDK for session start, project save with session metadata, preview search, full/version read, timeline, context, structured summary, explicit close, and exact save replay after close. The focused final installer run completed **7 pass, 0 fail, 49 assertions** and `bun run typecheck` succeeded. The immediately preceding PostgreSQL 17.6 full run completed **250 pass, 0 fail, 1492 assertions across 18 files**; all eight PostgreSQL integration tests executed rather than skipping, and `git diff --check` succeeded. No personal configuration or database was used. The command record is also retained in `.superpowers/sdd/2026-09-17-progressive-memory-sessions/task-5-report.md`.
