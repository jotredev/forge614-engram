# 03. Referencia CLI

Los comandos de datos escriben JSON en stdout. Los errores escriben JSON `{code,error}` en stderr y salen con código `1`. `help` y `--version` no crean almacenamiento.

## Ciclo de vida

```text
init [--json] [--postgres-url <URL>]    inicializa memoria local; URL requiere --json
update [--json]                         instala el último release estable; --json devuelve resultado estructurado
uninstall --confirm <frase exacta>      elimina solo Engram, o Engram y Atlas
mcp                                     inicia servidor MCP local por stdio
sync [--upgrade-format]                 sincroniza réplica PostgreSQL configurada
sync-watch [--interval <1..3600>]       reintenta sync mientras el proceso permanece abierto
sessions-enable                         habilita explícitamente sesiones
reinforcement-enable                    habilita explícitamente orden local por repeticiones
memory-protocol --json [--protocol-version 1|2]
                                        imprime el contrato público de memoria; versión 1 por defecto
startup-context --directory <ruta> --json
                                        precarga contexto de solo lectura para un host antes de una sesión
```

`setup` está retirado y devuelve `COMMAND_RETIRED`. No existen los comandos `tui`, `assistant-list`, `integration-enable` ni `memory-hook`.

## Contrato de protocolo de memoria

```text
forge614-engram memory-protocol --json
```

Este comando no interactivo publica el contrato JSON versionado para que Forge614 Engines pueda preparar una instalación segura en asistentes compatibles. Requiere `--json`; sin esa opción, o con flags desconocidos, devuelve el error JSON estándar `{code,error}` a stderr y sale con código `1`.

No requiere TTY, no crea ni abre `~/.forge614/engram/`, no inicializa SQLite y no consulta proyectos, PostgreSQL ni datos de la persona. El contrato está disponible desde la release `v1.3.0`; eso no implica que Engram configure asistentes directamente. Consulta [09. Protocolo Público de Memoria](09-protocolo-publico-de-memoria.md) para el ciclo de vida, seguridad y límites.

## Actualización para personas y herramientas

```bash
forge614-engram update
forge614-engram update --json
```

Sin opciones, `update` conserva la experiencia de terminal y muestra el progreso del instalador oficial. Con `--json`, no mezcla progreso con la salida y escribe exclusivamente `{"updated":true,"previousVersion":"<versión anterior>","installedVersion":"<versión instalada>"}` en stdout. `previousVersion` es la versión antes de actualizar; `installedVersion` se lee del binario instalado al terminar. Si ambas coinciden, `updated` es `false`.

Un fallo de `update --json` escribe exclusivamente `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` en stderr y sale con código `1`. No incluye diagnósticos crudos, URLs, credenciales ni secretos. Esta interfaz está disponible desde la release estable `v1.4.0`.

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

## Contexto de inicio para un host

```bash
forge614-engram startup-context --directory /ruta/absoluta/al-repositorio --json
```

Es la única interfaz pública para que Forge614 Engines o Shell lean memoria antes de iniciar un agente; nunca deben leer SQLite directamente. Es no interactiva, idempotente y de solo lectura. Devuelve un único JSON con `format: 1`, contexto `shared` y `project`: `bound` incluye `projectId` y contexto; `unbound` usa valores `null` y no es un error.

Cada sección usa el límite propio de `context()` (16 384 bytes por defecto) e incluye previews acotados. No crea proyectos, vínculos, recuerdos, sesiones, bases ni migraciones. Entrada inválida, espacio sin `init` previo u otro error devuelve `{code,error}` por stderr y código `1`, sin secretos ni rutas crudas. Disponible desde la versión 1.5.0.
