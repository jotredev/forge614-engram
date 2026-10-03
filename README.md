# Forge614 Engram (`forge614-engram`)

> Analogía en una frase: Como una bitácora que nunca se pierde: guarda lo que importa de cada proyecto y lo encuentra cuando hace falta.

## Qué es
La memoria persistente local de Forge614: una sola base SQLite con búsqueda de texto (FTS5) que guarda recuerdos por proyecto, de grupo y compartidos, con identidad portátil del proyecto (`.forge614/project.json`), sesiones, un servidor MCP de 10 herramientas `memory_*`, un SDK público de TypeScript y réplica opcional en PostgreSQL.

## Qué no es
- No tiene TUI ni centro de control de terminal.
- No detecta ni configura clientes de IA: eso es tarea de Forge614 Shell y Forge614 Engines.
- No tiene versión para Windows todavía: los binarios oficiales son para macOS y Linux.
- No usa embeddings ni búsqueda exclusiva en la nube: SQLite y FTS5 son la ruta local principal.

## Instalación

macOS / Linux:
```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

Requisitos: Bash, `curl`, una utilidad SHA-256, `tar` y Node.js 22.19 o superior (el instalador también instala Forge614 Shell y Forge614 Engines). Si falta algo, no instala nada.

Al terminar, abre una terminal nueva y ejecuta el siguiente paso:
```bash
~/.forge614/shell/bin/forge614-shell init --product engram
```

Para verificar: `forge614-engram --version` y `forge614-engram help`.

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
| 05 | [Arquitectura interna y fórmulas](docs/es/05-arquitectura-interna-y-formulas.md) | [Internal architecture and formulas](docs/en/05-internal-architecture-and-formulas.md) |
| 06 | [Resolución de errores](docs/es/06-resolucion-de-errores.md) | [Troubleshooting](docs/en/06-troubleshooting.md) |
| 07 | [Glosario](docs/es/07-glosario.md) | [Glossary](docs/en/07-glossary.md) |
| 08 | [Límites vigentes y hoja de ruta](docs/es/08-limites-y-roadmap.md) | [Current boundaries and roadmap](docs/en/08-boundaries-and-roadmap.md) |
| 09 | [Protocolo público de memoria](docs/es/09-protocolo-publico-de-memoria.md) | [Public memory protocol](docs/en/09-public-memory-protocol.md) |
| 10 | [Contexto de inicio para hosts](docs/es/10-contexto-de-inicio.md) | [Startup context for hosts](docs/en/10-startup-context.md) |
| 11 | [Ámbitos y ecosistemas](docs/es/11-ambitos-y-ecosistemas.md) | [Scopes and ecosystems](docs/en/11-scopes-and-ecosystems.md) |
| — | [Qué son los embeddings](docs/es/conceptos/que-son-los-embeddings.md) | [What are embeddings](docs/en/concepts/what-are-embeddings.md) |

## Licencia
Todos los derechos reservados. Ver [`LICENSE`](LICENSE). Las vulnerabilidades se reportan según [`SECURITY.md`](SECURITY.md).
