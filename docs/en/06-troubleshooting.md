# 06. Troubleshooting and Error Diagnostics

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This guide helps you diagnose and resolve any error emitted by the Forge614 Engram CLI or TypeScript SDK.

---

## 1. Complete Error Code Catalog

When an operation cannot be completed, the system returns structured JSON with an error `code` and descriptive `error` message.

> [!IMPORTANT]
> **Never delete your database to fix errors.** Forge614 Engram errors are defensive guards designed to protect historical integrity and prevent accidental data loss. Every error has a clean resolution.

| Error Code | Typical Message | Root Cause | Recommended Action |
| :--- | :--- | :--- | :--- |
| `INVALID_INPUT` | *"El campo [field] debe ser texto no vacío..."* or *"Tipo no válido."* | Missing required argument, empty text, null characters (`\0`), limit out of bounds (must be 1..100), or invalid type. | Verify command arguments. If using `save`, confirm `title` and `content` are non-empty strings. If providing `--expected-version`, ensure `--topic` is also supplied. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | The `--expected-version` number does not match the current revision recorded in the database. Occurs when another process updated the topic first. | Run `forge614-engram get` or `history` to check the current version on disk. Review recent changes and submit the update specifying the updated version. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | A `--request-key` was previously used in this project with different title, content, type, or topic. | If submitting a distinct memory or revision, provide a fresh request key (e.g. `--request-key demo-v3`) or omit the flag. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic that is currently in `archived` state. | Run `forge614-engram restore --project <project> --id <uuid>` to activate the memory before saving the new revision. |
| `NOT_FOUND` | *"Recuerdo no encontrado en este proyecto."* | The provided `--id` does not exist in the database or belongs to another project. | Verify that `--project` matches the project where the memory was stored, and check the UUID for typos. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | The SQLite database has a schema version (`user_version > 1`) created by a newer version of Forge614 Engram. | Upgrade your Forge614 Engram installation to the latest version to match the database schema. |
| `DATABASE_OWNER` | *"Esta base no pertenece a Forge614."* or *"La base ya contiene tablas ajenas..."* | Attempted to open an SQLite file created by an unrelated program or missing the Forge614 identifier (`application_id = 1177956660`). | Provide a dedicated database file path for Forge614 using `--db <path>`. By default the system uses `~/.forge614/engram.db`. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba la ruta..."* | Operating system level failure: permission denied, disk full, or hardware I/O error. | Verify write permissions in `~/.forge614/` and ensure sufficient disk space is available. |

---

## 2. Frequent Operational Scenarios

### 1. Where are my previous memories from `.forge614/memory.sqlite`?
- **Explanation:** Earlier prototypes stored databases inside the directory where the command was executed. The system now centralizes storage at `~/.forge614/engram.db`.
- **Resolution:** Legacy database files were not altered or deleted. To inspect previous records, pass the `--db` flag:
  ```bash
  forge614-engram search --db ./path/to/legacy/.forge614/memory.sqlite --project demo --query SQLite
  ```

### 2. Concurrent Processes and Terminal Wait Time
- **Mechanism:** SQLite serializes write transactions. Forge614 Engram sets a `busy_timeout` of **5 seconds**.
- **Resolution:** If a write takes a few moments to execute, it is waiting for an active write to commit. If it times out after 5 seconds, ensure no hung process is locking the database file.

### 3. Updated Memory Lost Its "decision" Type or Pinned Status
- **Mechanism:** The CLI resets omitted fields to defaults (`fact` and `false`). Updates replace the entire record.
- **Resolution:** When revising an important note, always pass all desired flags explicitly:
  ```bash
  forge614-engram save --project demo --topic architecture/database --expected-version 2 --type decision --pinned true --title "..." --content "..."
  ```
