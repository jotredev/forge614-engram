# 06 (EN). Troubleshooting and Error Diagnostics

> **Stage:** Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Active (Verified with 250 tests across 18 files on macOS with Bun 1.3.8)
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This troubleshooting guide provides an exhaustive diagnostic catalog of error codes, root causes, and recommended recovery procedures in Forge614 Engram, including progressive sessions, ranked context, assistant configuration conflicts, and PostgreSQL replication.

---

## 1. Fundamental Safety Principle

> [!IMPORTANT]
> **Never delete your database, SQLite tables, or sync checkpoints to "fix" an error.**
> Errors in Forge614 Engram are active safety safeguards. When the system detects session ambiguities, divergent plugin contents, or schema incompatibilities, it intentionally halts to **protect data integrity and prevent silent information loss**.

---

## 2. Complete Error Code Catalog

| Error Code | Typical Message | Root Cause | Recommended Solution |
| :--- | :--- | :--- | :--- |
| `MIGRATION_REQUIRED` | *"Habilita primero las sesiones."* or *"Habilita primero la integración..."* | A session command (`session-*`, `timeline`, `context`) or MCP tool was invoked before migrating SQLite to Schema 6. | Run `forge614-engram sessions-enable` in your terminal to apply the additive Schema 6 migration. |
| `AMBIGUOUS_SESSION` | *"AMBIGUOUS_SESSION: indica sessionId ([id1], [id2])."* | An assistant invoked `memory_save` without `sessionId` while 2 or more runtime sessions were active in the past 7 days on the bound folder. | Supply the target session explicitly with `--session-id <id>` or close finished sessions with `session-end`. |
| `SESSION_NOT_FOUND` | *"Sesión no encontrada."* or *"Sesión no encontrada para este proyecto."* | The requested `sessionId` does not exist in `sessions` or does not belong to the active `projectId`. | Verify session ID and project association, or start a new session with `session-start`. |
| `SESSION_CONFLICT` | *"El identificador de sesión no está disponible."* | Attempted to start a session with a `sessionId` already in use by another project or session kind. | Use a fresh, unique session identifier for this task. |
| `SESSION_CLOSED` | *"La sesión está cerrada."* | Attempted to associate a new memory entry with a session that has already ended (`endedAt` is not null). | Start a new runtime session with `session-start` or bind to an open session. |
| `SESSION_KIND` | *"Una sesión manual no admite asociación explícita."* or *"Una sesión manual no puede cerrarse."* | Attempted to explicitly associate or close a machine-local `manual` fallback session. | Use runtime sessions initiated via `session-start`. |
| `NO_SESSION_CONTEXT` | *"NO_SESSION_CONTEXT: no existe contexto de sesión..."* or *"el recuerdo no pertenece a esta sesión o está archivado."* | During `timeline` reconstruction, the specified memory has no entry in the given session or is archived. | Verify that `id` and `version` match the session log and that the memory remains active. |
| `SUMMARY_TOPIC_RESERVED` | *"El tema está reservado para un resumen de sesión."* | Attempted to save a standard memory using the reserved topic format `session/<id>/summary`. | Use an ordinary topic key or save summaries using the official `session-summary` command. |
| `SUMMARY_TOPIC_CONFLICT` | *"El tema reservado ya pertenece a otro recuerdo."* or *"El resumen no coincide con su puntero."* | Pointer mismatch between `session_summaries` and the stored memory record. | Retrieve the prior summary with `get` and supply `--expected-version` or verify your request key. |
| `CONFLICT` | *"The dedicated Engram plugin already exists with different contents..."* | In OpenCode, `plugins/forge614-engram.js` already exists with custom or divergent code. | Engram never overwrites modified plugins. Back up your existing plugin, remove or reconcile it, and re-run `forge614-engram tui`. |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* or *"setup necesita..."* | Invocations of `tui` or `setup` without a real interactive TTY (`isTTY` false or no raw mode). | Run directly in an interactive terminal. In scripts, use `assistant-list` or `init`. |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git..."* | Git is not installed, not in PATH, or `git rev-parse` failed. | Install Git (`git --version`) and ensure it is accessible in your system PATH. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* | Invoked MCP in a non-Git directory without passing directory, or tried to use binary path as project. | Pass `directory` explicitly in MCP tool calls or bind the directory beforehand with `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada..."* | Attempted queries on an unbound folder before saving an initial memory or starting a session. | Save an initial note with `memory_save` (auto-creates binding) or link with `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* or *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Name collision or a previously registered binding is missing on disk (folder moved or drive unmounted). | Check projects with `project-list` and bind explicitly with `project-bind --directory /path --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Attempted to bind a folder that already belongs to another `projectId`. | Inspect bindings with `project-list` and determine whether to reassign. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | Client has multiple workspace roots open simultaneously without specifying `directory`. | Pass the explicit `directory` parameter in tool arguments. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | Assistant called `memory_save` with `scope: "shared"` without providing `globalIntent`. | Supply `globalIntent` explaining why the decision applies universally. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Ran self-test in `tui` directly from source with Bun without installing the standalone binary. | Run `bash scripts/install.sh` to install the binary to `$HOME/.local/bin/forge614-engram`. |
| `TIMED_OUT` | Server self-test reported as timed out. | MCP self-test exceeded the strict 5-second deadline to spawn, handshake, and list tools. | Verify CPU load and ensure executable has `0755` permissions. |
| `MCP_FAILED` | Server self-test reported as failed. | MCP server failed handshake or did not expose all 10 expected tools. | Ensure database has Schema 6 enabled via `sessions-enable`. |
| `PUBLISHED_UNVERIFIED` | *"Publicado sin verificar: [path]"* | Configuration applied to file, but immediate post-publication byte validation failed due to concurrent modification. | Engram retains `.bak` backup. Close client editor and re-run `forge614-engram tui`. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | OpenCode has simultaneous `.json` and `.jsonc` files, or multiple active configuration directories. | Select configuration file explicitly in TUI or remove duplicate config files. |
| `INVALID_INPUT` | *"El campo [field] debe ser texto no vacío..."* | Empty options, null characters (`\0`), out-of-range limits, or incompatible flags (e.g. `--upgrade-format` on `sync-watch`). | Check valid options with `forge614-engram help`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | The `projectId` does not exist in `projects`. | Run `forge614-engram project-list` to verify project UUIDs. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | The `--expected-version` does not match the active version in SQLite. | Query current version with `get` or `history` and update with the correct version. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Reused a `--request-key` with differing content, title, or topic. | Use a fresh request key for a new revision. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic whose memory is in archived status. | Run `restore` on the memory before saving the new version. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | Memory UUID does not exist or does not belong to the selected scope. | Verify scope and verify UUID accuracy. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Lockfile `~/.forge614/.config-lock` is held by another process running `setup` or `tui`. | Wait for completion or remove `.config-lock` if orphaned by an abrupt termination. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | Invoked `sync` or `sync-watch` without `POSTGRES_URL` in `.env`. | Run `forge614-engram setup` and select `Sí, configurar PostgreSQL`. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Incompatible concurrent changes to the same entity between local and remote states. | Halts sync to protect data. No data is lost; do not drop tables. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | Merged snapshot exceeds strict 8 MiB limit (`8,388,608 bytes`). | Physical payload cap, not a history conflict. Archive obsolete memories. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida..."* | Invalid URL protocol or attempting unencrypted connection outside loopback. | Remote PostgreSQL requires verified TLS. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos..."* | Database server unreachable or invalid credentials. | Local SQLite operations remain 100% operational. Verify network and credentials. |

---

## 3. Operational Scenarios and Recovery Procedures

### 1. Safe Resolution of OpenCode Plugin Conflict (`CONFLICT`)
- **Symptom:** In `forge614-engram tui`, OpenCode shows a conflict warning: *"The dedicated Engram plugin already exists with different contents. Review it manually."*
- **Root Cause:** File `plugins/forge614-engram.js` exists in your active OpenCode configuration folder with divergent code. Engram refuses to overwrite custom code blindly.
- **Recovery Procedure:**
  1. Press `Enter` in TUI to view the **Plan Preview**, comparing planned changes.
  2. Create a manual backup:
     ```bash
     cp ~/.config/opencode/plugins/forge614-engram.js ~/.config/opencode/plugins/forge614-engram.js.bak
     ```
  3. To accept the official Engram plugin, remove the conflicting file:
     ```bash
     rm ~/.config/opencode/plugins/forge614-engram.js
     ```
  4. Re-run `forge614-engram tui`, select OpenCode with `Space`, and confirm.

---

### 2. Peer Device Coordination on PostgreSQL Format 2 Promotion
- **Symptom:** After executing `sync --upgrade-format` on computer A, computer B reports `SYNC_CONFLICT` when running `sync`.
- **Root Cause:** The PostgreSQL replica was promoted to **Format 2** (including sessions and summaries), but computer B's local SQLite database is still on Schema 3, 4, or 5.
- **Recovery Procedure:**
  1. Update Forge614 Engram on computer B (`bash scripts/install.sh --force`).
  2. Enable Schema 6 locally on computer B:
     ```bash
     forge614-engram sessions-enable
     ```
  3. Execute standard synchronization:
     ```bash
     forge614-engram sync
     ```
  Both machines now sync cleanly under Format 2.

---

### 3. Assistant Reports `AMBIGUOUS_SESSION` on Memory Save
- **Symptom:** When asking an assistant to save a technical decision, `memory_save` fails with `AMBIGUOUS_SESSION: indica sessionId (ses-a, ses-b)`.
- **Root Cause:** Multiple runtime work sessions were started in the same folder within the last 7 days and remain unclosed.
- **Recovery Procedure:**
  - Option A: Instruct the assistant explicitly: *"Save this decision associating it with session ses-a"*.
  - Option B: Close finished sessions from terminal:
    ```bash
    forge614-engram session-end --project-id <UUID> --session-id "ses-b"
    ```
    Once only one active session remains, subsequent notes are auto-inferred.

---

### 4. Resolving `MIGRATION_REQUIRED` for Sessions or MCP Tools
- **Symptom:** Running `forge614-engram session-start` or calling `memory_context` fails with `Habilita primero las sesiones.`
- **Root Cause:** Central database `~/.forge614/engram.db` was created under a prior schema (3, 4, or 5). Everyday operations never alter schemas without explicit authorization.
- **Recovery Procedure:**
  Run the official enablement command:
  ```bash
  forge614-engram sessions-enable
  ```
  The database updates additively to Schema 6 in milliseconds, preserving all memories and past history intact.
