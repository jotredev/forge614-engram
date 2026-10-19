# Forge614 Engram (`forge614-engram`)

> Analogía en una frase: Como una bitácora que nunca se pierde: guarda lo que importa de cada proyecto y lo encuentra cuando hace falta.

## Qué es
La memoria persistente local de Forge614: una sola base SQLite con búsqueda de texto (FTS5) que guarda recuerdos por proyecto, de grupo y compartidos, con identidad portátil del proyecto (`.forge614/project.json`), sesiones, un servidor MCP de 10 herramientas `memory_*`, un SDK público de TypeScript y réplica opcional en PostgreSQL.

## Qué no es
- No tiene TUI ni centro de control de terminal.
- No detecta ni configura clientes de IA: eso es tarea de Forge614 Shell y Forge614 Engines.
- Publica binarios oficiales para macOS, Linux y Windows x64; Windows arm64 sigue pendiente.
- No usa embeddings ni búsqueda exclusiva en la nube: SQLite y FTS5 son la ruta local principal.

## Instalación

macOS / Linux:
```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

Windows x64 (PowerShell):
```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-engram/releases/latest/download/install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
Remove-Item install.ps1
```

El instalador único necesita Node.js 22.19.0 o posterior en los tres sistemas. Verifica los archivos de la misma release con `SHA256SUMS`, instala Shell y Engines si faltan y publica el lanzador en PATH. En Windows, `-ExecutionPolicy Bypass` solo afecta ese proceso de PowerShell.

Al terminar, abre una terminal nueva y ejecuta el siguiente paso:
```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

Para verificar: `forge614-engram --version`, `forge614-engram --version --json` y `forge614-engram help`.

La base, `.env` y respaldos viven en `FORGE614_HOME/memory/` (por defecto `~/.forge614/memory/`). Al ejecutar Engram 1.10.0 por primera vez, una instalación 1.9.0 mueve allí la memoria de `engram/` automáticamente, después de verificar la copia.

`update [--version X.Y.Z] [--json]` usa el instalador de la release elegida y conserva los datos. `uninstall` conserva `memory/`; `uninstall --purge-data` también borra esa carpeta local tras una confirmación separada. La copia PostgreSQL, si existe, no se borra. Si Atlas está instalado, la confirmación de `uninstall` nombra a Engram y Atlas. `uninstall --self` retira solo las integraciones de Engram que administra Engines, conserva Atlas y se usa desde el instalador al retirar el programa.

## Comandos principales
| Comando | Para qué sirve |
| --- | --- |
| `init`, `update`, `uninstall` | Inicializar, actualizar y desinstalar Engram |
| `save`, `get`, `search`, `context` | Guardar, leer, buscar y resumir recuerdos |
| `project-create`, `project-list`, `project-bind` | Crear, listar y vincular proyectos |
| `group-create`, `group-list`, `group-bind` | Crear, listar y unir proyectos a grupos |
| `cloud on\|off\|status`, `sync` | Réplica opcional en PostgreSQL |
| `memory-protocol --json` | Publicar las reglas de memoria para los asistentes |
| `startup-context --directory <carpeta> --json` | Precargar contexto al iniciar una sesión |

La lista completa está en la [referencia CLI](docs/es/03-referencia-cli.md).

## Documentación
| # | Español | English |
| --- | --- | --- |
| 01 | [Instalación y primeros pasos](docs/es/01-instalacion-y-primeros-pasos.md) | [Installation and getting started](docs/en/01-installation-and-getting-started.md) |
| 02 | [Recorrido guiado](docs/es/02-recorrido-guiado.md) | [Guided walkthrough](docs/en/02-guided-walkthrough.md) |
| 03 | [Referencia CLI](docs/es/03-referencia-cli.md) | [CLI reference](docs/en/03-cli-reference.md) |
| 04 | [SDK de TypeScript](docs/es/04-sdk-typescript.md) | [TypeScript SDK](docs/en/04-typescript-sdk.md) |
| 05 | [Arquitectura Interna y Búsqueda](docs/es/05-arquitectura-interna-y-formulas.md) | [Architecture and Search](docs/en/05-internal-architecture-and-formulas.md) |
| 06 | [Resolución de Problemas](docs/es/06-resolucion-de-errores.md) | [Troubleshooting](docs/en/06-troubleshooting.md) |
| 07 | [Glosario](docs/es/07-glosario.md) | [Glossary](docs/en/07-glossary.md) |
| 08 | [Límites vigentes y hoja de ruta](docs/es/08-limites-y-roadmap.md) | [Current boundaries and roadmap](docs/en/08-boundaries-and-roadmap.md) |
| 09 | [Protocolo público de memoria](docs/es/09-protocolo-publico-de-memoria.md) | [Public memory protocol](docs/en/09-public-memory-protocol.md) |
| 10 | [Contexto de inicio para hosts](docs/es/10-contexto-de-inicio.md) | [Startup context for hosts](docs/en/10-startup-context.md) |
| 11 | [Ámbitos y ecosistemas](docs/es/11-ambitos-y-ecosistemas.md) | [Scopes and ecosystems](docs/en/11-scopes-and-ecosystems.md) |
| — | [Qué son los embeddings](docs/es/conceptos/que-son-los-embeddings.md) | [What are embeddings](docs/en/concepts/what-are-embeddings.md) |

## Licencia
Todos los derechos reservados. Ver [`LICENSE`](LICENSE). Las vulnerabilidades se reportan según [`SECURITY.md`](SECURITY.md).
