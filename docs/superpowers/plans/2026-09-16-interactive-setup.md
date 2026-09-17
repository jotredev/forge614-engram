# Interactive setup implementation plan

> HISTORICAL PLAN: the project menu described below was subsequently rejected
> by the user. Current implementation only validates/explains global storage and
> asks for confirmation; it never lists, selects or creates projects. See
> docs/handoffs/06-interactive-setup.md for the corrected current delivery and
> approved future projectId-default/explicit-global-only shared policy.
> Completion evidence below belongs to the earlier iteration, not current tests.

> Execute inline using executing-plans and test-driven-development. User approved the setup design in chat and requested implementation on feat/interactive-setup. No commits or pushes in this delivery.

## Approved design

Add `forge614-engram setup` alongside the existing noninteractive `init`.
Use the single global SQLite workspace and existing validation. Explain storage,
inspect existing configuration, offer create/select/skip project, summarize,
then require explicit confirmation. Cancel/EOF/Ctrl+C before confirmation must
not initialize storage or create a project. Existing configuration and memories
must never be overwritten. PostgreSQL, MCP, persistent project selection and
the full TUI remain out of scope. Keep existing command JSON contracts.

## Architecture

`src/setup.ts` owns the conversation using an injected `SetupIO` with
`write(message)` and asynchronous `ask(question): Promise<string | null>`.
It calls the real `MemoryWorkspace` only for inspection before confirmation,
then init/create after confirmation. `src/setup-terminal.ts` adapts readline,
requires an interactive terminal, buffers input through an async iterator and
closes on EOF/SIGINT. CLI dispatches setup separately, preserving init.
No dependencies, configuration fields or schema changes.

## Tasks

- [x] Write `tests/setup.test.ts` against real temporary databases. Assert absent
  storage after cancellation at every prompt; creation after explicit confirmation;
  selecting existing projects without duplicates; preservation of config and
  memories; validation retry; configured missing database refusal.
- [x] Run `bun test tests/setup.test.ts`, observe missing setup implementation.
- [x] Implement `runSetup(io, config)` and return a cancelled/result union.
  Format project names safely for terminal display, never interpolate names into
  shell commands. Confirm defaults to no; input `cancelar`/`q` cancels anywhere.
- [x] Add CLI tests rejecting nonterminal setup and unknown flags before writes;
  implement readline adapter and async CLI entry point.
- [x] Run targeted tests and an isolated real-PTY smoke test including Ctrl+C.
- [x] Obtain independent review. Fix important findings with regression tests.
- [x] Run `bun test`, `bun run typecheck`, `git diff --check` and record evidence.
- [x] Write `docs/handoffs/06-interactive-setup.md` for bilingual/Notion updater;
  do not edit their guides or publish to Notion.

## Safety and verification details

All tests inject temporary workspace paths or use the existing test homedir
preload; never initialize the real user directory. A pre-existing compatible
database without config can be attached after confirmation by existing init.
Failures after confirmation may leave initialized storage; do not attempt
destructive rollback or promise multi-file atomicity. Before confirmation,
SQLite read-only inspection can use normal SQLite auxiliary files, so the
guarantee is no configuration/project/memory mutations, not zero OS activity.
The selection is displayed as a UUID for subsequent commands, not persisted.
Use numeric choices; reuse existing project IDs rather than deriving IDs from names.

## Completion evidence

- Bun 1.3.8/macOS: 77 tests passed, 0 failures, 580 assertions across 9 files.
- `bun run typecheck` and `git diff --check` passed.
- Independent read-only review found no important issues. Its minor adapter
  coverage note was addressed with child-process EOF/SIGINT/multiline tests
  using real readline and a test-only terminal capability fixture.
- Real PTY: Ctrl+C at confirmation returned 130 with no workspace created;
  rapid multiline input successfully created exactly one project.
- Justified deviation: initial SQLite WAL required an empty writable transaction
  after activation to support immediate read-only use with no project. Reproduced
  before fixing; covered by setup-without-project and CLI init/read tests. No
  schema/version change. Program version is now 0.3.0.
- No commits, pushes, Notion publication or changes to real user storage.
