# 03. Referencia CLI

Los comandos de datos escriben JSON en stdout. Los errores escriben JSON `{code,error}` en stderr y salen con código `1`. `help` y `--version` no crean almacenamiento.

Los comandos incorporados en 1.6.0 (`group-*` y `memory-move`) y los códigos de error nuevos siguen la convención de contratos de máquina del ecosistema: la salida lleva `schemaVersion` en la raíz y el error es `{schemaVersion,code,error}` con un `code` en `MAYUSCULAS_CON_GUION_BAJO`. Todo comando y código anterior conserva exactamente su forma.

## Ciclo de vida

```text
init [--json] [--postgres-url <URL>] [--directory <ruta>]
                                        inicializa memoria local; URL y --directory requieren --json
update [--json]                         instala el último release estable; --json devuelve resultado estructurado
uninstall --confirm <frase exacta>      elimina solo Engram, o Engram y Atlas
mcp                                     inicia servidor MCP local por stdio
sync [--upgrade-format]                 sincroniza réplica PostgreSQL configurada
sync-watch [--interval <1..3600>]       reintenta sync mientras el proceso permanece abierto
sessions-enable                         habilita explícitamente sesiones
reinforcement-enable                    habilita explícitamente orden local por repeticiones
intelligence-enable                     habilita explícitamente la memoria inteligente (esquema 11); respalda antes de migrar
memory-protocol --json [--protocol-version 1|2|3]
                                        imprime el contrato público de memoria; versión 1 por defecto
startup-context --directory <ruta> --json
                                        precarga contexto para un host antes de una sesión y mantiene al día la identidad del repositorio
```

`setup` está retirado y devuelve `COMMAND_RETIRED`. No existen los comandos `tui`, `assistant-list`, `integration-enable` ni `memory-hook`.

`init --json --directory <ruta>` es la vinculación explícita y no interactiva de una carpeta: registra el proyecto (por el `id` de su `.forge614/project.json` si el repositorio ya lo trae), escribe ese archivo en silencio y añade `project` al resultado (`{ "projectId", "directory", "source" }`, más `group` si pertenece a un grupo). Repetirlo no cambia nada: el archivo queda con los mismos bytes. `--directory` no se combina con `--postgres-url`.

## Contrato de protocolo de memoria

```text
forge614-engram memory-protocol --json
```

Este comando no interactivo publica el contrato JSON versionado para que Forge614 Engines pueda preparar una instalación segura en asistentes compatibles. Requiere `--json`; sin esa opción, o con flags desconocidos, devuelve el error JSON estándar `{code,error}` a stderr y sale con código `1`.

No requiere TTY, no crea ni abre `~/.forge614/engram/`, no inicializa SQLite y no consulta proyectos, PostgreSQL ni datos de la persona. El contrato está disponible desde la release `v1.3.0`; eso no implica que Engram configure asistentes directamente. La versión 3 (desde 1.6.0) anuncia el ámbito `ecosystem`; las versiones 1 y 2 no cambian. Consulta [09. Protocolo Público de Memoria](09-protocolo-publico-de-memoria.md) para el ciclo de vida, seguridad y límites.

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

`project-rename` también actualiza el nombre en el `.forge614/project.json` de cada carpeta vinculada a ese proyecto en esta máquina; el `id` nunca cambia. `project-bind` escribe el archivo si no existe y devuelve `PROJECT_FILE_CONFLICT` si la carpeta ya declara otra identidad de proyecto.

## Grupos y ecosistema

Disponible desde la versión 1.6.0. Un **grupo** reúne repositorios relacionados que comparten memoria (consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md)).

```text
group-create --name <nombre>
group-list
group-bind --project-id <UUID> --group <nombre|id>
group-unbind --project-id <UUID>
group-rename --group <nombre|id> --name <nombre>
memory-move --id <id-recuerdo> --to-scope ecosystem --group <nombre|id> [--project-id <UUID> | --scope shared]
```

`<nombre>` usa minúsculas, dígitos y guiones simples (`mi-tienda`), de 1 a 64 caracteres. `--group` acepta el identificador (UUID) o un nombre que identifique exactamente un grupo; si hay varios con ese nombre devuelve `GROUP_AMBIGUOUS` y se indica el identificador que muestra `group-list`. Un proyecto pertenece como máximo a un grupo.

```text
// group-create --name mi-tienda
{ "schemaVersion": 1, "group": { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>" } }
// group-list
{ "schemaVersion": 1, "groups": [ { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>", "projects": [ { "projectId": "<uuid>", "name": "repo" } ] } ] }
// group-bind
{ "schemaVersion": 1, "projectId": "<uuid>", "group": { "id": "<uuid>", "name": "mi-tienda", "createdAt": "<ISO-8601>" }, "changed": true, "identityFilesUpdated": 1 }
// group-unbind
{ "schemaVersion": 1, "projectId": "<uuid>", "unbound": true, "identityFilesUpdated": 1 }
// group-rename
{ "schemaVersion": 1, "group": { "id": "<uuid>", "name": "tienda-2", "createdAt": "<ISO-8601>" }, "identityFilesUpdated": 1 }
```

La primera vez que crear un grupo actualiza la base, `group-create` añade `"notices": [ { "code": "DATABASE_MIGRATED", "message": "…", "backup": "<ruta del respaldo>" } ]` (sin `backup` si la base estaba vacía); después no aparece. `changed` es `false` si el proyecto ya estaba en ese grupo. `identityFilesUpdated` cuenta los `.forge614/project.json` de esta máquina que se actualizaron (el grupo o su nombre). Cambiar o quitar el grupo queda registrado como evento local.

`memory-move` mueve un recuerdo existente a un grupo **conservando su id, su historial y sus versiones**: añade una versión nueva que registra el cambio de ámbito y un evento `MEMORY_MOVED`. Nunca copia ni borra en silencio: si el grupo ya tiene un recuerdo con el mismo tema responde `TOPIC_CONFLICT` y no cambia nada; un resumen de sesión no puede moverse (`SUMMARY_TOPIC_RESERVED`). El origen es un proyecto (`--project-id`, por defecto) o compartido (`--scope shared`).

```text
// memory-move
{ "schemaVersion": 1, "memory": { "id": "<uuid>", "projectId": null, "scope": "ecosystem", "groupId": "<uuid>", "version": 2, "state": "active", "…": "…" },
  "from": { "scope": "project", "projectId": "<uuid>" }, "to": { "scope": "ecosystem", "groupId": "<uuid>" } }
```

La primera vez que un comando crea o usa un grupo en una base creada por 1.5.x, Engram actualiza la base con un respaldo automático previo (consulta el capítulo 11).

```text
save --project-id <UUID> --title <texto> --content <texto> [--type fact|decision|procedure|warning|preference]
     [--topic <clave>] [--expected-version <n>] [--request-key <clave>] [--pinned true|false]
     [--session-id <id>] [--session-project-id <UUID>]
search --project-id <UUID> --query <texto> [--scope all|project|shared|ecosystem] [--limit <1..100>] [--preview]
search --scope shared --query <texto>
search --scope ecosystem --group <nombre|id> --query <texto>
get --project-id <UUID> --id <id-recuerdo> [--version <n>]
history --project-id <UUID> --id <id-recuerdo>
archive|restore --project-id <UUID> --id <id-recuerdo>
save|get|history|archive|restore --scope ecosystem --group <nombre|id> …
```

Usa `--scope shared` en vez de `--project-id` para un recuerdo compartido. Actualizar un tema existente requiere `--expected-version`.

Usa `--scope ecosystem --group <nombre|id>` (sin `--project-id`) para el recuerdo de un grupo; tiene los mismos temas, versiones, archivo/restauración y refuerzo que los otros ámbitos, y su JSON añade `groupId`. En `search`, `--scope ecosystem` acepta `--group` o el `--project-id` de un proyecto que pertenezca a un grupo (si no pertenece, `GROUP_REQUIRED`). `--group` solo se acepta con `--scope ecosystem`. Con `--project-id` y `--scope all`, la búsqueda incluye automáticamente el grupo del proyecto; si un tema se repite, gana el del proyecto, luego el del grupo y por último el compartido.

## Sesiones y contexto

```text
session-start --directory <ruta> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json> --request-key <clave> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <id-recuerdo> --version <n> [--before <0..20>] [--after <0..20>]
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
context --scope ecosystem --group <nombre|id> [--compact] [--max-bytes <1024..65536>]
```

`context --project-id` de un proyecto que pertenece a un grupo añade al resultado la clave `ecosystem` (`{ "status": "member", "group": { "id", "name" }, "context": <ContextResult> }`) con su propio límite de bytes; para cualquier otro proyecto el resultado no cambia.

Con el esquema 11, `session-start` añade `previous` (`{ sessionId, interruptedAt, summary }`) cuando la llamada crea la sesión y el proyecto tiene una sesión anterior interrumpida; repetir el arranque con el mismo `session-id` nunca lo añade.

Ejecuta `forge614-engram help` para la sintaxis exacta de la versión instalada.

## Contexto de inicio para un host

```bash
forge614-engram startup-context --directory /ruta/absoluta/al-repositorio --json
```

Es la única interfaz pública para que Forge614 Engines o Shell lean memoria antes de iniciar un agente; nunca deben leer SQLite directamente. Es una consulta no interactiva e idempotente. Devuelve un único JSON con `format: 1`, contexto `shared` normal, `ecosystem` (`{ "status": "member", "group", "context" }` si el proyecto pertenece a un grupo o `{ "status": "none" }`) y `project` (con `source`: `file`, `path` o `unbound`): un proyecto válido y vinculado conserva el comportamiento previo con `status: "bound"`, `projectId` y contexto de proyecto; cuando no se puede resolver o vincular como proyecto, no falla y devuelve `project: { "status": "unbound" }` con los demás valores nulos según el esquema (`projectId: null, context: null`). Cualquier directorio existente y legible es válido: `$HOME`, `/`, una carpeta sin Git, un repositorio Git sin vínculo y una carpeta vinculada; los casos sin vínculo devuelven `unbound`.

Cada sección usa el límite propio de `context()` (16 384 bytes por defecto) e incluye previews acotados. No crea recuerdos, sesiones ni bases de datos, ni un proyecto para una carpeta sin vínculo; solo actualiza la base (con respaldo previo) la primera vez que un repositorio declara un grupo, y lo avisa con `DATABASE_MIGRATED` en `project.notices`. Sí mantiene la identidad del repositorio: registra por `id` un clon que trae su `.forge614/project.json` y escribe ese archivo a un proyecto vinculado solo por ruta (el resultado lo indica en `project.notices`). Por eso abre la base en solo lectura y la reabre para escritura solo cuando debe registrar algo (consulta [10. Contexto de Inicio para Hosts](10-contexto-de-inicio.md)). Solo fallan una ruta inexistente, que no sea directorio o que sea ilegible; el fallo deja stdout vacío, escribe JSON `{code,error}` en stderr y sale con código 1, sin secretos ni rutas crudas. Un espacio sin `init` previo u otro error real conserva ese mismo manejo de error. Disponible desde la versión 1.5.0.
