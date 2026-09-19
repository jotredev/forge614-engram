# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 1.0.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo (504 pruebas totales en 82 archivos: 495 superadas y 9 omitidas sin binarios aislados PG; 504 superadas, 0 fallos, 2566 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 39.76s)
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía documenta el catálogo exhaustivo de diagnósticos y códigos de error de Forge614 Engram, incluyendo el Centro de Control TUI, refuerzo de búsqueda FTS5, confirmaciones inmutables (Esquema 7), sincronización en Formato 3, desfases de reloj (*clock skew*), reintentos idempotentes y conflictos de configuración, detallando su causa raíz y la solución recomendada.

---

## 1. Principio Fundamental de Seguridad

> [!IMPORTANT]
> **Nunca borres tu base de datos, tus tablas de SQLite ni tus puntos de control (*checkpoints*) para "arreglar" un error.**
> Los errores en Forge614 Engram son salvaguardas de seguridad activas. Cuando el sistema detecta una ambigüedad de sesiones, un plugin con contenido divergente, un desfase de reloj o una incompatibilidad de esquemas, se detiene intencionadamente para **proteger la integridad absoluta de tus datos y evitar pérdidas silenciosas**.

---

## 2. Catálogo Completo de Códigos de Error

| Código de Error | Mensaje Habitual | Causa Raíz Explicada | Solución Recomendada |
| :--- | :--- | :--- | :--- |
| `REINFORCEMENT_REQUIRED` | *"REINFORCEMENT_REQUIRED: habilita el Esquema 7 con reinforcement-enable..."* | El servidor remoto PostgreSQL sincroniza en Formato 3 (confirmaciones) pero la base SQLite local no ha sido migrada al Esquema 7. | Ejecuta `forge614-engram reinforcement-enable` en la máquina local antes de sincronizar. |
| `SYNC_UPGRADE_REQUIRED` | *"SYNC_UPGRADE_REQUIRED: la réplica remota requiere promoción explícita..."* | Se intentó sincronizar con una réplica remota en formato anterior (Formato 1 o 2) sin proporcionar la bandera `--upgrade-format`. | Ejecuta deliberadamente `forge614-engram sync --upgrade-format` para promover la réplica a Formato 3. |
| `CLOCK_SKEW` | *"CLOCK_SKEW: el reloj local marca una fecha anterior a la versión confirmada..."* | El reloj del sistema local tiene un desfase hacia el pasado respecto a la fecha registrada en la versión del recuerdo existente que se intenta confirmar. | Sincroniza el reloj del sistema mediante NTP o ajusta la fecha y hora del sistema operativo. |
| `REQUEST_CONFLICT` | *"REQUEST_CONFLICT: la clave de petición ya corresponde a otro contenido."* | Se reutilizó un `--request-key` previo enviando un título, contenido, tipo o fijado diferente (hash SHA-256 no coincide). | Utiliza una clave de petición nueva y única para cada operación diferente. |
| `MIGRATION_REQUIRED` | *"Habilita primero las sesiones."* o *"Habilita primero la integración de asistentes con integration-enable."* | Se invocó un comando de sesiones (`session-*`, `timeline`, `context`) o una herramienta MCP avanzada sin haber migrado la base al Esquema 6 o 7. | Ejecuta `forge614-engram sessions-enable` (o `reinforcement-enable`) en la terminal para actualizar aditivamente la base. |
| `AMBIGUOUS_SESSION` | *"AMBIGUOUS_SESSION: indica sessionId ([id1], [id2])."* | Un asistente intentó guardar un recuerdo en modo asistido sin `--session-id` y existen 2 o más sesiones en ejecución activas en los últimos 7 días en la carpeta vinculada. | Especifica el identificador de sesión deseado mediante la opción `--session-id <id>` o ciérralas con `session-end`. |
| `SESSION_NOT_FOUND` | *"Sesión no encontrada."* o *"Sesión no encontrada para este proyecto."* | El `sessionId` especificado no existe en la tabla `sessions` o no pertenece al `projectId` asociado. | Comprueba el identificador de sesión y el proyecto, o inicia una nueva sesión con `session-start`. |
| `SESSION_CONFLICT` | *"El identificador de sesión no está disponible."* | Se intentó iniciar una sesión con un `sessionId` que ya existe en la base de datos para otro proyecto o con otro tipo. | Utiliza un identificador de sesión nuevo o exclusivo para esta tarea. |
| `SESSION_CLOSED` | *"La sesión está cerrada."* | Se intentó asociar un nuevo recuerdo a una sesión que ya concluyó (`endedAt` no es nulo). | Inicia una nueva sesión de trabajo con `session-start` o asocia el recuerdo a una sesión activa. |
| `SESSION_KIND` | *"Una sesión manual no admite asociación explícita."* o *"Una sesión manual no puede cerrarse."* | Se intentó cerrar o asociar de forma explícita una sesión de tipo `manual` (las cuales son administradas automáticamente por el sistema como respaldo). | Utiliza sesiones de tipo `runtime` iniciadas mediante `session-start`. |
| `NO_SESSION_CONTEXT` | *"NO_SESSION_CONTEXT: no existe contexto de sesión..."* o *"el recuerdo no pertenece a esta sesión o está archivado."* | Al solicitar una línea temporal (`timeline`), el recuerdo indicado no tiene registro en esa sesión o se encuentra archivado. | Verifica que el `id` y `version` del recuerdo correspondan a la sesión indicada y que el recuerdo esté activo. |
| `SUMMARY_TOPIC_RESERVED` | *"El tema está reservado para un resumen de sesión."* | Se intentó guardar un recuerdo ordinario con un tema que sigue el patrón reservado `session/<id>/summary`. | Utiliza un identificador de tema ordinario (ej. `arquitectura-db`) o utiliza el comando oficial `session-summary`. |
| `SUMMARY_TOPIC_CONFLICT` | *"El tema reservado ya pertenece a otro recuerdo."* o *"El resumen no coincide con su puntero."* | Existe una discrepancia de puntero entre la tabla `session_summaries` y el registro temático en `memories`. | Consulta el resumen previo con `get` y envía el comando con `--expected-version` o verifica tu clave de petición. |
| `CONFLICT` | *"The dedicated Engram plugin already exists with different contents..."* | En OpenCode, el archivo `plugins/forge614-engram.js` ya existe en disco pero contiene código o modificaciones personalizadas distintas al plugin estándar. | Engram no sobrescribe archivos divergentes por seguridad. Haz un respaldo manual del plugin, elimínalo o concílialo y vuelve a ejecutar `forge614-engram tui`. |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* o *"setup necesita una terminal interactiva..."* | Se invocó el Centro de Control TUI (`tui`) o el asistente de configuración (`setup`) en un entorno desatendido, canalización (`\|`), redirección (`< /dev/null`) o subshell sin soporte de modo crudo (*raw mode* TTY). | Ejecuta el comando directamente en una terminal interactiva real. Para scripts, flujos automatizados o pipelines CI/CD, utiliza comandos CLI sin interfaz como `project-list`, `assistant-list`, `status`, `health` o las funciones del SDK (`readControlCenter()`). |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git del proyecto."* | Git no está instalado, no se encuentra en el PATH, o la invocación de `git rev-parse` falló. | Instala Git (`git --version`) y asegúrate de que esté accesible en el PATH del sistema. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* | Se invocó una herramienta MCP en una carpeta sin Git sin especificar la ruta, o se intentó usar el directorio del binario como proyecto. | Especifica el parámetro `directory` en la llamada a la herramienta MCP o vincula la carpeta previamente con `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla."* | Se intentó consultar o buscar en una carpeta no registrada antes de guardar el primer recuerdo o iniciar sesión. | Guarda una primera nota técnica con `memory_save` o asocia la carpeta con `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* o *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Existe ambigüedad de nombres o alguna carpeta registrada en `project_bindings` ya no existe en el disco. | Consulta tus proyectos con `project-list` y vincula la ruta explícitamente con `project-bind --directory /ruta --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Se intentó vincular con `project-bind` una carpeta que ya tiene una asociación registrada hacia otro `projectId`. | Revisa las asociaciones con `project-list` y decide si deseas mover la asignación. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | El cliente de IA tiene múltiples espacios de trabajo abiertos simultáneamente y no especificó el parámetro `directory`. | Pasa el argumento `directory` explícito en la llamada a la herramienta MCP. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | El asistente intentó llamar a `memory_save` con `scope: "shared"` sin incluir el campo explicativo `globalIntent`. | Proporciona una explicación detallada en `globalIntent` justificando por qué la nota aplica a todos los proyectos. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Se intentó ejecutar la autoprueba en `tui` ejecutando desde el código fuente con Bun sin tener instalado el binario compilado. | Instala el binario oficial ejecutando `bash scripts/install.sh` y repite la prueba con el ejecutable instalado. |
| `TIMED_OUT` | Autoprueba del servidor reportada como fallida por límite de tiempo. | La autoprueba del servidor MCP superó el plazo máximo estricto de 5 segundos para responder y listar herramientas. | Verifica la carga de CPU de tu equipo y que el ejecutable cuente con permisos de ejecución (`0755`). |
| `PUBLISHED_UNVERIFIED` | *"The file was published but its planned bytes could not be safely verified..."* | Se aplicó la configuración al archivo del cliente, pero la verificación posterior de bytes falló por escrituras concurrentes de otro proceso. | Engram retiene la copia de respaldo `.forge614-backup-<UUID>` sin ejecutar rollback destructivo. Cierra el editor y vuelve a aplicar la configuración desde `tui`. |
| `UNSAFE_PATH` | *"Configuration paths must not traverse Windows reparse points."* o *"Could not verify Windows reparse-point safety."* o *"Configuration paths must not traverse symbolic links."* | La ruta de destino o alguno de sus directorios ancestros contiene enlaces simbólicos, *junctions*, *reparse points* (en Windows), permisos de escritura para otros usuarios (en Unix), o el módulo nativo de Windows falló (*fail-closed*). | Elimina cualquier enlace simbólico o junction en la ruta. En Windows, si compilas desde fuentes, compila el módulo nativo con `scripts/build-windows-reparse-addon.ps1`. |
| `CHANGED` | *"Configuration changed after preview..."* o *"Configuration changed before replacement..."* | El contenido del archivo de configuración cambió en el disco mientras el usuario revisaba la vista previa o mientras se preparaba el temporal. | Se detiene para evitar sobrescribir cambios ajenos. Cierra editores en segundo plano y vuelve a generar la vista previa en `tui`. |
| `UNSAFE_FILE` | *"Configuration must be a regular file owned by the current user."* | El archivo de destino no es un archivo regular, tiene enlaces duros múltiples (`nlink !== 1`), o pertenece a otro usuario del sistema. | Asegúrate de que el archivo de configuración pertenezca a tu usuario actual y no tenga enlaces duros compartidos. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | En OpenCode existen archivos simultáneos `.json` y `.jsonc`, o múltiples fuentes de configuración activas sin selección. | Selecciona el archivo deseado en el menú interactivo o retira la configuración duplicada en OpenCode. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* | Opciones vacías, caracteres nulos (`\0`), números fuera de rango o argumentos incompatibles (ej. `--upgrade-format` en `sync-watch`). | Consulta las opciones válidas con `forge614-engram help`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | El `projectId` no existe en la tabla `projects` de `~/.forge614/engram.db`. | Ejecuta `forge614-engram project-list` para verificar los UUIDs de tus proyectos registrados. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | El valor de `--expected-version` no coincide con la versión activa actual en la base de datos. | Consulta la versión actual con `get` o `history` y actualiza indicando la versión correcta. |
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

### 2. Coordinación de Equipos Pares ante Promoción de Réplica PostgreSQL a Formato 3 (`REINFORCEMENT_REQUIRED` y `SYNC_UPGRADE_REQUIRED`)
- **Síntoma:** Tras ejecutar `forge614-engram sync --upgrade-format` en una computadora, otra máquina que sincroniza contra la misma base PostgreSQL reporta `REINFORCEMENT_REQUIRED` o `SYNC_UPGRADE_REQUIRED`.
- **Causa:** La base de datos remota en PostgreSQL fue promovida a **Formato 3** (que incluye colecciones de confirmaciones y peticiones), pero la segunda máquina aún ejecuta una versión sin Esquema 7 o no ha ejecutado la habilitación local.
- **Procedimiento de Recuperación:**
  1. Instala la versión actualizada de Forge614 Engram en la segunda máquina (`bash scripts/install.sh --force`).
  2. En la segunda máquina, actualiza su base local al Esquema 7:
     ```bash
     forge614-engram reinforcement-enable
     ```
  3. Ejecuta la sincronización ordinaria:
     ```bash
     forge614-engram sync
     ```
  Ambos equipos sincronizarán ahora limpiamente bajo el Formato 3.

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

### 4. Desfase de Reloj del Sistema en Confirmaciones (`CLOCK_SKEW`)
- **Síntoma:** Un comando `save` o llamada a `memory_save` falla con el código de error `CLOCK_SKEW`.
- **Causa:** El reloj local de la computadora tiene una fecha/hora anterior a la marca temporal de la versión del recuerdo existente que se está confirmando. Esto ocurre habitualmente cuando la máquina pierde sincronización horaria o tras un cambio manual de hora hacia el pasado.
- **Procedimiento de Recuperación:**
  1. Sincroniza la hora del sistema operativo mediante Network Time Protocol (NTP):
     - En macOS: Abre *Ajustes del Sistema* $\rightarrow$ *General* $\rightarrow$ *Fecha y hora* y activa "Ajustar fecha y hora automáticamente".
     - En Linux: Ejecuta `sudo timedatectl set-ntp true` o `sudo ntpdate pool.ntp.org`.
  2. Vuelve a ejecutar la operación de guardado; se procesará exitosamente al restaurar la causalidad temporal.

---

### 5. Conflicto de Carga en Reintentos Idempotentes (`REQUEST_CONFLICT`)
- **Síntoma:** Al intentar guardar un recuerdo, el comando se detiene arrojando `REQUEST_CONFLICT`.
- **Causa:** El cliente o asistente reutilizó una clave de petición `--request-key` que ya existía en la base de datos pero enviando un título, contenido, alcance o tipo modificado. Engram protege la inmutabilidad de transacciones impidiendo que una misma clave cambie su carga semántica.
- **Procedimiento de Recuperación:**
  - Si se trata de una modificación intencionada del contenido, asigna una clave de petición nueva e independiente (ej. `--request-key "req-tarea-02"`).
  - Si se deseaba reintentar una operación fallida sin cambios, asegúrate de enviar exactamente los mismos parámetros y contenido que en la llamada original.

---

### 6. Control de Seguridad, Cancelación y Ejecución Desatendida en el Centro de Control TUI (`INTERACTIVE_REQUIRED`)
- **Síntoma:** Al invocar `forge614-engram tui` dentro de un script, pipe o entorno CI/CD, el proceso finaliza inmediatamente con código de salida `1` y el mensaje: *"tui necesita una terminal interactiva (TTY y raw mode) para renderizar el Centro de Control o configurar asistentes."*
- **Causa:** El Centro de Control TUI requiere una terminal física con modo crudo (*raw mode*) para capturar eventos de teclado, redimensionamiento dinámico y renderizar el panel interactivo. Para evitar bloqueos indefinidos o salidas corruptas en flujos desatendidos, aborta de manera preventiva sin alterar el sistema.
- **Procedimiento de Recuperación y Salvaguardas:**
  1. **Para flujos interactivos:** Ejecuta el comando directamente en tu emulador de terminal estándar (Ghostty, iTerm2, Alacritty, Terminal.app).
  2. **Para scripts automatizados y pipelines CI/CD:** No invoques `tui`. Utiliza los subcomandos CLI especializados que emiten salidas directas o JSON (ej. `forge614-engram project-list`, `forge614-engram assistant-list`, `forge614-engram status`, `forge614-engram health`) o consume la API mediante el SDK TypeScript (`readControlCenter()`).
  3. **Cancelación segura sin escrituras:** El Centro de Control inicia 100% en modo de solo lectura. Navegar pestañas (`Resumen`, `Proyectos`, `Compartido`, `Almacenamiento`), redimensionar la ventana o presionar `Escape`, `q` o `Ctrl+C` finaliza la interfaz de inmediato y restaura el cursor y la terminal sin haber escrito un solo byte en disco.
  4. **Protección durante acciones en curso:** Si ejecutas una acción confirmada (escribiendo deliberadamente `confirm` y presionando `Enter`), el Centro de Control bloquea el teclado y descarta cualquier pulsación de teclas entrante mientras la operación está en curso (por ejemplo, migraciones o sincronización con PostgreSQL). Esto previene la acumulación de comandos accidentales en el búfer de entrada.

---

### 7. Diagnóstico de Rutas Inseguras, Enlaces Simbólicos y Reparse Points en Windows (`UNSAFE_PATH`)
- **Síntoma:** Al configurar un asistente o guardar una configuración, la operación se interrumpe arrojando `UNSAFE_PATH` con uno de los siguientes mensajes:
  - *"Configuration paths must not traverse Windows reparse points."*
  - *"Could not verify Windows reparse-point safety."*
  - *"Configuration paths must not traverse symbolic links."*
  - *"A configuration parent is not a directory."*
  - *"A configuration parent is writable by other users."*
- **Causa Raíz:**
  1. En **Windows**: La ruta destino o alguno de sus directorios ancestros existentes es un enlace simbólico, una unión de directorio NTFS (*junction* creada con `mklink /J`), o un punto de montaje de volumen (*volume mount point* creado con `mountvol.exe`). El módulo nativo `windows_reparse_guard.node` detectó el atributo `FILE_ATTRIBUTE_REPARSE_POINT`.
  2. En **Windows (*Fail-Closed*)**: El módulo nativo C++ no está disponible en la ruta esperada, arrojó una excepción no controlada del sistema operativo, o devolvió un valor anómalo.
  3. En **macOS/Linux**: La ruta o sus ancestros atraviesan enlaces simbólicos no reconocidos como alias del sistema (excluyendo `/var` y `/tmp` propiedad de root), o algún directorio padre tiene permisos de escritura abiertos para otros usuarios (`chmod o+w`).
- **Procedimiento de Recuperación:**
  1. Si estás en Windows y usas carpetas vinculadas con `mklink` o junctions hacia otro disco, debes utilizar la ruta real física del disco destino en lugar de la unión simbólica.
  2. Si estás compilando Engram desde el código fuente en Windows, verifica que el módulo nativo esté compilado ejecutando en PowerShell:
     ```powershell
     pwsh -File scripts/build-windows-reparse-addon.ps1
     ```
  3. En sistemas Unix, `forge614-engram setup` y `forge614-engram init` restringen y reparan automáticamente a `0700` cualquier carpeta preexistente `~/.forge614` propiedad del usuario actual, sin que requieras ejecutar `chmod` manualmente.
     Si la carpeta pertenece a otro usuario (como `root` por un comando previo con `sudo`), debes corregir la propiedad y permisos de la cuenta:
     ```bash
     sudo chown -R $(id -un):$(id -gn) ~/.forge614
     chmod 0700 ~/.forge614
     ```
     Si `~/.forge614` es un enlace simbólico (*symlink*), Engram lo bloquea deliberadamente por seguridad (*fail-closed*) y no intentará repararlo; debes eliminar el symlink y crear un directorio ordinario real.

---

### 8. Modificaciones Concurrentes y Publicación no Verificada (`CHANGED` y `PUBLISHED_UNVERIFIED`)
- **Síntoma:** El configurador de asistentes se interrumpe arrojando `CHANGED` o `PUBLISHED_UNVERIFIED`.
- **Causa Raíz:**
  - `CHANGED`: El archivo de configuración en disco cambió de contenido mientras estabas en la pantalla de vista previa (`write.before`) o durante la preparación del archivo temporal en `guardedWrite`.
  - `PUBLISHED_UNVERIFIED`: El archivo temporal fue renombrado atómicamente sobre el destino final, pero al realizar la lectura inmediata posterior de verificación (*post-publication verification*), los bytes leídos no coincidieron exactamente con los bytes planificados (`write.after`).
- **Procedimiento de Recuperación:**
  1. Engram **preserva intacta la copia de respaldo** `.forge614-backup-<UUID>` con permisos `0600` y modo exclusivo (`flag: 'wx'`). No ejecuta ningún rollback destructivo que pudiera sobreescribir datos externos.
  2. Cierra cualquier editor de código (VS Code, Cursor, Zed) o asistente que pueda estar escribiendo automáticamente sobre los archivos de configuración (`settings.json`, `mcp_config.json`).
  3. Comprueba el estado del archivo y vuelve a lanzar `forge614-engram tui` para generar una nueva vista previa limpia.
