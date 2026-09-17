# 01 (EN). Installation, Setup, and Getting Started

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Verified (90 total tests: 86 passed and 4 skipped without PostgreSQL test binaries; 90 passed, 0 failures, 645 assertions with isolated PostgreSQL 17.6 on macOS with Bun 1.3.8)
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This guide walks you step-by-step through compiling and installing the `forge614-engram` CLI command on your computer, understanding how the interactive `setup` wizard works with optional PostgreSQL sync, exploring the single user configuration and database storage layout, and recording your first memories (both project-scoped and shared) in under three minutes.

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
2. **Operating System:**
   This documentation and test baseline is verified on **macOS**. The install script supports Bash-compatible Unix-like environments.
3. **PostgreSQL Server (Optional):**
   Required only if you choose to enable replica synchronization. Requires PostgreSQL 14 or higher (verified against version 17.6). The PostgreSQL role or user must possess privileges to create the `forge614_sync` schema (if not yet present) and perform read/write queries inside it. A dedicated, empty database or an existing compatible Forge614 installation must be used.

---

## 2. Installation via Standalone Script

From the root directory of the repository (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bash scripts/install.sh
```

### What does the installer script do?
1. Checks that Bun is installed with version >= 1.3.8.
2. Runs `bun build ./src/cli.ts --compile` to bundle TypeScript code, runtime dependencies, and the native SQLite engine into a single executable binary.
3. Copies it to your default user binary folder:
   `$HOME/.local/bin/forge614-engram`
4. **Protection against accidental overwrites:** If the executable already exists at that destination, the installer halts to prevent overwriting without warning. To upgrade or reinstall, pass the `--force` flag:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Note: `--force` replaces only the executable binary file; it never touches your configuration or deletes your database).*
5. **Custom install directory:** To install the binary into another folder:
   ```bash
   bash scripts/install.sh --bin-dir /custom/bin/path
   ```

---

## 3. Configuring your Terminal (The PATH Variable)

To invoke `forge614-engram` directly from any directory without typing its full path, your terminal needs to know where the binary lives.

### What is PATH?
The **PATH** is the environment list of folders where your operating system searches for executable programs when you type a command in the console.

If `$HOME/.local/bin` is not yet in your PATH, add this line in your current terminal session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> To preserve this setting across new terminal tabs and reboot cycles, append the export line above to your shell startup file (`~/.zshrc` on macOS or `~/.bashrc` on Linux).

---

## 4. Verifying the Installation

Once PATH is configured, check the installed version and review available commands without touching disk storage:

```bash
# Check installed binary version
forge614-engram --version
# Expected output: forge614-engram 0.4.0

# View terminal help reference
forge614-engram help
```

### Official output of `forge614-engram help`:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync            Sincroniza todo el espacio local con PostgreSQL configurado.
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
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
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada en setup.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup puede añadir metadatos de sincronización al esquema 3 sin borrar recuerdos.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup muestra texto y requiere terminal; cancelar devuelve código 130.
Los demás resultados son JSON; errores a stderr y código de salida 1, sin conexiones privadas.
save es manual/programático; la integración memory_save con asistentes está pendiente.
```

> [!NOTE]
> **Source development mode:** When developing directly in the source repository, you can run `bun run cli <command>` to test changes immediately without compiling the binary beforehand.

---

## 5. Central User Storage: One Configuration & One Database

Forge614 Engram uses a **single centralized storage location** housed inside your home directory (`~`):

```text
~/.forge614/
  ├── .env          (single global configuration file)
  ├── engram.db     (single SQLite database containing all memories)
  ├── engram.db-wal (fast WAL write-ahead transaction journal)
  └── engram.db-shm (shared memory index for multi-process concurrency)
```

### Key Storage Rules
1. **Single Configuration File (`~/.forge614/.env`):**
   There are no per-project `.env` files or `projects/<ID>` folders.
   - **Format 2 (Exclusively local SQLite storage):**
     ```dotenv
     FORMAT_VERSION="2"
     STORAGE="sqlite"
     ```
   - **Format 3 (With optional PostgreSQL sync replica enabled):**
     ```dotenv
     FORMAT_VERSION="3"
     STORAGE="sqlite"
     POSTGRES_URL="postgres://usuario:secreto@servidor:5432/basedatos"
     ```
   *Security Note:* Never copy or commit real credentials. The parser strictly checks for valid quoted values and rejects unrecognized keys, shell evaluations, or silent environment variables.
2. **SQLite Schemas & Additive Migration:**
   - In pure local mode, SQLite maintains **schema version 3**.
   - When enabling PostgreSQL sync in `setup`, an additive validated migration adds the `sync_checkpoints` table and advances the database to **schema version 4**. This migration never deletes or rewrites existing memory tables.
   - Disabling PostgreSQL later in `setup` retains schema 4 intact without purging local checkpoints or records.
3. **Strict Permissions and Ownership Security:**
   The directory `~/.forge614/` is created with mode `0700` (user owner only). The configuration file `.env` and SQLite database `engram.db` are created with mode `0600` (read/write by owner only). Before opening SQLite, the CLI verifies file ownership and rejects symlinks, hard links, and foreign file types.
4. **Working Directory Independence:**
   Whether you run commands from your Desktop, system root, or any project subfolder, the CLI connects to the exact same central `~/.forge614/` storage.
5. **Deprecated Flags:**
   `--db`, `--project`, and `--id-project` flags **do not exist**. The canonical identifier is strictly `projectId`.

---

## 6. Getting Started: Interactive Setup (`setup`) or Scriptable Init (`init`)

Forge614 Engram provides two entry points to prepare storage in `~/.forge614/`: an interactive terminal assistant (`setup`) for human users and a silent command (`init`) for scripts.

### Step 1: Initialize Global Storage with the Interactive Assistant (`setup`)

The `setup` command guides you through prompts before writing changes to disk:

```bash
forge614-engram setup
```

**Interactive terminal walkthrough:**
```text
Forge614 Engram — configuración guiada
Escribe cancelar o q, o pulsa Ctrl+C, para salir antes de confirmar.
Una configuración global: "/Users/usuario/.forge614/.env"
Una base SQLite para todos los proyectos: "/Users/usuario/.forge614/engram.db"
SQLite y FTS5 siempre guardan y buscan en este equipo, incluso sin conexión. PostgreSQL permite sincronizar una copia; no reemplaza SQLite.
Se preparará el espacio global al confirmar. Una base existente solo se reutilizará si es compatible; nunca se borrará ni reemplazará.
¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
No
Sí, configurar PostgreSQL
Elige [si/NO]: si
URL PostgreSQL (entrada oculta): [oculto]
Se sincronizará el espacio completo: todos los proyectos, recuerdos shared e historial. Usa una base PostgreSQL dedicada, vacía o ya compatible. Los equipos con acceso a esa base podrán recibir estos datos. No se transmite nada antes de confirmar.
Resumen: configurar el almacenamiento global SQLite. No se crearán ni seleccionarán proyectos y no se borrarán datos.
¿Confirmar? [si/NO]: si
Configuración global lista. No necesitas elegir un proyecto para configurar Engram.
Ejecuta forge614-engram sync para sincronizar ahora, o forge614-engram sync-watch para reintentar automáticamente mientras esté abierto. No se instaló un servicio permanente.
La identificación de proyectos y el guardado automático con asistentes siguen pendientes de integración.
```

#### Operational Rules for `setup`:
1. **Exact Synchronization Options:**
   Prompts: `¿Quieres habilitar la sincronización con una base de datos PostgreSQL?`.
   Displays exactly two options: `No` (default) and `Sí, configurar PostgreSQL`.
   It does not use ambiguous terms like "remote" or "Cloud".
2. **Hidden URL Input (`{ secret: true }`):**
   When configuring PostgreSQL, the connection string is accepted via masked input (`[oculto]`). Characters typed or pasted are never echoed to the screen, protecting secrets from bystanders or session logs.
3. **Full Workspace Replication Warning:**
   Before confirmation, `setup` explicitly warns that synchronization replicates the **entire workspace**: all registered projects, shared universal memories, version snapshots, request keys, and audit events.
4. **No Memories Transmitted Upon Setup Completion:**
   Completing `setup` verifies the connection and prepares the `forge614_sync` schema on PostgreSQL if needed, but **does not transmit memories immediately**. Upon completion, the terminal displays the commands to start synchronization when ready (`sync` or `sync-watch`).
5. **Final Confirmation:**
   Prompts `¿Confirmar? [si/NO]:`.
   Accepts `si`, `sí`, `s`, `yes`, `y` (case-insensitive).
6. **Safe Cancellation:**
   Pressing Enter (empty), `no`, `n`, `q`, `cancelar`, `Ctrl+C`, or sending EOF (`Ctrl+D`) cancels execution with **exit code 130** without creating or modifying files.
7. **No Project Management:**
   `setup` **does not prompt for, list, create, or select any project**.
8. **Interactive Terminal Requirement (TTY):**
   If executed in a non-interactive pipeline or background script, `setup` immediately halts with exit code 1 and outputs the JSON error `INTERACTIVE_REQUIRED` to stderr.

---

### Automation Alternative: Silent Initialization (`init`)

For automated scripts, CI/CD pipelines, or non-interactive headless environments operating locally:

```bash
forge614-engram init
```

**JSON Output:**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```
*(Note: `init` is idempotent. If configuration and database already exist and are valid, it verifies state without modifying or wiping existing memories).*

---

### Step 2: Register your First Project (`project-create`)

Projects can be registered at any time using `project-create`:

```bash
forge614-engram project-create --name "Online Store"
```

**JSON Output:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Online Store",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

> [!IMPORTANT]
> The command returns a persistent UUIDv4 `projectId`. **Store this UUID for subsequent operations**. The project name is merely a display label; all memory operations targeting this project require its `projectId`.

You can inspect all registered projects at any time:
```bash
forge614-engram project-list
```

---

### Step 3: Save your First Project Memory (`scope: project`)

By default, `save` stores within the scope of the designated project (requires `--project-id`):

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database Selection" --content "We are using local SQLite" --type decision --topic architecture/database
```

**JSON Output:**
```json
{
  "id": "a3b1c2d3-e4f5-4678-8901-abcdef012345",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database Selection",
  "content": "We are using local SQLite",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:01:00.000Z",
  "updatedAt": "2026-09-16T20:01:00.000Z"
}
```

---

### Step 4: Save a Shared Universal Memory (`scope: shared`)

When recording a rule or preference that applies globally across all projects, store it as shared memory using `--scope shared` (does not accept `--project-id`):

```bash
forge614-engram save --scope shared --title "Language Preference" --content "I prefer technical documentation in English" --type preference --topic preferences/language
```

**JSON Output:**
```json
{
  "id": "f1e2d3c4-b5a6-4789-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Language Preference",
  "content": "I prefer technical documentation in English",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:02:00.000Z",
  "updatedAt": "2026-09-16T20:02:00.000Z"
}
```

---

### Step 5: Synchronize your Workspace with PostgreSQL (`sync` or `sync-watch`)

If you configured a PostgreSQL connection during `setup`, run your first manual synchronization round:

```bash
forge614-engram sync
```

**JSON Output:**
```json
{
  "synchronized": true,
  "projects": 1,
  "memories": 2
}
```

To continuously sync changes in the foreground while working on this computer:

```bash
forge614-engram sync-watch
```
*(Press `Ctrl+C` to terminate. If PostgreSQL is offline or unreachable, local operations in SQLite are never blocked).*

---

## 7. Manual Recording vs. Future AI Assistant Integration

<callout icon="ℹ️" color="blue_bg">
**Current Stage Status:** Forge614 Engram saves **strictly upon explicit invocation**. Today, that trigger occurs either by executing a CLI command or programmatically via the TypeScript SDK.
</callout>

### Approved Future Assistant Policy (Pending Implementation)
When proactive assistant integration via `memory_save` and MCP (*Model Context Protocol*) is deployed:
- **Default Scope:** Assistants will default to saving within the project identified by `projectId`.
- **Requirement for `shared`:** Storing a shared memory will require unequivocal, contextually verified user intent for global scope (e.g., *"across all my projects"* or *"global rule"*), evaluated within full conversational context rather than keyword matching.
- **No False Positives:** Phrases like *"always"* within a single project, repetitive patterns, or perceived utility will not promote memories to shared scope.
- **Ambiguity Handling:** When active project identity is unclear, assistants must request clarification from the user rather than defaulting to `shared`.
