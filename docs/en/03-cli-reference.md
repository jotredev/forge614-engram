# 03 (EN). Terminal CLI Command Reference

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Active (Verified with 90 tests on macOS with Bun 1.3.8)
> **Sister translation:** [03. Manual Exhaustivo de Terminal (CLI)](../es/03-referencia-cli.md)

This guide exhaustively documents all commands, options, syntax rules, exit codes, and output modes of the Forge614 Engram command-line interface (CLI).

---

## 1. General Terminal Syntax & Operational Rules

1. **Command Invocation:** The command verb must immediately follow the program binary:
   ```bash
   forge614-engram <command> [options...]
   # Or when developing with Bun inside the repository:
   bun run cli <command> [options...]
   ```
2. **Option Formatting:** Each option flag (`--flag`) must be separated from its value by a space. Key-value assignment (`--flag=value`) is not supported.
   - ✅ Correct: `--project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --limit 5`
   - ❌ Incorrect: `--project-id=7c9e6679-7425-40de-944b-e07fc1f90ae7`
3. **Double Quotes for Text with Spaces:** All titles, contents, and project names containing spaces must be enclosed in double quotes (`"..."`).
4. **Strict Upfront Validation:** If you pass unknown flags, duplicate options, or incompatible arguments (e.g. combining `--scope shared` with `--project-id`), execution terminates immediately with a syntax error **before reading configuration or opening SQLite**.
5. **Output Channels & Exit Codes:**
   - **Interactive Assistant (`setup`):** Emits human-readable text to `stdout`. Returns exit code `0` on successful confirmation; code `130` on cancellation (`cancelar`, `q`, `Ctrl+C`, EOF, or `no`/Enter); and code `1` on error or non-interactive execution (`isTTY` is false).
   - **Continuous Watcher (`sync-watch`):** Emits successful rounds as JSON to `stdout` and retry warnings to `stderr`. Exits with code `130` when interrupted via `Ctrl+C`.
   - **Data & Automation Commands (`init`, `sync`, `project-*`, `save`, `search`, etc.):** Emit structured **JSON** to `stdout` with exit code `0` on success. On failure, emit a structured JSON error object to `stderr` with exit code `1`.
6. **Removed Flags that are NOT Supported:**
   - `--db`: Rejected. The database path is fixed at `~/.forge614/engram.db`.
   - `--project` (by name): Rejected. Project identity is strictly `--project-id <UUID>`.
   - `--id-project`: Rejected. The canonical flag name is `--project-id`.

---

## 2. Configuration & Workspace Commands

---

### 2.1. `--version`
Displays the program name and installed version.

```bash
forge614-engram --version
```
- **Output:** `forge614-engram 0.4.0`
- **Options:** Accepts no additional flags.
- **Side effects:** None. Does not read or write disk files.

---

### 2.2. `help`
Prints the official quick-reference manual in the terminal.

```bash
forge614-engram help
```
- **Official Output:**
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

---

### 2.3. `setup`
Interactive onboarding assistant for humans. Explains global paths (`~/.forge614/.env` and `~/.forge614/engram.db`), validates existing installations in read-only mode, offers optional PostgreSQL synchronization configuration, and requests explicit confirmation before initializing storage.

```bash
forge614-engram setup
```
- **Options:** Accepts no flags or arguments (rejects `--project`, `--yes`, paths, etc.).
- **TTY Requirement:** Requires an interactive terminal for stdin and stdout (`process.stdin.isTTY` and `process.stdout.isTTY`). If invoked without a TTY (in pipes, scripts, or CI), fails with exit code 1 and outputs JSON error `INTERACTIVE_REQUIRED` to stderr:
  ```json
  {"error":{"code":"INTERACTIVE_REQUIRED","message":"setup necesita una terminal interactiva. Para scripts utiliza init y project-create --name <nombre>."}}
  ```
- **PostgreSQL Synchronization Prompt:**
  ```text
  ¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
  No
  Sí, configurar PostgreSQL
  Elige [si/NO]:
  ```
  - Accepts `No` (or empty/Enter) to remain in local SQLite mode.
  - Accepts `si`, `sí`, `s`, `yes`, `y` to configure PostgreSQL sync.
- **Masked URL Input:**
  When configuring PostgreSQL, the connection string is accepted via masked input:
  `URL PostgreSQL (entrada oculta): [oculto]`
  Pasted text and keystrokes are never echoed to the screen.
- **Full Workspace Scope Warning:**
  Explicitly warns that synchronization replicates the entire workspace (all projects, shared memories, version trees, requests, and events).
- **Final Confirmation:**
  ```text
  ¿Confirmar? [si/NO]:
  ```
- **Cancellation:** Entering `no`, `n`, pressing Enter (empty), typing `q`, `cancelar`, pressing `Ctrl+C`, or sending EOF (`Ctrl+D`) aborts execution with **exit code 130**.
- **No Project Management:** `setup` **does not prompt for, list, create, or select any project**.
- **No Immediate Memory Transmission:** Configuring PostgreSQL does not send memories right away; it sets up schema `forge614_sync` if needed, updates `.env`, enables sync tables in SQLite, and directs you to run `sync` or `sync-watch`.
- **Standard Output:** Conversational human-readable plain text.

---

### 2.4. `init`
Silently initializes central user storage (`~/.forge614/`), creating `.env` (mode `0600`) and SQLite database `engram.db` (mode `0600`).

```bash
forge614-engram init
```
- **Options:** None required.
- **Ideal use:** Automation scripts, CI/CD pipelines, or headless environments without an interactive terminal.
- **Behavior:** Idempotent. If existing configuration and database are valid, verifies state without resetting or altering stored memories.
- **Standard Output (JSON):**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

---

### 2.5. `sync`
Executes a single complete round of synchronization between local SQLite storage and the configured PostgreSQL replica.

```bash
forge614-engram sync
```
- **Options:** Accepts no arguments.
- **Prerequisites:** Requires PostgreSQL sync enabled in `~/.forge614/.env` (`FORMAT_VERSION="3"` and `POSTGRES_URL`). If disabled, exits with code 1 and emits `SYNC_DISABLED`:
  ```json
  {"error":{"code":"SYNC_DISABLED","message":"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."}}
  ```
- **Behavior:**
  - Fetches the latest published remote snapshot from PostgreSQL and extracts the current local snapshot from SQLite.
  - Performs a deterministic 3-way merge against the last agreed checkpoint.
  - If local changes exist, publishes them using atomic CAS locking (`FOR UPDATE`).
  - If remote changes exist, applies them within an immediate SQLite transaction and refreshes the FTS5 index.
  - If incompatible edits touch the same entity, halts the round with `SYNC_CONFLICT` without modifying either database.
  - If snapshot exceeds 8 MiB, aborts with `SYNC_TOO_LARGE`.
- **Standard Output (JSON):**
```json
{
  "synchronized": true,
  "projects": 1,
  "memories": 2
}
```

---

### 2.6. `sync-watch`
Executes an immediate synchronization round and continues periodic retries in the foreground while kept open in the terminal.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Options:**
  - `--interval <seconds>` (Optional): Seconds between sync rounds. Default: `30`. Valid range: `1` to `3600`.
- **Behavior:**
  - Foreground console process. **Does not install background daemons**, OS launch services, or cron jobs.
  - Emits JSON to `stdout` after each successful round:
    ```json
    {"synchronized":true,"projects":1,"memories":2}
    ```
  - If PostgreSQL loses connectivity, emits a controlled warning to `stderr` and keeps waiting for the next cycle:
    ```json
    {"code":"POSTGRES_UNAVAILABLE","error":"Sincronización pendiente; los datos locales se conservan."}
    ```
  - **Offline Resilience:** Local operations (`save`, `get`, `search`, etc.) never wait on or depend upon `sync-watch`.
  - **Termination:** Halts gracefully on `Ctrl+C` (exit code `130`).

---

## 3. Project Management Commands

---

### 3.1. `project-create`
Registers a new project in the central `projects` database table.

```bash
forge614-engram project-create --name <name>
```
- **Options:**
  - `--name <name>` (**Required**): Display name for the project. Trimmed of surrounding whitespace; cannot be empty.
- **Behavior:** Initializes global storage automatically if not yet present. Generates a new UUIDv4 `projectId`.
- **Example:**
```bash
forge614-engram project-create --name "Online Store"
```
- **Standard Output (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Online Store",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

---

### 3.2. `project-list`
Lists all projects registered in the central database.

```bash
forge614-engram project-list
```
- **Options:** None.
- **Behavior:** Returns `[]` without creating files if storage is uninitialized. If initialized, returns the list sorted alphabetically by name.
- **Standard Output (JSON):**
```json
[
  {
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "Online Store",
    "createdAt": "2026-09-16T20:00:00.000Z",
    "updatedAt": "2026-09-16T20:00:00.000Z"
  }
]
```

---

### 3.3. `project-rename`
Renames an existing project.

```bash
forge614-engram project-rename --project-id <UUID> --name <new-name>
```
- **Options:**
  - `--project-id <UUID>` (**Required**): Unique project UUID.
  - `--name <name>` (**Required**): New display name.
- **Behavior:** Updates project record while preserving `projectId`, ownership, version snapshots, and request keys intact.
- **Standard Output (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "New Store Name",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:05:00.000Z"
}
```

---

## 4. Memory Commands

---

### 4.1. `save`
Stores a new memory or creates a new version of an existing topic memory.

```bash
# Project memory (defaults to scope project):
forge614-engram save --project-id <UUID> --title <title> --content <text> [options...]

# Universal shared memory (scope shared):
forge614-engram save --scope shared --title <title> --content <text> [options...]
```

- **Scope Flags (Mutually Exclusive):**
  - `--project-id <UUID>`: Project identifier. Establishes `scope: "project"`.
  - `--scope shared`: Universal memory (does not accept `--project-id`).
- **Required Content Flags:**
  - `--title <title>`: Concise descriptive title.
  - `--content <text>`: Memory body.
- **Optional Flags:**
  - `--type <fact|decision|procedure|warning|preference>`: Note type (defaults to `fact`).
  - `--topic <topic>`: Topic key for version evolution and overrides.
  - `--expected-version <number>`: Mandatory when updating an existing topic memory (optimistic concurrency).
  - `--request-key <key>`: Unique request key for idempotency replay protection.
  - `--pinned <true|false>`: Pins the memory with top ranking priority (defaults to `false`).
- **Standard Output (JSON):**
```json
{
  "id": "a3b1c2d3-e4f5-4678-8901-abcdef012345",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database Selection",
  "content": "We will use SQLite locally",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:01:00.000Z",
  "updatedAt": "2026-09-16T20:01:00.000Z"
}
```

---

### 4.2. `search`
Executes an explainable full-text search via SQLite FTS5.

```bash
# Project search (defaults to --scope all):
forge614-engram search --project-id <UUID> --query <text> [--limit <1..100>] [--scope all|project|shared]

# Shared memory search:
forge614-engram search --scope shared --query <text> [--limit <1..100>]
```

- **Options:**
  - `--query <text>` (**Required**): Search query string. All terms must match (logical *AND*).
  - `--limit <1..100>` (Optional): Maximum number of results (defaults to `10`).
  - `--scope all|project|shared` (Optional when passing project):
    - `all` (**Default when passing `--project-id`**): Returns project memories plus shared memories, honoring topic overrides.
    - `project`: Restricts search exclusively to project memories.
    - `shared`: Restricts search exclusively to universal shared memories.
- **Standard Output (JSON):** Returns an array of items containing `memory` and mathematical `explanation` (`mode`, `bm25`, `multiplier`, `orderScore`).

---

### 4.3. `get`
Retrieves a memory record by ID.

```bash
forge614-engram get --id <memory-id> [--project-id <UUID> | --scope shared]
```

---

### 4.4. `history`
Returns the immutable chronological array of historical version snapshots.

```bash
forge614-engram history --id <memory-id> [--project-id <UUID> | --scope shared]
```

---

### 4.5. `archive`
Hides an active memory from normal search queries without erasing its version audit trail.

```bash
# Archive project memory:
forge614-engram archive --project-id <UUID> --id <memory-id>

# Archive shared memory:
forge614-engram archive --scope shared --id <memory-id>
```

---

### 4.6. `restore`
Restores an archived memory back into active search results.

```bash
# Restore project memory:
forge614-engram restore --project-id <UUID> --id <memory-id>

# Restore shared memory:
forge614-engram restore --scope shared --id <memory-id>
```
