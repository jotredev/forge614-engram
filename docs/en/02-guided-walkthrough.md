# 02. Guided System Walkthrough

> **Stage:** Stage 1 — Local Memory (Interactive Setup and Single Database)
> **Release Versions:** Program 0.3.0 | Configuration Format 2 | SQLite Schema 3
> **Status:** Current & Active
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This walkthrough guides you step by step through the complete lifecycle of Forge614 Engram: from setting up global storage interactively with `setup` and registering projects, to recording project-scoped and shared memories, executing combined searches, applying topic overrides, auditing version history, and managing reversible archival.

> [!NOTE]
> All examples use the installed standalone binary `forge614-engram`. If working directly from the source repository with Bun, replace `forge614-engram` with `bun run cli`.

---

## 1. Project Concept and Identity (`projectId`)

In Forge614 Engram, **all projects share a single database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are formally registered with two attributes:
1. **`projectId` (Immutable Unique Identifier):** An automatically generated lowercase UUIDv4 (e.g. `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It serves as the primary key linking all project-scoped memories.
2. **`name` (Descriptive Display Name):** A human-readable label (e.g. `"Online Store"`). Renaming the project with `project-rename` never changes `projectId` or affects stored memories.

<callout icon="⚠️" color="yellow_bg">
**Logical Data Isolation, Not Multi-User Security:** Scoping by `projectId` isolates data so one project never reads private memories from another. However, it is not a network permission system. Any program running under your local operating system user can access the store. **Never store plaintext passwords, secret keys, or sensitive API tokens in memories.**
</callout>

---

## 2. The Two Memory Scopes (`scope`)

The `scope` property determines where each memory applies:

| Scope (`scope`) | Identifier (`projectId`) | Purpose and Behavior |
| :--- | :--- | :--- |
| **`project`** | UUID of a registered project | Decisions, facts, or guidelines specific **only to that project**. |
| **`shared`** | `null` (no project) | Universal preferences or learnings that apply to **all projects**. |

### Everyday Examples:
- *"This application uses SQLite"* $\rightarrow$ **Project** scope (`scope: project`).
- *"I prefer explanations in English"* $\rightarrow$ **Shared** scope (`scope: shared`).

A shared memory is stored **once in the database**; it is never duplicated across individual projects.

---

## 3. Step-by-Step Lifecycle Walkthrough

### Step 1: Configure Global Storage (`setup` or `init`)

For human users in a terminal, the interactive `setup` command explains global storage paths and asks for confirmation before touching the disk:

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

- If you decide to cancel by typing `no`, `cancelar`, `q`, pressing Enter, or hitting `Ctrl+C`, the process exits with **code 130** and no storage files are created in a clean environment.
- `setup` **does not manage projects**: it never asks for, lists, creates, or selects projects.
- For scripts, automation, or non-interactive environments, use the silent `init` command:
  ```bash
  forge614-engram init
  # JSON Output: {"initialized":true,"storage":"sqlite"}
  ```

---

### Step 2: Register a Project (`project-create`)
Register your project with a human-readable name:

```bash
forge614-engram project-create --name "Online Store"
```

**JSON Response:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Online Store",
  "createdAt": "2026-09-16T20:10:00.000Z",
  "updatedAt": "2026-09-16T20:10:00.000Z"
}
```

*(Keep the returned `projectId` for subsequent project operations).*

List all registered projects whenever needed:
```bash
forge614-engram project-list
```

---

### Step 3: Record Project Memories (`save --project-id`)
Within a project, you can save standalone or topic-tracked memories:

#### A. Standalone Memory (No Topic)
For notes that do not require revision tracking:
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Kickoff agreement" --content "Deliveries will occur biweekly" --type fact
```

#### B. Topic-Tracked Memory (Version Controlled with Idempotency)
For architectural decisions that evolve over time, specify a topic key (`--topic`) and request key (`--request-key`):
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database selection" --content "We use SQLite locally" --type decision --topic architecture/database --request-key req-db-v1
```

**JSON Response:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database selection",
  "content": "We use SQLite locally",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:11:00.000Z"
}
```

---

### Step 4: Record a Shared Preference (`save --scope shared`)
Record a universal preference to guide assistants across all projects:

```bash
forge614-engram save --scope shared --title "Preferred language" --content "I prefer explanations in English" --type preference --topic preferences/language
```

**JSON Response:**
```json
{
  "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Preferred language",
  "content": "I prefer explanations in English",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:12:00.000Z",
  "updatedAt": "2026-09-16T20:12:00.000Z"
}
```

---

### Step 5: Combined Search from a Project
When searching from a project (`search --project-id <UUID>`), the system uses **combined scope (`--scope all`) by default**:

```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "English"
```

**JSON Response:**
```json
[
  {
    "memory": {
      "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
      "projectId": null,
      "scope": "shared",
      "topicKey": "preferences/language",
      "type": "preference",
      "title": "Preferred language",
      "content": "I prefer explanations in English",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T20:12:00.000Z",
      "updatedAt": "2026-09-16T20:12:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.059999,
      "orderScore": -0.000001059999
    }
  }
]
```

The combined query seamlessly retrieved the shared preference alongside project memories. And crucially: **memories from other projects are never leaked**.

If you wish to search exclusively within this project's private notes, pass `--scope project`:
```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --scope project --query "SQLite"
```

---

## 4. The Topic Exception Rule (*Topic Override*)

What happens when a general rule exists, but a specific project requires an exception?

### Practical Testable Scenario:
1. **General Shared Rule:**
   Save a shared guideline under the topic `runtime`:
   ```bash
   forge614-engram save --scope shared --title "Execution runtime" --content "Bun as general preference" --type preference --topic runtime
   ```
2. **Project-Specific Exception:**
   In project `Online Store`, Node.js is required for legacy compatibility. Save a project memory with the **exact same topic** (`runtime`):
   ```bash
   forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Execution runtime" --content "Node.js for project compatibility" --type decision --topic runtime
   ```
3. **Combined Project Query:**
   Search for runtime requirements from the project:
   ```bash
   forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "runtime"
   ```
   **Result:** Only the project's memory (*"Node.js..."*) is returned. The shared rule (*"Bun..."*) is **automatically omitted**.
4. **Shared Rule Preservation:**
   The shared memory is **neither deleted nor modified**. Other projects continue to see it, and it can be queried directly via:
   ```bash
   forge614-engram search --scope shared --query "Bun"
   ```
5. **Reversible Behavior:**
   If you archive the project's exception:
   ```bash
   forge614-engram archive --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id <project-exception-id>
   ```
   Searching from the project again immediately returns the shared Bun preference. Restoring the project memory (`restore`) re-applies the project override.

> [!IMPORTANT]
> The `topicKey` comparison is exact and case-sensitive. It requires no vector semantics or AI training: it is an explicit rule enforced in the SQL query.

---

## 5. Revision Updates and Optimistic Concurrency

When updating a topic-tracked decision, **you must specify the version you read** using `--expected-version`:

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database selection" --content "We use SQLite locally with WAL mode" --type decision --topic architecture/database --expected-version 1 --request-key req-db-v2
```

**JSON Response:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database selection",
  "content": "We use SQLite locally with WAL mode",
  "pinned": false,
  "version": 2,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:20:00.000Z"
}
```

The version increments to `2`. If a concurrent process attempts to send `--expected-version 1` again, the engine halts with `VERSION_CONFLICT` to protect against stale overwrites.

---

## 6. Version Auditing and Reversible Archival

### Inspect Historical Versions (`history`)
Retrieve the complete immutable record of changes:

```bash
forge614-engram history --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

Returns a chronological JSON array containing snapshot version 1 and snapshot version 2.

---

### Crucial Rule: Modifying Shared Memories
<callout icon="🛑" color="red_bg">
Finding a shared memory in a combined project search **DOES NOT permit modifying or archiving it using `--project-id`**.
</callout>

- To modify, archive, or restore a project-scoped memory:
  ```bash
  forge614-engram archive --project-id <UUID> --id <memory-id>
  ```
- To modify, archive, or restore a shared memory:
  ```bash
  forge614-engram archive --scope shared --id <memory-id>
  ```
Attempting to pass both `--scope shared` and `--project-id` triggers an immediate error (`INVALID_INPUT`).

---

### Renaming a Project (`project-rename`)
If your project changes display name:

```bash
forge614-engram project-rename --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --name "Global Store 2026"
```

The display name updates immediately. Because `projectId` remains unchanged, **all memories, historical revisions, and request keys remain fully intact**.
