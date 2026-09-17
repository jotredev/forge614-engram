# 06. Troubleshooting and Error Diagnostics

> **Stage:** Stage 1 — Local Memory (Single Database and Shared Memory)
> **Release Versions:** Program 0.2.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Active
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This diagnostic guide helps you resolve any error emitted by the Forge614 Engram CLI or TypeScript SDK, explaining root causes and safe remediation steps.

---

## 1. Safety Principle

> [!IMPORTANT]
> **Never delete your database or configuration to resolve an error.**
> Error codes in Forge614 Engram are protective guardrails. When the system detects an unverified file, unsafe permissions, or an older schema version, it halts execution to **prevent accidental data loss or corruption**.

---

## 2. Complete Error Code Catalog

| Error Code | Typical Message | Root Cause | Recommended Action |
| :--- | :--- | :--- | :--- |
| `INVALID_INPUT` | *"El campo [field] debe ser texto no vacío..."* or *"scope shared no acepta --project-id..."* | Missing required flag, empty string, null byte (`\0`), out-of-bounds limit, or mutually exclusive arguments. | Check command options. Shared memory operations must not pass `--project-id`. Project operations must specify `--project-id`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado."* | The provided `projectId` does not exist in the central `projects` table. | Run `forge614-engram project-list` to verify registered project UUIDs. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | Stale update: the `--expected-version` number does not match the active version in SQLite. | Run `get` or `history` on that memory to read its current version, then resubmit with the correct version number. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | The `--request-key` was previously used with a different title, content, topic, or type. | If saving a new revision or distinct note, specify a new request key or omit the flag. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic that is currently in an archived state. | Run `restore` on the memory before saving the new revision. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | Memory UUID not found in the specified scope (project or shared). | Verify whether the memory was saved as shared or under a specific project, and confirm UUID accuracy. |
| `CONFIG_NOT_FOUND` | *"Configuración global inválida o inaccesible..."* | Missing `~/.forge614/.env` file. | Run `forge614-engram init` to create the configuration file securely. |
| `CONFIG_INVALID` | *"Configuración global inválida o inaccesible. Comprueba su formato, propietario y permisos..."* | Unsafe permissions on `.env` (must be `0600`), directory mode (must be `0700`), wrong owner, or malformed keys. | Set directory mode `0700` (`chmod 700 ~/.forge614`) and `.env` mode `0600` (`chmod 600 ~/.forge614/.env`). |
| `LEGACY_CONFIG` | *"Se detectó configuración antigua por proyecto. No se modificó. Su conversión debe ser explícita..."* | A legacy `projects/` directory was detected inside `~/.forge614/`. | The software does not automatically delete or alter this folder. Inspect and back up its data before removing it manually. |
| `MIGRATION_REQUIRED` | *"Formato anterior detectado. Conserva el archivo: no se modificó la base..."* | The database has an obsolete schema (version 1 or 2). | Schema version 3 is required. Retain your backup; no automatic in-place migration is run on real data. |
| `DATABASE_MISSING` | *"Falta la base configurada. No se creó un reemplazo; conserva la configuración y recupera tu base."* | The `.env` file exists, but `engram.db` is missing from `~/.forge614/`. | The system never silently creates an empty substitute database. Restore your `engram.db` backup. |
| `DATABASE_PATH_UNSAFE` | *"La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido. No se abrió SQLite."* | `engram.db` or its WAL/SHM sidecars are symlinks, hard links, or owned by another OS user. | Ensure all database files are regular files owned exclusively by your user account. |
| `DATABASE_SCHEMA` | *"La estructura no es compatible. No se modificó ni reparó la base."* | SQLite tables, triggers, or indexes do not match canonical schema definition version 3. | Ensure you are targeting a legitimate Forge614 Engram database without foreign alterations. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | Database `user_version` is incompatible with this release. | Upgrade your `forge614-engram` binary to the latest software release. |
| `DATABASE_OWNER` | *"La base contiene una estructura ajena; usa una base vacía y dedicada."* | The SQLite database contains tables created by third-party software. | Use a clean, dedicated database file for Forge614 Engram. |
| `DATABASE_UNINITIALIZED`| *"La base no está inicializada. Conectar no crea tablas."* | Attempted to open the database in read-only mode before it was initialized. | Run `forge614-engram init` to create the initial tables. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba permisos, configuración..."* | Operating system I/O error: disk full, permanent lock, or filesystem permission failure. | Check available disk space and filesystem permissions. |

---

## 3. Common Operational Scenarios

### 1. `LEGACY_CONFIG` detected on command execution
- **Cause:** An older `projects/` directory remains inside `~/.forge614/` from previous prototype releases.
- **Remediation:** The system halts intentionally to safeguard old information. Inspect `~/.forge614/projects/`. If it contains test data, remove the folder; if it contains important data, copy it to a secure backup before removing the directory.

### 2. Missing database triggers `DATABASE_MISSING`
- **Cause:** The configuration `.env` exists, but `engram.db` is absent.
- **Why it is not auto-created:** Silently recreating an empty database would cause a user who accidentally moved their database to believe their data was lost. The system halts so you can restore your original `engram.db` file.

### 3. Terminal pauses briefly before completing a write
- **Cause:** Another process is actively writing to the SQLite database.
- **Behavior:** SQLite serializes write transactions. With `busy_timeout = 5000`, the CLI waits up to 5 seconds for the active transaction to finish before raising an error.
