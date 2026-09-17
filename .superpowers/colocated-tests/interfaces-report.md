# Interfaces colocated-test correction

Production files are unchanged. All 16 implementation files reviewed: 15 own sibling tests, plus one justified static-data exemption. Root src/cli.ts is a two-line entry wrapper with no independent logic; CLI main and command behavior is exercised through isolated spawned processes to retain process.exitCode/stdin semantics.

## Source-to-test map

| Implementation under src/interfaces | Own sibling test and behavior |
| --- | --- |
| cli/arguments.ts | arguments.test.ts: command-specific flags, trim/boolean consumption, malformed options, integer bounds |
| cli/commands.ts | commands.test.ts: shared scope dispatch, mutation validation, summaries and watch-option validation |
| cli/main.ts | main.test.ts: help/version/default route, error JSON to stderr and exit status |
| cli/help.ts | Exempt: one exported static help string; no executable logic. Existing consumer help assertions retained in main.test.ts. |
| mcp/context.ts | context.test.ts: async JSON serialization, domain errors and unexpected-error redaction |
| mcp/memory-tools.ts | memory-tools.test.ts: own registration function with real SDK/in-memory transport and SQLite; project/shared ownership, writes, versions, previews and intent validation |
| mcp/sessions-tools.ts | sessions-tools.test.ts: own registration function; session start/summary/replay/end, timeline owner/version, shared compact context |
| mcp/tools.ts | tools.test.ts: composed published tool surface, both executable handler families and schema rejection |
| mcp/project-directory.ts | project-directory.test.ts: explicit-root precedence, decoded root, ambiguity and malformed URL |
| mcp/schemas.ts | schemas.test.ts: normalization, exact session identity, numeric bounds, strict keys and complete summaries |
| mcp/server.ts | server.test.ts: stdio lazy initialization, compiled official SDK handshake, EOF cancels outstanding roots and closes process |
| terminal/hooks.ts | hooks.test.ts: client/event response shapes, no input echo, malformed/oversized input, bounded never-closed stdin |
| terminal/setup.ts | setup.test.ts: EOF/Ctrl+C cancellation, pasted invalid-answer retry, secret echo suppression |
| terminal/sync-watch.ts | sync-watch.test.ts: offline retry diagnostics, secret redaction, local writes remain usable, SIGINT exit |
| tui/controller.ts | controller.test.ts: Escape/cancel transitions, resize/EOF/Ctrl+C restoration and listener cleanup |
| tui/render.ts | render.test.ts: viewport bounds, control sanitization, coverage text and no private config contents |

New shared harness: src/interfaces/mcp/__tests__/sdk-harness.ts. It imports production implementations only; uses official SDK linked transports and an in-memory SQLite database, closes both peers/database and removes its temporary directory. No global mocks added. Existing child-only homedir preload, interactive preload, compile and PTY paths remain rooted at the repository fixtures.

## Moved existing cases

All 56 original test declarations (66 expanded cases) preserved exactly once. AST inventory found 55 direct test/test.each declarations with zero missing/duplicate names, plus the conditional real-PTY declaration noted below. Focused cases were transferred, not copied; broad suites remain under their owning __tests__ directories. Plugin generation/quoting collaboration moved to modules/assistants with controller approval.

### tests/e2e/assistant-hooks.test.ts

- %s %s emits native additional context without echoing input → src/interfaces/terminal/hooks.test.ts
- Cursor uses sessionStart additional_context and no beforeSubmitPrompt support → src/interfaces/terminal/hooks.test.ts
- unsafe or unsupported input returns empty native JSON → src/interfaces/terminal/hooks.test.ts
- never-closed stdin times out without blocking the client → src/interfaces/terminal/hooks.test.ts
- native hook commands quote binary paths and clients use their own timeout units → src/modules/assistants/__tests__/assistant-hooks.integration.test.ts
- standalone compiled hooks and assistant listing run with no Bun on PATH and no storage writes → src/interfaces/terminal/__tests__/assistant-hooks.e2e.test.ts

### tests/e2e/assistant-tui.test.ts

- optional own-server test performs compiled SDK handshake without enrollment or launching client commands → src/interfaces/tui/__tests__/assistant-tui.e2e.test.ts
- nonTTY tui returns INTERACTIVE_REQUIRED with no terminal escapes or workspace writes → src/interfaces/tui/__tests__/assistant-tui.e2e.test.ts
- compiled TUI cancels from preview and Escape on a real PTY and restores stty → src/interfaces/tui/__tests__/assistant-tui.e2e.test.ts (existing conditional test; ran and passed).

### tests/e2e/cli.test.ts

- help, version and empty project list create no storage → src/interfaces/cli/main.test.ts
- setup requires a terminal and leaves automation commands noninteractive → src/interfaces/cli/__tests__/cli.e2e.test.ts
- setup rejects unknown flags without entering prompts or creating files → src/interfaces/cli/__tests__/cli.e2e.test.ts
- sync without PostgreSQL configuration never creates storage → src/interfaces/cli/__tests__/cli.e2e.test.ts
- sync-watch reports offline retry state and exits on SIGINT without blocking local writes → src/interfaces/terminal/sync-watch.test.ts
- all projects and working directories share exactly one workspace configuration → src/interfaces/cli/__tests__/cli.e2e.test.ts
- SDK workspace and CLI share the same identity and database → src/interfaces/cli/__tests__/cli.e2e.test.ts
- project CLI saves, revises, searches, archives and restores with UUID identity → src/interfaces/cli/__tests__/cli.e2e.test.ts
- init is repeatable and rename retains identity without per-project registration → src/interfaces/cli/__tests__/cli.e2e.test.ts
- CLI shared memories work without a project and require explicit scope for mutations → src/interfaces/cli/commands.test.ts
- two identical project names stay isolated from each other → src/interfaces/cli/__tests__/cli.e2e.test.ts
- invalid scope, legacy and per-project connection flags fail before any storage changes → src/interfaces/cli/commands.test.ts
- missing configuration and configured missing database never cause silent reinitialization → src/interfaces/cli/__tests__/cli.e2e.test.ts
- concurrent project and shared request replays create one memory per namespace → src/interfaces/cli/__tests__/cli.e2e.test.ts
- concurrent initializers keep a single config and preserve all projects → src/interfaces/cli/__tests__/cli.e2e.test.ts
- concurrent init of existing workspace leaves existing memories and configuration intact → src/interfaces/cli/__tests__/cli.e2e.test.ts
- explicit session CLI lifecycle, previews, version reads, timeline and context stay noninteractive → src/interfaces/cli/__tests__/cli.e2e.test.ts
- CLI rejects valued boolean flags, malformed summaries, unknown summary keys and watch promotion → src/interfaces/cli/commands.test.ts

### tests/e2e/mcp.test.ts

- stdio initializes and advertises exactly the bounded memory tool surface → src/interfaces/mcp/server.test.ts
- mcp never enrolls implicitly and resolves one client root without creating a project → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- a non-Git process cwd is not treated as an implicit non-Git project root → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- stdio save, search, get, history, update and request replay persist across restarts → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- shared saves require explicit scope and a nonempty global-intent explanation → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- owner mismatch, unbound default search, multiple roots and oversized inputs fail safely → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- compiled executable completes the official SDK stdio handshake without user storage → src/interfaces/mcp/server.test.ts
- raw stdin EOF cancels an unanswered roots request and exits promptly → src/interfaces/mcp/server.test.ts
- MCP session contracts support parallel chats, exact versions, replay, summary ordering and private shared origins → src/interfaces/mcp/__tests__/mcp.e2e.test.ts
- MCP accepts the SDK session identifier boundary and reports ambiguous assistant inference → src/interfaces/mcp/__tests__/mcp.e2e.test.ts

### tests/e2e/project-context.test.ts

- project-bind is scriptable recovery for a colliding existing project name → src/interfaces/cli/__tests__/project-context.e2e.test.ts

### tests/e2e/setup-terminal.test.ts

- terminal EOF and Ctrl+C cancel without initializing storage → src/interfaces/terminal/setup.test.ts
- terminal retries pasted invalid answers then initializes without creating projects → src/interfaces/terminal/setup.test.ts
- terminal never echoes a pasted PostgreSQL credential even before the secret prompt → src/interfaces/terminal/setup.test.ts

### tests/integration/assistant-hooks.test.ts

- generated OpenCode plugin executes independently and preserves custom system and compaction state idempotently → src/modules/assistants/__tests__/assistant-hooks.integration.test.ts

### tests/integration/assistant-tui.test.ts

- selection and previews do not enroll; only confirmed selected clients change and old memories survive → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- Escape backs out and Ctrl+C before confirmation leaves a new workspace absent → src/interfaces/tui/controller.test.ts
- entire selection is preflighted before workspace enrollment → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- redetection discovers fresh executable, distinguishes config-only and supports hidden custom paths → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- source execution never resolves Bun as an installed Engram prerequisite → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- self-test failures never expose server stderr or protocol content → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- self-test refuses a source runtime and remains not-run without touching storage → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- self-test timeout kills an unresponsive child and does not enroll → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- self-test deadline covers shutdown after successful initialize and listTools → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- terminal stays responsive and closes own test on %s → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- client details can scroll to trust warnings in a small viewport → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts
- renderer bounds every viewport, sanitizes controls, exposes coverage and never private config bytes → src/interfaces/tui/render.test.ts
- terminal stream redraws on resize and restores raw/cursor state on Ctrl+C and EOF → src/interfaces/tui/controller.test.ts
- partial application reports retained files and backups without undoing a successful client → src/interfaces/tui/__tests__/assistant-tui.integration.test.ts

## New cases

- src/interfaces/cli/arguments.test.ts: parser trims values, consumes boolean switches and requires command-specific values
- src/interfaces/cli/arguments.test.ts: parser rejects malformed command %j
- src/interfaces/cli/arguments.test.ts: numeric options enforce inclusive bounds and reject fractional, signed and unsafe inputs
- src/interfaces/cli/main.test.ts: main defaults to help and serializes invalid invocations only to stderr
- src/interfaces/mcp/schemas.test.ts: save schema normalizes durable text while preserving exact session identity
- src/interfaces/mcp/schemas.test.ts: search, timeline and context schemas enforce their public bounds
- src/interfaces/mcp/schemas.test.ts: schemas reject unknown fields, nul bytes and incomplete structured summaries
- src/interfaces/mcp/memory-tools.test.ts: memory handlers resolve projects, save revisions and expose owner-scoped previews and history
- src/interfaces/mcp/memory-tools.test.ts: shared saves require explicit intent and paired session ownership without resolving a project
- src/interfaces/mcp/project-directory.test.ts: explicit directories override ambiguous roots and a single root is decoded from its file URL
- src/interfaces/mcp/project-directory.test.ts: resolver rejects malformed file URLs accepted by the SDK file prefix check
- src/interfaces/mcp/context.test.ts: safely awaits the handler and serializes its result as protocol text
- src/interfaces/mcp/context.test.ts: safely preserves domain codes and hides unexpected exception details
- src/interfaces/mcp/tools.test.ts: registerTools publishes both handler families with executable schemas and callbacks
- src/interfaces/mcp/sessions-tools.test.ts: session handlers start, summarize and close the selected project's conversation
- src/interfaces/mcp/sessions-tools.test.ts: timeline uses the exact owner/version and context supports shared scope without a binding

## Verification

- Final focused command: `bun test src/interfaces src/modules/assistants/__tests__/assistant-hooks.integration.test.ts`
- Output: 89 pass, 0 fail; 658 expect calls; 22 files; 20.72 seconds.
- Final `bun run typecheck`: exit 0.
- Baseline comparison of every src/interfaces production file against .superpowers/colocated-tests/before.json: zero changes.
- Shared fixtures and root install/PostgreSQL e2e were not edited. Global suite belongs to controller.

## Concerns and limits

This is existing-behavior characterization and test relocation; no production mutation was made to force RED. Initial test development corrected expectations to the actual version-read/preview envelopes and session-end behavior. A cleanup mistakenly removed the server test's runCli fixture; restored before final green verification. No failure remains.

Per-file tests establish meaningful owned behaviors, not 100% branch coverage. Project-directory's implicit-cwd branches also retain stdio collaboration cases; SDK transport validates non-file roots before the resolver, so the direct malformed-URL case uses a file-prefix URI that reaches the resolver's own validation. No production hooks or test imports were added.

