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

Engram conserva el UUID de un proyecto en SQLite. Un vínculo identifica su carpeta local, y un remoto Git confirmado permite reconocer reclones. Los worktrees de un repositorio comparten el directorio común de Git. Los repositorios antiguos también pueden traer un archivo legado `.forge614/project.json` en la raíz, con esta forma.

```json
{
  "schemaVersion": 1,
  "project": { "id": "<uuid>", "name": "frontend" },
  "ecosystem": { "id": "<uuid>", "name": "mi-tienda" }
}
```

`ecosystem` es `null` para un proyecto sin grupo. Los UUID identifican el proyecto y el grupo. Los nombres se usan para mostrarlos.

- **El archivo legado aporta evidencia.** Una declaración compatible puede recuperar el UUID. Si contradice el vínculo local o el remoto confirmado, Engram conserva el archivo y pide resolver la carpeta. Consulta [03. Referencia CLI](03-referencia-cli.md).
- **La publicación de un archivo legado requiere una exclusión efectiva.** Una carpeta Git con remoto utilizable usa SQLite. Al publicar un archivo legado, Engram verifica la regla `/.forge614/` del `.gitignore` raíz de ese worktree. Si el archivo ya está rastreado, Engram lo lee, avisa y conserva tanto el archivo como su entrada en el índice.
- **Un archivo inválido produce `PROJECT_FILE_INVALID`.** JSON corrupto, campos o versiones desconocidos, enlaces simbólicos o archivos mayores de 64 KiB no se sobrescriben. Corrige el archivo antes de volver a leer esa carpeta.

## Cómo se vincula un proyecto a un grupo

Sin preguntar, en este orden de prioridad:

1. **`forge614.node.json`** con el campo `ecosystem` (el nombre del grupo). Los nodos de Forge614 lo traen de fábrica con `"ecosystem": "forge614"`. Engram solo **lee** ese archivo (es de otro componente) e ignora cualquier valor inutilizable. Como el archivo solo trae el nombre, el `id` del grupo se deriva de él, de modo que cualquier máquina reconoce el mismo grupo sin coordinarse; el grupo `forge614` tiene el `id` fijo `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4`.
2. **La sección `ecosystem` de un archivo legado compatible.**

En el flujo ordinario, `forge614.node.json` tiene precedencia sobre la declaración compatible del archivo legado. Sin una declaración ni una pertenencia previa, el proyecto queda sin grupo. Los proyectos creados con `project-create --directory` requieren una pertenencia explícita mediante `group-bind`; `group-unbind` la quita, aunque la carpeta conserve declaraciones copiadas.

## Mover un recuerdo entre ámbitos

Ningún recuerdo cambia de ámbito automáticamente. Para llevar uno existente a un grupo se usa `memory-move --id <id> --to-scope ecosystem --group <nombre|id>`, que conserva su `id`, su historial y sus versiones, añade una versión nueva con el ámbito nuevo y registra el evento `MEMORY_MOVED`. Nunca copia ni borra en silencio: un tema ya ocupado en el grupo (`TOPIC_CONFLICT`), una clave de petición repetida (`REQUEST_CONFLICT`) o un resumen de sesión (`SUMMARY_TOPIC_RESERVED`) detienen la operación sin cambiar nada.

## Actualización desde 1.5.x

Los ámbitos nuevos necesitan una ampliación del esquema de la base. Es **aditiva**: solo se agregan tablas y una columna nula, y se recrean `memories` y `requests` conservando nombre, columnas, tipos y todas sus filas para ampliar la restricción del ámbito a tres valores.

- **Niveles.** Los niveles de esquema 8, 9 y 10 son los niveles 5, 6 y 7 (vínculos, sesiones, refuerzo) más el ecosistema. Habilitar grupos nunca activa sesiones ni refuerzo por su cuenta.
- **Cuándo.** Una apertura normal nunca migra. La base se actualiza la primera vez que un comando necesita grupos (`group-create`, leer un `project.json` o `forge614.node.json` que declara un grupo compatible); los comandos que solo consultan o mueven algo a un grupo que no existe responden `GROUP_NOT_FOUND` sin migrar. Quien no usa grupos conserva su base tal cual.
- **Respaldo automático.** Antes de migrar, Engram copia la base a `engram.db.v<versión>-pre-ecosystem-<fecha UTC>-<id>.bak` junto a ella (permisos `0600`, copia consistente con `VACUUM INTO`). Se omite si la base aún no tiene proyectos ni recuerdos. Engram no borra esos respaldos.
- **Aviso.** El resultado del comando que dispara la actualización (`startup-context`, `group-create`, `session-start`, `init --directory`, `project-bind` o una llamada MCP) incluye un aviso `DATABASE_MIGRATED` con la ruta del respaldo en `backup`. Las llamadas siguientes no vuelven a avisar. Si esa llamada devuelve una lista (por ejemplo `memory_history`), el aviso llega en el primer resultado que puede llevarlo.
- **Verificación.** La migración ocurre en una sola transacción y compara, antes y después, el recuento de filas y una suma SHA-256 del contenido de `memories` y `requests`, además de las claves foráneas y el índice de texto. Si algo difiere, revierte todo y responde `MIGRATION_VERIFY_FAILED`; el respaldo se conserva. Aplicarla dos veces no cambia nada. En la prueba con 50 000 recuerdos tardó unos 0,65 s, incluidos respaldo y verificación (medido en macOS).
- **Compatibilidad hacia atrás.** Una base creada por 1.5.3 se abre y se lee completa con 1.6.0 sin pérdida (fixtures reales en las pruebas). En sentido inverso, Engram 1.5.3 no abre una base ya actualizada: responde `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") y **no la modifica** (verificado: integridad correcta, mismas filas). El respaldo previo sí se abre con 1.5.3. Un proceso 1.5.x que ya estuviera en marcha (por ejemplo un servidor MCP) debe reiniciarse después de actualizar.

## El tablero del ecosistema (desde 1.7.0)

Con el esquema 11, el ámbito `ecosystem` de un grupo funciona como un tablero compartido. Sirve para las reglas y los contratos que valen para varios proyectos del grupo (una decisión de arquitectura, un procedimiento común, una advertencia), nunca para estados ni avances de trabajo, que se quedan en cada proyecto. Por debajo del esquema 11 nada de esto aplica: un recuerdo `ecosystem` se guarda y se mueve como en 1.6.0.

Todo guardado `ecosystem` (CLI `save`, SDK `save` y `saveWithSession`, MCP `memory_save`) y todo `memory-move` hacia un grupo cumplen estas reglas, comprobadas en este orden:

1. **Tipo:** solo `decision`, `procedure` o `warning` (`ECOSYSTEM_TYPE_NOT_ALLOWED`).
2. **`affects`:** los efectivos, los enviados o, si no hay, los ya guardados, deben ser al menos 2 nombres (`ECOSYSTEM_AFFECTS_REQUIRED`) y cada uno el nombre exacto de un proyecto miembro del grupo (`ECOSYSTEM_AFFECTS_UNKNOWN`, cuyo mensaje nombra los desconocidos y los válidos). En la CLI se envían con `save --affects <proyecto-a,proyecto-b,...>`.
3. **Tope:** el tablero admite 40 recuerdos activos. Solo se comprueba al agregar un recuerdo nuevo (`ECOSYSTEM_BOARD_FULL`, cuyo mensaje trae el conteo y los títulos para consolidar o bajar uno). No cuentan la nota de estado ni los resúmenes de sesión; sí cuentan los recuerdos sin tema.

Los resúmenes de sesión de grupo (`memory_session_summary` con `scope: "ecosystem"`) no siguen estas reglas.

**Nota de estado y proyecto fuente.** El tema reservado `ecosystem/estado-actual` guarda una nota corta con el estado del grupo. Solo la escribe el **proyecto fuente** del grupo, que se define con `group-source-set --group <nombre|id> --project-id <UUID>` (SDK: `setGroupSource`) y debe seguir siendo miembro; cualquier otro autor recibe `ECOSYSTEM_STATUS_FORBIDDEN`. Por MCP, `memory_save` envía siempre como autor el proyecto de la carpeta; la CLI no envía autor, así que por CLI la nota de estado siempre responde ese error. La nota admite los tipos `decision`, `procedure`, `warning` y `fact`, tiene un máximo de 600 caracteres de contenido (`ECOSYSTEM_STATUS_TOO_LONG`), siempre queda fijada, no pide `affects` y no cuenta para el tope. Repetir la misma petición (`requestKey`) devuelve el mismo recuerdo, y un recuerdo con ese tema no puede moverse a un grupo (`ECOSYSTEM_STATUS_FORBIDDEN`).

**Bajar un recuerdo.** `memory-demote --id <recuerdo> --project-id <UUID>` (SDK: `demoteMemory(projectId, id)`) devuelve al proyecto un recuerdo del tablero del grupo de ese proyecto, conservando su id, todas sus versiones y sus metadatos (versión corta, `affects`, vigencia). Añade una versión que registra el cambio de ámbito y el evento `MEMORY_DEMOTED`. Si el proyecto ya tiene un recuerdo con ese tema responde `TOPIC_CONFLICT`. El detalle de los comandos está en el [capítulo 3](03-referencia-cli.md).

## La misma memoria en otra Mac, con nube (desde 1.8.0)

Con `cloud on`, la réplica incremental transporta recuerdos, grupos, pertenencias, orígenes confirmados y políticas de grupo. En la otra instalación, ejecuta `sync` y deja que termine la primera descarga antes de usar una carpeta nueva. En una misma máquina, SQLite puede reconocer los reclones con la nube apagada.

## Límites actuales

- **Réplica PostgreSQL de los formatos 1–3.** **Las memorias de ámbito `ecosystem` no se replican por esta ruta.** Sin la nube activada, `sync` (con o sin `--upgrade-format`) se detiene con `SYNC_ECOSYSTEM_UNSUPPORTED` si existen recuerdos `ecosystem`, sin tocar datos locales ni remotos; sin recuerdos de grupo funciona igual que antes. `sync --upgrade-format` usa siempre esta ruta, aun con la nube activada. Esta ruta queda obsoleta desde 1.8.0 (sunset 2027-03-31): la nube de `cloud on` sí replica el ámbito `ecosystem` (arriba).
- **`forge614.node.json` es de solo lectura** para Engram y solo se usa su campo `ecosystem`.
- **Cada base guarda sus grupos.** Las instalaciones que usan la misma réplica incremental sincronizan sus grupos y pertenencias.
- La pregunta de a qué grupo pertenece un proyecto sin declaración no la hace Engram (la hace Shell en su flujo visual).
