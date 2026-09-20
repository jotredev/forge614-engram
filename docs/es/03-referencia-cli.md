# 03. Referencia CLI

Los comandos de datos escriben JSON en stdout. Los errores escriben JSON `{code,error}` en stderr y salen con código `1`. `help` y `--version` no crean almacenamiento.

## Ciclo de vida

```text
init [--json] [--postgres-url <URL>]    inicializa memoria local; URL requiere --json
update                                  verifica e instala el último release estable
uninstall --confirm <frase exacta>      elimina solo Engram, o Engram y Atlas
mcp                                     inicia servidor MCP local por stdio
sync [--upgrade-format]                 sincroniza réplica PostgreSQL configurada
sync-watch [--interval <1..3600>]       reintenta sync mientras el proceso permanece abierto
sessions-enable                         habilita explícitamente sesiones
reinforcement-enable                    habilita explícitamente orden local por repeticiones
memory-protocol --json                  imprime el contrato público de memoria, sin inicializar almacenamiento
```

`setup` está retirado y devuelve `COMMAND_RETIRED`. No existen los comandos `tui`, `assistant-list`, `integration-enable` ni `memory-hook`.

## Contrato de protocolo de memoria

```text
forge614-engram memory-protocol --json
```

Este comando no interactivo publica el contrato JSON versionado para que Forge614 Engines pueda preparar una instalación segura en asistentes compatibles. Requiere `--json`; sin esa opción, o con flags desconocidos, devuelve el error JSON estándar `{code,error}` a stderr y sale con código `1`.

No requiere TTY, no crea ni abre `~/.forge614/engram/`, no inicializa SQLite y no consulta proyectos, PostgreSQL ni datos de la persona. El contrato está disponible desde la release `v1.3.0`; eso no implica que Engram configure asistentes directamente. Consulta [09. Protocolo Público de Memoria](09-protocolo-publico-de-memoria.md) para el ciclo de vida, seguridad y límites.

## Proyectos

```text
project-create --name <nombre>
project-list
project-rename --project-id <UUID> --name <nombre>
project-bind --directory <ruta> --project-id <UUID>
```

## Recuerdos

```text
save --project-id <UUID> --title <texto> --content <texto> [--type fact|decision|procedure|warning|preference]
     [--topic <clave>] [--expected-version <n>] [--request-key <clave>] [--pinned true|false]
     [--session-id <id>] [--session-project-id <UUID>]
search --project-id <UUID> --query <texto> [--scope all|project|shared] [--limit <1..100>] [--preview]
search --scope shared --query <texto>
get --project-id <UUID> --id <id-recuerdo> [--version <n>]
history --project-id <UUID> --id <id-recuerdo>
archive|restore --project-id <UUID> --id <id-recuerdo>
```

Usa `--scope shared` en vez de `--project-id` para un recuerdo compartido. Actualizar un tema existente requiere `--expected-version`.

## Sesiones y contexto

```text
session-start --directory <ruta> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json> --request-key <clave> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <id-recuerdo> --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
```

Ejecuta `forge614-engram help` para la sintaxis exacta de la versión instalada.
