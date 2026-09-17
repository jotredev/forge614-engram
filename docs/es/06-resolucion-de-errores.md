# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Activo (369 pruebas totales en 69 archivos: 361 superadas y 8 omitidas sin binarios aislados PG; 369 superadas, 0 fallos, 1891 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8)
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía documenta el catálogo exhaustivo de diagnósticos y códigos de error de Forge614 Engram, incluyendo los errores de sesiones progresivas, recuperación clasificada, conflictos de configuración de plugins y promoción de réplica PostgreSQL, detallando su causa raíz y la solución recomendada.

---

## 1. Principio Fundamental de Seguridad

> [!IMPORTANT]
> **Nunca borres tu base de datos, tus tablas de SQLite ni tus puntos de control (*checkpoints*) para "arreglar" un error.**
> Los errores en Forge614 Engram son salvaguardas de seguridad activas. Cuando el sistema detecta una ambigüedad de sesiones, un plugin con contenido divergente o una incompatibilidad de esquemas, se detiene intencionadamente para **proteger la integridad absoluta de tus datos y evitar pérdidas silenciosas**.

---

## 2. Catálogo Completo de Códigos de Error

| Código de Error | Mensaje Habitual | Causa Raíz Explicada | Solución Recomendada |
| :--- | :--- | :--- | :--- |
| `MIGRATION_REQUIRED` | *"Habilita primero las sesiones."* o *"Habilita primero la integración de asistentes con integration-enable."* | Se invocó un comando de sesiones (`session-*`, `timeline`, `context`) o una herramienta MCP avanzada sin haber migrado la base al Esquema 6. | Ejecuta `forge614-engram sessions-enable` en la terminal para actualizar aditivamente la base al Esquema 6. |
| `AMBIGUOUS_SESSION` | *"AMBIGUOUS_SESSION: indica sessionId ([id1], [id2])."* | Un asistente intentó guardar un recuerdo en modo asistido sin `--session-id` y existen 2 o más sesiones en ejecución activas en los últimos 7 días en la carpeta vinculada. | Especifica el identificador de sesión deseado mediante la opción `--session-id <id>` o ciérralas con `session-end`. |
| `SESSION_NOT_FOUND` | *"Sesión no encontrada."* o *"Sesión no encontrada para este proyecto."* | El `sessionId` especificado no existe en la tabla `sessions` o no pertenece al `projectId` asociado. | Comprueba el identificador de sesión y el proyecto, o inicia una nueva sesión con `session-start`. |
| `SESSION_CONFLICT` | *"El identificador de sesión no está disponible."* | Se intentó iniciar una sesión con un `sessionId` que ya existe en la base de datos para otro proyecto o con otro tipo. | Utiliza un identificador de sesión nuevo o exclusivo para esta tarea. |
| `SESSION_CLOSED` | *"La sesión está cerrada."* | Se intentó asociar un nuevo recuerdo a una sesión que ya concluyó (`endedAt` no es nulo). | Inicia una nueva sesión de trabajo con `session-start` o asocia el recuerdo a una sesión activa. |
| `SESSION_KIND` | *"Una sesión manual no admite asociación explícita."* o *"Una sesión manual no puede cerrarse."* | Se intentó cerrar o asociar de forma explícita una sesión de tipo `manual` (las cuales son administradas automáticamente por el sistema como respaldo). | Utiliza sesiones de tipo `runtime` iniciadas mediante `session-start`. |
| `NO_SESSION_CONTEXT` | *"NO_SESSION_CONTEXT: no existe contexto de sesión..."* o *"el recuerdo no pertenece a esta sesión o está archivado."* | Al solicitar una línea temporal (`timeline`), el recuerdo indicado no tiene registro en esa sesión o se encuentra archivado. | Verifica que el `id` y `version` del recuerdo correspondan a la sesión indicada y que el recuerdo esté activo. |
| `SUMMARY_TOPIC_RESERVED` | *"El tema está reservado para un resumen de sesión."* | Se intentó guardar un recuerdo ordinario con un tema que sigue el patrón reservado `session/<id>/summary`. | Utiliza un identificador de tema ordinario (ej. `arquitectura-db`) o utiliza el comando oficial `session-summary`. |
| `SUMMARY_TOPIC_CONFLICT` | *"El tema reservado ya pertenece a otro recuerdo."* o *"El resumen no coincide con su puntero."* | Existe una discrepancia de puntero entre la tabla `session_summaries` y el registro temático en `memories`. | Consulta el resumen previo con `get` y envía el comando con `--expected-version` o verifica tu clave de petición. |
| `CONFLICT` | *"The dedicated Engram plugin already exists with different contents..."* | En OpenCode, el archivo `plugins/forge614-engram.js` ya existe en disco pero contiene código o modificaciones personalizadas distintas al plugin estándar. | Engram no sobrescribe archivos divergentes por seguridad. Haz un respaldo manual del plugin, elimínalo o concílialo y vuelve a ejecutar `forge614-engram tui`. |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* o *"setup necesita una terminal interactiva..."* | Se invocó `tui` o `setup` desde un script, tubería (`\|`) o entorno desatendido (`isTTY` falso o sin *raw mode*). | Ejecuta el comando directamente en tu terminal interactiva. Para scripts, utiliza `assistant-list` o `init`. |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git del proyecto."* | Git no está instalado, no se encuentra en el PATH, o la invocación de `git rev-parse` falló. | Instala Git (`git --version`) y asegúrate de que esté accesible en el PATH del sistema. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* | Se invocó una herramienta MCP en una carpeta sin Git sin especificar la ruta, o se intentó usar el directorio del binario como proyecto. | Especifica el parámetro `directory` en la llamada a la herramienta MCP o vincula la carpeta previamente con `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla."* | Se intentó consultar o buscar en una carpeta no registrada antes de guardar el primer recuerdo o iniciar sesión. | Guarda una primera nota técnica con `memory_save` o asocia la carpeta con `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* o *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Existe ambigüedad de nombres o alguna carpeta registrada en `project_bindings` ya no existe en el disco. | Consulta tus proyectos con `project-list` y vincula la ruta explícitamente con `project-bind --directory /ruta --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Se intentó vincular con `project-bind` una carpeta que ya tiene una asociación registrada hacia otro `projectId`. | Revisa las asociaciones con `project-list` y decide si deseas mover la asignación. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | El cliente de IA tiene múltiples espacios de trabajo abiertos simultáneamente y no especificó el parámetro `directory`. | Pasa el argumento `directory` explícito en la llamada a la herramienta MCP. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | El asistente intentó llamar a `memory_save` con `scope: "shared"` sin incluir el campo explicativo `globalIntent`. | Proporciona una explicación detallada en `globalIntent` justificando por qué la nota aplica a todos los proyectos. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Se intentó ejecutar la autoprueba en `tui` ejecutando desde el código fuente con Bun sin tener instalado el binario compilado. | Instala el binario oficial ejecutando `bash scripts/install.sh` y repite la prueba con el ejecutable instalado. |
| `TIMED_OUT` | Autoprueba del servidor reportada como fallida por límite de tiempo. | La autoprueba del servidor MCP superó el plazo máximo estricto de 5 segundos para responder y listar herramientas. | Verifica la carga de CPU de tu equipo y que el ejecutable cuente con permisos de ejecución (`0755`). |
| `MCP_FAILED` | Autoprueba del servidor reportada como fallida. | El servidor MCP falló al responder o no expuso las 10 herramientas esperadas. | Comprueba que la base de datos tenga el Esquema 6 habilitado mediante `sessions-enable`. |
| `PUBLISHED_UNVERIFIED` | *"Publicado sin verificar: [ruta]"* | Se aplicó la configuración al archivo del cliente, pero la verificación posterior de bytes falló por escrituras concurrentes. | Engram retiene la copia de respaldo `.bak`. Cierra el editor o cliente y vuelve a aplicar la configuración desde `tui`. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | En OpenCode existen archivos simultáneos `.json` y `.jsonc`, o múltiples fuentes de configuración activas sin selección. | Selecciona el archivo deseado en el menú interactivo o retira la configuración duplicada en OpenCode. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* | Opciones vacías, caracteres nulos (`\0`), números fuera de rango o argumentos incompatibles (ej. `--upgrade-format` en `sync-watch`). | Consulta las opciones válidas con `forge614-engram help`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | El `projectId` no existe en la tabla `projects` de `~/.forge614/engram.db`. | Ejecuta `forge614-engram project-list` para verificar los UUIDs de tus proyectos registrados. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | El valor de `--expected-version` no coincide con la versión activa actual en la base de datos. | Consulta la versión actual con `get` o `history` y actualiza indicando la versión correcta. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se reutilizó un `--request-key` previo con un contenido, título o tema diferente. | Utiliza una nueva clave de petición para una revisión diferente. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó actualizar un tema cuya memoria está archivada. | Ejecuta `restore` sobre ese recuerdo antes de guardar la nueva versión. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | El ID del recuerdo no existe en la base o no pertenece al proyecto indicado. | Revisa si el recuerdo era de proyecto o compartido y verifica que el UUID sea exacto. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Existe el cerrojo `~/.forge614/.config-lock` porque otro proceso está ejecutando `setup` o `tui`. | Espera a que concluya el otro proceso o retira `.config-lock` si fue una interrupción abrupta anterior. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | Se ejecutó `sync` o `sync-watch` pero `.env` no tiene `POSTGRES_URL`. | Ejecuta `forge614-engram setup` y elige `Sí, configurar PostgreSQL`. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Modificaciones concurrentes incompatibles sobre una misma entidad entre local y remoto. | Detiene la sincronización para proteger los datos. No hay pérdida de información; no borres tablas. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | La instantánea unificada supera el límite estricto de 8 MiB (`8,388,608 bytes`). | Se trata de un límite físico de carga, no de un conflicto histórico. Archiva datos obsoletos. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida..."* | Protocolo inválido o intento de `sslmode=disable` fuera de `127.0.0.1`/`localhost`. | Conexiones remotas exigen TLS verificado de manera estricta. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos..."* | Servidor PostgreSQL inaccesible o credenciales erróneas. | Los datos locales en SQLite continúan 100% operativos. Revisa tu red y credenciales. |

---

## 3. Escenarios Operativos y Procedimientos de Recuperación

### 1. Actualización Segura ante Conflicto de Plugin en OpenCode (`CONFLICT`)
- **Síntoma:** Al configurar OpenCode desde `forge614-engram tui`, el cliente se marca con estado de conflicto y el mensaje: *"The dedicated Engram plugin already exists with different contents. Review it manually."*
- **Causa:** El archivo `plugins/forge614-engram.js` ya existía en tu directorio de configuración con código modificado o de una versión previa. Engram no destruye código preexistente de forma automática.
- **Procedimiento de Recuperación:**
  1. Abre `tui` y presiona `Enter` para inspeccionar la pantalla de **Vista Previa** (*Plan Preview*), donde podrás contrastar los cambios planificados.
  2. Haz una copia de seguridad manual de tu archivo actual:
     ```bash
     cp ~/.config/opencode/plugins/forge614-engram.js ~/.config/opencode/plugins/forge614-engram.js.backup
     ```
  3. Si deseas adoptar el plugin oficial actualizado de Engram, elimina o mueve el archivo divergente:
     ```bash
     rm ~/.config/opencode/plugins/forge614-engram.js
     ```
  4. Vuelve a ejecutar `forge614-engram tui`, selecciona OpenCode con `Espacio` y confirma la instalación.

---

### 2. Coordinación de Equipos Pares ante Promoción de Réplica PostgreSQL
- **Síntoma:** Tras ejecutar `forge614-engram sync --upgrade-format` en una computadora, otra máquina que sincroniza contra la misma base PostgreSQL reporta `SYNC_CONFLICT` al intentar sincronizar.
- **Causa:** La base de datos remota en PostgreSQL fue promovida a **Formato 2** (que incluye sesiones y resúmenes), pero la segunda máquina aún ejecuta una versión anterior del software o su base SQLite local continúa en Esquema 3, 4 o 5 sin soporte de sesiones.
- **Procedimiento de Recuperación:**
  1. Instala la versión actualizada de Forge614 Engram en la segunda máquina (`bash scripts/install.sh --force`).
  2. En la segunda máquina, actualiza su base local al Esquema 6:
     ```bash
     forge614-engram sessions-enable
     ```
  3. Ejecuta la sincronización ordinaria:
     ```bash
     forge614-engram sync
     ```
  Ambos equipos sincronizarán ahora limpiamente bajo el Formato 2.

---

### 3. Asistente Arroja `AMBIGUOUS_SESSION` al Guardar Recuerdos
- **Síntoma:** Al solicitarle a un asistente que guarde una decisión técnica, la herramienta `memory_save` falla con el error `AMBIGUOUS_SESSION: indica sessionId (ses-a, ses-b)`.
- **Causa:** El desarrollador inició múltiples sesiones de trabajo concurrentes en la misma carpeta dentro de los últimos 7 días y ninguna ha sido cerrada. El modelo no puede adivinar a cuál de las dos pertenece la nota técnica.
- **Procedimiento de Recuperación:**
  - Opción A: Indicarle al asistente explícitamente: *"Guarda la nota asociándola a la sesión ses-a"*.
  - Opción B: Cerrar las sesiones antiguas que ya finalizaron desde la terminal:
    ```bash
    forge614-engram session-end --project-id <UUID> --session-id "ses-b"
    ```
    Una vez que solo quede una sesión activa, las notas subsiguientes se asociarán automáticamente por inferencia contextual.

---

### 4. Aparece `MIGRATION_REQUIRED` al Usar Sesiones o Herramientas MCP
- **Síntoma:** Comandos como `forge614-engram session-start` o llamadas a `memory_context` fallan reportando `Habilita primero las sesiones.`
- **Causa:** La base de datos `~/.forge614/engram.db` fue creada con una versión previa (Esquema 3, 4 o 5). Por política de estabilidad, las operaciones cotidianas jamás modifican la estructura de la base sin autorización.
- **Procedimiento de Recuperación:**
  Ejecuta el comando oficial de habilitación:
  ```bash
  forge614-engram sessions-enable
  ```
  La base se actualizará aditivamente al Esquema 6 en milisegundos, preservando íntegros todos tus recuerdos, versiones y asociaciones previas.

---

### 5. Error al Importar Archivos Internos Antiguos (`Cannot find module './store'`)
- **Síntoma:** Un script, extensión o prueba externa falla al compilar con errores como `Cannot find module './store'` o `Cannot find module './domain'`.
- **Causa:** En la reorganización del monolito modular por funcionalidad (Entrega 10), los archivos planos que antes residían en la raíz de `src/` fueron eliminados y redistribuidos en `app/`, `modules/`, `infrastructure/` e `interfaces/`. Las rutas internas anteriores no forman parte de la API pública.
- **Procedimiento de Recuperación:**
  Actualiza las sentencias de importación para consumir exclusivamente desde la raíz del SDK (`src/index.ts` o `@forge614/engram`):
  ```typescript
  // Antes (Ruta interna obsoleta eliminada):
  // import { MemoryStore } from "./src/store";

  // Ahora (Punto de entrada público oficial):
  import { MemoryStore, MemoryWorkspace, MemoryError } from "./src/index";
  ```
  La fachada `MemoryStore` en `src/index.ts` preserva el 100% de las firmas y métodos históricos.
