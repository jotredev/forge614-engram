# 01. Installation, Setup, and Getting Started

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Updated (Local installer + User storage path)  
> **Sister translation:** [01. Instalación, Configuración y Primeros Pasos](../es/01-instalacion-y-primeros-pasos.md)

This guide explains how to compile and install the `forge614-engram` command-line executable, how centralized user data storage operates, and how to store your first memory in under two minutes.

---

## 1. What Is This Program and How Is It Distributed?

Forge614 Engram is a personal memory system developed in **TypeScript**. Unlike public web packages, this repository is a **private project**:
- It is not downloaded from npm (`npm install forge614-engram` does not exist).
- It is compiled directly from a local checkout of this repository using a setup script (`scripts/install.sh`).
- It produces a **standalone binary executable** named `forge614-engram`. Once compiled and installed, the binary **does not require Bun or Node.js in your PATH** to run in daily use.

### System Requirements
1. **Bun (stable version >= 1.3.8):**  
   Required exclusively to **compile and install** from source code.
   ```bash
   bun --version
   ```
   If not installed, follow instructions at [bun.sh](https://bun.sh).
2. **Operating System:**  
   Developed and verified on **macOS**. The script supports macOS and Linux environments running Bash.

---

## 2. Compiling and Installing via Standalone Script

From the repository root (`/Users/jorgeetrejoo/Desktop/forge614-engram`):

```bash
bash scripts/install.sh
```

### What does the installer do?
1. Checks for Bun >= 1.3.8.
2. Runs `bun build ./src/cli.ts --compile` to compile the TypeScript engine, runtime, and embedded SQLite driver into a single standalone binary.
3. Installs by default into your user bin folder:  
   `$HOME/.local/bin/forge614-engram`
4. **Overwrite Protection:** If the file already exists, the script aborts to avoid accidental overwrites. To update or reinstall, supply the `--force` flag:
   ```bash
   bash scripts/install.sh --force
   ```
5. **Custom Directory:** To install into an alternative bin path:
   ```bash
   bash scripts/install.sh --bin-dir /custom/bin/path
   ```

---

## 3. Configuring Your Terminal PATH

To run `forge614-engram` from any folder without typing its absolute path, your terminal needs to include the installation directory in its search list.

### What is PATH?
**PATH** is the list of directories your operating system checks whenever you type the name of a command in your terminal.

If `$HOME/.local/bin` is not yet in your PATH, configure it for your current Bash/Zsh session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> To preserve this setting permanently across all terminal windows, add the export line above to your shell configuration file (`~/.zshrc` on macOS or `~/.bashrc` on Linux).

---

## 4. Verifying the Installation

Check the installed version and help manual without touching the filesystem:

```bash
# Verify version (does not create or open storage)
forge614-engram --version
# Expected output: forge614-engram 0.1.0

# View command help
forge614-engram help
```

### Help Output:
```text
Forge614 Engram — memoria personal local (etapa 1)

Uso: forge614-engram <comando> --project <proyecto> [opciones]

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
Ruta predeterminada: ~/.forge614/engram.db (base global del usuario).
Las consultas son literales; todas las palabras deben coincidir.
Actualizar un tema existente exige --expected-version. No hay borrado definitivo.
Los resultados son JSON. Los errores van a stderr y devuelven código de salida 1.
save es una operación manual. La integración con asistentes aún está pendiente.
```

> [!NOTE]
> **Developer Shortcut:** If you are modifying code inside the repository, you can run `bun run cli <command>` directly to test changes without rebuilding the binary.

---

## 5. Where Your Memories Live: The Centralized User Database

Unlike earlier prototypes that created database files per project directory, Forge614 Engram stores all memories in a **centralized database in your user home directory**:

$$\sim/\text{.forge614/engram.db}$$

On your macOS computer, this path is:
`/Users/jorgeetrejoo/.forge614/engram.db`

### Conceptual Structure:
```text
user home directory (~/)
  ├── .claude/         (AI client configuration)
  ├── .codex/          (coding assistant settings)
  ├── .local/bin/      (installed forge614-engram binary)
  └── .forge614/       (Forge614 central storage)
        ├── engram.db       (SQLite database storing all memories)
        ├── engram.db-wal   (concurrent Write-Ahead Log)
        └── engram.db-shm   (shared memory index)
```

- **Working Directory Independence:** Whether you run commands from `/Users/jorgeetrejoo/Desktop/project-a` or `/Users/jorgeetrejoo/Desktop/project-b`, the system opens the exact same central database.
- **Strict Project Scoping:** Within that shared database, the required `--project <name>` flag strictly partitions memories into isolated drawers.
- **On-Demand Initialization:** The `~/.forge614/` folder and `engram.db` file are created automatically the first time a valid data operation executes. `help`, `--version`, and invalid flags **never create storage**.

---

## 6. Storing Your First Memory

Record an initial memory in the `demo` project:

```bash
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

### JSON Response:
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

---

## 7. Crucial Clarification: Does It Save Automatically?

<callout icon="ℹ️" color="blue_bg">
**Stage 1 Reality:** Storage occurs **only when explicitly instructed**. Today, that instruction comes from a human executing `forge614-engram save` or software calling `store.save(...)`.
</callout>

### How will assistants interact in Stage 2?
Future stages will connect assistants (Claude Code, Cursor, Antigravity) via the **Model Context Protocol (MCP)** or hooks, enabling the assistant to identify learnings and trigger saves automatically.

However, **assistant auto-save is NOT implemented in Stage 1**. Do not expect the tool to silently monitor chats in the background. The manual CLI command serves for testing, auditing, and explicit saving.
