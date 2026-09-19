# 01 (EN). Installation, Setup, and Getting Started

> **Stage:** TUI Control Center, Reinforced FTS5 (no embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & reinforced ordering) | PostgreSQL Formats 1, 2 & 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Enrollments:** Explicit and additive (`integration-enable` for Schema 5; `sessions-enable` for Schema 6; `reinforcement-enable` for Schema 7; `sync --upgrade-format` for replica Format 2 or Format 3). Database opening, the TUI control center, and ordinary commands never auto-migrate databases.
> **Status:** Current & Verified (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This step-by-step guide walks through preparing dependencies, compiling and installing the `forge614-engram` command, mandatory prerequisites (including Git), post-install assistant detection, the interactive `setup` wizard with the search reinforcement offer, the **interactive Terminal Control Center (`tui`)**, explicit enablement of assistant integration (Schema 5), progressive sessions (Schema 6), immutable FTS5 confirmations (Schema 7), and peer device coordination.

---

## 1. What is this program and how is it distributed?

Forge614 Engram is a personal local memory system for artificial intelligence models and developers, written in **TypeScript**. Unlike public web packages:
- **Not downloaded from npm:** `npm install forge614-engram` does not exist because this is a private development package.
- **Compiled locally:** Packaged directly from repository source code using the install script (`scripts/install.sh`).
- **Produces a standalone binary:** Outputs a standalone binary named `forge614-engram`. Once installed, **it does not require Bun or Node.js in PATH** for routine execution.

### System Prerequisites

1. **Bun (stable version >= 1.3.8):**
   Required strictly to **build and install** the program from source code or execute the automated test suite.
   ```bash
   bun --version
   ```
   If not yet installed, download from [bun.sh](https://bun.sh).

2. **Git (Available in PATH — Mandatory):**
   **Git is a mandatory system requirement**, not only for cloning the repository, but because Engram's project identity resolver relies on Git (`git rev-parse --path-format=absolute --git-common-dir`) to resolve common roots, linked worktrees, and subdirectories. Git is also strictly required to certify that a folder does **not** belong to Git. If Git is missing or unavailable in PATH, project resolution halts safely with `PROJECT_IDENTITY_UNAVAILABLE`.
   ```bash
   git --version
   ```

3. **Operating System:**
   - **macOS or Linux:** With a Bash-compatible shell (`bash`).
   - **Windows:** Requires PowerShell 7+ (`pwsh`) for the official installer (`install.ps1`). To compile the native security addon from source on Windows, you require **Node.js (>= 22.14.0)**, **`node-gyp` (version 12.1.0 pinned in `devDependencies`)**, **Python (3.12+)**, and **Visual Studio 2026 Build Tools** (Microsoft C++ compiler). *(Note: once the standalone binary is installed, the end user does not need compilers or Node.js dependencies in their PATH).*

4. **PostgreSQL Server (Optional):**
   Required only if enabling remote replication. Requires PostgreSQL 14 or higher with permissions to create and write to the `forge614_sync` schema.

---

## 2. Dependency Preparation and Installation

### Step 2.1 — Prepare local dependencies in a clean checkout

The installer **never downloads network dependencies automatically** nor alters your lockfile (`bun.lock`). In a clean repository checkout, prepare frozen dependencies prior to building:

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-engram
bun install --frozen-lockfile --ignore-scripts
```

> [!IMPORTANT]
> If local dependencies in `node_modules/` are missing or versions do not match `package.json` exactly, the installer prints an explicit error message and halts before compiling or publishing any files.

### Step 2.2 — Run the standalone installer

From the repository root directory:

```bash
bash scripts/install.sh
```

#### What does the installer do?
1. Verifies Bun availability (version >= 1.3.8).
2. Verifies Git availability in system PATH.
3. Verifies local dependencies against `package.json` without network downloads or silent lockfile modifications.
4. Compiles `src/cli.ts` into a native standalone executable using `bun build ./src/cli.ts --compile`.
5. Atomically hard-links the binary to `$HOME/.local/bin/forge614-engram` with `0755` permissions.
6. **Overwrite Protection:** If the target binary exists, it stops to prevent unauthorized overwrites. To update an existing installation, use `--force`:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Note: `--force` updates only the executable binary; it never alters `.env` or memories in `engram.db`).*
7. **Custom Directory:** To install into an alternate directory:
   ```bash
   bash scripts/install.sh --bin-dir /path/to/bin
   ```
8. **Post-install Assistant Detection:** Following binary publication, it runs a read-only audit (`assistant-list`) detecting installed AI coding assistants (Claude Code, Codex, Cursor, OpenCode, Antigravity).
9. **Interactive TUI Control Center Prompt:** If running in an interactive terminal (TTY stdin and stdout), the installer prompts:
   ```text
   ¿Abrir ahora el menú de asistentes? [s/N]
   ```
   Answering yes (`s` or `si`) immediately launches the interactive `tui` Control Center. If running non-interactively (e.g., CI script), it skips without modifying configuration or initializing storage and prints the command to launch later.
10. **Zero Project Prompting:** The installer **never prompts for project selection or creation**.

---

## 3. Terminal PATH Configuration

To invoke `forge614-engram` directly from any directory without typing its full path (`$HOME/.local/bin/forge614-engram`), ensure the binary directory is in your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> Make this change persistent by adding it to your shell configuration (`~/.zshrc` on macOS or `~/.bashrc` on Linux).

---

## 4. Verifying Installation

Verify the installed version and command help without writing to disk or creating databases:

```bash
# Verify installed version
forge614-engram --version
# Expected output: forge614-engram 0.5.0

# Print official help reference
forge614-engram help
```

### Official `forge614-engram help` Output:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
tui             Centro de control local. Asistentes con vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve al formato local habilitado (hasta 3).
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
reinforcement-enable
                Habilita explícitamente repeticiones y orden reforzado (esquema 7).
mcp             Inicia el servidor MCP local por stdio; no migra la base.
assistant-list  Detecta asistentes y muestra configuración/cobertura sin escribir archivos.
memory-hook     --client <claude-code|codex|cursor|opencode|antigravity>
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>
project-bind    --directory <carpeta> --project-id <UUID>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false] [--session-id <id>] [--session-project-id <UUID>]
         type=fact por defecto; un save shared con sesión requiere --session-project-id.
get      --id <recuerdo> [--version <n>]
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>] [--preview]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         limit=10; con proyecto, scope=all: proyecto + shared.

Sesiones (requieren antes sessions-enable; la habilitación y promoción nunca son automáticas):
session-start --directory <carpeta> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json>
                --request-key <clave> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <recuerdo> --version <n>
         [--before <0..20>] [--after <0..20>] (ambos por defecto 5)
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
        compact=false y max-bytes=16384 por defecto.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada en setup.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
Antes de sync --upgrade-format, actualiza todos los equipos: todos deben entender el formato seleccionado; el refuerzo requiere formato 3.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup ofrece el refuerzo explícitamente; registrar repeticiones mejora el orden, no verifica la verdad.
La habilitación local no promueve la réplica: ejecuta sync --upgrade-format por separado.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup y tui muestran texto y requieren terminal; cancelar devuelve código 130.
Los comandos de datos devuelven JSON; errores a stderr y código de salida 1, sin conexiones privadas.
MCP expone memory_save a asistentes; el modelo puede omitir guardados. No captura transcripciones.
La resolución de directorios de proyecto requiere Git disponible, incluso para carpetas sin Git.
```

---

## 5. Initializing the Central Workspace: The `setup` Wizard

To create your central storage for the first time or reconfigure it interactively, run:

```bash
forge614-engram setup
```

The wizard requires an interactive terminal (`stdin` and `stdout`). It guides through each setting step-by-step:

```text
=== Asistente de configuración de Forge614 Engram ===

Este asistente configurará el espacio de trabajo local en:
  Configuración : /Users/usuario/.forge614/.env
  Base de datos : /Users/usuario/.forge614/engram.db

¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
No
Sí, configurar PostgreSQL
Elige [si/NO]:
```

### Synchronization Options
- **Option `No` (Default):**
  Pressing Enter or typing `no` runs 100% locally and offline. If PostgreSQL was configured previously, selecting `No` disables replication without deleting prior backups.
- **Option `Sí, configurar PostgreSQL`:**
  Selecting yes prompts for your PostgreSQL connection string with **masked input** (`{ secret: true }`). Typed passwords are never shown in plaintext or asterisks, preventing shoulder-surfing.

### Search Reinforcement Offer (Schema 7)
Next, the wizard asks whether to activate repetition-based search reinforcement:

```text
registrar repeticiones mejora el orden; no verifica la verdad.
sincronizar esta función requiere actualizar todos los equipos.
¿Quieres habilitar el refuerzo de recuerdos? [si/NO]
```

- **Default is `NO`:** Pressing Enter leaves reinforcement off.
- **Typing `si` / `yes`:** Stages Schema 7 enrollment upon final confirmation.
- **If already active:** Informs: *"El refuerzo de recuerdos ya está habilitado. Se conservará habilitado; esta configuración no ofrece una degradación."* without presenting a false downgrade path.

### Summary and Pre-Flight Confirmation
Before writing any byte to disk, the wizard displays a clear summary and asks for confirmation:

```text
Resumen: configurar el almacenamiento global SQLite y mantener habilitado el refuerzo de recuerdos. No se crearán ni seleccionarán proyectos y no se borrarán datos.
¿Confirmar? [si/NO]:
```

> [!NOTE]
> If choosing `no` or pressing `Ctrl+C` at any point:
> - The command exits with standard code **130** (*Cancelled*).
> - **Zero bytes are written.** If `~/.forge614/` did not exist, it remains uncreated.
> - Pre-existing databases and memories remain intact.

---

## 6. Interactive Terminal Control Center (`forge614-engram tui`)

Once installed, `forge614-engram tui` launches the full-screen interactive **Terminal Control Center**:

```bash
forge614-engram tui
```

### Main Menu and Keyboard Navigation
The header bar presents all core functional sections:
```text
Summary | Projects | Shared | Storage | Actions | Assistants | Exit
```

- **Arrow Keys (Left / Right / Up / Down):** Move focus across menu tabs and navigate list entries.
- **Enter:** Enters the selected tab or opens the focused item.
- **Escape:** Returns to the previous view or cancels the active action.
- **PgUp / PgDn:** Scroll detail text when output exceeds terminal height.
- **Ctrl+C or EOF:** Immediately exits and restores the terminal cleanly.

### Read-Only by Default Principle
The Control Center opens strictly in **read-only mode**:
- Opening the screen, navigating, resizing the terminal, or pressing invalid keys **never writes to disk**, never creates `~/.forge614/.env`, never creates `engram.db`, never registers projects, and never binds paths.
- If the workspace has not yet been initialized, it displays an uninitialized warning informing you to run `setup` or `init`, without attempting automatic creation.
- Strictly requires an interactive terminal (TTY). In non-TTY environments (such as pipe redirections or headless CI runners), it immediately exits with safe code `INTERACTIVE_REQUIRED`.

### Visible vs. Hidden Information
- **Visible Metadata:** Project names, short UUIDs in listings and full UUIDs in detail view, creation/update timestamps, locally bound filesystem paths, active and archived memory counters, local SQLite database path, schema version (3 to 7), enabled capabilities, and PostgreSQL status (`configured` or `not-configured`).
- **Protected Secrets:** The Control Center **never** displays `POSTGRES_URL`, `.env` file contents, passwords, memory titles, memory bodies, or assistant configuration file contents.
- **Exhaustive Output Sanitization:** All rendered strings pass through a sanitization filter neutralizing ANSI escape injection, control characters, bidi overrides, zero-width characters, and unvetted URLs.

### Strict Two-Step Action Confirmation (`confirm` + Enter)
To execute any mutative action from the `Actions` tab:
1. The screen renders a **comprehensive preview** of the chosen action and its consequences.
2. If parameters are needed (such as a new project name or an absolute binding path), they are collected and pre-validated.
3. The interface requires typing the literal word `confirm` (case-insensitive) followed by Enter.
4. **Pressing Enter alone never authorizes writes.**
5. Pressing Escape or Ctrl+C before final confirmation immediately aborts the action, leaving storage bytes completely unchanged.

### Sequential Assistant Subflow
Selecting `Assistants`:
- Pauses the Control Center and restores standard terminal mode.
- Sequentially opens the assistant configuration tool (`assistantTui`) with its client selection, 5-second async self-test, preflight diffs, and safe backups.
- Upon closing the assistant tool, the terminal restores and the Control Center reloads a fresh, updated snapshot from SQLite.
- **No nested raw modes:** Two terminal event readers never execute concurrently.

---

## 7. Enabling Assistant Integration (Schema 5)

For AI assistants to interact with memory and record local directory bindings (`project_bindings`), the database must be on **Schema 5**.

Enable Schema 5 through either of two paths:

### Path A: TUI Control Center (`tui`)
From `forge614-engram tui`, navigate to `Actions`, select `Enable assistant integration`, type `confirm`, and press Enter.

### Path B: Explicit Command (`integration-enable`)
```bash
forge614-engram integration-enable
```

Expected JSON output:
```json
{
  "enabled": true,
  "schema": 5
}
```

---

## 8. Enabling Progressive Memory Sessions (Schema 6)

For AI assistants to create work sessions (`session-start`), inspect timelines (`timeline`), retrieve ranked context dossiers (`context`), and record structured summaries (`session-summary`), the database must be on **Schema 6**.

### Path A: TUI Control Center (`tui`)
From `forge614-engram tui`, navigate to `Actions`, select `Enable sessions`, type `confirm`, and press Enter.

### Path B: Explicit Command (`sessions-enable`)
```bash
forge614-engram sessions-enable
```

Expected JSON output:
```json
{
  "enabled": true,
  "schema": 6
}
```

### Critical Rules for Session Enablement:
1. **Never auto-migrates:**
   Standard MCP start (`mcp`), routine opens (`workspace.open()`), `init`, project queries, and ordinary reads/searches **never auto-migrate existing databases**. Attempting session commands on an unmigrated database halts with `MIGRATION_REQUIRED`.
2. **Tables added by Schema 6:**
   Additively creates `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`.

---

## 9. Enabling Reinforced FTS5 Search (Schema 7)

For the SQLite FTS5 search engine to incorporate immutable confirmation factors and temporal stability without embeddings, the database must be on **Schema 7**.

### Path A: TUI Control Center (`tui`)
From `forge614-engram tui`, navigate to `Actions`, select `Enable search reinforcement`, type `confirm`, and press Enter.

### Path B: Explicit Command (`reinforcement-enable`)
```bash
forge614-engram reinforcement-enable
```

Expected JSON output:
```json
{
  "enabled": true,
  "schema": 7
}
```

### Critical Rules for FTS5 Reinforcement:
1. **Additive & Transactional:**
   Creates `confirmations` (keyed by UUID `confirmationId`, referencing memory version, UTC timestamp, and optional session) and `confirmation_requests` (for idempotent request key deduplication). Upgrades older schemas within a single atomic transaction (`BEGIN IMMEDIATE ... COMMIT`).
2. **Idempotence and Missing Database Guard:**
   Running `reinforcement-enable` on an already-enrolled Schema 7 database is safe and returns the same JSON. If `.env` exists pointing to a database that was deleted from disk, the command **fails closed with a safe error**; it never silently recreates an empty database.
3. **Does Not Auto-Configure Assistants:**
   Enabling reinforcement does not modify client settings. To update assistant instructions, use `Assistants` in `forge614-engram tui`.
4. **Peer Device Coordination:**
   When synchronizing across machines via PostgreSQL:
   - All machines must upgrade to compatible version 0.5.0.
   - Run `forge614-engram reinforcement-enable` on each peer machine prior to synchronizing confirmed notes. Unreinforced clients receiving Format 3 snapshots abort with `REINFORCEMENT_REQUIRED`.
5. **PostgreSQL Replica Promotion (Format 1 or 2 to Format 3):**
   Local enablement does not promote remote replicas. Promote the PostgreSQL snapshot format consciously via:
   ```bash
   forge614-engram sync --upgrade-format
   ```
   > [!WARNING]
   > `sync-watch` and the TUI Control Center synchronization action reject format promotion. Format promotion requires explicit execution of `sync --upgrade-format` via CLI.

---

## 10. Inspecting Assistant Configuration in JSON (`assistant-list`)

To audit installed assistants, configuration file paths, and memory coverage without writing files or launching interactive screens:

```bash
forge614-engram assistant-list
```

Representative JSON output:
```json
[
  {
    "id": "claude-code",
    "label": "Claude Code",
    "detected": {
      "installed": true,
      "executable": "/usr/local/bin/claude",
      "configFound": true,
      "evidence": ["executable-found", "config-found"]
    },
    "configuration": {
      "status": "configured",
      "paths": [
        "/Users/usuario/.claude.json",
        "/Users/usuario/.claude/settings.json"
      ]
    },
    "automation": {
      "coverage": "session-and-prompt",
      "warnings": [
        "Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save.",
        "Managed policies and runtime trust can restrict MCP or hooks; this preview does not change them."
      ]
    }
  },
  {
    "id": "antigravity",
    "label": "Antigravity",
    "detected": {
      "installed": true,
      "executable": "/Users/usuario/.local/bin/agy",
      "configFound": true,
      "evidence": ["executable-found", "config-found"]
    },
    "configuration": {
      "status": "configured",
      "paths": [
        "/Users/usuario/.gemini/config/mcp_config.json"
      ]
    },
    "automation": {
      "coverage": "mcp-only",
      "warnings": [
        "Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.",
        "Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save."
      ]
    }
  }
]
```

### 10.1. Antigravity Integration

Forge614 Engram officially supports **Antigravity** as a developer coding assistant:

* **Compatibility via MCP (*Model Context Protocol*):** Antigravity interacts with Engram through the standard MCP protocol over standard input/output (`stdio`). This allows Antigravity to query ranked context (`memory_context`), perform lexical searches (`memory_search`), and persist new decisions (`memory_save`).
* **Model Autonomy:** Configuring MCP exposes the tools to Antigravity, but **does not guarantee that the model will always save a memory**. The AI assistant autonomously decides when to invoke memory tools based on your conversational instructions.
* **Current Coverage (*MCP Only*):** Antigravity is currently configured as **MCP only**. **No automatic hook is installed** for Antigravity. Event hooks will only be made available if an official, compatible, and validated durable-memory reminder event is verified in the future.
  > [!WARNING]
  > *Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.*

#### Configuration File Location:
Across macOS, Linux, and Windows, Engram manages exclusively Antigravity's global MCP configuration file:
```text
~/.gemini/config/mcp_config.json
```

The managed entry within this file adheres to the following conceptual structure:
```json
{
  "mcpServers": {
    "forge614-engram": {
      "command": "/absolute/path/to/forge614-engram",
      "args": ["mcp"]
    }
  }
}
```

* **Absolute Command Path:** The `command` property always contains the exact absolute binary path to `forge614-engram` on your disk.
* **Sole Argument:** `"args": ["mcp"]` is the single argument supplied to the executable.
* **Preservation of Unrelated Keys:** Engram safely preserves all unrelated keys, comments, and third-party MCP servers present in the JSON file.
* **Conflict Protection:** If an existing `forge614-engram` entry points to a different path or arguments, Engram **does not overwrite it blindly**; it halts execution and requests manual inspection (`CONFLICT`).
* **Private Backups:** Before writing changes, Engram creates a private (`0600`) backup identified by UUID.
* **Post-Write Verification:** Engram reads back and verifies the published byte content before reporting success.

#### Antigravity Detection Order:
When auditing your environment, Engram looks for the Antigravity executable in this strict sequence:
1. Searches for `agy` in your `PATH` environment variable directories.
2. On macOS and Linux, also inspects:
   ```text
   ~/.local/bin/agy
   ```
3. On Windows, also inspects:
   ```text
   %LOCALAPPDATA%/agy/bin/agy.exe
   ```

*(Note: Finding Antigravity never modifies any files automatically. The user must explicitly select it and confirm configuration during `setup` or via the `tui` menu).*

#### Compatibility and Protection of Legacy Gemini Configurations:
* Forge614 Engram **no longer manages Gemini CLI**.
* It does not migrate existing Gemini configurations.
* Engram **does not read, modify, or delete**:
  ```text
  ~/.gemini/settings.json
  ```
  If that file already exists on your machine, it remains completely untouched.
* The fact that Antigravity shares a `.gemini` folder does not authorize Engram to touch legacy Gemini configurations.

#### Windows Path Security (Native Node-API Component and Reparse Points):
* **Limitation of POSIX Permissions:** On macOS and Linux, Engram validates file safety through octal POSIX permission bits (`0700` for folders, `0600` for files) and POSIX `O_NOFOLLOW` open flags. On Windows, POSIX permission bits do not accurately represent NTFS Access Control Lists (ACLs), and Bun on Windows lacks direct POSIX symbolic link flag mappings in file opening.
* **Native C/C++ Reparse-Point Guard Addon:**
  To guarantee maximum security on Windows, Engram incorporates a native Node-API C++ addon (`native/windows-reparse-guard/addon.cc`), exposed via the TypeScript loader `src/infrastructure/filesystem/windows-reparse-guard.ts` as `hasWindowsReparsePoint(path: string): boolean`.
* **Direct Win32 API Call (`GetFileAttributesW`):**
  Instead of spawning slow external shell commands (like PowerShell or `fsutil`), the compiled binary directly queries the official Win32 API `GetFileAttributesW` from `Kernel32.dll`. It evaluates the native bitwise mask:
  ```c
  (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
  ```
* **Comprehensive Protection against Redirection:**
  The native guard strictly detects and blocks:
  - Symbolic links to files (`symlinkSync(..., 'file')`).
  - Directory symbolic links.
  - NTFS directory junctions (*junctions*, created via `symlinkSync(..., 'junction')` or `mklink /J`).
  - Volume mount points (*volume mount points*, created via `mountvol.exe`).
* **Fail-Closed Security Architecture:**
  The validation in `src/infrastructure/filesystem/private-files.ts` (`assertNoWindowsReparsePoints`) traverses the entire hierarchy: it evaluates the target path and climbs through every existing parent folder (`while (current !== root)`). If the native addon is missing, throws an operating system exception, or returns a non-boolean value, the operation **fails closed immediately**, throwing `UNSAFE_PATH`.
* **Acknowledgment of Concurrency Limits (TOCTOU):**
  Checking a path before use reliably prevents pre-existing malicious redirection points, but does not provide absolute protection against concurrent modifications (*Time-of-Check to Time-of-Use*, TOCTOU) performed by another privileged process between inspection and file opening.

#### Detailed Publication and Protected Write Flow (`guardedWrite`):
When Engram writes or modifies configuration files (e.g., publishing MCP tools for Antigravity or other assistants), it executes an atomic, protected 10-step protocol:
1. **Pre-write Path Validation:** Validates the target path with `assertSafePath` (POSIX octal permission checks on Unix; recursive reparse point inspection on Windows).
2. **Comparison with Preview:** Verifies that current disk content matches byte-for-byte what was presented in the interactive preview (`write.before`). If another process modified the file while the user reviewed the screen, it halts with `CHANGED`.
3. **Safe Parent Directory Creation:** Ensures the parent directory exists using `mkdirSync` with restricted permissions (`0700`) and immediately re-validates the directory path safety with `assertSafePath`.
4. **Unique Identifier Backup:** If a previous file existed, creates an exact backup copy appending the suffix `.forge614-backup-<UUID>` with `0600` permissions and exclusive creation mode (`flag: 'wx'`).
5. **Exclusive Temporary File Creation:** Generates a unique temporary file with suffix `.forge614-tmp-<UUID>` via `openSync` using the secure descriptor from `safeOpenFlag`.
6. **Write and Forced Disk Sync:** Writes new content (`writeFileSync`) and invokes `fsyncSync` on the descriptor to guarantee data is physically committed to disk before proceeding.
7. **Pre-Replacement Re-verification:** Re-reads the original file to certify it did not change while preparing the temporary file. If changed, halts with `CHANGED` and retains the original backup.
8. **Atomic Replacement:** After re-validating the target path, executes the atomic replacement via `io.rename(temporary, write.path)`.
9. **Post-Publication Verification:** Re-reads the published file with `readSafeFile`. If content does not match planned bytes (`write.after`) byte-for-byte, throws `PUBLISHED_UNVERIFIED`. Backups remain preserved intact and no destructive rollback is executed that could corrupt external data.
10. **Safe Cleanup:** If an error occurs before publishing, the `finally` block removes any orphaned temporary file with `unlinkSync`.

#### Platform Differences in File Opening:
* **Textual Modes on Windows ("r" and "wx"):**
  - For safe file reading, Windows uses mode `"r"` (read).
  - For temporary file and backup creation, Windows uses mode `"wx"`. The `"w"` flag opens for writing and `"x"` (*exclusive*) requires exclusive file creation: if the file already exists, the call immediately fails throwing `EEXIST`.
* **Numeric Bitwise Flags on macOS and Linux:**
  - On Unix systems, opening uses POSIX bitwise constants combined with the no-follow symlink flag: `constants.O_RDONLY | constants.O_NOFOLLOW` for reading, and `constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW` with octal permissions `0600` for exclusive creation.
* **Technical Incident Observed in CI:**
  During automated tests in GitHub Actions on Windows runners, temporary file creation using numeric bitwise flags (`O_WRONLY | O_CREAT | O_EXCL`) failed with system error `ENOENT` within the Bun runtime on Windows. In the same file, backup creation succeeded because it used textual mode `{ flag: 'wx' }`. Unifying file opening on Windows under the `safeOpenFlag` function to use textual modes (`"r"` and `"wx"`) resolved this, allowing both reading and temporary creation to pass cleanly. *(Note: this does not imply that all numeric flags fail on Windows or that Windows lacks secure opening; the incompatibility was specific to Bun's handling of numeric open flags in that call).*

#### Native Component Build and Tools:
* **Build Script (`scripts/build-windows-reparse-addon.ps1`):**
  Orchestrates compilation of the native addon for `x64` or `arm64` architectures.
* **Pinned Tools and Versions:**
  - **Bun (`>=1.3.8`):** Main TypeScript runtime engine.
  - **Node.js (`22.14.0` in CI):** Required strictly at build time to execute `node-gyp`.
  - **`node-gyp` (`12.1.0` pinned in `devDependencies`):** Generates the MSBuild project and compiles `addon.cc`. Pinned to version `12.1.0` to guarantee simultaneous compatibility with Node.js 22 and Visual Studio 2026.
  - **Python (`3.12+`):** Used internally by GYP (`gyp_main.py`).
  - **Visual Studio 2026 Build Tools (internal version `18`):** Official Microsoft C/C++ compiler on `windows-latest` runners.
* **Safe `node.exe` Resolution:**
  In virtual machines with multiple Node.js installations in PATH, the script implements `Resolve-NodeExecutable` to filter and select **a single valid executable path**, preventing faulty command concatenations.

#### CI Validation Evidence and Automated Tests:
* **Successful CI Execution:**
  The `Verify` workflow in GitHub Actions (**Run ID `35414475529`**, commit `5f9867ddcb7521e6e4fd1c05d53ab565506b8534`) completed with successful status (**Pass / Green**) across all platforms (`ubuntu-latest`, `macos-latest`, and `windows-latest`).
* **Tests Executed in the Native Windows x64 Job:**
  1. Native addon compilation and non-empty file check (`windows_reparse_guard.node`).
  2. Immediate acceptance of normal paths in temporary directories without spawning shell processes.
  3. Strict rejection with `UNSAFE_PATH` of file symlinks (`symlinkSync(..., 'file')`).
  4. Strict rejection of directory junctions (*junctions* created via `symlinkSync(..., 'junction')`).
  5. Strict rejection of volume mount points (*volume mount points* created via `mountvol.exe`).
  6. Fail-closed rejection on exceptions or non-boolean checker results.
  7. Antigravity configuration publication to `%USERPROFILE%\.gemini\config\mcp_config.json` in an isolated temporary environment, verifying persisted data.
  8. PowerShell installer test suite (`install.ps1.test.ps1`), validating 5 scenarios against an ephemeral loopback HTTP server (`127.0.0.1`).
* **Validation Scope:**
  The Windows CI job executes a targeted subset of test files (`windows-reparse-guard.test.ts`, `private-files.test.ts`, `windows-publication.test.ts`, and `install.ps1.test.ps1`), not the entire project suite. Validation ran exclusively on **x64** architecture on Windows; the ARM64 architecture was not executed in this job.

#### Pending Tasks for a Stable Release (v1.0.0):
A green CI workflow confirms that implemented tests pass in that environment, but does not prove on its own that the final distribution is ready for general release:
1. **Embed Native Addon into Distributed Standalone Executable:** Configure the release workflow (`release.yml`) to compile the native addon and bundle it inside the standalone Windows binary (`bun build --compile`), verifying that the final `.exe` loads the addon without requiring external files.
2. **Build and Test on Windows ARM64:** Verify compilation and test execution on native Windows ARM64 runners (`windows-11-arm`).
3. **Standalone Binary Validation Outside the Repository:** Test binary installation and execution on a clean Windows machine without development tools or cloned source code.
4. **Runtime Dependency Verification:** Certify that the standalone binary does not depend on external C++ runtime redistributables (*MSVC CRT*) missing on standard Windows installations.
5. **Full Release Workflow Verification:** Validate the generation and cryptographic signing of all six release artifacts before publishing version 1.0.0.

---

## 11. Programmatic Initialization Alternative (`init`)

To initialize basic local storage in headless or automated environments without interactive wizards:

```bash
forge614-engram init
```

JSON output:
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

This command:
1. Creates `~/.forge614/` with strict `0700` permissions if absent.
2. Writes `~/.forge614/.env` in Format 2 (`0600`) if absent.
3. Initializes `~/.forge614/engram.db` in WAL mode (`0600`).
4. Is **strictly idempotent**: never deletes or alters pre-existing memories.

---

## 12. First Project and Manual Memory Recording

### Creating a Project
Project identity is an immutable UUID. The display name is purely descriptive. Create via the TUI Control Center (`Actions > Create project`) or CLI:

```bash
forge614-engram project-create --name "Recommendation Engine"
```

Output:
```json
{
  "projectId": "8b08708c-9bf1-4770-9fa6-3f1eb94644a4",
  "name": "Recommendation Engine",
  "createdAt": "2026-09-17T11:50:00.000Z",
  "updatedAt": "2026-09-17T11:50:00.000Z"
}
```

### Saving a Project Memory (`scope: project`)
The default scope is `project` and requires specifying `--project-id`:

```bash
forge614-engram save \
  --project-id "8b08708c-9bf1-4770-9fa6-3f1eb94644a4" \
  --title "Algorithm Choice" \
  --content "We will use collaborative filtering with sparse matrix factorizations." \
  --type decision \
  --topic "recommendation-algorithm"
```

### Saving a Shared Universal Memory (`scope: shared`)
To record a universal rule applicable across all projects on this machine:

```bash
forge614-engram save \
  --scope shared \
  --title "Explanation Language" \
  --content "All technical explanations and documentation must be in Spanish with engineering rigor." \
  --type preference \
  --topic "documentation-language"
```

> [!TIP]
> Notice that with `--scope shared`, `--project-id` is omitted because the note belongs to the user's universal scope rather than a single project.
