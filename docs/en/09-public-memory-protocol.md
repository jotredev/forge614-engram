# 09. Public Memory Protocol

> **Status:** available from stable release `v1.3.0`.

Think of a shared instruction card that any compatible assistant can read before working: it does not store a whole conversation, but tells the assistant how to use the common archive consistently. That is Forge614 Engram's public memory protocol.

## Purpose and public surface

The versioned contract identifies durable shared memory for a person and their projects. The SDK exposes `memoryProtocol()` and the `MemoryProtocol` type; the non-interactive public transport is:

```text
forge614-engram memory-protocol --json
```

The response is one JSON object containing `id: "forge614-engram-memory"`, `version: 1`, canonical instructions, the `start`, `save`, `compact`, `resume`, and `end` lifecycle arrays, `shared` and `project` rules, and `security.neverSave`.

The command requires `--json`. It does not need a TTY, create or open `~/.forge614/engram/`, initialize SQLite, or query projects, PostgreSQL, or user data. Without `--json`, or with unknown flags, it writes the standard `{code,error}` JSON error to stderr and exits with code `1`.

## Lifecycle for compatible assistants

1. **Start.** Retrieve project memory and shared preferences with `memory_context`. If Engram returns no result, never invent a memory.
2. **Save.** When the person clearly says “remember”, “save”, “keep in mind”, or an equivalent, save through `memory_save` without requesting a second confirmation. Also save durable personal, collaboration, and documentation preferences, decisions, rules, discoveries, and outcomes; do not save every message or raw transcripts.
3. **Scopes.** A preference shared across assistants uses `scope: "shared"` and a truthful `globalIntent` (the real explanation of the global intent). Repository knowledge uses project scope. A stable `topicKey` updates an existing subject instead of duplicating it; for example, `user/preference/favorite-color`.
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
