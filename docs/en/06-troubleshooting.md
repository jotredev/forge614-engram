# 06 (EN). Troubleshooting and Error Diagnostics

> **Stage:** Nonvisual Engine Transition (Task 1: Inspection & Preview, Task 2: Atomic Initialization Application), Retirement of setup (`COMMAND_RETIRED`), Ecosystem Contract (`FORGE614_ECOSYSTEM_CONTRACT.md`), TUI Control Center, Reinforced FTS5 (No Embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Product Home (`~/.forge614/engram/`), Safe Legacy Migration, Coordinated Uninstaller, Assistant TUI Menu & PostgreSQL Replica Formats 1, 2, and 3
> **Release Versions:** Program 1.1.0-beta.2 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) | SQLite Schemas 5 (assistants & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & search reinforcement) | PostgreSQL Formats 1, 2, and 3
> **Status:** Current & Active (582 tests passed, 15 skipped across 92 files on macOS ARM64 with Bun 1.3.8; native Windows tests validated on release binaries in GitHub Actions)
> **Sister translation:** [06. Resolución de Problemas y Catálogo de Errores](../es/06-resolucion-de-errores.md)

This troubleshooting guide provides an exhaustive diagnostic catalog of error codes, root causes, and recommended recovery procedures in Forge614 Engram, including the formal retirement of `setup` (`COMMAND_RETIRED`), guided and headless initialization (`init` and `init --json`), TUI Control Center, reinforced FTS5 search ranking, immutable confirmations (Schema 7), Format 3 PostgreSQL replication, dedicated product home, safe legacy data migration, guarded coordinated uninstallation, clock skew guards, idempotent retries, and assistant configuration conflicts.

---

## 1. Fundamental Safety Principle

> [!IMPORTANT]
> **Never delete your database, SQLite tables, or sync checkpoints to "fix" an error.**
> Errors in Forge614 Engram are active safety safeguards. When the system detects session ambiguities, divergent plugin contents, clock skew, migration conflicts, or schema incompatibilities, it intentionally halts to **protect data integrity and prevent silent information loss**.

---

## 2. Complete Error Code Catalog

| Error Code | Typical Message | Root Cause | Recommended Solution |
| :--- | :--- | :--- | :--- |
| `COMMAND_RETIRED` | *"El comando setup fue retirado. Usa forge614-engram init."* | Invoked the legacy `setup` command, which has been permanently retired to align with the unified Forge614 ecosystem architecture. | Replace script or terminal invocations with `forge614-engram init` (interactive terminal mode) or `forge614-engram init --json` (headless automation). |
| `LEGACY_UNSAFE` | *"Legacy workspace path or file is unsafe for migration..."* | The container directory `~/.forge614` or a legacy file is a symbolic link, owned by another user, or permits writes by other users. | Ensure current user ownership, remove symlinks, and remove unsafe write permissions without changing sibling product ownership. |
| `LEGACY_CONFLICT` | *"Conflict in target Engram product directory..."* | The directory `~/.forge614/engram/` already contains files colliding with legacy files, or orphaned WAL/SHM journals exist without main database. | Verify that `~/.forge614/engram/` does not contain duplicate files and that `engram.db` accompanies journal files. |
| `LEGACY_MIGRATION_FAILED` | *"Legacy file migration failed; atomic rollback applied..."* | I/O error occurred while moving legacy files; automatic atomic rollback was applied with zero data loss. | Verify disk space and write permissions in `~/.forge614/`. |
| `UNINSTALL_CONFIRMATION` | *"Exact uppercase confirmation phrase required..."* | The phrase passed to `--confirm` did not match the required phrase exactly. | Specify `--confirm "REMOVE FORGE614-ENGRAM"` (or add `AND FORGE614-ATLAS` if Atlas exists). |
| `UNINSTALL_UNSAFE` | *"Target uninstallation directory is unsafe..."* | The directory `~/.forge614/engram` or `~/.forge614/atlas` is a symbolic link or has unsafe permissions. | Ensure target directories are regular directories owned by the current user without symlinks. |
| `ATLAS_UNINSTALL_REQUIRED` | *"Forge614 Atlas is installed but its uninstaller is missing..."* | Forge614 Atlas is present in `~/.forge614/atlas/` but its executable binary does not exist or lacks execute permissions. | Install or repair the Atlas uninstaller at `~/.forge614/atlas/bin/forge614-atlas`. |
| `ATLAS_UNINSTALL_FAILED` | *"Forge614 Atlas uninstallation failed..."* | The Atlas uninstaller executable failed; Engram halted uninstallation to preserve state consistency. | Review Atlas error logs before retrying uninstallation. |
| `ASSISTANT_REMOVE_FAILED` | *"Failed to safely remove assistant configurations..."* | Failed to inspect or modify assistant configuration files (malformed JSON or access denied). | Check assistant configuration files and file access permissions. |
| `PATH_REMOVE_FAILED` | *"Failed to remove PATH entry..."* | I/O error modifying shell startup file or Windows registry. | Check write permissions for your shell startup file or Windows user environment registry. |
| `PATH_CONFLICT` | *"Delimited PATH block was edited manually or duplicated..."* | The delimited `# >>> forge614-engram PATH >>>` block was manually edited or duplicated in your dotfile. | Manually clean the `# >>> forge614-engram PATH >>>` block in your shell startup file. |
| `REINFORCEMENT_REQUIRED` | *"REINFORCEMENT_REQUIRED: habilita el Esquema 7 con reinforcement-enable..."* | The remote PostgreSQL replica synchronizes Format 3 (confirmations & requests) but the local SQLite database lacks Schema 7. | Run `forge614-engram reinforcement-enable` on the local machine before syncing. |
| `SYNC_UPGRADE_REQUIRED` | *"SYNC_UPGRADE_REQUIRED: la réplica remota requiere promoción explícita..."* | Attempted to sync against a replica in an earlier format (Format 1 or 2) without supplying `--upgrade-format`. | Run `forge614-engram sync --upgrade-format` deliberately to promote the replica to Format 3. |
| `CLOCK_SKEW` | *"CLOCK_SKEW: el reloj local marca una fecha anterior a la versión confirmada..."* | The local system clock is earlier than the timestamp recorded on the confirmed memory version. | Synchronize system clock with NTP or adjust date/time settings. |
| `REQUEST_CONFLICT` | *"REQUEST_CONFLICT: la clave de petición ya corresponde a otro contenido."* | Reused an existing `--request-key` with modified title, content, type, or pinned state (mismatched SHA-256 hash). | Use a fresh, unique request key for requests with differing content. |
| `MIGRATION_REQUIRED` | *"Habilita primero las sesiones."* or *"Habilita primero la integración..."* | A session command (`session-*`, `timeline`, `context`) or MCP tool was invoked before migrating SQLite to Schema 6 or 7. | Run `forge614-engram sessions-enable` (or `reinforcement-enable`) in your terminal to apply the additive migration. |
| `AMBIGUOUS_SESSION` | *"AMBIGUOUS_SESSION: indica sessionId ([id1], [id2])."* | An assistant invoked `memory_save` without `sessionId` while 2 or more runtime sessions were active in the past 7 days on the bound folder. | Supply the target session explicitly with `--session-id <id>` or close finished sessions with `session-end`. |
| `SESSION_NOT_FOUND` | *"Sesión no encontrada."* or *"Sesión no encontrada para este proyecto."* | The requested `sessionId` does not exist in `sessions` or does not belong to the active `projectId`. | Verify session ID and project association, or start a new session with `session-start`. |
| `SESSION_CONFLICT` | *"El identificador de sesión no está disponible."* | Attempted to start a session with a `sessionId` already in use by another project or session kind. | Use a fresh, unique session identifier for this task. |
| `SESSION_CLOSED` | *"La sesión está cerrada."* | Attempted to associate a new memory entry with a session that has already ended (`endedAt` is not null). | Start a new runtime session with `session-start` or bind to an open session. |
| `SESSION_KIND` | *"Una sesión manual no admite asociación explícita."* or *"Una sesión manual no puede cerrarse."* | Attempted to explicitly associate or close a machine-local `manual` fallback session. | Use runtime sessions initiated via `session-start`. |
| `NO_SESSION_CONTEXT` | *"NO_SESSION_CONTEXT: no existe contexto de sesión..."* or *"el recuerdo no pertenece a esta sesión o está archivado."* | During `timeline` reconstruction, the specified memory has no entry in the given session or is archived. | Verify that `id` and `version` match the session log and that the memory remains active. |
| `SUMMARY_TOPIC_RESERVED` | *"El tema está reservado para un resumen de sesión."* | Attempted to save a standard memory using the reserved topic format `session/<id>/summary`. | Use an ordinary topic key or save summaries using the official `session-summary` command. |
| `SUMMARY_TOPIC_CONFLICT` | *"El tema reservado ya pertenece a otro recuerdo."* or *"El resumen no coincide con su puntero."* | Pointer mismatch between `session_summaries` and the stored memory record. | Retrieve the prior summary with `get` and supply `--expected-version` or verify your request key. |
| `CONFLICT` | *"The dedicated Engram plugin already exists with different contents..."* | In OpenCode, `plugins/forge614-engram.js` already exists with custom or divergent code. | Engram never overwrites modified plugins. Back up your existing plugin, remove or reconcile it, and re-run `forge614-engram tui`. |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* or *"init necesita una terminal interactiva. Para scripts utiliza init --json y project-create --name <nombre>."* | The TUI Control Center (`tui`) or interactive initialization (`init`) was invoked in an unattended environment, pipeline (`\|`), redirection (`< /dev/null`), or subshell without interactive raw mode TTY support. | Run the command directly in a real interactive terminal emulator. For scripts, automation, or CI/CD pipelines, use `init --json` for initialization, followed by non-interactive CLI commands such as `project-create`, `project-list`, `assistant-list`, `status`, `health`, or TypeScript SDK helpers (`inspectMemoryInitialization`, `applyMemoryInitialization`). |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git..."* | Git is not installed, not in PATH, or `git rev-parse` failed. | Install Git (`git --version`) and ensure it is accessible in your system PATH. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* | Invoked MCP in a non-Git directory without passing directory, or tried to use binary path as project. | Pass `directory` explicitly in MCP tool calls or bind the directory beforehand with `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada..."* | Attempted queries on an unbound folder before saving an initial memory or starting a session. | Save an initial note with `memory_save` (auto-creates binding) or link with `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* or *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Name collision or a previously registered binding is missing on disk (folder moved or drive unmounted). | Check projects with `project-list` and bind explicitly with `project-bind --directory /path --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Attempted to bind a folder that already belongs to another `projectId`. | Inspect bindings with `project-list` and determine whether to reassign. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | Client has multiple workspace roots open simultaneously without specifying `directory`. | Pass the explicit `directory` parameter in tool arguments. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | Assistant called `memory_save` with `scope: "shared"` without providing `globalIntent`. | Supply `globalIntent` explaining why the decision applies universally. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Ran self-test in `tui` directly from source with Bun without installing the standalone binary. | Run `bash scripts/install.sh` to install the binary to `$HOME/.local/bin/forge614-engram`. |
| `TIMED_OUT` | Server self-test reported as timed out. | MCP self-test exceeded the strict 5-second deadline to spawn, handshake, and list tools. | Verify CPU load and ensure executable has `0755` permissions. |
| `PUBLISHED_UNVERIFIED` | *"The file was published but its planned bytes could not be safely verified..."* | Configuration was applied to disk, but post-publication verification detected that written bytes do not match planned bytes (`write.after`), typically due to concurrent writes. | Engram preserves the `.forge614-backup-<UUID>` backup copy intact without executing destructive rollback. Close editors and re-run configuration from `tui`. |
| `UNSAFE_PATH` | *"Configuration paths must not traverse Windows reparse points."* or *"Could not verify Windows reparse-point safety."* or *"Configuration paths must not traverse symbolic links."* | Target path or an existing ancestor directory contains symbolic links, directory junctions, reparse points (on Windows), other-user write permissions (on Unix), or the native Windows addon failed (*fail-closed*). | Eliminate symbolic links or junctions in the path. On Windows, if building from source, compile the native addon with `scripts/build-windows-reparse-addon.ps1`. |
| `CHANGED` | *"Configuration changed after preview..."* or *"Configuration changed before replacement..."* | The target configuration file changed on disk while reviewing the preview or while preparing the temporary replacement file. | Halts to prevent overwriting third-party changes. Close background editors and generate a fresh preview in `tui`. |
| `CONFIG_CHANGED` | *"La configuración cambió; genera una vista previa nueva antes de aplicar cambios."* | When calling `applyMemoryInitialization` from the SDK, `.env` fingerprint differs from the preview (`expectedRevision`). | Request a fresh preview with `previewMemoryInitialization` and apply with the new revision stamp. |
| `UNSAFE_FILE` | *"Configuration must be a regular file owned by the current user."* | The target file is not a regular file, has hard links (`nlink !== 1`), or is owned by another system user. | Ensure the configuration file is owned by the current user and has no shared hard links. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | OpenCode has simultaneous `.json` and `.jsonc` files, or multiple active configuration directories. | Select configuration file explicitly in TUI or remove duplicate config files. |
| `INVALID_INPUT` | *"El campo [field] debe ser texto no vacío..."* | Empty options, null characters (`\0`), out-of-range limits, or incompatible flags (e.g. `--upgrade-format` on `sync-watch`). | Check valid options with `forge614-engram help`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | The `projectId` does not exist in `projects` under `~/.forge614/engram/engram.db`. | Run `forge614-engram project-list` to verify project UUIDs. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | The `--expected-version` does not match the active version in SQLite. | Query current version with `get` or `history` and update with the correct version. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Attempted to update a topic whose memory is in archived status. | Run `restore` on the memory before saving the new version. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | Memory UUID does not exist or does not belong to the selected scope. | Verify scope and verify UUID accuracy. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Lockfile `~/.forge614/engram/.config-lock` is held by another process running `init` or `tui`. | Wait for completion or remove `.config-lock` if orphaned by an abrupt termination. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta init para configurarla."* | Invoked `sync` or `sync-watch` without `POSTGRES_URL` in `.env`. | Run `forge614-engram init` and select configuring PostgreSQL, or call `applyMemoryInitialization({ postgresUrl: ... })` via SDK. |
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

### 2. Peer Device Coordination on PostgreSQL Format 3 Promotion (`REINFORCEMENT_REQUIRED` and `SYNC_UPGRADE_REQUIRED`)
- **Symptom:** After executing `sync --upgrade-format` on computer A, computer B reports `REINFORCEMENT_REQUIRED` or `SYNC_UPGRADE_REQUIRED` when running `sync`.
- **Root Cause:** The PostgreSQL replica was promoted to **Format 3** (including confirmations and request replay records), but computer B's local SQLite database has not yet been upgraded to Schema 7.
- **Recovery Procedure:**
  1. Update Forge614 Engram on computer B (`bash scripts/install.sh --force`).
  2. Enable Schema 7 locally on computer B:
     ```bash
     forge614-engram reinforcement-enable
     ```
  3. Execute standard synchronization:
     ```bash
     forge614-engram sync
     ```
  Both machines now sync cleanly under Format 3.

---

### 3. Assistant Reports `AMBIGUOUS_SESSION` on Memory Save
- **Symptom:** When asking an assistant to save a technical decision, `memory_save` fails with `AMBIGUOUS_SESSION: indica sessionId (ses-a, ses-b)`.
- **Root Cause:** Multiple runtime work sessions were started in the same folder within the last 7 days and remain unclosed.
- **Recovery Procedure:**
  - Option A: Tell the assistant explicitly: *"Save this memory associating it with session ses-a"*.
  - Option B: Conclude obsolete open sessions from your terminal:
     ```bash
     forge614-engram session-end --project-id <UUID> --session-id "ses-b"
     ```
     Once only one runtime session remains open, subsequent saves auto-bind via contextual inference.

---

### 4. System Clock Skew on Confirmations (`CLOCK_SKEW`)
- **Symptom:** Running `save` or calling `memory_save` halts with error code `CLOCK_SKEW`.
- **Root Cause:** The computer's local clock is earlier than the timestamp recorded on the confirmed memory version. This occurs when a machine loses time sync or the system clock is manually set backward.
- **Recovery Procedure:**
  1. Synchronize system time using Network Time Protocol (NTP):
     - On macOS: Open *System Settings* $\rightarrow$ *General* $\rightarrow$ *Date & Time* and toggle "Set time and date automatically".
     - On Linux: Run `sudo timedatectl set-ntp true` or `sudo ntpdate pool.ntp.org`.
  2. Re-run the save operation; it will succeed now that causal temporal progression is restored.

---

### 5. Payload Conflict on Idempotent Request Retries (`REQUEST_CONFLICT`)
- **Symptom:** Memory save halts with error code `REQUEST_CONFLICT`.
- **Root Cause:** The client or assistant reused an existing `--request-key` while sending modified title, content, scope, or type. Engram preserves transactional immutability by forbidding payload modifications under the same idempotency key.
- **Recovery Procedure:**
  - If intending to modify the memory content, use a fresh, unique request key (e.g., `--request-key "req-task-02"`).
  - If intending to retry an interrupted operation without changes, verify that the parameters and content match the original request exactly.

---

### 6. Safety Control, Safe Cancellation, and Non-Interactive Execution (`INTERACTIVE_REQUIRED`)
- **Symptom:** Invoking `forge614-engram tui` or `forge614-engram init` (without `--json`) in a script, pipe, redirection, or CI/CD runner halts immediately with exit code `1` and a structured error message:
  - In `tui`: *"tui necesita una terminal interactiva (TTY y raw mode) para renderizar el Centro de Control o configurar asistentes."*
  - In `init`: *"init necesita una terminal interactiva. Para scripts utiliza init --json y project-create --name <nombre>."*
- **Root Cause:** Both the TUI Control Center and the interactive initialization wizard require an authentic physical terminal with raw mode support to capture keyboard events safely and render interactive views. To prevent runaway hangs or corrupted output in unattended automated environments, they preemptively halt without altering any system state.
- **Recovery Procedure & Safety Safeguards:**
  1. **For interactive use:** Run the command directly in a supported terminal emulator (Ghostty, iTerm2, Alacritty, Terminal.app).
  2. **For scripts and CI/CD pipelines:** Use the official headless initialization flag `forge614-engram init --json` (which initializes SQLite storage locally and outputs `{"initialized": true, "storage": "sqlite"}` without prompts), followed by non-interactive CLI commands such as `forge614-engram project-create --name <name>`, `forge614-engram project-list`, `forge614-engram assistant-list`, `forge614-engram status`, `forge614-engram health`, or TypeScript SDK programmatic helpers (`inspectMemoryInitialization`, `applyMemoryInitialization`).
  3. **Zero-write cancellation safety:** The Control Center starts 100% read-only. Browsing tabs (`Summary`, `Projects`, `Shared`, `Storage`), resizing windows, or pressing `Escape`, `q`, or `Ctrl+C` exits immediately, restoring terminal settings without writing a single byte to disk.
  4. **In-flight action input draining:** When executing a two-step confirmed action (explicitly typing `confirm` and pressing `Enter`), the Control Center locks input and drains all incoming keypresses while migrations or PostgreSQL sync run. This prevents buffered keystrokes from unintentionally executing follow-up actions upon completion.

---

### 7. Diagnosing Unsafe Paths, Symbolic Links, and Windows Reparse Points (`UNSAFE_PATH`)
- **Symptom:** When configuring an assistant or writing configuration, the operation halts throwing `UNSAFE_PATH` with one of the following error messages:
  - *"Configuration paths must not traverse Windows reparse points."*
  - *"Could not verify Windows reparse-point safety."*
  - *"Configuration paths must not traverse symbolic links."*
  - *"A configuration parent is not a directory."*
  - *"A configuration parent is writable by other users."*
- **Root Cause:**
  1. On **Windows**: The target path or an existing ancestor directory is a symbolic link, NTFS directory junction (created via `mklink /J`), or volume mount point (created via `mountvol.exe`). The native `windows_reparse_guard.node` addon detected `FILE_ATTRIBUTE_REPARSE_POINT`.
  2. On **Windows (*Fail-Closed*)**: The native C++ addon cannot be found, threw an unhandled operating system exception, or returned an anomalous non-boolean result.
  3. On **macOS/Linux**: The target path or its ancestors traverse symlinks not recognized as system aliases (excluding root-owned `/var` and `/tmp`), or an ancestor directory has world-writable permissions (`chmod o+w`).
- **Recovery Procedure:**
  1. If running on Windows with linked drives or junctions pointing across volumes, provide the target physical drive path directly rather than the symbolic junction.
  2. If building from source on Windows, verify that the native addon is compiled:
     ```powershell
     pwsh -File scripts/build-windows-reparse-addon.ps1
     ```
  3. On Unix systems, `forge614-engram init` and `init --json` repair only Engram's own existing `~/.forge614/engram` directory to `0700`; they validate but do not chmod the shared `~/.forge614` container.
     If the directory is owned by another user (such as `root` from an accidental `sudo` command), restore correct user ownership and permissions:
     ```bash
     sudo chown -R $(id -un):$(id -gn) ~/.forge614
     chmod go-w ~/.forge614
     ```
     If `~/.forge614` is a symbolic link, Engram intentionally blocks it fail-closed and will not attempt to repair it; you must remove the symlink and use an ordinary physical directory.

---

### 8. Concurrent Modifications and Unverified Publication (`CHANGED` and `PUBLISHED_UNVERIFIED`)
- **Symptom:** The assistant configurator halts throwing `CHANGED` or `PUBLISHED_UNVERIFIED`.
- **Root Cause:**
  - `CHANGED`: On-disk configuration changed while viewing the interactive plan preview (`write.before`) or during temporary file preparation in `guardedWrite`.
  - `PUBLISHED_UNVERIFIED`: The temporary file was renamed atomically over the destination path, but immediate post-publication byte verification detected a mismatch between read bytes and planned bytes (`write.after`).
- **Recovery Procedure:**
  1. Engram **preserves the backup file** `.forge614-backup-<UUID>` intact with `0600` permissions and exclusive creation mode (`flag: 'wx'`). No destructive rollback is performed that could damage external data.
  2. Close any code editor (VS Code, Cursor, Zed) or assistant client that may be autosaving or updating config files (`settings.json`, `mcp_config.json`).
  3. Inspect the file state and relaunch `forge614-engram tui` to generate a clean preview and retry publication.

---

### 9. Safe Legacy Workspace Migration & Conflict Resolution (`LEGACY_CONFLICT`, `LEGACY_UNSAFE`, `LEGACY_MIGRATION_FAILED`)
- **Symptom:** Invoking `init` or `init --json` fails with `LEGACY_CONFLICT`, `LEGACY_UNSAFE`, or `LEGACY_MIGRATION_FAILED`.
- **Root Causes:**
  - `LEGACY_UNSAFE`: The container directory `~/.forge614` or any loose legacy file (`.env`, `engram.db`, etc.) is a symbolic link, owned by another user, or fails permission verification.
  - `LEGACY_CONFLICT`: The target directory `~/.forge614/engram/` already contains files colliding with legacy files in `~/.forge614/`, or orphaned WAL/SHM journals exist without the primary `engram.db` database.
  - `LEGACY_MIGRATION_FAILED`: An unexpected I/O error occurred during file migration. Engram automatically rolled back all moved files to their original location with zero data loss.
- **Recovery Procedure:**
  1. If `LEGACY_UNSAFE` is reported, verify that `~/.forge614` is an ordinary directory owned by your user and repair permissions:
     ```bash
     chmod go-w ~/.forge614
     ```
  2. If `LEGACY_CONFLICT` is reported, inspect both `~/.forge614/` and `~/.forge614/engram/`. If you already have active data in `engram/`, back it up and remove old duplicate files in the root of `~/.forge614/`.
  3. If orphaned `engram.db-wal` or `engram.db-shm` files exist without `engram.db`, clean them up or restore them alongside their matching database file.
  4. Re-run `forge614-engram init` to complete the migration cleanly.

---

### 10. Guarded Uninstallation Coordinated with Atlas (`UNINSTALL_CONFIRMATION`, `ATLAS_UNINSTALL_REQUIRED`, `PATH_CONFLICT`)
- **Symptom:** Running `forge614-engram uninstall` halts with one of these errors.
- **Root Causes:**
  - `UNINSTALL_CONFIRMATION`: The confirmation phrase was not uppercase or omitted the required Atlas clause.
  - `ATLAS_UNINSTALL_REQUIRED`: Forge614 Atlas is present in `~/.forge614/atlas/` but its uninstaller executable is missing or not executable.
  - `ATLAS_UNINSTALL_FAILED`: The Atlas uninstaller exited with an error. Engram halted immediately to prevent leaving the environment in an inconsistent state.
  - `PATH_CONFLICT`: The delimited PATH block in your shell dotfile was manually edited or duplicated.
- **Recovery Procedure:**
  1. If only Engram is installed, supply the exact standalone confirmation phrase:
     ```bash
     forge614-engram uninstall --confirm "REMOVE FORGE614-ENGRAM"
     ```
  2. If Atlas is installed, supply the mandatory extended phrase:
     ```bash
     forge614-engram uninstall --confirm "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS"
     ```
  3. If `ATLAS_UNINSTALL_REQUIRED` is reported, ensure the Atlas binary is located at `~/.forge614/atlas/bin/forge614-atlas` with executable permissions (`0755`).
  4. If `PATH_CONFLICT` is reported, open your shell startup file (`.zshrc`, `.bashrc`, etc.) and manually remove the `# >>> forge614-engram PATH >>>` block before retrying.

---

### 11. Formal Retirement of the setup Command (`COMMAND_RETIRED`)
- **Symptom:** Executing `forge614-engram setup` halts immediately with exit code `1` and emits the following structured JSON to stderr:
  ```json
  {
    "code": "COMMAND_RETIRED",
    "error": "El comando setup fue retirado. Usa forge614-engram init."
  }
  ```
- **Root Cause:** As part of the architectural transition toward the unified Forge614 ecosystem (`FORGE614_ECOSYSTEM_CONTRACT.md`), the `setup` subcommand was permanently retired from the public CLI. Engram no longer recognizes `setup` or keeps it as a silent alias, guaranteeing deterministic, unambiguous CLI behavior.
- **Recovery Procedure:**
  1. For an interactive guided terminal setup (selecting storage, optional PostgreSQL replica configuration, additive FTS5 reinforcement, and transition to `assistantTui`), run:
     ```bash
     forge614-engram init
     ```
  2. For automated environments, bash scripts, or container setup in CI/CD pipelines, run headless:
     ```bash
     forge614-engram init --json
     ```
     This command never opens interactive prompts or reads from stdin; it returns `{"initialized": true, "storage": "sqlite"}` with exit code 0.
