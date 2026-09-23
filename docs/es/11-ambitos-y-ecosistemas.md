# 11. Ámbitos y Ecosistemas

> **Estado:** disponible desde la versión 1.6.0.

Imagina tres estantes: uno dentro de cada oficina (un repositorio), uno en el pasillo que comparten las oficinas de una misma empresa (un grupo de repositorios relacionados) y uno en tu casa, que te acompaña a todas partes. Un **ámbito** es el estante donde vive un recuerdo; decide quién lo puede ver.

## Los tres ámbitos

- **`project`**: el conocimiento de un repositorio. Lo ve solo ese proyecto.
- **`ecosystem`**: el conocimiento que comparten los repositorios de un **grupo** (microservicios, microfrontends, un monorepo partido en varios o el propio ecosistema Forge614). Lo ven todos los proyectos del grupo y ninguno más. Tiene los mismos temas (`topicKey`), versiones, historial, archivo/restauración y refuerzo que los otros ámbitos.
- **`shared`**: lo que la persona quiere tener en todos sus proyectos, sin importar el grupo.

Nadie tiene que guardar recuerdos a mano en el ámbito de grupo ni saber que existe: un proyecto declara a qué grupo pertenece en su propio repositorio y Engram lo detecta. Guardar en `ecosystem` es explícito: `--scope ecosystem --group <nombre|id>` en la CLI, o `scope: "ecosystem"` con un `groupIntent` verdadero en las herramientas MCP (consulta [09. Protocolo Público de Memoria](09-protocolo-publico-de-memoria.md)).

## Precedencia cuando un tema se repite

Si el mismo `topicKey` activo existe en varios ámbitos, la búsqueda combinada (`--scope all` con un proyecto) devuelve solo uno: **`project` sobre `ecosystem` sobre `shared`**. Si el del proyecto se archiva, aparece el del grupo; si también se archiva, el compartido. La precedencia solo aplica a la búsqueda combinada: `startup-context` y `context` devuelven un bloque por ámbito, cada uno con su propio límite de bytes.

## Grupos

Un **grupo** es un conjunto con nombre de proyectos relacionados. Sus reglas:

- El nombre usa minúsculas, dígitos y guiones simples (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), de 1 a 64 caracteres.
- Un proyecto pertenece **como máximo a un grupo**; un monorepo es un solo proyecto.
- La identidad de un grupo es su **`id`** (un UUID); el nombre es para personas. Por eso dos grupos pueden compartir nombre (por ejemplo, un clon en otra máquina trae su grupo por `id` aunque ya exista otro con el mismo nombre). `group-create` rechaza un nombre que ya existe (`GROUP_EXISTS`) y una referencia por nombre que coincida con varios grupos devuelve `GROUP_AMBIGUOUS`: usa el `id` que muestra `group-list`.
- Se administran con `group-create`, `group-list`, `group-bind`, `group-unbind` y `group-rename` (consulta [03. Referencia CLI](03-referencia-cli.md)) o con `MemoryWorkspace` en el SDK. Cambiar o quitar el grupo de un proyecto queda registrado como un evento local.

## Identidad portátil del proyecto

Hasta 1.5.x un proyecto se vinculaba a la **ruta** de su carpeta: mover o renombrar la carpeta, o clonar el repositorio en otra máquina, rompía el vínculo y la memoria parecía desaparecer. Desde 1.6.0 el repositorio lleva su identidad en `.forge614/project.json`, en la raíz del checkout, versionado en Git:

```json
{
  "schemaVersion": 1,
  "project": { "id": "<uuid>", "name": "frontend" },
  "ecosystem": { "id": "<uuid>", "name": "mi-tienda" }
}
```

`ecosystem` es `null` para un proyecto suelto. Los `id` son la verdad; los `name` son para personas.

- **Se resuelve por `id`, no por ruta.** Toda operación con `--directory` lee primero ese archivo; la ruta queda como pista. Si el `id` no existe en la base local (un clon en otra máquina), Engram registra el proyecto —y su grupo— con ese `id`, sin preguntar.
- **Mover, renombrar la carpeta o clonar no requiere ninguna acción.** `project-rename` y `group-rename` actualizan el `name` en el archivo; los `id` nunca cambian.
- **Engram es el único dueño del archivo y lo escribe en silencio.** Nunca pide permiso ni avisa por escribirlo: es configuración del producto. La escritura es idempotente: si el archivo ya existe, lo lee, **nunca lo reemplaza ni cambia sus `id`** y, como máximo, completa un campo que falte; repetir `init --directory` o `project-bind` no cambia ni un byte. Dentro de `.forge614/` Engram escribe solo `project.json` y nunca toca otros archivos (cada nodo de Forge614 es dueño del suyo).
- **Si la base y el archivo discrepan, gana el archivo.** Si la base tenía esa carpeta vinculada a otro proyecto, Engram la re-vincula al del archivo, registra el evento `PROJECT_REBOUND_FROM_FILE` y no modifica el archivo. Los proyectos que ya estaban vinculados solo por ruta reciben su `project.json` en el siguiente `startup-context` o `session-start` en esa carpeta, con un aviso `PROJECT_FILE_CREATED` en el resultado de `startup-context` (dentro de `project.notices`) y de `session-start` (clave `notices`).
- **Un archivo inválido nunca se sobrescribe.** JSON corrupto, `schemaVersion` desconocido, campos desconocidos, un `id` que no es UUID, un enlace simbólico, un directorio o un archivo mayor de 64 KiB producen `PROJECT_FILE_INVALID` por stderr y no se cambia nada. La validación es estricta (un esquema Zod `.strict()`) y se carga solo cuando el repositorio trae ese archivo: un inicio de sesión en una carpeta sin `project.json` no la paga. Para los hosts es un **error visible**, no un contexto vacío: `startup-context` no devuelve ningún bloque (ni siquiera `shared`); se repara corrigiendo el archivo o borrándolo.

## Cómo se vincula un proyecto a un grupo

Sin preguntar, en este orden de prioridad:

1. **`forge614.node.json`** con el campo `ecosystem` (el nombre del grupo). Los nodos de Forge614 lo traen de fábrica con `"ecosystem": "forge614"`. Engram solo **lee** ese archivo (es de otro componente) e ignora cualquier valor inutilizable. Como el archivo solo trae el nombre, el `id` del grupo se deriva de él, de modo que cualquier máquina reconoce el mismo grupo sin coordinarse; el grupo `forge614` tiene el `id` fijo `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4`.
2. **La sección `ecosystem` de `.forge614/project.json`** (que Engram escribe al vincular y que viaja por Git).

Si no hay ninguno, los comandos no interactivos (`init --json --directory`, `project-bind`, `startup-context`) dejan el proyecto **sin grupo** y escriben `ecosystem: null` (el resultado no incluye `group`); no preguntan. La única pregunta ("¿a qué grupo pertenece?") pertenece al flujo visual de Shell, no a Engram. **Nada se infiere**: ni por nombres de carpeta, ni por cercanía en disco, ni por remotos de Git, ni por parecido entre nombres. Si ambas fuentes declaran un grupo distinto, gana `forge614.node.json`. Quitar la sección `ecosystem` de un archivo que estableció la pertenencia la quita también de la base; una pertenencia hecha con `group-bind` no se deshace porque un archivo aún no se haya actualizado.

## Mover un recuerdo entre ámbitos

Ningún recuerdo cambia de ámbito automáticamente. Para llevar uno existente a un grupo se usa `memory-move --id <id> --to-scope ecosystem --group <nombre|id>`, que conserva su `id`, su historial y sus versiones, añade una versión nueva con el ámbito nuevo y registra el evento `MEMORY_MOVED`. Nunca copia ni borra en silencio: un tema ya ocupado en el grupo (`TOPIC_CONFLICT`), una clave de petición repetida (`REQUEST_CONFLICT`) o un resumen de sesión (`SUMMARY_TOPIC_RESERVED`) detienen la operación sin cambiar nada.

## Actualización desde 1.5.x

Los ámbitos nuevos necesitan una ampliación del esquema de la base. Es **aditiva**: solo se agregan tablas y una columna nula, y se recrean `memories` y `requests` conservando nombre, columnas, tipos y todas sus filas para ampliar la restricción del ámbito a tres valores.

- **Niveles.** Los niveles de esquema 8, 9 y 10 son los niveles 5, 6 y 7 (vínculos, sesiones, refuerzo) más el ecosistema. Habilitar grupos nunca activa sesiones ni refuerzo por su cuenta.
- **Cuándo.** Una apertura normal nunca migra. La base se actualiza la primera vez que un comando necesita grupos (`group-create`, leer un `project.json` o `forge614.node.json` que declara un grupo, o re-vincular una carpeta porque gana el archivo); los comandos que solo consultan o mueven algo a un grupo que no existe responden `GROUP_NOT_FOUND` sin migrar. Quien no usa grupos conserva su base tal cual.
- **Respaldo automático.** Antes de migrar, Engram copia la base a `engram.db.v<versión>-pre-ecosystem-<fecha UTC>-<id>.bak` junto a ella (permisos `0600`, copia consistente con `VACUUM INTO`). Se omite si la base aún no tiene proyectos ni recuerdos. Engram no borra esos respaldos.
- **Aviso.** El resultado del comando que dispara la actualización (`startup-context`, `group-create`, `session-start`, `init --directory`, `project-bind` o una llamada MCP) incluye un aviso `DATABASE_MIGRATED` con la ruta del respaldo en `backup`. Las llamadas siguientes no vuelven a avisar. Si esa llamada devuelve una lista (por ejemplo `memory_history`), el aviso llega en el primer resultado que puede llevarlo.
- **Verificación.** La migración ocurre en una sola transacción y compara, antes y después, el recuento de filas y una suma SHA-256 del contenido de `memories` y `requests`, además de las claves foráneas y el índice de texto. Si algo difiere, revierte todo y responde `MIGRATION_VERIFY_FAILED`; el respaldo se conserva. Aplicarla dos veces no cambia nada. En la prueba con 50 000 recuerdos tardó unos 0,65 s, incluidos respaldo y verificación (medido en macOS).
- **Compatibilidad hacia atrás.** Una base creada por 1.5.3 se abre y se lee completa con 1.6.0 sin pérdida (fixtures reales en las pruebas). En sentido inverso, Engram 1.5.3 no abre una base ya actualizada: responde `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") y **no la modifica** (verificado: integridad correcta, mismas filas). El respaldo previo sí se abre con 1.5.3. Un proceso 1.5.x que ya estuviera en marcha (por ejemplo un servidor MCP) debe reiniciarse después de actualizar.

## Límites actuales

- **Réplica PostgreSQL.** **Las memorias de ámbito `ecosystem` no se replican todavía.** La sincronización aún no describe el ámbito de grupo: si existen recuerdos `ecosystem`, `sync` se detiene con `SYNC_ECOSYSTEM_UNSUPPORTED` sin tocar datos locales ni remotos; sin recuerdos de grupo funciona igual que antes. La replicación de grupos llegará en un plan propio (1.7.0, «formato 4»).
- **`forge614.node.json` es de solo lectura** para Engram y solo se usa su campo `ecosystem`.
- **Un grupo es local a la base** de esta máquina más los archivos `.forge614/project.json` de cada repositorio; no hay un servicio central de grupos.
- La pregunta de a qué grupo pertenece un proyecto sin declaración no la hace Engram (la hace Shell en su flujo visual).
