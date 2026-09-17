# 01 (EN). Installation, Setup, and Getting Started

> **Stage:** Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, Local MCP (10 Tools), Assistant TUI Menu & PostgreSQL Replica Format 2
> **Release Versions:** Program 0.5.0 | Configuration Formats 2 (local) / 3 (with sync) | SQLite Schemas 3 (local) / 4 (with sync) / 5 (assistant integration & local bindings) / 6 (progressive memory sessions & ranked context) | PostgreSQL Formats 1 & 2
> **Status:** Current & Verified (369 total tests across 69 files: 361 passed and 8 skipped without isolated PostgreSQL test binaries; 369 passed, 0 failures, 1891 assertions with `FORGE614_TEST_POSTGRES_BIN` configured on macOS with Bun 1.3.8)
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This guide walks you step-by-step through preparing dependencies, compiling, and installing the `forge614-engram` CLI command on your computer, understanding the mandatory Git requirement, assistant discovery, the interactive `setup` wizard for central storage, enabling progressive sessions with Schema 6, peer device coordination, and PostgreSQL replica promotion.

---

## 1. What is this program and how is it distributed?

Forge614 Engram is a personal local memory system for language models and software developers, built in **TypeScript**. Unlike public web packages:
- **It is not downloaded from npm:** `npm install forge614-engram` does not exist because it is a private developer repository.
- **It is compiled locally:** It is built directly from repository source code using the standalone installation script (`scripts/install.sh`).
- **It produces an autonomous binary executable:** The output is an independent binary file named `forge614-engram`. Once installed, **it does not require Bun or Node.js in your PATH** for everyday operation.

### System Requirements

1. **Bun (stable version >= 1.3.8):**
   Required exclusively to **compile and install** the program from source or run the automated test suite.
   ```bash
   bun --version
   ```
   If not yet installed, download it from [bun.sh](https://bun.sh).

2. **Git (Available in PATH — Mandatory):**
   **Git is an indispensable system requirement**, not only for repository cloning, but because Engram's project identity resolver relies on Git internally (`git rev-parse --path-format=absolute --git-common-dir`) to determine the canonical root directory across projects, linked worktrees, and nested subdirectories. Furthermore, Git is required to safely verify that a directory does **not** belong to Git. If Git is missing or unavailable in PATH, project resolution fails closed, throwing `PROJECT_IDENTITY_UNAVAILABLE`.
   ```bash
   git --version
   ```

3. **Operating System:**
   macOS or Linux with a Bash-compatible shell (`bash`).

4. **PostgreSQL Server (Optional):**
   Required only if you choose to enable replica synchronization. Requires PostgreSQL 14 or higher. The user must possess privileges to create and write to the `forge614_sync` schema.

---

## 2. Dependency Preparation & Installation

### Step 2.1 — Prepare local dependencies in a fresh clone

The install script **never downloads dependencies from the network automatically** nor silently updates your lockfile (`bun.lock`). In a fresh clone of the repository, prepare locked dependencies before building:

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-engram
bun install --frozen-lockfile --ignore-scripts
```

> [!IMPORTANT]
> If local dependencies are missing in `node_modules/` or their versions mismatch those declared in `package.json`, the installer displays a clear error message and halts before compiling or publishing any files, safeguarding your environment.

### Step 2.2 — Run the standalone installer

From the repository root directory:

```bash
bash scripts/install.sh
```

#### What does the installer script do?
1. Verifies that Bun is installed with version >= 1.3.8.
2. Verifies that Git is installed and available in your system PATH.
3. Validates local dependency versions against `package.json` without network downloads or lockfile edits.
4. Compiles `src/cli.ts` into a standalone native binary via `bun build ./src/cli.ts --compile`.
5. Atomically publishes the binary to `$HOME/.local/bin/forge614-engram` with `0755` permissions using a hard link.
6. **Protection against accidental overwrites:** If the executable already exists at the destination, the installer halts to prevent overwriting without authorization. To update an existing installation, pass `--force`:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Note: `--force` replaces only the binary executable; it never modifies `.env` or deletes memories in `engram.db`).*
7. **Custom binary directory:** To install into another directory:
   ```bash
   bash scripts/install.sh --bin-dir /custom/bin/path
   ```
8. **Post-install assistant discovery:** After publishing the binary, it runs a read-only audit (`assistant-list`) detecting which AI coding assistants (Claude Code, Codex, Cursor, OpenCode, Gemini CLI) are installed on your system.
9. **Interactive prompt for TUI menu:** If running in an interactive terminal (with real TTY stdin/stdout), the installer asks whether to launch the TUI menu.

---

## 3. Configuring your Terminal (The PATH Variable)

To invoke `forge614-engram` directly from any directory without typing its full path (`$HOME/.local/bin/forge614-engram`), add the folder to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> To make this change permanent across new terminal sessions, append the export line to your shell startup file (`~/.zshrc` on macOS or `~/.bashrc` on Linux).

---

## 4. Verifying the Installation

Check the installed version and review help documentation without writing to disk:

```bash
# Check installed version
forge614-engram --version
# Expected output: forge614-engram 0.5.0

# View terminal help reference
forge614-engram help
```

### Official output of `forge614-engram help`:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
tui             Asistentes: flechas, Espacio, vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve explícitamente una réplica formato 1.
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
mcp             Inicia el servidor MCP local por stdio; no migra la base.
assistant-list  Detecta asistentes y muestra configuración/cobertura sin escribir archivos.
memory-hook     --client <claude-code|codex|cursor|opencode|gemini-cli>
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
```

---

## 5. Initializing Central Storage: The `setup` Wizard

To configure your central workspace for the first time or reconfigure it interactively, run:

```bash
forge614-engram setup
```

The wizard requires an interactive terminal (`stdin` and `stdout`). It displays a step-by-step screen:

```text
=== Asistente de configuración de Forge614 Engram ===

Este asistente configurará el espacio de trabajo local en:
  Configuración : /Users/usuario/.forge614/.env
  Base de datos : /Users/usuario/.forge614/engram.db

¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
> 1. No
  2. Sí, configurar PostgreSQL

Opción [1]:
```

### Synchronization Options
- **Option 1: `No` (Default):**
  Pressing Enter selects `No`. The system operates 100% locally and autonomously in **Format 2** without PostgreSQL settings.
- **Option 2: `Sí, configurar PostgreSQL`:**
  Selecting `2` prompts for the connection URL with **hidden terminal input** (`{ secret: true }`). Typed passwords are never echoed in cleartext or with asterisks.

### Summary and Confirmation
Before writing any file to disk, the wizard displays a summary and asks for explicit confirmation:

```text
¿Deseas guardar esta configuración e inicializar la base de datos?
> 1. Sí, aplicar cambios
  2. Cancelar y salir
```

> [!NOTE]
> If you choose `Cancelar y salir` or press `Ctrl+C`:
> - The command exits with standard code **130**.
> - **No files are created.** If `~/.forge614/` was absent, it remains absent.
> - Any pre-existing database with previous memories remains untouched.

---

## 6. Enabling Progressive Sessions and Schema 6

To enable progressive work sessions, structured summaries, and ranked context retrieval, the local SQLite database must be on **Schema 6**.

### Enabling Schema 6 (`sessions-enable`)
Run the explicit enablement command:

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

> [!IMPORTANT]
> **Strict Additive Migration Principle:** Normal database opens (`workspace.open()`), commands such as `init`, `mcp`, `list`, or memory queries **never auto-migrate existing databases**. The migration to Schema 6 is additive and permanent, creating tables `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, and `local_manual_sessions`.

### Peer Device Coordination and Replica Promotion
If your team or setup synchronizes multiple devices against a PostgreSQL replica:
1. When upgrading a device to Schema 6, run:
   ```bash
   forge614-engram sync --upgrade-format
   ```
   This promotes the PostgreSQL replica from **Format 1** to **Format 2** under atomic CAS protection in `forge614_sync.state`.
2. **Peer Devices Requirement:** Any other computer syncing against that same PostgreSQL database must install the updated software and run:
   ```bash
   forge614-engram sessions-enable
   forge614-engram sync
   ```
   If a peer device attempts to sync against a Format 2 replica while still on Schema 3, 4, or 5, sync halts safely with `SYNC_CONFLICT` to protect data.

---

## 7. Inspecting Assistants in JSON (`assistant-list`)

To audit installed assistants, configuration paths, and hook coverage without modifying files or launching interactive menus:

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
  }
]
```

---

## 8. Scriptable Non-Interactive Initialization (`init`)

For automated provisioning (e.g. CI/CD or Docker containers) without terminal prompts:

```bash
forge614-engram init
```

Output:
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

This command creates `~/.forge614/` (`0700`), `.env` (`0600`), and `engram.db` (`0600`) idempotently. If existing data is present, it is preserved completely without modification.

---

## 9. Creating Projects and Initial Memories

### Creating a Project
Project identities are permanent UUIDv4 strings. Display names are cosmetic labels:

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
The default scope is `project` and requires `--project-id`. When Schema 6 is enabled, it automatically attaches to the session if specified:

```bash
forge614-engram save \
  --project-id "8b08708c-9bf1-4770-9fa6-3f1eb94644a4" \
  --title "Algorithm Selection" \
  --content "We will use collaborative filtering based on sparse matrices." \
  --type decision \
  --topic "recommendation-algorithm" \
  --session-id "ses-initial-setup"
```

### Saving a Universal Shared Memory (`scope: shared`)
To record a universal guideline applying across all projects:

```bash
forge614-engram save \
  --scope shared \
  --title "Documentation Language" \
  --content "All technical documentation must be written in English with high precision." \
  --type preference \
  --topic "documentation-language"
```

> [!TIP]
> When saving with `--scope shared`, `--project-id` is omitted because the memory belongs universally to your user space rather than any single project. If associated with an active work session, pass `--session-id <id>` and `--session-project-id <UUID>`; the memory retains `projectId: null` in storage and private session metadata is excluded from external queries.
