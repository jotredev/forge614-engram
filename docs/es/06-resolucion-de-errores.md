# 06. Resolución de Problemas

## Instalación o actualización

Usa una terminal macOS/Linux soportada con Bash, `curl`, una utilidad SHA-256, `tar` y Node.js 22.19 o más nuevo. `forge614-engram update` usa el instalador oficial `latest` y conserva el binario anterior si falla validación o instalación. Reintenta después de recuperar conectividad; no reemplaces `engram.db` manualmente.

El instalador publicado revisa sus requisitos antes de bajar nada. Si falta un requisito (los tres primeros puntos) **no instaló nada**. Si falla Shell o Engines (los seis últimos) solo se garantiza que Engram no cambió (puede que Forge614 Engines o parte de Shell ya estén instalados). En todos los casos puedes volver a correr el instalador cuando resuelvas la causa:

- `…which needs Node.js 22.19 or newer. Nothing was installed…` (Node falta): instala Node.js desde https://nodejs.org (o `brew install node`) y vuelve a correr el instalador.
- `…which needs Node.js 22.19 or newer; found <versión>…` (Node es viejo o ilegible): actualiza Node.js (por ejemplo `brew upgrade node`) hasta que `node --version` muestre v22.19 o más nuevo, y vuelve a correr el instalador.
- `…which needs tar…` (falta `tar`): instala `tar` con el gestor de paquetes de tu sistema y vuelve a correr el instalador.
- `Could not download the Forge614 Shell installer.`: no se pudo bajar el instalador de Forge614 Shell; revisa la conectividad y reintenta. Engram no se cambió.
- `Forge614 Shell could not be installed; Engram was not changed.`: el instalador de Shell terminó con error (sus mensajes salen justo arriba); corrige lo que indique y vuelve a correr el instalador. Engram no se cambió.
- `Forge614 Shell installation did not provide its required command.`: el instalador de Shell terminó sin dejar `<FORGE614_HOME>/shell/bin/forge614-shell` (por defecto `~/.forge614/shell/bin/forge614-shell`); reintenta y, si se repite, reporta el problema en el repositorio de Forge614 Shell.
- `Could not download the Forge614 Engines installer.`: no se pudo bajar el instalador de Forge614 Engines; revisa la conectividad y reintenta. Engram no se cambió.
- `Forge614 Engines could not be installed; Engram was not changed.`: el instalador de Engines terminó con error (sus mensajes salen justo arriba); corrige lo que indique y vuelve a correr el instalador. Engram no se cambió.
- `Forge614 Engines installation did not provide its required command.`: el instalador de Engines terminó sin dejar `<FORGE614_HOME>/engines/bin/forge614-engines` (por defecto `~/.forge614/engines/bin/forge614-engines`); reintenta y, si se repite, reporta el problema en el repositorio de Forge614 Engines.

Con `update --json` estos mensajes no se muestran; ejecuta `forge614-engram update` sin `--json` para verlos.

Para automatización, usa `forge614-engram update --json`. Su éxito es un único JSON compacto en stdout; no debe contener progreso. Si falla, devuelve código `1` y únicamente `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` en stderr. Ese mensaje deliberadamente no revela diagnósticos del instalador, URLs, credenciales ni secretos.

## Inicialización

`init` requiere terminal interactiva. Usa `init --json` en automatización. `--postgres-url` solo es válido con `init --json`; fallas de conexión devuelven JSON estructurado sin exponer la URL ni dejar configuración parcial.

## Almacenamiento

No borres ni muevas manualmente `~/.forge614/engram/engram.db`. Engram repara permisos solo dentro de su directorio. Si hay configuración pero falta la base, falla de forma segura en vez de crear un reemplazo silencioso.

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
- `GROUP_REQUIRED`: el ámbito `ecosystem` necesita un grupo: indica `--group` o usa un proyecto que pertenezca a uno (`group-bind`). `memory_search` y `memory_context` con scope `ecosystem` ya no la dan (desde 1.8.6): un proyecto ligado sin grupo no tiene recuerdos de grupo, así que `memory_search` responde `results: []` y `memory_context` el contexto vacío de grupo, los dos con un campo `ecosystem: { status: "none", message }` y la nota «Este proyecto no pertenece a ningún grupo, así que no hay recuerdos de grupo. Se vincula a uno con forge614-engram group-bind.». Sí la siguen dando `memory_save`, `memory_get`, `memory_history` y `memory_session_summary` con scope `ecosystem`, y la CLI `search --scope ecosystem`.
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

Usa la frase exacta de confirmación indicada por help. Si existe Atlas, Engram requiere la confirmación combinada y elimina solo `~/.forge614/engram/` y `~/.forge614/atlas/`.
