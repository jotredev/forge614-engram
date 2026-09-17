# Direct PostgreSQL synchronization implementation plan

Approved scope: SQLite/FTS5 always local; optional direct PostgreSQL replication,
no intermediate server. Setup labels: No; Sí, configurar PostgreSQL. Execute
inline with TDD on feat/postgresql-storage. No commit/push or real credentials.

## Architecture

Use conservative three-way snapshot reconciliation for a personal workspace.
Snapshots carry projects and memory bundles (current row, immutable versions,
request keys and events). The checkpoint lives in the same SQLite database, not
a second DB/file. Compare each entity against the last successful checkpoint.
Concurrent changes to the same entity cause SYNC_CONFLICT and change neither
copy. No timestamp-based winner. Histories must extend, never rewrite, existing
versions. All rows validate before applying. Whole-snapshot size limit 8 MiB.

PostgreSQL owns only forge614_sync: immutable revision payloads addressed by
SHA256 and a singleton head. Validate schema before use. Publish via transactional
compare-and-swap under a row lock. Apply received snapshot/checkpoint in one
SQLite transaction only if local data still matches what was exported. Lost
responses are safe to retry; hashes and three-way reconciliation are idempotent.
No deleting source databases, tables, memories, or revisions.

SQLite version 3 remains valid for local-only use. Explicit sync configuration
adds checkpoint table and advances to version 4 after strict version-3 validation;
both exact schemas remain supported. No implicit migrations on normal reads.

## Tasks

- [x] Pure snapshot types/validation/reconciliation tests and implementation.
- [x] Local export/apply/checkpoint with real SQLite tests: histories, FTS, shared,
      conflicts, rollback, stale local snapshots, additive sync enrollment.
- [x] PostgreSQL URL security and repository with real isolated PostgreSQL tests:
      compatible reuse, incompatible rejection, concurrent CAS, failure recovery.
- [x] Private global config with optional PostgreSQL URL; atomic guarded replacement.
      setup secret input, confirmation before changes, no project menu.
- [x] sync once and sync-watch retry loop; all reads/writes remain local/offline.
      No daemon installation. Explicit sync errors never masquerade as local save errors.
- [x] Independent review, full tests/typecheck/build and documentation handoff.

## Verification evidence

Full suite with isolated PostgreSQL 17.6 and Bun 1.3.8: 90 passed, 0 failed,
645 assertions across 11 files. Includes standalone CLI compilation/installation,
offline writes and watcher interruption. Typecheck and git diff --check passed.
Independent review identified a pre-publication history validation gap; fixed
with a regression test proving a rollback is rejected before publishing.
Documentation prompt: docs/handoffs/07-postgresql-sync.md. No commit or push.

## Tests and constraints

Do not simulate PostgreSQL as final evidence. Use downloaded test binaries in a
temporary directory, loopback-only cluster and temporary user directory. Test
two independent local databases against one PostgreSQL schema. Never accept
untrusted payloads by casting alone. Preserve UUIDs, owner pairs, version chains,
topic/request uniqueness and original snapshots. Never evaluate .env as code.

Limitations to document: personal full-workspace sync, conflict halts until explicit
manual reconciliation, no automatic semantic merge or multiuser authorization,
no infinite-background promise when no sync-watch process runs, no cloud service.
