# 01 (EN). Installation, Setup, and Getting Started

> **Stage:** TUI Control Center, Reinforced FTS5 (no embeddings), Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 3
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) / 7 (immutable confirmations & reinforced ordering) | PostgreSQL Formats 1, 2 & 3 (explicit promotion via `sync --upgrade-format`; remote physical table `state.format = 1`)
> **Enrollments:** Explicit and additive (`integration-enable` for Schema 5; `sessions-enable` for Schema 6; `reinforcement-enable` for Schema 7; `sync --upgrade-format` for replica Format 2 or Format 3). Database opening, the TUI control center, and ordinary commands never auto-migrate databases.
> **Status:** Current & Verified (504 total tests across 82 files: 495 passed and 9 skipped without isolated PostgreSQL test binaries; 504 passed, 0 failures, 2566 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8 in 39.76s)
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This step-by-step guide walks through installing the `forge614-engram` command, the interactive `setup` wizard, assistant connection with explicit approval, progressive sessions, immutable FTS5 confirmations, and peer device coordination.

---

## 1. What is this program and how is it distributed?

Forge614 Engram is a personal local memory system for artificial intelligence models and developers, written in **TypeScript and Bun**, featuring a minimal native C++ security component for Windows.

### Distribution Methods

Unlike public web packages:
- **Not downloaded from npm:** `npm install forge614-engram` does not exist because this is a private standalone package.
- **Official bootstrap installer (Recommended):** Downloads the precompiled standalone binary for your OS and architecture directly from GitHub Releases, cryptographically verifies its integrity against `SHA256SUMS`, and automatically configures your terminal's PATH.
- **Local compilation from source (Developers):** Packaged directly from repository source code using `scripts/install-from-source.sh` or `scripts/install.sh`.
- **Produces a standalone executable binary:** Outputs a single standalone executable named `forge614-engram` (or `forge614-engram.exe` on Windows). Once installed, **the end user does not require Bun, Node.js, Python, or C++ compilers in PATH** for routine execution.

### System Prerequisites for End Users

1. **Git (needed only for project identity):**
   Git is **not required to install Forge614 Engram, initialize its global memory, or connect an assistant**. It is required later only when Engram needs to identify a project folder and its linked worktrees using `git rev-parse --path-format=absolute --git-common-dir`. If Git is unavailable, project-specific resolution stops safely with `PROJECT_IDENTITY_UNAVAILABLE`; the installer itself is unaffected.
   ```bash
   git --version
   ```

2. **Zero development tools for standard installation:**
   End users installing via the official bootstrap commands **do not need to install Bun, Node.js, Python, node-gyp, or Visual Studio Build Tools**. The standalone executable bundles all runtime requirements and the embedded Windows security addon.

3. **Developer-only build prerequisites (compiling from source):**
   - **Bun (stable version >= 1.3.8):** Required strictly to build from source or run the automated test suite (`bun test`).
   - **Windows Build Tools (source build only):** Requires Visual Studio 2026 C++ Build Tools, Node.js 22+, node-gyp 12.1.0, and Python 3.12+ to compile the native module `windows_reparse_guard.node`.

4. **PostgreSQL Server (Optional):**
   Required only if enabling remote replication. Requires PostgreSQL 14 or higher with permissions to create and write to the `forge614_sync` schema.

---

## 2. Official Installation and Cryptographic Verification

### Official Installation Commands

The planned official commands, once merged to `main` and an official GitHub Release with published assets is available, are:

#### On macOS and Linux (Bash / Zsh):
```bash
curl -fsSL https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.sh | bash
```

#### On Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.ps1 | iex
```

> [!NOTE]
> **Release Availability Requirement:** The official installers fetch the latest GitHub Release (or an explicit version via `--version <tag>` on Unix or `-Version <tag>` on Windows) and verify the binary against `SHA256SUMS` before publishing it. Commands targeting `main` require an official public GitHub Release to exist; this engineering milestone prepared the installers and verification flow without prematurely creating a release or pushing a `v*` tag.

### What does the official installer do?

1. **Automatic OS and architecture detection:** Detects macOS ARM64/x64, Linux x64/ARM64, and Windows x64/ARM64 automatically.
2. **Download and strict checksum verification:** Fetches the standalone binary and official `SHA256SUMS` manifest, validates the SHA-256 hash locally, and halts immediately on any mismatch.
3. **Atomic publication to default executable directory:**
   - **macOS / Linux:** `$HOME/.local/bin/forge614-engram` with `0755` permissions.
   - **Windows:** `%LOCALAPPDATA%\Forge614\bin\forge614-engram.exe`.
4. **Overwrite Protection:** If the target binary exists, the installer stops to prevent accidental overwrites. To update an existing installation, pass the force flag:
   ```bash
   # On macOS / Linux
   curl -fsSL ... | bash -s -- --force
   # On Windows
   & { irm ... | iex } -Force
   ```
   *(Note: `--force` / `-Force` updates only the executable binary; it never alters `.env` configuration or memories in `engram.db`).*
5. **Custom Directory:** To install into an alternate location:
   ```bash
   # On macOS / Linux
   curl -fsSL ... | bash -s -- --bin-dir /path/to/bin
   # On Windows
   & { irm ... | iex } -BinDir C:\MyPath\bin
   ```
6. **Automatic and idempotent PATH configuration:** Configures your shell environment PATH (see Section 3).
7. **Zero premature storage creation:** The installer **never creates `~/.forge614` or initializes database files** during installation. Storage setup occurs deliberately during `setup`.

### Alternative: Building from Source (Developers)

If contributing to the repository and compiling locally:

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-engram
bun install --frozen-lockfile --ignore-scripts
bash scripts/install.sh
```

---

## 3. Terminal PATH Configuration

### What is the PATH environment variable in plain language?

The **PATH** variable is like your operating system's speed-dial directory. When you type `forge614-engram` in a terminal, the operating system doesn't guess where it is stored: it checks each folder listed in your PATH one by one. If the directory containing `forge614-engram` is in that list, the command runs immediately from any folder without needing to type its full path (`$HOME/.local/bin/forge614-engram`).

### Automatic Idempotent PATH Publishing

The official installers automatically configure the executable directory in your shell environment:

| Platform / Shell | Default Binary Location | PATH Publishing Method |
| :--- | :--- | :--- |
| **macOS / Linux, Zsh** | `$HOME/.local/bin` | Marked block in `~/.zshrc` |
| **Linux, Bash** | `$HOME/.local/bin` | Marked block in `~/.bashrc` |
| **macOS, Bash** | `$HOME/.local/bin` | Marked block in `~/.bash_profile`, unless another login file already owns Bash startup; then manual guidance |
| **macOS / Linux, Fish** | `$HOME/.local/bin` | Dedicated file `~/.config/fish/conf.d/forge614-engram.fish` via `fish_add_path` |
| **Windows (PowerShell / CMD)** | `%LOCALAPPDATA%\Forge614\bin` | User PATH variable via .NET API and `WM_SETTINGCHANGE` broadcast |

#### Safety Properties of PATH Publishing:
- **Delimited blocks in Unix:** On Zsh and Bash, the installer writes a clearly bounded block:
  ```bash
  # >>> forge614-engram initialize >>>
  export PATH="$HOME/.local/bin:$PATH"
  # <<< forge614-engram initialize <<<
  ```
  Reinstalling or updating replaces the block cleanly without adding duplicate lines and preserves 100% of your existing shell configuration.
- **Preserving symlinks and custom dotfiles:** If a startup file is a symbolic link or managed by a dotfile manager, the installer does not replace or follow it. It leaves that file untouched, preserves the verified binary, and prints clear manual instructions instead. On macOS Bash, it likewise avoids creating `~/.bash_profile` when `~/.bash_login` or `~/.profile` already controls login startup.
- **Safe Windows configuration without `setx`:** On Windows, the installer modifies exclusively the **user-level** PATH using the official .NET API (`[Environment]::SetEnvironmentVariable('Path', ..., 'User')`). It requires no Administrator privileges, never modifies machine PATH, avoids the obsolete `setx` command (which truncates at 1024 characters and risks destroying system variables), normalizes slashes and case to prevent duplicates, and broadcasts `WM_SETTINGCHANGE` so newly launched terminal sessions inherit the update.
- **Mandatory requirement:** PATH changes apply to **new terminal sessions**. To start using the command, **open a new terminal window** (or run the printed export/source command in your current shell).

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

### Seamless Continuation to Assistant Onboarding (`assistantTui`)

Once memory storage initialization is confirmed and completed, `setup` cleanly closes its terminal reader (`readline`) and **automatically launches the Assistant Selection TUI (`assistantTui`)** to finish onboarding:

1. **Exhaustive Detection of all 5 Supported Assistants:** Audits presence and configuration of:
   - **Claude Code** (`claude-code`)
   - **Codex** (`codex`)
   - **Cursor** (`cursor`)
   - **OpenCode** (`opencode`)
   - **Antigravity** (`antigravity`)
2. **Zero Silent Modifications:** The installer and `setup` **never modify any assistant configuration files without explicit user consent**. Finding an assistant binary on your system does not automatically modify its files.
3. **Comprehensive Action Plan Preview:** You can select or deselect which assistants to connect (using the spacebar or self-test `t`). Before modifying the disk, the assistant presents an exact preview detailing:
   - Target configuration paths to be edited.
   - MCP server definitions (`forge614-engram`) being added or verified.
   - Memory hooks being installed or explicit notifications when hooks are unavailable (such as Antigravity).
   - Automated private backups generated with suffix `.forge614-backup-<UUID>` under strict `0600` permissions.
4. **Mandatory Explicit Confirmation:** File modifications are only executed after final human confirmation, utilizing the guarded atomic write protocol.

### Strict Cancellation Semantics

The onboarding flow isolates cancellation cleanly between storage and assistant setup:
- **Cancelling During Memory Configuration:** Pressing `Ctrl+C`, `Escape`, or answering `no` before confirming storage:
  - Exits immediately with code **130** (*Cancelled*).
  - **Does not launch the Assistant TUI.**
  - **Writes zero bytes to disk.** If `~/.forge614/` was absent, it remains uncreated.
- **Cancelling or Exiting the Assistant TUI:** If you confirmed and initialized storage, but later choose to exit or cancel the assistant selector:
  - The initialized memory store in `~/.forge614/` is **retained intact**.
  - Newly initialized databases and `.env` settings are preserved without rollback.
  - The exit is treated as a clean completion with code `0`.

### Key Differences Between Initialization Commands

To avoid operational confusion:

| Command | Interface Mode | Configures Storage (`~/.forge614`)? | Detects / Connects Assistants? |
| :--- | :--- | :--- | :--- |
| **`forge614-engram setup`** | Interactive (TTY) | Yes (guided step-by-step with confirmation) | **Yes:** Seamlessly launches assistant onboarding TUI following storage setup |
| **`forge614-engram init`** | Non-interactive (Headless / JSON) | Yes (creates/verifies storage silently) | **No:** Never detects assistants or launches interactive interfaces |
| **`forge614-engram assistant-list`** | Read-only (JSON) | **No:** Never creates `.forge614` or writes files | **Yes (Audit only):** Detects assistants and coverage without touching files |

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
* **Successful CI Execution on Verify Workflow:**
  The `Verify` workflow in GitHub Actions (**Run ID `35427426902`**, commit `f047693b9e27368d104cfc945c0e419af4a1d4b9`) completed with successful status (**Pass / Green**) across all platforms (`ubuntu-latest`, `macos-latest`, and `windows-latest`):
  - **Ubuntu and macOS:** 543/545 passed tests (9 PostgreSQL tests passed with configured binaries; 0 failures); shell syntax and fixture checks for Bash, Zsh, and Fish.
  - **Windows x64 Native:** Native guard tests, in-memory PATH reader/writer fixtures in `install.ps1.test.ps1`, and smoke test regression validation.
* **Full Release Packaging Workflow Validation (`release.yml`):**
  The standalone release packaging workflow (**manual run ID `35427429725`**, and reference run `35428406085`) validated successfully (**Pass / Green**) the compilation and assembly of all 6 release artifacts:
  1. **Native Addon Bundling for Windows x64 and ARM64:** The workflow compiles the C++ addon via `scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}` before invoking `bun build --compile`. Bun automatically embeds the compiled `.node` binary inside standalone executables `forge614-engram-windows-x64.exe` (111,104 bytes addon) and `forge614-engram-windows-arm64.exe` (110,592 bytes addon).
  2. **Strengthened Packaged-Executable Smoke Test Outside Repository:**
     Previously, `assistant-list` returned all 5 assistant identifiers even if the native addon failed to load, capturing the exception and reporting `configuration.status = blocked`. Checking only the exit code did not guarantee in-memory addon loading. The CI verification was strengthened to strictly require that, under an empty temporary user profile (`RUNNER_TEMP`), all 5 assistants return exactly one entry with status `absent`. Any `blocked`, missing, or duplicate result immediately fails the workflow. Both `windows-x64` and `windows-arm64` passed with zero residual pollution (no `~/.forge614/` folder created).
  3. **Release Artifact Assembly and Cryptographic Checksums:** Generated and verified `SHA256SUMS` across all 6 standalone release binaries (macOS x64/ARM64, Linux x64/ARM64, Windows x64/ARM64), confirming six `OK` verifications.
  4. **Publication Guard:** Manual execution via `workflow_dispatch` safely skipped GitHub Release publication; actual public release creation is strictly gated on official `v*` tag pushes.
* **Local Test Suite Verification:**
  The full local test suite finished with **536 passed, 13 skipped (4 Windows native on macOS, 9 PG without local binaries), 0 failed**, and 2,606 assertions across 88 files. In addition, `bun run typecheck`, `git diff --check`, and `bash -n scripts/install.sh scripts/install-from-source.sh` all completed with exit code 0.

#### Pending Tasks for a Stable Release (v1.0.0):
With native addon embedding, empty-profile smoke test verification, and `SHA256SUMS` verification completed in CI, the remaining requirements for v1.0.0 are:
1. **Standalone Binary Validation Outside Repository on Clean Machine:** Test binary installation and execution on a clean physical or virtual Windows machine without development tools (no Node.js, Python, or Visual Studio installed previously).
2. **Runtime Dependency Verification (MSVC CRT):** Certify that the standalone binary loads without requiring external Microsoft Visual C++ Redistributable packages on that base Windows installation.
3. **Deliberate Official Version Release:** Create and push the official release tag `v1.0.0` (`git tag v1.0.0 && git push origin v1.0.0`) to trigger GitHub Release publication following human verification.

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
