# Getting Started

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/01-instalacion-y-primeros-pasos.md)

This guide explains the prerequisites needed to run Forge614 Engram on your computer and how to store your first memory in under two minutes.

---

## 1. What Is This Program and What Do You Need Before Starting?

Forge614 Engram is a private software package developed in **TypeScript** (a programming language with strict typing) that executes using **Bun** (a modern, high-performance runtime that runs JavaScript and TypeScript without complex compilation steps).

### System Requirements

1. **Bun (version 1.3.8 or higher):**
   - Check if you already have Bun installed by opening your terminal and typing:
     ```bash
     bun --version
     ```
   - If not installed, follow the official installation guide at [bun.sh](https://bun.sh).
2. **Operating System:**
   - Developed and verified on **macOS** and Unix-like environments (Linux).
3. **Private Package:**
   - This project is a private repository package. Do not attempt to install it from npm (`npm install forge614-engram` does not exist). It is run with Bun directly from the repository folder.

---

## 2. Project Setup (Installing Dependencies)

From the root directory of the repository (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bun install
```

### What does this command do?
It installs the internal type definitions required for development. Forge614 Engram **has zero external runtime dependencies**: the embedded database (SQLite) is provided directly by Bun (`bun:sqlite`), so you do not need to install database servers, Docker containers, or heavy packages.

---

## 3. Verifying Operation: The Help Command

Before storing any data, inspect the built-in manual by running:

```bash
bun run cli help
```

### Output:
```text
Forge614 Engram — memoria personal local (etapa 1)

Uso: bun run cli <comando> --project <proyecto> [opciones]

save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
search   --query <texto> [--limit <1..100>]
get      --id <identificador>
history  --id <identificador>
archive  --id <identificador>
restore  --id <identificador>
help     Muestra esta ayuda sin crear archivos.

Todos los comandos de datos aceptan --db <ruta>.
Ruta predeterminada: .forge614/memory.sqlite, relativa al directorio de ejecución.
Las consultas son literales; todas las palabras deben coincidir.
Actualizar un tema existente exige --expected-version. No hay borrado definitivo.
Los resultados son JSON. Los errores van a stderr y devuelven código de salida 1.
```

> [!NOTE]
> **No Side Effects on Help:** Running `help` or passing invalid arguments terminates immediately without creating directories or touching the file system.

---

## 4. Your First Stored Memory

Save your first memory in a project named `demo`:

```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

### Understanding Each Option:
- `bun run cli save`: Command to store a memory note.
- `--project demo`: The organizational project scope. All data is isolated under this project name.
- `--title "Base de datos"`: Short descriptive header.
- `--content "Usamos SQLite localmente"`: Full body text.
- `--type decision`: Conceptual category (in this case, an architectural decision).
- `--topic architecture/database`: Unique topic key grouping this decision for future revisions.
- `--request-key demo-v1`: Idempotency key ensuring that accidental re-runs do not create duplicate entries.

### Terminal Output (Structured JSON):
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite localmente",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:19:51.746Z"
}
```

### What Changed on Your Computer?
In the directory where you ran the command, the system automatically created a hidden folder called `.forge614/` containing `memory.sqlite`:
- `memory.sqlite`: The primary database file storing memories, version history, and search tables.
- `memory.sqlite-wal` and `memory.sqlite-shm`: Temporary Write-Ahead Logging files used by SQLite to allow fast concurrent reads and writes without blocking.

---

## 5. Next Steps

- To learn how to update this note, search notes, or archive them, proceed to the [**System Walkthrough Guide (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md).
- To inspect all flags and syntax rules, consult the [**Terminal CLI Reference (`03-cli-reference.md`)**](03-cli-reference.md).
- To integrate memory management into your TypeScript code, check the [**TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md).
