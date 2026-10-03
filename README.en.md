# Forge614 Engram (`forge614-engram`)

> One-sentence analogy: Like a logbook that never gets lost: it keeps what matters from each project and finds it when needed.

## What it is
Forge614's local persistent memory: a single SQLite database with full-text search (FTS5) that stores per-project, group, and shared memories, with a portable project identity (`.forge614/project.json`), sessions, an MCP server with 10 `memory_*` tools, a public TypeScript SDK, and optional PostgreSQL replication.

## What it is not
- It has no TUI or terminal control center.
- It does not detect or configure AI clients: that is the job of Forge614 Shell and Forge614 Engines.
- It has no Windows version yet: official binaries are for macOS and Linux.
- It uses no embeddings or cloud-only search: SQLite and FTS5 are the primary local path.

## Installation

macOS / Linux:
```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

Requirements: Bash, `curl`, a SHA-256 utility, `tar`, and Node.js 22.19 or newer (the installer also installs Forge614 Shell and Forge614 Engines). If anything is missing, it installs nothing.

When it finishes, open a new terminal and run the next step:
```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

To verify: `forge614-engram --version` and `forge614-engram help`.

## Main commands
| Command | What it does |
| --- | --- |
| `init`, `update`, `uninstall` | Initialize, update, and uninstall Engram |
| `save`, `get`, `search`, `context` | Save, read, search, and summarize memories |
| `project-create`, `project-list`, `project-bind` | Create, list, and bind projects |
| `group-create`, `group-list`, `group-bind` | Create, list, and join projects to groups |
| `cloud on\|off\|status`, `sync` | Optional PostgreSQL replication |
| `memory-protocol --json` | Publish the memory rules for assistants |
| `startup-context --directory <folder> --json` | Preload context when a session starts |

The full list is in the [CLI reference](docs/en/03-cli-reference.md).

## Documentation
| # | Español | English |
| --- | --- | --- |
| 01 | [Instalación y primeros pasos](docs/es/01-instalacion-y-primeros-pasos.md) | [Installation and getting started](docs/en/01-installation-and-getting-started.md) |
| 02 | [Recorrido guiado](docs/es/02-recorrido-guiado.md) | [Guided walkthrough](docs/en/02-guided-walkthrough.md) |
| 03 | [Referencia CLI](docs/es/03-referencia-cli.md) | [CLI reference](docs/en/03-cli-reference.md) |
| 04 | [SDK de TypeScript](docs/es/04-sdk-typescript.md) | [TypeScript SDK](docs/en/04-typescript-sdk.md) |
| 05 | [Arquitectura interna y fórmulas](docs/es/05-arquitectura-interna-y-formulas.md) | [Internal architecture and formulas](docs/en/05-internal-architecture-and-formulas.md) |
| 06 | [Resolución de errores](docs/es/06-resolucion-de-errores.md) | [Troubleshooting](docs/en/06-troubleshooting.md) |
| 07 | [Glosario](docs/es/07-glosario.md) | [Glossary](docs/en/07-glossary.md) |
| 08 | [Límites vigentes y hoja de ruta](docs/es/08-limites-y-roadmap.md) | [Current boundaries and roadmap](docs/en/08-boundaries-and-roadmap.md) |
| 09 | [Protocolo público de memoria](docs/es/09-protocolo-publico-de-memoria.md) | [Public memory protocol](docs/en/09-public-memory-protocol.md) |
| 10 | [Contexto de inicio para hosts](docs/es/10-contexto-de-inicio.md) | [Startup context for hosts](docs/en/10-startup-context.md) |
| 11 | [Ámbitos y ecosistemas](docs/es/11-ambitos-y-ecosistemas.md) | [Scopes and ecosystems](docs/en/11-scopes-and-ecosystems.md) |
| — | [Qué son los embeddings](docs/es/conceptos/que-son-los-embeddings.md) | [What are embeddings](docs/en/concepts/what-are-embeddings.md) |

## License
All rights reserved. See [`LICENSE`](LICENSE). Vulnerabilities are reported as described in [`SECURITY.md`](SECURITY.md).
