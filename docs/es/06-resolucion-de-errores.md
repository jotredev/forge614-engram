# 06. Resolución de Problemas

## Instalación o actualización

El instalador único requiere Node.js 22.19.0 o posterior; en Windows, `-ExecutionPolicy Bypass` solo afecta ese proceso de PowerShell. Si falla la descarga o la huella, reintenta con conectividad estable y no ejecutes un archivo que no pasó la verificación. Con `FORGE614_HOME` definido, comprueba que sea una ruta absoluta.

Si actualizas desde 1.9.0, en macOS/Linux el portero nuevo migra la memoria en una ejecución. En Windows, corre `forge614-engram update` dos veces: la primera actualiza el ejecutable de 1.9.0 y la segunda, ya en 1.10.0, migra los datos. `update --version X.Y.Z` selecciona un release específico; Shell usa `update --json`.

## Inicialización

`init` requiere terminal interactiva. Usa `init --json` en automatización. `--postgres-url` solo es válido con `init --json`; fallas de conexión devuelven JSON estructurado sin exponer la URL ni dejar configuración parcial.

## Almacenamiento

La base, `.env` y respaldos viven en `~/.forge614/memory/` o `FORGE614_HOME/memory/`. No borres ni muevas manualmente esos archivos. Si una sesión de MCP 1.9.0 mantiene abierta la base antigua, 1.10.0 sigue usándola y reintenta la migración al abrir Engram de nuevo.

## Búsqueda y temas

Por debajo del esquema 11, la búsqueda es coincidencia literal FTS5 (sin cambios). Desde el esquema 11 (memoria inteligente) es híbrida: reparte la consulta entre palabras completas y trigramas, combina por rango recíproco (RRF) y pondera por el multiplicador de refuerzo; un resultado necesita al menos 2 de los términos de la consulta y una consulta sin términos útiles no devuelve nada (consulta el capítulo 5). Proporciona un `projectId` para búsquedas de proyecto o usa `--scope shared`. Actualizar un tema requiere su `--expected-version` actual; consulta antes `get` o `history`.

## PostgreSQL

SQLite/FTS5 permanece local aun después de configurar PostgreSQL. Ejecuta `sync` explícitamente. Antes de `sync --upgrade-format`, actualiza cada equipo participante a una versión compatible.

La URL de PostgreSQL es un secreto. Engram nunca la devuelve en resultados, errores de CLI ni respuestas MCP. Si un error de dominio llegara a contener una URL `postgres://` o `postgresql://`, la reemplaza por `[URL de PostgreSQL oculta]`; no expone usuario, contraseña, host, puerto, base de datos ni parámetros. Los errores inesperados usan un mensaje genérico sin detalles internos.

## Grupos, identidad del proyecto y actualización de la base

Desde 1.6.0. Los comandos `group-*`, `memory-move` y los códigos de esta sección devuelven `{schemaVersion,code,error}` por stderr (consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md)).

- `GROUP_NAME_INVALID`: el nombre del grupo debe usar minúsculas, dígitos y guiones simples (`mi-tienda`), de 1 a 64 caracteres.
- `GROUP_EXISTS`: ya existe un grupo con ese nombre; usa `group-list`.
- `GROUP_NOT_FOUND`: el grupo no existe en esta base (también cuando la base aún no conoce grupos). Créalo con `group-create`.
- `GROUP_AMBIGUOUS`: varios grupos tienen ese nombre; usa el `id` que muestra `group-list`.
- `GROUP_REQUIRED`: el ámbito `ecosystem` necesita un grupo: indica `--group` o usa un proyecto que pertenezca a uno (`group-bind`). `memory_search` y `memory_context` con scope `ecosystem` ya no la dan (desde 1.8.6): un proyecto ligado sin grupo no tiene recuerdos de grupo, así que `memory_search` responde `results: []` y `memory_context` el contexto vacío de grupo, los dos con un campo `ecosystem: { status: "none", message }` y la nota «Este proyecto no pertenece a ningún grupo, así que no hay recuerdos de grupo. Se vincula a uno con forge614-engram group-bind.». Sí la siguen dando, en un proyecto ligado sin grupo (y, en `memory_save` y `memory_session_summary`, una vez dado el `groupIntent`), `memory_save`, `memory_get`, `memory_history` y `memory_session_summary` con scope `ecosystem`, y la CLI `search --scope ecosystem`.
- `GROUP_INTENT_REQUIRED`: guardar en `ecosystem` con MCP exige un `groupIntent` verdadero.
- `TOPIC_CONFLICT`: `memory-move` no sobrescribe; el grupo ya tiene un recuerdo con ese tema. Archívalo o cambia el tema.
- `PROJECT_FILE_INVALID` indica JSON corrupto, un formato desconocido o un archivo legado inseguro. Engram conserva sus bytes. Corrige el archivo o retíralo si ya no aporta una identidad que quieras conservar.
- `PROJECT_FILE_CONFLICT` aparece cuando el archivo declara otro proyecto. Verifica el UUID y usa `project-bind --replace-from` para corregir el vínculo sin editar el archivo.
- `MIGRATION_VERIFY_FAILED`: la verificación de la migración falló y se revirtió todo. La base no cambió y el respaldo `.bak` junto a `engram.db` se conserva; no lo borres y reporta el caso.
- `SYNC_ECOSYSTEM_UNSUPPORTED` indica que la sincronización de snapshots 1–3 encontró recuerdos de grupo. La sincronización incremental de `cloud on` sí los replica.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") al abrir con Engram 1.5.x una base actualizada por 1.6.0: actualiza Engram. La base no se modifica; el respaldo previo `.bak` sigue siendo legible por 1.5.x. Un proceso 1.5.x ya iniciado (por ejemplo un servidor MCP) debe reiniciarse tras actualizar.

## Carpetas sin vincular y recuperación

- `PROJECT_BINDING_REQUIRED` señala evidencias incompatibles, varios candidatos, un remoto histórico sin confirmar o un catálogo de nube pendiente. También puede aparecer si el nombre coincide con un proyecto existente o con su carpeta perdida. El arranque y las consultas de orientación conservan el contexto compartido. Los guardados de proyecto y los inicios de sesión quedan pendientes de resolución.
- Si falta sincronizar, ejecuta `forge614-engram sync` y vuelve a abrir el contexto. Si conoces el proyecto correcto, consulta `project-list` y vincula la carpeta con `project-bind --directory <ruta> --project-id <UUID>`. Añade `--replace-from <UUID-anterior>` al corregir un vínculo o un archivo incompatible. Si la carpeta debe empezar de cero, usa `project-create --name <nombre> --directory <ruta>`.
- `PROJECT_ORIGIN_CONFIRMATION_REQUIRED` indica que una carpeta vinculada conserva su UUID después de cambiar a un remoto libre. Confirma la dirección para futuros clones con `project-bind --accept-origin`.
- `PROJECT_BINDING_CONFLICT` indica que la carpeta ya está vinculada o que `--replace-from` no coincide con el UUID esperado. Revisa la identidad local y repite la corrección con el valor correcto.
- `PROJECT_NOT_BOUND` indica una carpeta sin proyecto identificado. `memory_search` y `memory_context` devuelven la nota `unbound` sin error; con alcance de proyecto o grupo la búsqueda queda vacía. Usar alcance compartido no requiere vincular la carpeta.
- `SESSION_CONFLICT` puede aparecer si intentas abrir una sesión antigua desde una carpeta corregida. Inicia una sesión con un identificador nuevo. Los recuerdos escritos antes de la corrección se revisan por separado en el UUID anterior.
- `PROJECT_FILE_TRACKED` indica que Git rastrea el archivo legado. Engram lo puede leer y conserva sus bytes. Para quitarlo del índice conservando la copia local, añade `/.forge614/` al `.gitignore` raíz y ejecuta estos comandos desde la raíz del checkout.

```bash
git rm --cached -- .forge614/project.json
git status --short
```

- `PROJECT_FILE_NOT_WRITTEN` indica que se omitió la publicación legada. El cambio de SQLite sigue disponible. Revisa si el `.gitignore` raíz es un archivo normal y si la exclusión se aplica al directorio completo.

### Recuperar en otra máquina o actualizar desde 1.10.0

Con la nube activa, configura la misma réplica en la otra instalación y ejecuta `sync`. Espera a que la primera descarga termine y vuelve a leer el contexto. Sin nube, abre una copia consistente del respaldo SQLite en `FORGE614_HOME/memory/engram.db` de la otra instalación y comprueba el UUID antes de guardar. Una base vacía no recupera recuerdos leyendo Git.

Antes de habilitar el catálogo, guarda una copia SQLite consistente, cierra los procesos que abren la base y actualiza sus lectores, incluido cualquier binario de Atlas que incorpore Engram 1.10.0. El primer `sync` tras actualizar puede preparar el catálogo y dejar un respaldo `.bak`. Engram 1.10.0 responde `DATABASE_VERSION` al abrir la base migrada. Si necesitas volver a esa versión, cierra los procesos recientes y restaura una copia del respaldo previo. Conserva tanto la base migrada como el respaldo original.

Consulta [03. Referencia CLI](03-referencia-cli.md) para los comandos completos.

## Memoria inteligente

Desde 1.7.0. En la CLI estos códigos devuelven `{schemaVersion,code,error}` por stderr.

- `SECRET_REJECTED`: el título, el contenido, el tema, la versión corta o un proyecto afectado (`affects`) parecen contener un secreto (el mensaje dice de qué tipo, nunca el valor). Quita el valor y guarda solo dónde vive, por ejemplo `password: <redacted>` o el nombre de la variable de entorno. Aplica en cualquier nivel de la base.
- `INTELLIGENCE_REQUIRED`: se enviaron `short`, `supersedes` o `affects` y la base aún no tiene la memoria inteligente. Actívala con `forge614-engram intelligence-enable` (respalda antes de migrar) o guarda sin esos campos.
- `SUPERSEDES_NOT_FOUND`: `supersedes` apunta a un recuerdo que no existe, está archivado o es de otro ámbito o proyecto. Busca el id correcto con `memory_search`.
- `AMBIGUOUS_SESSION`: con el esquema 11 ya no lo provocan sesiones abiertas obsoletas (las inactivas por más de 6 horas, o las que aún llevan una marca dejada por una base que corrió 1.7.0, se ignoran para la inferencia); si aun así aparece, hay dos sesiones de la misma carpeta genuinamente vivas y abiertas a la vez: indica `sessionId`.
- `ECOSYSTEM_TYPE_NOT_ALLOWED`: el recuerdo del tablero del ecosistema no es `decision`, `procedure` ni `warning` (la nota de estado admite además `fact`). El tablero es para reglas y contratos: cambia el tipo o deja el recuerdo en el proyecto.
- `ECOSYSTEM_AFFECTS_REQUIRED`: los `affects` efectivos (los enviados o, si no hay, los ya guardados) son menos de 2. Envía al menos 2 nombres de proyectos del grupo (CLI: `--affects proyecto-a,proyecto-b`); al mover con `memory-move`, el recuerdo ya debe tenerlos guardados.
- `ECOSYSTEM_AFFECTS_UNKNOWN`: algún nombre de `affects` no es el nombre exacto de un proyecto miembro del grupo; el mensaje nombra los desconocidos y los válidos. Corrige los nombres.
- `ECOSYSTEM_BOARD_FULL`: el tablero ya tiene 40 recuerdos activos (no cuentan la nota de estado ni los resúmenes de sesión); el mensaje trae el conteo y los títulos. Consolida recuerdos o baja uno con `memory-demote`. Solo aparece al agregar un recuerdo nuevo, nunca al actualizar uno existente.
- `ECOSYSTEM_STATUS_FORBIDDEN`: la nota de estado (tema `ecosystem/estado-actual`) solo la escribe el proyecto fuente del grupo, que debe seguir siendo miembro; tampoco se puede mover a un grupo un recuerdo con ese tema. Define el proyecto fuente con `group-source-set` y guarda por MCP o por el SDK con `fromProjectId`; por CLI siempre responde este código.
- `ECOSYSTEM_STATUS_TOO_LONG`: el contenido de la nota de estado pasa de 600 caracteres. Acórtalo.

**Otra sesión aparece como sin cerrar (`previous`) mientras sigue trabajando.** Lleva más de 30 minutos sin pasar por Engram (arrancar o repetir, guardar o confirmar con sesión runtime, actualizar el resumen o cerrar); los mensajes del chat no cuentan. No está cerrada y deja de aparecer en cuanto guarda algo o actualiza su resumen (desde 1.7.1).

## Nube (`cloud on/off/status`, desde 1.8.0)

Consulta [01. Instalación y Primeros Pasos](01-instalacion-y-primeros-pasos.md) para la guía paso a paso y [05. Arquitectura Interna y Fórmulas](05-arquitectura-interna-y-formulas.md) para cómo funciona.

**Conflictos y avisos, nunca detienen la sincronización:**

- El mismo recuerdo cambiado en las dos Mac sin sincronizar entre sí: quedan las dos versiones (la más reciente activa, la otra en el historial) y aparece un aviso una sola vez en el siguiente `session-start`/`memory_session_start`, dentro de `sessionNotice`. La numeración del historial puede quedar distinta entre las dos Mac; eso es normal.
- Un cambio bajado con un secreto o con una forma inválida o desconocida se salta, con un aviso agrupado en la misma sesión; el resto de la cola sigue aplicándose.
- Si un pendiente local lleva más de 24 horas sin subir, aparece un aviso en la siguiente sesión; `cloud status` también lo muestra siempre (`oldestPendingAt`).

**Errores nuevos o que ahora pueden aparecer con la nube activada:**

- `CONFIG_NOT_FOUND`: pediste `cloud on` antes de `init`. Ejecuta `init` antes de `cloud on`.
- `POSTGRES_URL`: la dirección de conexión no es válida (protocolo, usuario, host o base faltantes; fuera de loopback exige `sslmode=require` o `verify-full`; solo admite los parámetros `sslmode` y `channel_binding`, con un valor de `channel_binding` entre `require`, `prefer` y `disable`). El mensaje nombra lo que se admite; nunca repite la dirección que enviaste.
- `POSTGRES_SCHEMA`: el esquema `forge614_sync` de Neon no tiene exactamente la forma esperada (alguien lo modificó por fuera, o quedó a medias). PostgreSQL 16 a 18 son compatibles; en 18, las restricciones `NOT NULL` catalogadas no cuentan como una diferencia.
- `POSTGRES_UNAVAILABLE`: PostgreSQL no está disponible o no tiene permisos; los datos locales se conservan tal cual. Comprueba la conexión y el TLS sin compartir credenciales.
- `SYNC_DISABLED`: pediste `sync`/`sync-watch` con el mecanismo nuevo sin haber corrido `cloud on` antes (o el `.env` tiene la dirección pero la base local nunca llegó al nivel de esquema de la nube). Corre `cloud on`.
- `DATABASE_VERSION` indica que el binario no admite este esquema. Cierra los lectores y usa una versión compatible. Conserva el respaldo `.bak` que corresponda al esquema anterior.
- `SYNC_WATCH_DEPRECATED` y `SYNC_UPGRADE_FORMAT_DEPRECATED`: avisos en stderr, no errores que detengan nada; `sync-watch` y `sync --upgrade-format` (formatos 1–3) siguen funcionando igual, mientras se retiran el 2027-03-31.

## Integraciones de IA

Engram no detecta ni configura clientes de IA. Si un cliente MCP no está disponible, usa la ruta pública de setup de Forge614 Engines/Shell; no busques una TUI o comando de asistentes en Engram.

## Desinstalación

`uninstall` muestra la frase de confirmación en terminal y conserva `memory/`. Si Atlas está instalado, la frase nombra ambos productos y desinstala ambos. `--json` o la ausencia de terminal omiten la pregunta. `--purge-data` requiere terminal interactiva, borra la memoria local y su configuración, y no borra la copia PostgreSQL; con `--json` o sin terminal se rechaza sin cambios. `uninstall --self` retira solo las integraciones de Engram administradas por Engines y deja Atlas instalado. En Windows, si no se puede programar por WMI el borrado del ejecutable apartado, Engram termina de desinstalarse e informa la ruta donde quedó ese archivo.

En Windows, el desinstalador puede borrar `engram/` mientras el asistente mantiene abierto el MCP. Los ejecutables bloqueados permanecen en la carpeta temporal hasta que cierres el asistente; con `--json`, revisa sus rutas en `remainingExecutablePaths`. La memoria sigue en `memory/`.
