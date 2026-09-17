# Project identity and private configuration

> Historical/superseded: per-project connections were explicitly rejected by the
> user. See `2026-09-16-shared-memory-design.md` for the current approved design.

Status: approved first roadmap step, narrowed after the user confirmed there
are no real memories to migrate. Implemented; verification evidence is in the
corresponding plan and documentation handoff.

## Scope

Implement stable `idProject` identity, a separate editable display name and
private per-project local configuration. Keep TypeScript, Bun and the repository-installed CLI. Do not add
PostgreSQL connectivity, interactive setup, MCP, scoring changes or the TUI.
Do not commit, push, publish documentation or operate on real user databases
during implementation. Tests use disposable directories and databases only.

## Identity

- Generate a UUID for a new project; validate canonical UUIDs before using them
  in paths. Neither a directory name, Git remote nor display name determines it.
- Store the same `idProject` in the database project registry, memory ownership
  and `~/.forge614/projects/<idProject>/.env` configuration.
- Names may repeat. Renaming a project changes its display name, never ownership.
- Connecting an existing project requires selecting its existing `idProject`
  from the database. Never generate an identity for a supposedly existing project.
- Identity is not authorization. Multiuser access control remains out of scope.

## Storage and configuration

- Keep `~/.forge614/engram.db` as the default location for new local storage.
  Projects may explicitly select different local database files.
- The per-project `.env` contains configuration format version, `idProject`,
  storage kind (`sqlite` in this delivery) and an absolute SQLite path.
  The database is the authority for project names; do not duplicate names in
  configuration where they could become stale.
- Do not accept PostgreSQL connections as working configuration in this step.
  Providers and remote credentials belong to the later PostgreSQL step.
- Use a restricted, documented dotenv subset, with quoted values and no shell
  execution, environment expansion or automatic loading into `process.env`.
- Create private directories with mode 0700 and files with mode 0600 on the
  supported macOS/Linux platforms. Reject unsafe symbolic-link configuration
  paths and mismatched IDs. Do not silently repair or overwrite existing files.
- Publish a complete new configuration atomically without replacement. A retry
  with identical configuration may succeed; a conflicting configuration fails.
- Never print configuration values in errors or list results. No telemetry or
  calls to external services. Hidden files are not encrypted.

## Commands and API

Provide noninteractive building blocks now; the setup wizard and TUI will reuse
them later. Implemented CLI surface:

- `project-create --name <name> [--db <absolute-path>]`: explicitly create a
  project in an empty or compatible database and register its local configuration.
- `project-connect --id-project <uuid> --db <absolute-path>`: validate an existing
  project and register it locally; never initialize a missing database.
- `project-list`: list locally configured project identities and availability,
  without creating files or exposing connection configuration.
- `project-rename --id-project <uuid> --name <name>`: explicit display-name update.
- Memory commands select a configured project with `--id-project <uuid>`.
  No implicit active project or working-directory inference in this delivery.
- SDK operations use explicit `idProject` for the new identity-aware API.

Existing name-based commands must not silently select a newly generated UUID.
This is an explicit pre-release API change: `idProject` replaces `project` in
memory input/output; `--id-project` replaces `--project`. Reject old options.
The new API rejects version-1 storage without modification. No compatibility
adapter or migration is needed in this delivery because the user confirmed
there are no real memories. MemoryStore remains the low-level database API;
the configured-project API resolves private configuration and opens existing
databases only. Low-level SDK calls do not implicitly register a local project.

## Transition: deferred, not implemented in this delivery

If real old-format data must be migrated in the future, first review an explicit
copy migration proposal. Do not implement or run the following workflow now:

1. The user stops writers to the old database and explicitly supplies source and
   a new, nonexistent destination. Source and destination must differ.
2. Open the source read-only, verify ownership and version, and obtain a consistent
   SQLite read transaction. Do not copy the database file while ignoring its WAL.
3. Create a new identity-aware database in private staging storage. Generate one
   project UUID for each distinct existing normalized project key.
4. Transfer current memories, all revisions, archive state, events and request
   records, preserving memory IDs, timestamps, versions, text and request replay
   behavior. Preserve legacy metadata needed to interpret old request hashes.
5. Verify project/memory/version/event/request counts, ownership, relationships,
   history, request replay and rebuilt search results before publishing the copy.
6. Publish without replacing an existing destination. Leave the source unchanged.
   Return the old-name-to-idProject mapping. Connecting the resulting projects
   is explicit and must not overwrite a conflicting local configuration.

If migration fails, do not publish a partial usable database or configuration.
The source remains available. After successful migration the user must switch
to the new database; writes made to the old one afterward are not synchronized.
Never silently choose between copies or fall back to another database.

An alternative is an explicit in-place migration after a verified backup. It
avoids two files but modifies the original structure, contrary to the strongest
interpretation of the user's preference to preserve existing storage. A second
alternative, automatic migration on open, is rejected.

## Schema safety

- Fresh databases contain a project registry, memory ownership by `idProject`,
  revision history, scoped idempotency records, events and FTS5 search.
- Opening existing identity-aware storage validates ownership, version and
  expected tables, columns, constraints, indexes and triggers. Version alone is
  not proof of compatibility. Do not repair an incompatible schema on open.
- Initialization must reject unrelated databases and serialize concurrent
  initializers. Reconnecting never resets data, changes schema or reseeds rows.
- No user-facing deletion/reset commands, DROP or TRUNCATE workflow.
- Changing names must not change topic uniqueness, replay keys or search scope.

## Verification and delivery

Use test-first implementation and real SQLite/filesystem integration tests:
duplicate display names remain isolated; rename retains ownership; reconnect
reuses identity; invalid UUIDs cannot traverse directories; configuration remains
private and cannot be overwritten; invalid input creates no files; unsupported
storage and foreign schemas are rejected without changes; renaming preserves
history, archived memories and request replay; old-format databases remain
unchanged on rejection; repeated connection and concurrent initialization are safe.

Run the full `bun test`, `bun run typecheck`, `git diff --check` and installer
smoke tests. Deliver a documentation handoff describing verified behavior,
compatibility changes, old-format rejection and remaining limitations. The
other model maintains `docs/es/`, `docs/en/` and Notion.
