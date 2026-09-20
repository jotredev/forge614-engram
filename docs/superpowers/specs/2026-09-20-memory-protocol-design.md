# Forge614 Engram Memory Protocol Design

## Purpose

Forge614 Engram will publish one versioned, public memory protocol for AI
clients. The protocol tells an AI client when to retrieve memory, when to
save durable information, how to distinguish shared preferences from
project knowledge, how to survive context compaction, and what never to
store.

This is an Engram contract. It does not configure Claude Code, Codex, or
Cursor itself. Forge614 Engines will later translate and install the same
protocol through each client's supported configuration mechanism, and
Forge614 Shell will present and confirm those changes.

## Product outcome

After Engines and Shell consume this contract, a person can say:

> Remember that my favorite color is black.

The active client will call Engram's public `memory_save` MCP tool rather
than create a client-private memory file. The preference is saved locally
first and can be retrieved by another configured client.

## Scope of this delivery

This delivery adds only the public, machine-readable protocol contract to
Engram. It does not install client integrations, add a TUI, change the
memory database schema, or add a permanent PostgreSQL synchronization
service.

The existing SQLite-first write path remains authoritative. The existing
optional PostgreSQL synchronization remains explicit (`sync` or
`sync-watch`) until a separate autosync design is approved.

## Ownership boundaries

| Product | Owns |
|---|---|
| Forge614 Engram | Protocol semantics, version, public retrieval command, MCP tools, local memory persistence and future replication behavior. |
| Forge614 Engines | Detection plus safe, agent-specific installation, verification and removal of the Engram MCP and protocol. |
| Forge614 Shell | Human-facing preview, consent, progress and result reporting. |

Engines must consume the protocol only through Engram's public CLI output.
It must not import Engram source files or read files inside
`~/.forge614/engram/`.

## Public CLI contract

Engram will add this non-interactive command:

```text
forge614-engram memory-protocol --json
```

It writes exactly one JSON object to stdout on success. It has no optional
flags in version 1 and never needs a TTY.

The response has this stable shape:

```ts
interface MemoryProtocol {
  id: "forge614-engram-memory";
  version: 1;
  instructions: string;
  lifecycle: {
    start: string[];
    save: string[];
    compact: string[];
    resume: string[];
    end: string[];
  };
  scopes: {
    shared: string;
    project: string;
  };
  security: {
    neverSave: string[];
  };
}
```

`instructions` is the canonical complete text an adapter may inject into an
AI client's instructions. The structured fields let Engines display a
preview and verify the protocol version without interpreting prose.

Unknown arguments, an omitted `--json`, or an unknown command preserve the
existing CLI error convention: JSON `{ code, error }` on stderr and exit
code 1.

## Canonical memory behavior

### Start

At the beginning of a conversation, a client should retrieve relevant
shared preferences and project memory through the public MCP tools. It must
not invent a remembered fact when the search returns no result.

### Save

An explicit user instruction to remember, save, retain, or keep information
is sufficient authorization to save it automatically. The client must not
ask for a second confirmation.

Durable preferences, collaboration preferences, documentation preferences,
decisions, rules, discoveries and outcomes may also be saved when they are
useful beyond the immediate turn. Raw transcripts and every conversational
turn must not be stored.

Preferences intended to work across configured AI clients use Engram's
existing `shared` scope and the required `globalIntent` field. Project
knowledge uses the existing project scope. A stable `topicKey` updates the
same evolving subject instead of creating duplicates; for example:

```text
user/preference/favorite-color
```

### Security

The protocol forbids automatic storage of passwords, access tokens, private
keys, credentials, connection strings containing credentials, and equivalent
secrets. A client must not put a secret into a title, content, topic key,
session summary, error message, log, or fallback file.

### Compaction and resume

Before a client compacts or otherwise discards conversation context, it
should call `memory_session_summary` with the work completed, decisions,
pending work, risks and next step. After compaction, it should call
`memory_context` before continuing so it can recover the relevant summary
and memory.

This is best effort: inability to reach Engram must not block a user from
continuing work. The client reports the truthful failure state and must not
pretend that a private client file is shared Forge614 memory.

### End

At a normal session end, a client should persist the same useful summary and
call `memory_session_end`. A client may omit a summary only when nothing
durable was learned or changed.

## Source layout and exports

The source of truth lives in a pure module:

```text
src/modules/memory-protocol/
  protocol.ts
  protocol.test.ts
  index.ts
```

`protocol.ts` exports the public `MemoryProtocol` type and a
`memoryProtocol()` getter. `src/index.ts` re-exports those symbols for SDK
consumers. The CLI delegates to the same getter, so SDK and CLI cannot
publish diverging protocol text.

## Error handling and compatibility

- Version 1 is immutable once released; later semantic changes require a
  new protocol version.
- Engines compares both `id` and `version`; it must fail closed for an
  unsupported protocol version.
- The command includes no credentials and reads no workspace or database.
- The protocol output contains no user memory, project identity, filesystem
  path, PostgreSQL configuration or secret.

## Tests

Tests must prove:

1. The module has the declared fixed identifier and version.
2. The canonical instructions cover retrieval, explicit saves, shared versus
   project scope, topic keys, compaction, resume, session end and secrets.
3. The public SDK exports the type and getter.
4. `memory-protocol --json` returns the exact module value as JSON.
5. The command is non-interactive and does not initialize a workspace or
   create files.
6. Invalid variants follow the existing JSON-error CLI behavior.
7. Existing tests, `tsc --noEmit`, and `git diff --check` continue to pass.

## Explicitly deferred

- Client-specific plugins, hooks and instruction-file locations: Engines.
- Human confirmations and visible setup: Shell.
- Automatic PostgreSQL replication: a separate local-first autosync
  delivery, with durable retry state and no impact on local writes.
- Adding any AI client beyond Claude Code, Codex and Cursor: Engines scope,
  not this protocol.
