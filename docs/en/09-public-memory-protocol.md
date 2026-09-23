# 09. Public Memory Protocol

> **Status:** available from stable release `v1.3.0`. Protocol version 3 is available from version 1.6.0.

Think of a shared instruction card that any compatible assistant can read before working: it does not store a whole conversation, but tells the assistant how to use the common archive consistently. That is Forge614 Engram's public memory protocol.

## Purpose and public surface

The versioned contract identifies durable shared memory for a person and their projects. The SDK exposes `memoryProtocol()` and the `MemoryProtocol` type; the non-interactive public transport is:

```text
forge614-engram memory-protocol --json
```

The response is one JSON object containing `id: "forge614-engram-memory"`, `version: 1`, canonical instructions, the `start`, `save`, `compact`, `resume`, and `end` lifecycle arrays, `shared` and `project` rules, and `security.neverSave`.

Version 1 remains identical for compatibility. Consumers requesting `forge614-engram memory-protocol --json --protocol-version 2` also receive `startupContext`, announcing `forge614-engram startup-context --directory <absolute-directory> --json`. This is a host addition: it does not alter the existing instructions or lifecycle.

## Version 3: the `ecosystem` scope

`forge614-engram memory-protocol --json --protocol-version 3` publishes `version: 3` with the same keys as version 2 and these changes, always by addition:

- `scopes.ecosystem` announces the scope of a **group of related repositories** (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)): saving there requires `scope: "ecosystem"` and a truthful `groupIntent`, symmetric to `shared`'s `globalIntent`. The group is always the one the current project belongs to.
- The instructions add that a `topicKey` repeated across scopes resolves with project first, then ecosystem, and finally `shared`.
- The updated lifecycle: `start` also consults ecosystem memory when the project belongs to a group; `save` distinguishes `shared` (`globalIntent`), `ecosystem` (`groupIntent`), and project. `compact`, `resume`, and `end` do not change.
- `startupContext.description` describes the group block and that the command keeps the repository identity in step.

Versions 1 and 2 **remain byte-identical** to what 1.5.3 published: an immutability test pins their SHA-256 digests. The default version is still 1. The `memory_save` and `memory_session_summary` MCP tools accept the new scope (`groupIntent` is required and accepted only with `scope: "ecosystem"`); if the project does not belong to a group they return `GROUP_REQUIRED`.

The command requires `--json`. It does not need a TTY, create or open `~/.forge614/engram/`, initialize SQLite, or query projects, PostgreSQL, or user data. Without `--json`, or with unknown flags, it writes the standard `{code,error}` JSON error to stderr and exits with code `1`.

## Lifecycle for compatible assistants

1. **Start.** Retrieve project memory and shared preferences with `memory_context` (in version 3, also ecosystem memory when the project belongs to a group). If Engram returns no result, never invent a memory.
2. **Save.** When the person clearly says “remember”, “save”, “keep in mind”, or an equivalent, save through `memory_save` without requesting a second confirmation. Also save durable personal, collaboration, and documentation preferences, decisions, rules, discoveries, and outcomes; do not save every message or raw transcripts.
3. **Scopes.** A preference shared across assistants uses `scope: "shared"` and a truthful `globalIntent` (the real explanation of the global intent). Repository knowledge uses project scope. Since version 3, knowledge that the related repositories of a group share uses `scope: "ecosystem"` and a truthful `groupIntent`. A stable `topicKey` updates an existing subject instead of duplicating it; for example, `user/preference/favorite-color`.
4. **Compaction and resume.** Before compacting or discarding context, call `memory_session_summary` with completed work, decisions, pending work, risks, and the next step. Afterwards, call `memory_context` before continuing.
5. **End.** At normal session end, save a useful summary when durable work or learning occurred and call `memory_session_end`.

If Engram fails, the assistant may continue working, but it reports the actual failure. A private fallback file is not Forge614 shared memory.

## Security

Never store in Engram, or include in logs, errors, titles, content, `topicKey`, summaries, or fallback files: passwords, tokens, private keys, credentials, or connection strings containing credentials.

## Not yet implemented

The protocol does not install MCP, instructions, hooks, or plugins in Claude Code, Codex, or Cursor. Forge614 Engines will consume this JSON and install the protocol through each assistant's safe mechanism; Forge614 Shell will show a preview and request human confirmation. Engram does not configure AI clients directly.

PostgreSQL remains an optional replica with explicit synchronization through `sync` or `sync-watch`. This delivery does not add permanent automatic PostgreSQL synchronization or a TUI.

## Verification for release `v1.3.0`

This delivery was verified with `bun test` (417 pass, 0 fail, 10 skip), `bun run typecheck`, `git diff --check`, and the focused protocol/SDK/CLI tests (38 pass, 0 fail).
