# 06 (EN). Troubleshooting and Error Diagnostics

> **Stage:** Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.5.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings)
> **Status:** Current & Active (Verified with 191 tests on macOS with Bun 1.3.8)
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This troubleshooting guide documents the comprehensive error code catalog of Forge614 Engram, including Model Context Protocol (MCP) diagnostics, the terminal UI menu (TUI), client hooks, and Git project resolution, detailing root causes and recommended recovery steps.

---

## 1. Core Safety Directive

> [!IMPORTANT]
> **Never delete your database, SQLite tables, or sync checkpoints to "fix" an error.**
> Errors in Forge614 Engram are active safety invariants. When the system detects directory ambiguity, external interference in client configuration files, or synchronization conflicts, it halts intentionally to **prevent silent data corruption and accidental loss**.

---

## 2. Comprehensive Error Catalog

| Error Code | Typical Error Message | Root Cause Explained | Recommended Fix |
| :--- | :--- | :--- | :--- |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* or *"setup necesita una terminal interactiva..."* | `tui` or `setup` was invoked from a non-interactive pipe (`\|`), redirect, or headless CI environment (`isTTY` false or no raw mode). | Run the command directly inside an interactive terminal. For scriptable non-interactive audits, use `forge614-engram assistant-list`. |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git del proyecto."* | Git is not installed, not in system PATH, or `git rev-parse` failed. | Install Git (`git --version`) and verify it is available in terminal PATH. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* or *"La carpeta del ejecutable no se usa..."* | An MCP tool was called in a non-git directory without an explicit path, or the binary directory was targeted as a project. | Pass the explicit `directory` parameter in the MCP call, or bind the folder beforehand with `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla."* | Attempted to search (`memory_search`), get (`memory_get`), or view history (`memory_history`) in an unbound directory before any save. | Save a durable note with `memory_save` (which creates the binding atomically) or bind manually using `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* or *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Ambiguity detected: either another project shares the display name, or recorded paths in `project_bindings` are missing from disk. | List registered projects via `forge614-engram project-list` and explicitly link the folder using `forge614-engram project-bind --directory /path --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Attempted to bind a directory path already bound to another `projectId`. | Inspect existing projects using `project-list` to verify project ownership. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | The AI assistant client has multiple workspace roots open simultaneously and did not pass `directory`. | Provide an explicit `directory` parameter in the MCP tool call. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | The assistant called `memory_save` with `scope: "shared"` without providing the required `globalIntent` explanation. | Provide a detailed explanation in `globalIntent` justifying why the note applies across all projects. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Attempted to run the TUI self-test from source code via Bun (`bun src/cli.ts tui`) without having the compiled binary installed in `$HOME/.local/bin/`. | Build and install the official binary via `bash scripts/install.sh` and rerun the menu using the installed binary. |
| `TIMED_OUT` | Server self-test reported as failed due to timeout. | The MCP server self-test exceeded its strict 5-second deadline for initialization, tool listing, and shutdown. | Ensure the host machine is not under extreme CPU starvation and that the binary has execution permissions (`0755`). |
| `MCP_FAILED` | Server self-test reported as failed. | The MCP server failed to complete the protocol handshake or did not expose the 5 expected tools. | Ensure the database has Schema 5 enabled via `forge614-engram integration-enable`. |
| `CANCELLED` | Server self-test canceled. | The user pressed `Escape` during the asynchronous self-test. | Clean cancellation; preserves user assistant selections. |
| `PUBLISHED_UNVERIFIED` | *"Publicado sin verificar: [ruta]"* | Configuration was applied to client files, but post-publication byte verification failed due to concurrent edits by another process. | Engram retains the `.bak` backup file. Close the client editor and re-apply settings via `tui`. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | In OpenCode, both `.json` and `.jsonc` files exist simultaneously, or multiple active sources exist without explicit selection. | Select the intended configuration file explicitly or remove duplicate configs in OpenCode. |
| `UNSUPPORTED_PLATFORM` | *"Assistant configuration currently supports macOS and Linux."* | Assistant configuration was invoked on an unsupported operating system. | Use macOS or Linux for developer assistant configuration. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* | Missing mandatory options, null bytes (`\0`), out-of-bounds numbers (`limit`), or incompatible flags. | Review syntax in `forge614-engram help`. Omit `--project-id` in `shared` mode; provide UUID in `project` mode. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | The provided `projectId` does not exist in the `projects` table of `~/.forge614/engram.db`. | Run `forge614-engram project-list` to check registered project UUIDs. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | The `--expected-version` number does not match the active version currently stored in the database. | Query current version using `get` or `history` and submit update with the matching version. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | A previously seen `--request-key` was submitted with differing title, content, or topic data. | When storing a new note or revision, use a new unique key (e.g. `--request-key req-02`) or omit the key. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic memory currently in an archived state. | Execute `restore` on the memory before publishing a new topic revision. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | Memory ID does not exist or does not match the provided project or shared scope. | Check whether the memory is project-scoped or shared, and verify UUID formatting. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Lock file `~/.forge614/.config-lock` is held by another running `setup` or `tui` process. | Wait for the other process to finish. If left behind by a crash, remove `.config-lock` manually. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | `sync` or `sync-watch` was executed but `.env` lacks `POSTGRES_URL` (format 2). | Run `forge614-engram setup` and select `Sí, configurar PostgreSQL` to enable sync. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Incompatible concurrent edits on the same entity across replicas. | The round is halted to protect data. No automatic resolution exists in this version; do not delete tables. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | Workspace snapshot exceeds the strict 8 MiB (`8,388,608 bytes`) safety boundary. | Archive obsolete records or partition your workspace. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida..."* | Invalid URL protocol or attempting `sslmode=disable` outside `127.0.0.1`/`localhost`. | Verified TLS is mandatory on remote connections. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos..."* | PostgreSQL server is unreachable or credentials are invalid. | Local SQLite operations remain 100% functional. Check network connectivity and credentials. |

---

## 3. Operational Recovery Scenarios

### 1. Codex Hooks Do Not Fire After TUI Configuration
- **Cause:** Codex enforces a native security model where newly installed hooks must be reviewed and trusted explicitly before execution.
- **Fix:** Open Codex and run the `/hooks` command. Review the Forge614 Engram hooks and mark them as trusted.

### 2. `PROJECT_BINDING_REQUIRED` Encountered in a New Directory
- **Cause:** The system detected that a previously registered directory path is no longer available on disk (e.g. you renamed a folder or unmounted an external drive). Engram halts conservatively to avoid creating an orphan duplicate project.
- **Fix:**
  1. Run `forge614-engram project-list` to view registered project UUIDs.
  2. Run `forge614-engram project-bind --directory /current/path --project-id <UUID>`.
  3. If the folder is genuinely a new project, create it first via `forge614-engram project-create --name "Name"` and bind it using `project-bind`.

### 3. MCP Server Self-Test Fails with `INSTALLATION_REQUIRED`
- **Cause:** You ran `bun src/cli.ts tui` from source without installing the standalone binary. For security, Engram never registers Bun as an installed server binary.
- **Fix:** Run `bash scripts/install.sh --force` to compile and publish the binary to `$HOME/.local/bin/forge614-engram`. Then run `forge614-engram tui`.

### 4. `PUBLISHED_UNVERIFIED` Reported During Configuration
- **Cause:** Claude Code, Cursor, or Codex modified the configuration file in the same millisecond Engram was writing changes.
- **Fix:** Engram preserves the pre-change backup with a UUID suffix. Close the editor client and rerun `forge614-engram tui` to apply the configuration cleanly.
