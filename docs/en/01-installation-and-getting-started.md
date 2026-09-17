# 01. Installation, Setup, and Getting Started

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Verified (75 tests passed, 0 failures on macOS with Bun 1.3.8)
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This guide walks you through compiling and installing `forge614-engram` on your computer, using the interactive `setup` onboarding wizard, understanding the single user storage architecture, and recording your first memories (both project-scoped and shared) in under three minutes.

---

## 1. What is this software and how is it distributed?

Forge614 Engram is a personal local memory engine for language models and software engineers, built in **TypeScript**. Unlike public web packages:
- **It is not downloaded from npm:** `npm install forge614-engram` does not exist because this is a private development package.
- **It compiles from source:** It is packaged directly from this repository using the provided installer script (`scripts/install.sh`).
- **It produces an autonomous binary:** The result is a standalone native executable named `forge614-engram`. Once installed, **it does not require Bun or Node.js in your PATH** for everyday operation.

### System Requirements
1. **Bun (stable version >= 1.3.8):**
   Required exclusively for **compiling and installing** from source code.
   ```bash
   bun --version
   ```
   If not yet installed, download it from [bun.sh](https://bun.sh).
2. **Operating System:**
   This delivery is verified and tested on **macOS**. The installer script supports Bash-compatible Unix environments.

---

## 2. Installing via the Autonomous Script

From the root directory of the repository (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bash scripts/install.sh
```

### What does the installer do?
1. Validates that Bun >= 1.3.8 is available for compilation.
2. Executes `bun build ./src/cli.ts --compile` to bundle the TypeScript code, dependencies, and native SQLite driver into a single autonomous binary file.
3. Installs the binary by default into your user bin directory:
   `$HOME/.local/bin/forge614-engram`
4. **Accidental Overwrite Protection:** If the file already exists, the script halts to prevent overwriting existing files without warning. To update or reinstall, pass the `--force` flag:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Note: `--force` replaces only the executable binary file; it never touches your configuration or database).*
5. **Custom Install Directory:** If you prefer installing into another directory:
   ```bash
   bash scripts/install.sh --bin-dir /custom/bin/path
   ```

---

## 3. Configuring Your Shell (The PATH Variable)

To execute `forge614-engram` from any directory without typing its full path, your terminal needs to know where to find it.

### What is PATH?
The **PATH** is the list of directories your operating system searches whenever you type a command name in the terminal (command-line interface).

If `$HOME/.local/bin` is not yet in your PATH, add it in your current terminal session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> To preserve this setting permanently so that it is available every time you open a new terminal window, add the line above to your shell configuration file (`~/.zshrc` on macOS or `~/.bashrc` on Linux).

---

## 4. Verifying the Installation

Once PATH is set, verify the installed version and check help text without touching the hard drive or creating any files:

```bash
# Check installed version
forge614-engram --version
# Expected output: forge614-engram 0.3.0

# Print command help
forge614-engram help
```

### Official Output of `forge614-engram help`:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
init            Inicializa una sola configuración y base local, sin borrar datos.
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
get      --id <recuerdo>
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         Con proyecto, all es el valor por defecto: proyecto + shared.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
PostgreSQL todavía no está disponible. No hay copia local alternativa ni sincronización.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup muestra texto y requiere terminal; cancelar devuelve código 130.
Los demás resultados son JSON; errores a stderr y código de salida 1, sin conexiones privadas.
save es manual/programático; la integración memory_save con asistentes está pendiente.
```

> [!NOTE]
> **Repository Development Mode:** When making code changes inside the repository, you can execute `bun run cli <command>` to run the CLI directly without recompiling the binary.

---

## 5. The Central Storage Space: One Config, One Database

Forge614 Engram uses a **single central storage directory** located in your personal home folder (`~`):

```text
~/.forge614/
  ├── .env          (single global configuration file)
  ├── engram.db     (single SQLite database containing all memories)
  ├── engram.db-wal (write-ahead log file for fast concurrent transactions)
  └── engram.db-shm (shared memory index for WAL concurrency)
```

### Key Storage Principles:
1. **Single Configuration File (`~/.forge614/.env`):**
   There are no per-project `.env` files and no `projects/<ID>` folders. Its content is generated automatically:
   ```dotenv
   FORMAT_VERSION="2"
   STORAGE="sqlite"
   ```
   The strict internal parser accepts exactly these two keys with double-quoted JSON strings, blank lines, and comments starting with `#`. It does not evaluate shell commands, does not expand environment variables, and does not load keys into `process.env`.
2. **Strict Security & Permissions:**
   The directory `~/.forge614/` is created with mode `0700` (exclusive access for the owner). The `.env` file and `engram.db` database are created with mode `0600` (read/write only for the owner). Before opening SQLite, the software validates ownership and rejects symlinks, hard links, and special file types.
3. **Working Directory Independence:**
   Regardless of whether you run the command from your Desktop, project folder, or root directory, the CLI always interacts with the exact same central `~/.forge614/` storage.
4. **Superseded Flags:**
   Options `--db`, `--project`, and `--id-project` **are not accepted**. The project identifier is named `projectId`.

---

## 6. Getting Started: Interactive Setup (`setup`) or Scriptable Init (`init`)

Forge614 Engram provides two paths to initialize central user storage in `~/.forge614/`: an interactive terminal assistant for humans (`setup`), and a silent command for automation and scripts (`init`).

### Step 1: Configure Global Storage with the Interactive Wizard (`setup`)

The `setup` command explains system paths and awaits confirmation before modifying your disk:

```bash
forge614-engram setup
```

**Terminal Session Flow:**
```text
Forge614 Engram — configuración guiada
Escribe cancelar o q, o pulsa Ctrl+C, para salir antes de confirmar.
Una configuración global: "/Users/user/.forge614/.env"
Una base SQLite para todos los proyectos: "/Users/user/.forge614/engram.db"
SQLite guarda tus recuerdos en este equipo. PostgreSQL todavía no está disponible. No se pedirán credenciales ni se conectarán asistentes en este paso.
Se preparará el espacio global al confirmar. Una base existente solo se reutilizará si es compatible; nunca se borrará ni reemplazará.
Resumen: configurar el almacenamiento global SQLite. No se crearán ni seleccionarán proyectos y no se borrarán datos.
¿Confirmar? [si/NO]: si
Configuración global lista. No necesitas elegir un proyecto para configurar Engram.
La identificación de proyectos y el guardado automático con asistentes siguen pendientes de integración.
```

#### Operational Rules for `setup`:
1. **Single Confirmation:** Displays paths and a summary, asking exclusively `¿Confirmar? [si/NO]:`.
2. **Accepted Answers:** Accepts `si`, `sí`, `s`, `yes`, `y` (case-insensitive).
3. **Safe Cancellation:** Pressing Enter (empty response), `no`, `n`, `q`, `cancelar`, `Ctrl+C`, or sending EOF (`Ctrl+D`) cancels execution with **exit code 130**, leaving a fresh workspace completely absent.
4. **Zero Project Management:** `setup` **does not ask for, list, create, or select projects**. The global database serves all projects from any working directory.
5. **Read-Only Pre-Validation:** If global configuration already exists, it validates compatibility in read-only mode prior to prompting, guaranteeing that existing memories and settings remain intact. Upon confirmation, it executes atomic initialization.
6. **Interactive TTY Requirement:** When invoked without an interactive terminal (e.g. redirected through a pipeline or non-interactive script), it fails immediately with exit code 1 and outputs structured JSON `INTERACTIVE_REQUIRED` to stderr:
   ```json
   {"error":{"code":"INTERACTIVE_REQUIRED","message":"setup necesita una terminal interactiva. Para scripts utiliza init y project-create --name <nombre>."}}
   ```

---

### Automation Alternative: Non-Interactive Initialization (`init`)

For automated scripts, CI/CD pipelines, or silent setups, use `init`. It asks no questions and responds in JSON:

```bash
forge614-engram init
```

**JSON Response:**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```
*(Note: `init` is idempotent and safe. If storage is already configured and the database is valid, it confirms readiness without modifying or resetting existing data).*

---

### Step 2: Register Your First Project (`project-create`)

Projects are created when you choose to register them with `project-create`. They are not mandatory steps in `setup`:

```bash
forge614-engram project-create --name "My Application"
```

**JSON Response:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "My Application",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

> [!IMPORTANT]
> The system returns a unique identifier (`projectId`). **Copy this UUID for subsequent operations**. The project name is merely a display label; all project-scoped commands require its `projectId`.

List all registered projects at any time using:
```bash
forge614-engram project-list
```

---

### Step 3: Save a Project-Scoped Memory (`scope: project`)

By default, the `save` command targets a project scope (requires `--project-id`):

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database selection" --content "We use SQLite locally" --type decision --topic architecture/database
```

**JSON Response:**
```json
{
  "id": "a3b1c2d3-e4f5-4678-8901-abcdef012345",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database selection",
  "content": "We use SQLite locally",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:01:00.000Z",
  "updatedAt": "2026-09-16T20:01:00.000Z"
}
```

---

### Step 4: Save a Shared Universal Memory (`scope: shared`)

To record a preference or guideline that applies across all projects, save it with `--scope shared` (forbids `--project-id`):

```bash
forge614-engram save --scope shared --title "Preferred language" --content "I prefer explanations in English" --type preference --topic preferences/language
```

**JSON Response:**
```json
{
  "id": "f1e2d3c4-b5a6-4789-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Preferred language",
  "content": "I prefer explanations in English",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:02:00.000Z",
  "updatedAt": "2026-09-16T20:02:00.000Z"
}
```

---

## 7. Manual Saving vs. Future AI Assistant Policy

<callout icon="ℹ️" color="blue_bg">
**Current Stage 1 Status:** The system saves **exclusively upon explicit command**. Today that command comes from typing `forge614-engram save` or invoking `store.save(...)` via the TypeScript SDK.
</callout>

### Approved Policy for Future AI Assistant Integration (Pending Implementation)
When proactive assistant capture is integrated through MCP (*Model Context Protocol*) tools via `memory_save`:
- **Default Scope:** The assistant will save under the active project identified by its `projectId`.
- **Requirement for `shared`:** Storing universal shared memories requires an explicit user intent of global scope (e.g. *"in all my projects"* or *"global guideline"*), evaluated across the complete conversational context (questions, authorship, confirmed decisions), rather than basic keyword triggers.
- **No False Promotions:** Words like *"always"* within a project, repeated occurrences, or apparent utility will never promote a note to shared status.
- **No Inferred Fallback:** If no project is identified, the assistant must seek clarification from the user rather than defaulting to `shared`.
