# 02 (EN). Guided System Walkthrough

> **Stage:** Local Memory & Optional PostgreSQL Synchronization
> **Release Versions:** Program 0.4.0 | Configuration Format 2 (local) / 3 (with sync) | SQLite Schema 3 (local) / 4 (with sync)
> **Status:** Current & Active (Verified with 90 tests on macOS with Bun 1.3.8)
> **Sister translation:** [02. Recorrido Guiado del Sistema](../es/02-recorrido-guiado.md)

This practical walkthrough guides you step-by-step through the complete lifecycle of Forge614 Engram: from setting up global storage interactively with `setup` (with or without optional PostgreSQL sync) and registering projects, to recording project and shared memories, executing combined searches, leveraging topic overrides, synchronizing replicas via `sync` and `sync-watch`, auditing immutable version histories, and managing reversible archival.

> [!NOTE]
> All examples use the compiled binary `forge614-engram`. When developing directly in the source repository with Bun, replace `forge614-engram` with `bun run cli`.

---

## 1. The Project Concept & Identity (`projectId`)

In Forge614 Engram, **all projects share a single database (`~/.forge614/engram.db`) and a single configuration file (`~/.forge614/.env`)**.

Within that database, projects are formally registered with two attributes:
1. **`projectId` (Immutable Unique Identifier):** An automatically generated lowercase UUIDv4 (e.g. `7c9e6679-7425-40de-944b-e07fc1f90ae7`). It permanently links all memories to that project.
2. **`name` (Cosmetic Display Name):** A human-readable label (e.g. `"Online Store"`). Renaming with `project-rename` never changes the `projectId` or affects stored memories.

<callout icon="⚠️" color="yellow_bg">
**Logical isolation, not multi-tenant authorization:** Isolation by `projectId` organizes your data so one project never reads private notes belonging to another. However, it is not a multi-user operating system boundary. Any program running under your local user account can access the storage. **Never store plain-text passwords, private API secrets, or access tokens in memories.**
</callout>

---

## 2. The Two Memory Scopes (`scope`)

The `scope` property dictates where a stored note applies:

| Scope (`scope`) | Identifier (`projectId`) | Purpose & Application |
| :--- | :--- | :--- |
| **`project`** | UUID of a registered project | Facts, decisions, or procedures applying **strictly to that specific project**. |
| **`shared`** | `null` (no project) | Universal preferences or developer practices applying across **all projects**. |

### Everyday examples:
- *"This application uses SQLite"* $\rightarrow$ **Project** scope (`scope: project`).
- *"I prefer technical explanations in English"* $\rightarrow$ **Shared** scope (`scope: shared`).

A shared memory is stored **once in the central database**; it is never duplicated or cloned across individual projects.

---

## 3. Step-by-Step Lifecycle Walkthrough

### Step 1: Initialize Global Storage (`setup` or `init`)

For human users in the terminal, the interactive `setup` wizard explains storage paths, offers optional PostgreSQL replica sync, and requests confirmation before modifying disk:

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

- If you select `No` (pressing Enter directly), the system operates in purely local mode with `.env` format version 2 and SQLite schema version 3.
- If you select `Sí, configurar PostgreSQL`, the URL is entered via masked input (`[oculto]`), the `forge614_sync` schema is initialized on PostgreSQL, and SQLite is upgraded to schema version 4 with the additive `sync_checkpoints` table.
- Canceling at any prompt with `no`, `cancelar`, `q`, or `Ctrl+C` exits with **code 130** without writing changes to disk.
- For automation scripts without an interactive terminal, use silent `init`:
  ```bash
  forge614-engram init
  # JSON output: {"initialized":true,"storage":"sqlite"}
  ```

---

### Step 2: Register a Project (`project-create`)

Register your project with a descriptive name:

```bash
forge614-engram project-create --name "Online Store"
```

**JSON Output:**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Online Store",
  "createdAt": "2026-09-16T20:10:00.000Z",
  "updatedAt": "2026-09-16T20:10:00.000Z"
}
```

*(Keep the returned `projectId` handy for all commands relating to this project).*

You can list all registered projects at any time:
```bash
forge614-engram project-list
```

---

### Step 3: Store Project Memories (`save --project-id`)

You can store memories within a project in two ways:

#### A. Standalone memory (without a topic)
For general notes that do not require version evolution:
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Kickoff Meeting" --content "Client requested bi-weekly milestone deliveries" --type fact
```

#### B. Topic-managed memory (with revision control & idempotency)
For architectural decisions that evolve over time, assign a topic (`--topic`) and request key (`--request-key`):
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database Engine" --content "We will use SQLite locally" --type decision --topic architecture/database --request-key req-db-v1
```

**JSON Output:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database Engine",
  "content": "We will use SQLite locally",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:11:00.000Z"
}
```

---

### Step 4: Store a Shared Universal Preference (`save --scope shared`)

Store a universal preference to guide assistants across all your projects:

```bash
forge614-engram save --scope shared --title "Language Preference" --content "I prefer technical explanations in English" --type preference --topic preferences/language
```

**JSON Output:**
```json
{
  "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
  "projectId": null,
  "scope": "shared",
  "topicKey": "preferences/language",
  "type": "preference",
  "title": "Language Preference",
  "content": "I prefer technical explanations in English",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:12:00.000Z",
  "updatedAt": "2026-09-16T20:12:00.000Z"
}
```

---

### Step 5: Combined Search from a Project

When searching from a project (`search --project-id <UUID>`), the system **defaults to combined scope (`--scope all`)**:

```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "English"
```

**JSON Output:**
```json
[
  {
    "memory": {
      "id": "e2f1c0d9-b8a7-4655-9012-3456789abcde",
      "projectId": null,
      "scope": "shared",
      "topicKey": "preferences/language",
      "type": "preference",
      "title": "Language Preference",
      "content": "I prefer technical explanations in English",
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

The combined search seamlessly retrieved the universal shared preference. Crucially, **it will never return private memories belonging to other projects**.

To restrict results exclusively to this project's private notes, specify `--scope project`:
```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --scope project --query "SQLite"
```

---

## 4. The Topic Exception Rule (*Topic Override*)

What happens if you have a company-wide guideline, but one specific project requires an exception?

### Practical Verifiable Scenario:
1. **Universal Shared Policy:**
   Record a shared preference under topic `runtime`:
   ```bash
   forge614-engram save --scope shared --title "Execution Runtime" --content "Bun as default runtime" --type preference --topic runtime
   ```
2. **Project-Specific Exception:**
   In our `Online Store` project, we require Node.js for dependency compatibility. We save a note with the **exact same topic** (`runtime`):
   ```bash
   forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Execution Runtime" --content "Node.js for project compatibility" --type decision --topic runtime
   ```
3. **Project Combined Search:**
   Query runtime information from the project:
   ```bash
   forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "runtime"
   ```
   **Result:** Only the project's exception (*"Node.js..."*) is returned. The shared policy (*"Bun..."*) is **automatically suppressed**.
4. **Shared Rule Preservation:**
   The shared memory is **neither deleted nor modified**. Other projects continue receiving it normally, and you can inspect it directly using:
   ```bash
   forge614-engram search --scope shared --query "Bun"
   ```
5. **Reversible Suppression:**
   If you archive the project's exception:
   ```bash
   forge614-engram archive --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id <project-exception-id>
   ```
   When querying from the project again, the shared rule (`Bun`) **automatically resurfaces**. Restoring the exception (`restore`) reinstates the project's priority.

> [!IMPORTANT]
> Topic matching (`topicKey`) is exact and case-sensitive. It relies on deterministic SQL query filtering rather than opaque AI weights.

---

## 5. Version Progression & Optimistic Concurrency Control

When evolving a topic decision over time, **you must declare the version you previously read** using `--expected-version`:

```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Database Engine" --content "We will use SQLite locally with WAL mode" --type decision --topic architecture/database --expected-version 1 --request-key req-db-v2
```

**JSON Output:**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Database Engine",
  "content": "We will use SQLite locally with WAL mode",
  "pinned": false,
  "version": 2,
  "state": "active",
  "createdAt": "2026-09-16T20:11:00.000Z",
  "updatedAt": "2026-09-16T20:20:00.000Z"
}
```

The version advanced to `2`. If another process attempts to submit `--expected-version 1` again, the engine rejects the write with `VERSION_CONFLICT` to protect against blind overwrites.

---

## 6. Audit Tree, Inspection, and Reversible Archival

### Inspect Version History (`history`)
Examine the immutable historical snapshots over time:

```bash
forge614-engram history --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

Returns a chronologically ordered JSON array containing complete version 1 and version 2 payloads.

---

### Crucial Rule for Mutating Shared Memories
<callout icon="🛑" color="red_bg">
Discovering a shared memory in a project's combined search **DOES NOT authorize you to modify or archive it passing `--project-id`**.
</callout>

- To mutate, archive, or restore a project memory:
  ```bash
  forge614-engram archive --project-id <UUID> --id <memory-id>
  ```
- To mutate, archive, or restore a shared memory:
  ```bash
  forge614-engram archive --scope shared --id <memory-id>
  ```
Combining `--scope shared` with `--project-id` triggers an immediate validation error (`INVALID_INPUT`).

---

### Renaming a Project (`project-rename`)
If your project changes its public branding:

```bash
forge614-engram project-rename --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --name "Global Store 2026"
```

The display label is updated instantly. Because `projectId` remains stable, **not a single memory, version snapshot, or request key is lost**.

---

## 7. PostgreSQL Synchronization Lifecycle (`sync` & `sync-watch`)

If you enabled PostgreSQL replica synchronization during `setup`, you have two deterministic, safe execution modes:

### Mode 1: Single On-Demand Round (`sync`)
When you want to explicitly push and pull changes following a work session:

```bash
forge614-engram sync
```

**Successful JSON Output:**
```json
{
  "synchronized": true,
  "projects": 1,
  "memories": 2
}
```

#### What happens during `sync`?
1. **Remote Read:** Connects to PostgreSQL and fetches the latest published head snapshot.
2. **Local Snapshot:** Exports current local SQLite state (`projects`, `memories`, versions, requests, and events).
3. **Base Checkpoint:** Retrieves the last agreed snapshot stored in `sync_checkpoints`.
4. **Deterministic 3-Way Merge:** Combines changes from local and remote if they affect distinct projects or memories.
5. **Remote Publication (CAS):** If local modifications exist, publishes the new head using atomic compare-and-swap locking (`FOR UPDATE`).
6. **Local Atomic Apply:** If remote modifications exist, applies them within an immediate SQLite transaction, simultaneously updating FTS5 indexes via database triggers and updating the local checkpoint.

---

### Mode 2: Foreground Continuous Watcher (`sync-watch`)
To keep changes synchronized periodically without running manual commands:

```bash
forge614-engram sync-watch
# Or specify a custom interval in seconds (between 1 and 3600):
forge614-engram sync-watch --interval 60
```

#### Operational Rules for `sync-watch`:
- **Foreground Terminal Process:** Runs directly in your console window. **It does not install background daemons**, OS services (*launchd*, *systemd*), or *cron* entries.
- **Continuous Terminal Reporting:**
  - Emits JSON to `stdout` on each successful round:
    ```json
    {"synchronized":true,"projects":1,"memories":2}
    ```
  - If PostgreSQL is unreachable or drops offline, logs an informational error to `stderr` and keeps waiting for the next round:
    ```json
    {"code":"POSTGRES_UNAVAILABLE","error":"Sincronización pendiente; los datos locales se conservan."}
    ```
- **Offline Resilience:** If the PostgreSQL database is powered down or you lose internet access, **local Forge614 Engram operations (`save`, `search`, `get`, `archive`) never block or fail**. All memories are saved and retrieved locally from SQLite, and will synchronize automatically during the next round once PostgreSQL recovers.
- **Clean Termination:** Press `Ctrl+C` at any time to exit the watcher with standard exit code `130`. Any unsynchronized local changes remain safely stored in SQLite.
