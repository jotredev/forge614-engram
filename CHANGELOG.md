# Changelog

## 1.6.0

Ámbito `ecosystem` (memoria compartida entre repositorios relacionados) e identidad portátil del proyecto.

- **Nuevo ámbito `ecosystem`:** conocimiento que comparten los repositorios de un grupo (microservicios, microfrontends, monorepos partidos, el ecosistema Forge614). Mismos temas (`topicKey`), versiones, historial, archivo/restauración, refuerzo y claves de petición que `project` y `shared`. En la búsqueda combinada, con un tema repetido gana `project` sobre `ecosystem` sobre `shared`.
- **Grupos y CLI:** `group-create`, `group-list`, `group-bind`, `group-unbind`, `group-rename`, `--scope ecosystem --group <nombre|id>` en `save`, `get`, `history`, `archive`, `restore`, `search` y `context`, y `memory-move` para llevar un recuerdo existente a un grupo conservando su historial (registrado como evento; nunca copia ni borra en silencio). Los comandos nuevos y sus errores llevan `schemaVersion`.
- **Identidad portátil:** Engram escribe y posee `.forge614/project.json` en la raíz del repositorio. La resolución es por `id` (un clon en otra máquina se registra sin preguntar), la escritura es silenciosa e idempotente y nunca reemplaza ids, gana el archivo ante un conflicto con la ruta (`PROJECT_REBOUND_FROM_FILE`), y un archivo inválido detiene la operación con `PROJECT_FILE_INVALID` sin sobrescribirlo. `project-rename` y `group-rename` actualizan el archivo; `init --json --directory` vincula una carpeta. La pertenencia a un grupo se declara en `forge614.node.json` (campo `ecosystem`, solo lectura) o en la sección `ecosystem` del archivo; nada se infiere.
- **Validación con Zod `.strict()` cargado de forma perezosa:** el esquema del archivo se carga solo cuando el repositorio trae `.forge614/project.json` (medido: `startup-context` con archivo pasa de 26,7 a 46,1 ms de mediana; sin archivo y `memory-protocol` no cambian).
- **`startup-context` y `context`:** campos nuevos y aditivos, `format` sigue en 1: `ecosystem` (`{"status":"member","group","context"}` o `{"status":"none"}`), `project.source` (`file`, `path` o `unbound`) y `project.notices`. **Los consumidores deben ignorar los campos desconocidos.** `context` de un proyecto con grupo añade `ecosystem`. `startup-context` abre la base en solo lectura y solo la reabre en escritura cuando tiene que registrar algo (un clon, un grupo). Un `.forge614/project.json` inválido es un error visible: `startup-context` sale con código 1 y sin ningún contexto; se repara corrigiendo o borrando el archivo.
- **Protocolo público v3** (anuncia el ámbito `ecosystem` y exige `groupIntent` al guardar en él; v1 y v2 no cambian ni un byte). **MCP:** `scope: "ecosystem"` en `memory_save`, `memory_search`, `memory_get`, `memory_history`, `memory_context` y `memory_session_summary`; `memory_current_project` informa el grupo.
- **SDK:** `MemoryWorkspace.createGroup`, `listGroups`, `bindProjectToGroup`, `unbindProject`, `renameGroup`, `moveMemory` y métodos nuevos de `MemoryStore` (`*InGroup`, `contextForGroup`, …). Ninguna firma existente cambia; `MemoryScope` gana el literal `"ecosystem"`.
- **Migración de esquema 7 → 10 (aditiva, con respaldo):** los niveles 8, 9 y 10 son los niveles 5, 6 y 7 más el ecosistema (no activan sesiones ni refuerzo por sí solos). Se agregan tablas y una columna nula, y `memories` y `requests` se recrean conservando todas las filas para ampliar el ámbito a tres valores, en una sola transacción con verificación de recuento y suma SHA-256 (`MIGRATION_VERIFY_FAILED` revierte todo). Antes se copia la base a `engram.db.v<versión>-pre-ecosystem-<fecha>-<id>.bak` (permisos 0600; se omite si la base está vacía). Ocurre la primera vez que un comando necesita grupos, y el resultado de ese comando incluye un aviso `DATABASE_MIGRATED` con la ruta del respaldo. 50 000 recuerdos migran en menos de un segundo.
- **Compatibilidad:** una base creada por 1.5.3 se abre y se lee completa con 1.6.0. En sentido inverso, Engram 1.5.x no abre una base ya migrada (`DATABASE_VERSION`) y no la modifica; el respaldo previo sí se abre con 1.5.x. **Reinicia cualquier Engram 1.5.x en ejecución (por ejemplo un servidor MCP) después de migrar.**
- **Limitación conocida:** las memorias de ámbito `ecosystem` **no se replican todavía**. Mientras existan, `sync` se detiene con `SYNC_ECOSYSTEM_UNSUPPORTED` sin tocar datos locales ni remotos; sin ellas la réplica funciona igual que antes. La replicación de grupos llegará en un plan propio (1.7.0, «formato 4»).
- **Códigos nuevos:** `GROUP_NAME_INVALID`, `GROUP_EXISTS`, `GROUP_NOT_FOUND`, `GROUP_AMBIGUOUS`, `GROUP_REQUIRED`, `GROUP_INTENT_REQUIRED`, `TOPIC_CONFLICT`, `PROJECT_FILE_INVALID`, `PROJECT_FILE_CONFLICT`, `MIGRATION_VERIFY_FAILED`, `SYNC_ECOSYSTEM_UNSUPPORTED`.
- **Documentación:** capítulo nuevo «Ámbitos y Ecosistemas» (es/en) y actualización de los capítulos de CLI, SDK, protocolo, contexto de inicio, errores, glosario y límites. Las páginas de Notion afectadas quedan marcadas como pendientes de sincronizar.
- Un renombrado de carpeta con `.forge614/project.json` ya no requiere `project-bind`: el proyecto se resuelve por su identidad.

## 1.5.3 — pendiente de revisión

- Corrección del cuelgue intermitente de la CLI en Linux: causa raíz confirmada en Bun 1.3.8 (bug del runtime, no de Engram); CI y binarios fijados a Bun 1.4.2.
- Timeout explícito por prueba en todos los e2e de CLI, por encima del timeout del lanzador.
- El SDK de MCP y `zod` ahora se cargan de forma perezosa, solo para el comando `mcp`, en vez de en cada invocación de la CLI.
- Prueba de idempotencia de `init` corregida: compara contenido lógico, no bytes.

## 1.5.2 — pendiente de revisión

- Límites de tiempo para pruebas PostgreSQL y jobs de workflow; sin cambios funcionales.

## 1.5.1 — pendiente de revisión

- `startup-context` ahora conserva el contexto `shared` y devuelve `project.status: "unbound"` para cualquier directorio existente y legible sin vínculo, incluidos el hogar, la raíz, carpetas sin Git y repositorios Git no vinculados.
- `FORGE614_HOME` permite elegir una raíz absoluta para toda la instalación de Engram; valores vacíos o relativos fallan de forma explícita con `INVALID_FORGE614_HOME` y no escriben bajo el hogar real.
