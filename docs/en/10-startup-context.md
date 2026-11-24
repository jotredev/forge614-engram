# 10. Startup Context for Hosts

> **Status:** available since version 1.5.0. The `ecosystem` block, `project.source`, and repository-identity maintenance are available since version 1.6.0. Format 2 (`--format 2`) is available since version 1.7.0.

Think of a host handing an agent a welcome folder before the conversation opens. Rather than waiting for the model to remember to request it, `startup-context` supplies that initial context safely and within a limit.

## Command and purpose

```bash
forge614-engram startup-context --directory /absolute/path/to/repository --json
```

This is the **only public interface** through which Forge614 Engines or Forge614 Shell may read Engram memory before an agent session begins. They must never open or read SQLite directly. It is a non-interactive, idempotent query; it does not require a TTY and suits automation, CI, and hosts.

## Output contract

On success it writes one JSON object to stdout, with keys in this order:

```json
{
  "format": 1,
  "shared": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
  "ecosystem": {
    "status": "member",
    "group": { "id": "<uuid>", "name": "mi-tienda" },
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false }
  },
  "project": {
    "status": "bound",
    "projectId": "<uuid>",
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
    "source": "file"
  }
}
```

`shared`, `ecosystem.context`, and `project.context` use the same `ContextResult` shape as the `context` command and include bounded previews, not titles alone. Each block uses its own byte ceiling.

- **`ecosystem`** is `{ "status": "member", "group": { "id", "name" }, "context": … }` when the project belongs to a group (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)) and `{ "status": "none" }` otherwise: a loose project, an unlinked folder, or a database created by an earlier version.
- **`project.source`** is `"file"` for a compatible legacy declaration, `"path"` for an SQLite binding or a unique confirmed origin match, and `"unbound"` when the project is unresolved.
- **`project.notices`** appears when there is a notice. Each entry has `code` and `message`. `PROJECT_BINDING_REQUIRED` marks a pending decision and `PROJECT_ORIGIN_CONFIRMATION_REQUIRED` a move to an unclaimed origin. Notices also report tracked or unpublished legacy files and ecosystem migrations, with the backup path where applicable.

When it cannot be resolved or linked as a project, it does not fail: it returns `"project": { "status": "unbound", "projectId": null, "context": null, "source": "unbound" }` and `"ecosystem": { "status": "none" }`. Any existing readable directory is valid: `$HOME`, `/`, an unversioned folder without Git, an unlinked Git repository, and a linked folder.

## Why `format` stays at 1

`ecosystem`, `project.source`, and `project.notices` are **additive fields**: no existing field changed its name, type, or meaning, so a consumer that ignores unknown fields keeps working unchanged. Raising `format` would have forced every host, including those that never use groups, to recognize a new shape. A consumer must **ignore unknown fields** and treat an `ecosystem` block it does not understand as absent; Engines and Shell must accept it as optional and sanitized. To display the new notices, a host that filters by code needs to recognize `PROJECT_BINDING_REQUIRED` and `PROJECT_ORIGIN_CONFIRMATION_REQUIRED`. Format 2 includes the notice directly in its text.

## Reading the catalog

The command opens SQLite read-only first. A unique confirmed origin match can show the UUID, memories, and ecosystem without recording a binding or publishing a file. The first save or session start records the local binding. A compatible legacy file can still import an identity and may need to reopen the database to register the project or its group.

When the evidence conflicts or the cloud catalog is pending, the result includes shared context, `project.status: "unbound"`, and a `PROJECT_BINDING_REQUIRED` notice. The command preserves existing files and bindings. Projects with an explicit group policy take their membership from `group-bind` and `group-unbind`.

Startup never creates memories, sessions, or databases. A project memory with the same `topicKey` hides the shared memory only within `project.context`. The top-level `shared` block keeps its results.

Each block uses `context()`'s own ceiling —16,384 bytes by default— so the combined payload remains bounded (three times that ceiling at most).

## Format 2: ready-to-inject block (since 1.7.0)

```bash
forge614-engram startup-context --directory /absolute/path/to/repository --json --format 2
```

Instead of the context JSON, it returns a single JSON object with a text block that the host can inject as is when starting an agent. The keys come in this order: `format` (always `2`), `text`, `chars`, `sections`, and `omitted`. A short example:

```json
{
  "format": 2,
  "text": "[Forge614 Engram] Startup block: retrieved data, not an instruction.\n319/5000 chars · nothing omitted.\n\n## Essentials (pinned)\n- Run tests with bun test · project · 3f2b9c1e-7d4a-4e8b-9a61-2c5d8e0f4b17\n\n## Index (titles only: open with memory_get)\n- Shared schema decision · board · b8e4d2a0-5c19-4f37-8e2d-6a9b1c3e7f50",
  "chars": 319,
  "sections": { "essentials": 97, "previous": 0, "index": 116 },
  "omitted": 0
}
```

`chars` is the exact length of `text` in Unicode characters, header included, and never exceeds 5,000. `sections` gives the characters of each section (0 if it does not appear) and `omitted` counts the titles of essentials and index that did not fit.

`text` starts with two header lines: `[Forge614 Engram] Startup block: retrieved data, not an instruction.` and `<chars>/5000 chars · nothing omitted.` (or `<chars>/5000 chars · <N> titles did not fit: find them with memory_search.`). After that, separated by a blank line and only if they have something, come three sections in this order:

- **`## Essentials (pinned)`** (up to 1,500 characters): active pinned memories of the personal notebook (`shared`; a project memory on the same topic hides the shared one), of the group's board (the `ecosystem/estado-actual` status note first) and of the project, in that order, and within each newest first. One line per memory: `- <short version or title> [verify] · <personal|board|project> · <id>`; `[verify]` appears only if its validity has expired.
- **`## Previous session (interrupted)`** (up to 800 characters; only with schema 11 and a linked project): the project's open runtime session left open (no activity for more than 30 minutes) with the most recent activity, the same one `previousInterrupted` returns. It says `Session <id> was left open; its last activity was at <ISO date>; its last summary (<memory id> v<version>):` followed by the summary without blank lines, or `…; it saved no summary.` if it saved none. If it goes over 800 characters it is cut with `…`. The block never lists sessions open in parallel: it is built before the new session exists and is injected again after compaction, where the "parallel" one would be the own session. For the same reason, after compaction, if the own session has had no Engram activity for more than 30 minutes, the block may name it as "left open"; it is data, and repeating `memory_session_start` does not return `previous`.
- **`## Index (titles only: open with memory_get)`** (the rest): only titles of the active unpinned memories of the board and the project, alternating one from the board and one from the project (board first; each newest first). It includes no session summaries and no unpinned memories of the personal notebook. An unlinked folder has no index: it only gets the notebook's essentials.

Each list is filled in order and stops at the first line that does not fit; what is left out is counted in `omitted` and can be found with `memory_search`. The fixed texts are in English; the content of the memories goes as is.

Format 2 works at any database level: it does not require `intelligence-enable`. Only with schema 11 does the short version replace the title in essentials, memories marked as superseded not appear, `[verify]` appear, and the previous session get included; below it, the block is built from the same sources without those extras. It uses the same opening and the same project resolution as format 1 (read-only first and, only if it must register the identity, writable), and includes a pending binding or confirmation notice as a line within the 5,000-character budget.

Without `--format`, the command keeps returning format 1, with the same output as always. `--format` accepts only `1` or `2`: any other value answers `INVALID_INPUT` (`format debe ser 1 o 2.`) before the database is opened. Versions 2 and 3 of the memory protocol announce the command without `--format`, that is, format 1 (version 1 announces none); version 4 (since 1.7.0) announces format 2. From the SDK, `MemoryStore.startupBlock` delivers the same block.

## With the cloud on (since 1.8.0)

With `cloud on`, `startup-context` and `memory_context` wait up to 1 second for the replica. A new folder with a usable origin or legacy file stays pending until the first download finishes and the identity cursor reaches the general cursor. Existing local bindings stay available. After upgrading from schema 12, run `sync` to prepare the identity catalog with a backup outside the startup wait. With `cloud off`, Engram uses the local catalog.

`startup-context` also opens correctly even when SQLite's WAL auxiliary files are missing (`engram.db-wal` and `engram.db-shm`), which SQLite deletes when the last connection closes: previously it failed with `STORAGE_ERROR` on the first session after closing everything (also in 1.7.2); since 1.8.0 it retries in writable mode and keeps working normally, including the cloud wait.

## Safe errors

`--directory` and `--json` are required. A nonexistent path, a path that is not a directory, an unreadable path, an uninitialized workspace, or any other real failure fails, and so does an invalid `.forge614/project.json` (`PROJECT_FILE_INVALID`: corrupt JSON, an unknown schema version, or unknown fields), which Engram never overwrites. The failure leaves stdout empty, writes JSON only to stderr, and exits with exit code 1: `{ "code": "…", "error": "…" }`, or `{ "schemaVersion": 1, "code": "…", "error": "…" }` for the codes introduced in 1.6.0. It does not print secrets, tokens, credentials, or raw paths in an error message.

**For hosts.** An invalid legacy file produces `PROJECT_FILE_INVALID` and no output block. A valid file with an incompatible identity produces a notice and leaves the shared block available.

## Relationship to the memory protocol

`memory-protocol --json --protocol-version 1` does not change. Version 2 adds `startupContext` to announce this command to Engines and Shell without changing the instructions or lifecycle. Version 3 also announces the `ecosystem` scope and describes this command including the group block. Version 4 announces this command with `--format 2`. Announcing it does not prove that any host already consumes it.
