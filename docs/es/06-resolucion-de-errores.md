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
- `PROJECT_FILE_INVALID`: el `.forge614/project.json` no es válido (JSON corrupto, esquema o campos desconocidos, enlace simbólico, demasiado grande). Engram no lo modifica: corrígelo o bórralo para que se regenere.
- `PROJECT_FILE_CONFLICT`: `project-bind` intentó vincular una carpeta cuyo archivo declara otro proyecto; usa esa identidad o borra el archivo.
- `MIGRATION_VERIFY_FAILED`: la verificación de la migración falló y se revirtió todo. La base no cambió y el respaldo `.bak` junto a `engram.db` se conserva; no lo borres y reporta el caso.
- `SYNC_ECOSYSTEM_UNSUPPORTED`: `sync` se detiene mientras existan recuerdos de grupo: las memorias `ecosystem` no se replican todavía (llegará en 1.8.0, «formato 4»). Los datos locales y remotos no se tocan.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") al abrir con Engram 1.5.x una base actualizada por 1.6.0: actualiza Engram. La base no se modifica; el respaldo previo `.bak` sigue siendo legible por 1.5.x. Un proceso 1.5.x ya iniciado (por ejemplo un servidor MCP) debe reiniciarse tras actualizar.

## Carpetas sin vincular (desde 1.8.4)

- `PROJECT_BINDING_REQUIRED`: Engram no registra sola una carpeta nueva que podría ser un proyecto que ya existe, para no partir su memoria en dos. Tiene dos mensajes, y los dos traen el nombre y el `id` del proyecto, la carpeta de trabajo (nunca la ruta interna `…/.git`) y el comando exacto:
  - «Ya existe un proyecto llamado «{nombre}» ({id}). Si esta carpeta es ese proyecto, vincúlala con: forge614-engram project-bind --directory {esta carpeta} --project-id {id}. Si es otro, créalo con forge614-engram project-create --name <otro nombre> y vincúlalo con project-bind.» Sale cuando el nombre de la carpeta (en un repositorio Git, el de la carpeta que contiene `.git`) es el de un proyecto existente y ni un `.forge614/project.json` ni, con la nube activada, un remoto de Git que tenga anotado exactamente un proyecto la reconocen.
  - «Esta carpeta podría ser el proyecto «{nombre}» ({id}), cuya carpeta registrada ({carpeta perdida}) ya no existe. Si es el mismo proyecto, vincúlala con: forge614-engram project-bind --directory {esta carpeta} --project-id {id}. Si es otro proyecto, créalo con forge614-engram project-create --name <nombre> y vincúlalo con project-bind.» Sale cuando todas las carpetas registradas de un proyecto ya no existen (o no se pueden leer) y la carpeta nueva tiene el mismo nombre que una de ellas o, con la nube activada, el mismo remoto de Git que ese proyecto mientras otro proyecto comparte ese remoto (si solo uno lo tiene, la carpeta se liga sola a él). La carpeta perdida de un proyecto sin relación con la carpeta nueva ya no bloquea.
  - Qué hacer: si es el mismo proyecto, ejecuta el comando `project-bind` del mensaje; si es otro, créalo con `project-create` y vincúlalo con `project-bind`. `project-list` muestra los proyectos y sus `id`. Si varios proyectos perdidos coinciden, el mensaje nombra el primero por nombre y luego por `id`.
- `PROJECT_NOT_BOUND`: la carpeta todavía no está vinculada a ningún proyecto y el comando no crea proyectos y necesita uno real: lee un recuerdo concreto (`memory_get`, `memory_history`; con scope `shared` no hace falta proyecto) o continúa una sesión o un grupo ya existentes (`memory_session_end`, `memory_session_summary`, `memory_timeline` o `memory_save` con scope `ecosystem`). `memory_search` y `memory_context` ya no la dan (desde 1.8.5): en una carpeta sin proyecto no hay recuerdos de proyecto ni de grupo, así que responden sin error y con un campo `project` con `status: "unbound"` y la nota «Esta carpeta todavía no tiene proyecto en Engram, así que no hay recuerdos de proyecto ni de grupo. Se crea al iniciar sesión (memory_session_start) o al guardar.»: `memory_search` con scope `project` o `ecosystem` da `results: []`, y con scope `all` o sin scope da lo de `shared`; `memory_context` sin scope da el contexto de `shared` y con scope `ecosystem` un contexto vacío de grupo; con scope `shared` nada cambia (sin nota). Esas lecturas no registran la carpeta. Una carpeta con `.forge614/project.json` se registra sola incluso con una lectura. No es otra falla: se arregla con el primer `memory_session_start` o guardado de proyecto en esa carpeta, que la registra, o con `project-bind`. Si ese primer inicio o guardado respondió `PROJECT_BINDING_REQUIRED`, resuélvelo primero como se explica arriba.

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
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión"): una versión de Engram anterior a 1.8.0 intentó abrir una base ya preparada para la nube. Actualiza esa Mac a 1.8.0 y cierra primero cualquier sesión anterior que siga abierta.
- `SYNC_WATCH_DEPRECATED` y `SYNC_UPGRADE_FORMAT_DEPRECATED`: avisos en stderr, no errores que detengan nada; `sync-watch` y `sync --upgrade-format` (formatos 1–3) siguen funcionando igual, mientras se retiran el 2027-03-31.

## Integraciones de IA

Engram no detecta ni configura clientes de IA. Si un cliente MCP no está disponible, usa la ruta pública de setup de Forge614 Engines/Shell; no busques una TUI o comando de asistentes en Engram.

## Desinstalación

`uninstall` muestra la frase de confirmación en terminal y conserva `memory/`. Si Atlas está instalado, la frase nombra ambos productos y desinstala ambos. `--json` o la ausencia de terminal omiten la pregunta. `--purge-data` requiere terminal interactiva, borra la memoria local y su configuración, y no borra la copia PostgreSQL; con `--json` o sin terminal se rechaza sin cambios. `uninstall --self` retira solo las integraciones de Engram administradas por Engines y deja Atlas instalado. En Windows, si no se puede programar por WMI el borrado del ejecutable apartado, Engram termina de desinstalarse e informa la ruta donde quedó ese archivo.
