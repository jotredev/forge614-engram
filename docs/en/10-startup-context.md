# 10. Startup Context for Hosts

> **Status:** available since version 1.5.0.

Think of a host handing an agent a welcome folder before the conversation opens. Rather than waiting for the model to remember to request it, `startup-context` supplies that initial context safely and within a limit.

## Command and purpose

```bash
forge614-engram startup-context --directory /absolute/path/to/repository --json
```

This is the **only public interface** through which Forge614 Engines or Forge614 Shell may read Engram memory before an agent session begins. They must never open or read SQLite directly. It is a non-interactive, idempotent, and read-only query; it does not require a TTY and suits automation, CI, and hosts.

## Output contract

On success it writes one JSON object to stdout:

```json
{
  "format": 1,
  "shared": { "pinned": [], "recent": [], "sessions": [], "truncated": false },
  "project": {
    "status": "bound",
    "projectId": "<uuid>",
    "context": { "pinned": [], "recent": [], "sessions": [], "truncated": false }
  }
}
```

`shared` and `project.context` use the same `ContextResult` shape as the `context` command and include bounded previews, not titles alone. A valid and linked project retains previous behavior: `shared` plus project context. When it cannot be resolved or linked as a project, it does not fail: it returns JSON with `format: 1`, normal `shared` context, and `project: { "status": "unbound", "projectId": null, "context": null }` with remaining project fields set to null per schema. Any existing readable directory is valid: `$HOME`, `/`, an unversioned folder without Git, an unlinked Git repository, and a linked folder.

## Strict reads and limits

The command uses SQLite in read-only mode. It never creates projects, bindings, memories, sessions, databases, files, or migrations. A project memory using the same `topicKey` supersedes the shared one only inside `project.context`; the top-level `shared` section is unchanged.

Each section uses `context()`'s own ceiling —16,384 bytes by default—so the combined payload remains bounded. The operation works even when the database file itself is read-only.

## Safe errors

`--directory` and `--json` are required. Only a nonexistent path, a path that is not a directory, or an unreadable path fails; an uninitialized workspace or any other real failure leaves stdout empty, writes `{ "code": "…", "error": "…" }` JSON only to stderr, and exits with exit code 1. It does not print secrets, tokens, credentials, or raw paths in an error message.

## Relationship to the memory protocol

`memory-protocol --json --protocol-version 1` does not change. Version 2 adds `startupContext` to announce this command to Engines and Shell without changing the instructions or lifecycle. Announcing it does not prove that any host already consumes it.
