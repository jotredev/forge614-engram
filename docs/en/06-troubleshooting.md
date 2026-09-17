# 06 (EN). Troubleshooting and Error Diagnostics

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Active (Verified with 90 tests on macOS with Bun 1.3.8)
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This troubleshooting guide allows you to rapidly diagnose any error code returned by the Forge614 Engram CLI or TypeScript SDK, understand its root cause, and resolve it without risking data loss.

---

## 1. Core Safety Directive

> [!IMPORTANT]
> **Never delete your database, tables, or sync checkpoints to "fix" an error.**
> Errors in Forge614 Engram are active safety invariants. When the system detects an unresolvable conflict, altered schema, or unsafe file permissions, it halts intentionally to **prevent silent data corruption and irrevocable history erasure**.

---

## 2. Comprehensive Error Catalog

| Error Code | Typical Error Message | Root Cause Explained | Recommended Fix |
| :--- | :--- | :--- | :--- |
| `INTERACTIVE_REQUIRED` | *"setup necesita una terminal interactiva..."* | `setup` was invoked from a non-interactive pipe (`\|`), redirect, or background CI environment (`isTTY` is false). | In automation scripts or CI/CD pipelines, use `forge614-engram init`. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* or *"scope shared no acepta --project-id..."* | Missing mandatory arguments, null bytes (`\0`), out-of-bounds numbers (`limit`), or incompatible flag combinations. | Review command arguments. In `shared` mode, omit `--project-id`. In `project` mode, pass a valid project UUID. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | The provided `projectId` does not exist in the `projects` table of `~/.forge614/engram.db`. | Run `forge614-engram project-list` to verify registered project UUIDs. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | The `--expected-version` number does not match the active version currently stored in the database. | Query current version using `get` or `history` and submit the update with the exact matching version. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | A previously seen `--request-key` was submitted with differing title, content, or topic data. | When storing a new note or revision, use a new unique key (e.g. `--request-key req-02`) or omit the key. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic memory currently in an archived state. | Execute `restore` on the memory before publishing a new topic revision. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | Memory ID does not exist or does not match the provided project or shared scope. | Check whether the memory is project-scoped or shared, and verify UUID formatting. |
| `CONFIG_NOT_FOUND` | *"Configuración global inválida o inaccesible..."* | The file `~/.forge614/.env` is missing. | Run `forge614-engram init` or `forge614-engram setup` to generate global configuration. |
| `CONFIG_INVALID` | *"Configuración global inválida o inaccesible. Comprueba su formato..."* | `.env` or parent folder has insecure permissions (`not 0600/0700`), wrong owner, or malformed syntax. | Enforce mode `0700` on `~/.forge614` and mode `0600` on `.env`. Verify that keys match format 2 or 3. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Lock file `~/.forge614/.config-lock` is held by another running `setup` process. | Wait for the other process to finish. If left behind by a crash, verify no processes are running, then remove lock. |
| `CONFIG_CHANGED` | *"La configuración cambió mientras respondías. Vuelve a ejecutar setup."* | The `.env` file was modified or had its hash altered while answering `setup` prompts. | Rerun `forge614-engram setup` to configure against current configuration state. |
| `LEGACY_CONFIG` | *"Se detectó configuración antigua por proyecto..."* | A legacy `projects/` folder from deprecated designs was found in `~/.forge614/`. | Back up and manually remove that folder. The engine will not silently delete it. |
| `MIGRATION_REQUIRED` | *"Formato anterior detectado..."* or *"No se puede habilitar sincronización en este formato."* | SQLite database is in version 1 or 2, or sync was attempted on an incompatible database. | Keep your file intact. Schema 3 is required for local operation; schema 4 is required for sync. |
| `DATABASE_MISSING` | *"Falta la base configurada. No se creó un reemplazo..."* | `.env` is present, but `engram.db` is missing from disk. | The engine refuses to generate an empty replacement to prevent silent data loss. Restore `engram.db` from backup. |
| `DATABASE_PATH_UNSAFE` | *"La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido..."* | Database or auxiliary WAL/SHM files are symlinks, hard links, or owned by another user. | Ensure all database files are regular files owned by your operating system user account. |
| `DATABASE_SCHEMA` | *"La estructura no es compatible. No se modificó ni reparó la base."* | SQLite tables, triggers, or indexes do not match canonical schema definitions. | The engine rejects altered databases without attempting unsafe repairs. Use a genuine Forge614 database. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | Database `user_version` is newer than or incompatible with this binary. | Update your `forge614-engram` binary to the latest repository release. |
| `DATABASE_OWNER` | *"La base contiene una estructura ajena; usa una base vacía y dedicada."* | SQLite file contains tables from an unrelated third-party software application. | Provide a clean, dedicated database for Forge614 Engram. |
| `DATABASE_UNINITIALIZED`| *"La base no está inicializada. Conectar no crea tablas."* | Opened database in read-only mode prior to initializing schema. | Run `forge614-engram init` or confirm in `setup` to initialize tables. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | `sync` or `sync-watch` was executed but `.env` lacks `POSTGRES_URL` (format 2). | Run `forge614-engram setup` and select `Sí, configurar PostgreSQL` to enable sync. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Incompatible concurrent edits on the same entity across replicas, or a missing historical record. | The round is halted to protect data. **No automatic resolution exists in this version**. Do not delete tables or checkpoints. |
| `SYNC_LOCAL_CHANGED` | *"SYNC_LOCAL_CHANGED: sincronización detenida; se conservan los datos..."* | Local writes occurred in SQLite while waiting for remote network I/O. | Retry with `forge614-engram sync` or keep `sync-watch` running. |
| `SYNC_REMOTE_CHANGED` | *"SYNC_REMOTE_CHANGED: sincronización detenida; se conservan los datos..."* | Another replica advanced the PostgreSQL head revision between read and publish (CAS mismatch). | Retry via `forge614-engram sync`. The new round will pull remote changes and re-reconcile. |
| `SYNC_INVALID` | *"SYNC_INVALID: sincronización detenida; se conservan los datos..."* | Snapshot payload or its SHA-256 hash failed canonical integrity verification. | Check that external tools have not directly mutated the `forge614_sync` tables in PostgreSQL. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | Workspace snapshot exceeds the strict 8 MiB (8,388,608 bytes) safety boundary. | Storage exceeds current full-snapshot capacity. Archive obsolete records or await future incremental protocol versions. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida. Usa una URL PostgreSQL completa; TLS verificado es obligatorio..."* | Invalid URL protocol, missing database/user, illegal control characters, or `sslmode=disable` outside loopback. | Use `postgres://user:password@host:5432/dbname`. For remote hosts, verified TLS is mandatory; `sslmode=disable` is only allowed on `127.0.0.1` or `localhost`. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos. Los datos locales se conservan; comprueba conexión..."* | PostgreSQL server is down, unreachable network, bad credentials, or connection timeout. | Local SQLite operations remain 100% operational. Verify network connection and host settings without leaking secrets. |
| `POSTGRES_UNINITIALIZED`| *"POSTGRES_UNINITIALIZED: sincronización detenida; se conservan los datos..."* | Schema `forge614_sync` does not exist in PostgreSQL and `sync` was called without running `setup`. | Run `forge614-engram setup` to create the schema and initial state in PostgreSQL. |
| `POSTGRES_SCHEMA` | *"POSTGRES_SCHEMA: sincronización detenida; se conservan los datos..."* | PostgreSQL `revisions` or `state` tables are altered, incomplete, or contain foreign triggers/rules. | Use a dedicated or canonical PostgreSQL database. Do not manually alter the `forge614_sync` schema. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba permisos..."* | General OS I/O failure (disk full, hardware fault, filesystem lock). | Check available disk space and operating system filesystem permissions. |

---

## 3. Operational Recovery Scenarios

### 1. `SYNC_CONFLICT` Occurred During Synchronization
- **Cause:** You modified the exact same memory or project on two different computers without synchronizing between the two editing sessions.
- **System Safeguard:** Forge614 Engram halts the round immediately without modifying either your local SQLite or remote PostgreSQL databases. There is no silent overwrite and no last-write-wins clock resolution.
- **What NOT to do:** **Never delete the `sync_checkpoints` table, never purge `revisions` in PostgreSQL, and never delete `engram.db`.** Doing so erases cryptographic audit trails.
- **Current Status:** Automated or interactive conflict resolution commands are not available in this delivery. Both versions remain safely preserved in their respective databases.

### 2. PostgreSQL Server is Down (`POSTGRES_UNAVAILABLE`)
- **Offline Resilience:** A network outage or PostgreSQL downtime **never blocks or delays local operations**. You can continue executing `save`, `get`, `search`, `history`, and `archive` against local SQLite with zero latency.
- **Watcher Behavior:** `sync-watch` logs a warning to `stderr` and continues polling on its scheduled interval until the server recovers.

### 3. Orphaned `.config-lock` File After Terminal Crash
- **Cause:** If your workstation lost power or the terminal was abruptly killed while `setup` was writing `.env`, an orphaned lock file (`~/.forge614/.config-lock`) may remain.
- **Why It Isn't Deleted Silently:** To protect against overwriting another legitimate concurrent `setup` process running in a different terminal window.
- **Safe Recovery:** Verify via `ps aux | grep forge614-engram` that no other setup assistant is active. If clear, remove the lock manually with `rm ~/.forge614/.config-lock` and rerun `setup`.

### 4. PostgreSQL URL Rejected with `POSTGRES_URL`
- **Common Cause:** Attempting to specify `sslmode=disable` when connecting to a remote cloud database (e.g. Neon, Supabase, or a remote VPS).
- **Security Invariant:** Forge614 Engram strictly **enforces verified TLS encryption on all remote network connections**. The `sslmode=disable` exception is exclusively permitted when connecting to local loopback hosts (`127.0.0.1`, `localhost`, or `[::1]`).
