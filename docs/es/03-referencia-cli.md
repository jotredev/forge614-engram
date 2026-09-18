# 03. Manual Exhaustivo de Terminal (CLI)

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo (504 pruebas totales en 82 archivos: 495 superadas y 9 omitidas sin binarios aislados PG; 504 superadas, 0 fallos, 2566 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 39.76s)
> **Traducción hermana:** [03 (EN). Terminal CLI Command Reference](../en/03-cli-reference.md)

Esta guía documenta exhaustivamente todos los comandos, opciones, reglas de sintaxis, códigos de salida y formatos de respuesta de la interfaz de línea de comandos (CLI) de Forge614 Engram.

---

## 1. Reglas Generales de Uso de la Terminal

1. **Estructura del comando:** El comando a ejecutar debe escribirse inmediatamente después del nombre del programa:
   ```bash
   forge614-engram <comando> [opciones...]
   # O en desarrollo con Bun dentro del repositorio:
   bun run cli <comando> [opciones...]
   ```
2. **Formato de opciones:** Cada opción (`--opcion`) debe ir separada de su valor mediante un espacio. No se admite la sintaxis `--opcion=valor`.
   - ✅ Correcto: `--project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --limit 5`
   - ❌ Incorrecto: `--project-id=7c9e6679-7425-40de-944b-e07fc1f90ae7`
3. **Comillas obligatorias para textos con espacios:** Todo título, texto, JSON o nombre con espacios debe encerrarse entre comillas dobles (`"..."`).
4. **Validación estricta previa:** Si pasas una opción desconocida, repites una opción, o envías argumentos incompatibles (por ejemplo combinar `--scope shared` con `--project-id` en operaciones de recuerdo individual o pasar `--upgrade-format` a `sync-watch`), el programa termina inmediatamente con error de sintaxis `INVALID_INPUT` **antes de leer la configuración o abrir SQLite**.
5. **Canales de salida y códigos de salida:**
   - **Comandos interactivos (`setup`, `tui`):** Emiten texto comprensible para personas a través de `stdout`. Devuelven código `0` en caso de éxito/confirmación; código `130` si el usuario cancela voluntariamente (`Ctrl+C`, `Escape`, `cancelar`, `q` o `no`); y código `1` si ocurre un error o si se invocan sin terminal interactiva (`isTTY` falso arrojando `INTERACTIVE_REQUIRED`).
   - **Servidor MCP (`mcp`):** Reserva `stdout` exclusivamente para tramas JSON-RPC del protocolo MCP. Al cerrarse con `Ctrl+C` (SIGINT) devuelve código `130`; con SIGTERM devuelve código `143`.
   - **Observador de sincronización (`sync-watch`):** Emite rondas exitosas en JSON a `stdout` y avisos de reintento a `stderr`. Al interrumpirse con `Ctrl+C` finaliza con código `130`.
   - **Comandos de datos y automatización (`init`, `sync`, `assistant-list`, `integration-enable`, `sessions-enable`, `reinforcement-enable`, `project-*`, `save`, `search`, `session-*`, `timeline`, `context`, etc.):** Emiten respuestas en formato **JSON estructurado** a través de `stdout` con código de salida `0` en caso de éxito. En caso de error, emiten un objeto JSON de error a través de `stderr` con código de salida `1`.
6. **Banderas eliminadas que NO se admiten:**
   - `--db`: No se admite. La base de datos es fija: `~/.forge614/engram.db`.
   - `--project` (por nombre): No se admite. El identificador es estrictamente `--project-id <UUID>`.
   - `--id-project`: No se admite. El parámetro oficial es `--project-id`.

---

## 2. Catálogo de Comandos de Configuración, Asistentes y MCP

---

### 2.1. `--version`
Muestra el nombre del programa y la versión actual instalada.

```bash
forge614-engram --version
```
- **Salida:** `forge614-engram 0.5.0`
- **Opciones:** No acepta ninguna opción adicional.
- **Efectos secundarios:** Ninguno. No lee ni crea archivos en disco.

---

### 2.2. `help`
Imprime el manual de referencia rápida oficial en la terminal.

```bash
forge614-engram help
```

---

### 2.3. `setup`
Asistente interactivo guiado para configurar el espacio central (`~/.forge614/.env` y `~/.forge614/engram.db`), ofreciendo sincronización opcional con PostgreSQL y habilitación de refuerzo de búsqueda (Esquema 7).

```bash
forge614-engram setup
```
- **Opciones:** Ninguna.
- **Requisitos:** Terminal interactiva (`stdin` y `stdout` TTY).
- **Códigos de salida:** `0` al confirmar y aplicar; `130` al cancelar voluntariamente; `1` ante error.

---

### 2.4. `tui`
Centro de Control interactivo de pantalla completa en terminal para auditar el estado del almacén local, inspeccionar proyectos y memoria compartida, ejecutar acciones seguras con confirmación estricta (`confirm` + Enter) y configurar asistentes de inteligencia artificial mediante un subflujo secuencial limpio.

```bash
forge614-engram tui
```
- **Opciones:** Ninguna.
- **Requisitos:** Terminal interactiva (`isTTY` verdadero en `stdin` y `stdout`). Si se ejecuta en un entorno no interactivo o redirigido, falla inmediatamente con `INTERACTIVE_REQUIRED`.
- **Estructura del Menú Superior:**
  `Summary | Projects | Shared | Storage | Actions | Assistants | Exit`
  *(Resumen | Proyectos | Shared | Almacenamiento | Acciones | Asistentes | Salir)*
- **Teclas de navegación:**
  - `←` / `→` / `↑` / `↓`: Mover el foco entre pestañas del menú y desplazarse por listas de elementos.
  - `Enter`: Abrir la pestaña enfocada o ver el detalle del proyecto seleccionado.
  - `Escape`: Retroceder a la pantalla anterior o cancelar la acción en curso.
  - `PgUp` / `PgDn`: Desplazar el texto cuando excede la altura de la terminal.
  - `Ctrl+C` o `EOF`: Terminar la sesión inmediatamente, restaurar la terminal y salir con código `130`.
- **Comportamiento de Solo Lectura por Defecto:**
  - Abrir la pantalla, navegar, redimensionar la terminal o presionar teclas no reconocidas **jamás escribe archivos en el disco**, no crea `~/.forge614/.env`, no crea `engram.db` ni registra proyectos.
  - Si el almacén no existe, muestra un estado claro sin inicializar e indica usar `setup` o `init`; no crea archivos automáticamente.
- **Vistas y Metadatos Disponibles:**
  - **Summary:** Inicialización, esquema SQLite activo (3 a 7), capacidades habilitadas, total de proyectos y estadísticas agregadas de memoria compartida.
  - **Projects:** Lista proyectos con nombre descriptivo, UUID abreviado y conteo de recuerdos activos/archivados. Al pulsar Enter, muestra el detalle con UUID canónico completo, marcas temporales y rutas locales vinculadas (`bindings`).
  - **Shared:** Conteos activo/archivado de notas compartidas y fecha de última actualización; aclara que es una colección única global y no bases por proyecto.
  - **Storage:** Ruta de SQLite local, versión de esquema y estado de PostgreSQL (`configured` o `not-configured`).
- **Privacidad Estricta y Saneamiento:**
  - **Oculta de forma absoluta:** `POSTGRES_URL`, contenidos del `.env`, contraseñas, secretos, títulos y contenidos de recuerdos, y configuraciones de asistentes.
  - **Saneamiento:** Filtra y reemplaza caracteres de escape ANSI, caracteres de control, secuencias bidireccionales (bidi), caracteres de ancho cero y URLs. Ocultar la URL no prueba conectividad remota.
- **Acciones Confirmadas (`Actions`):**
  - Acciones disponibles: `Create project`, `Rename project`, `Bind directory`, `Enable assistant integration` (Esquema 5), `Enable sessions` (Esquema 6), `Enable search reinforcement` (Esquema 7), `Synchronize now` (solo si PostgreSQL está configurado; ronda única sin promoción de formato ni instalación de servicios).
  - **Protocolo de confirmación:** Exige previsualizar las consecuencias, escribir explícitamente la palabra `confirm` (insensible a mayúsculas/minúsculas) y presionar Enter. Presionar Enter solo jamás autoriza la operación.
  - **Cancelación segura:** Presionar Escape o Ctrl+C antes de la confirmación final no realiza ninguna escritura. Si una acción ya confirmada comenzó a ejecutarse, se ignoran pulsaciones repetidas y la terminal se restaura con seguridad al salir, aunque la acción iniciada no se promete revertir.
- **Subflujo de Asistentes (`Assistants`):**
  - Suspende limpiamente el Centro de Control y restaura la terminal.
  - Abre de forma secuencial el configurador de asistentes existente (`assistantTui`) con su selección con la barra espaciadora, autoprueba asíncrona de 5 segundos (`t`), previsualización de cambios, respaldos `0600` con sufijo UUID y verificación posterior de bytes.
  - Al salir del subflujo de asistentes, la terminal se restaura y el Centro de Control recarga un resumen fresco y actualizado de la base de datos sin anidar lectores en crudo (*no nested raw modes*).
- **Códigos de salida:** `0` al salir normalmente; `130` al cancelar; `1` ante error o si falta TTY (`INTERACTIVE_REQUIRED`).

---

### 2.5. `assistant-list`
Inspección de solo lectura en formato JSON estructurado que audita la presencia de ejecutables de asistentes, archivos de configuración existentes y niveles de cobertura de ganchos nativos.

```bash
forge614-engram assistant-list
```
- **Opciones:** Ninguna.
- **Salida:** Lista JSON de descriptores de asistentes. Apta para scripts y tuberías de automatización.
- **Efectos secundarios:** Ninguno. No escribe en disco, no inicializa bases de datos ni lanza procesos de clientes.

---

### 2.6. `integration-enable`
Habilita explícitamente el soporte de asistentes y asociaciones locales de carpetas actualizando la base de datos local al **Esquema 5** (añade la tabla `project_bindings`), sin alterar archivos de configuración de ningún cliente.

```bash
forge614-engram integration-enable
```
- **Opciones:** Ninguna.
- **Salida JSON:**
  ```json
  {
    "enabled": true,
    "schema": 5
  }
  ```
- **Efectos secundarios:** Inicializa el espacio global si no existía y actualiza aditivamente SQLite al Esquema 5.

---

### 2.7. `sessions-enable`
Habilita explícitamente el soporte de sesiones progresivas y contexto clasificado actualizando la base de datos local al **Esquema 6** (añade las tablas `sessions`, `session_entries`, `session_summaries`, `local_session_bindings` y `local_manual_sessions`).

```bash
forge614-engram sessions-enable
```
- **Opciones:** Ninguna.
- **Salida JSON:**
  ```json
  {
    "enabled": true,
    "schema": 6
  }
  ```
- **Efectos secundarios:** Migración aditiva irreversible. Si la base estaba en Esquema 3, 4 o 5, la promueve al Esquema 6. Los comandos normales de apertura, `mcp` o `init` jamás auto-migran la base; la ejecución de `sessions-enable` es obligatoria antes de invocar comandos de sesiones.

---

### 2.8. `reinforcement-enable`
Habilita explícitamente el registro de confirmaciones inmutables y el ranking reforzado FTS5 actualizando la base de datos local al **Esquema 7** (añade las tablas `confirmations` y `confirmation_requests`).

```bash
forge614-engram reinforcement-enable
```
- **Opciones:** Ninguna.
- **Salida JSON:**
  ```json
  {
    "enabled": true,
    "schema": 7
  }
  ```
- **Efectos secundarios:** Migración aditiva irreversible. Si la base estaba en Esquema 3, 4, 5 o 6, la promueve al Esquema 7. Los comandos normales de apertura o `mcp` jamás auto-migran bases de datos existentes a Esquema 7; la ejecución de `reinforcement-enable` (o seleccionarlo en `setup`) es obligatoria para activar el ranking reforzado.

---

### 2.9. `mcp`
Inicia el servidor local del Protocolo de Contexto de Modelo (*Model Context Protocol*) a través de los canales estándar de comunicación entre procesos (`stdio`).

```bash
forge614-engram mcp
```
- **Opciones:** Ninguna.
- **Canales:** Reserva `stdout` exclusivamente para el intercambio de tramas JSON-RPC del protocolo MCP. Los errores internos se gestionan sin emitir texto que contamine la comunicación.
- **10 Herramientas expuestas:**
  1. `memory_context`
  2. `memory_current_project`
  3. `memory_get`
  4. `memory_history`
  5. `memory_save`
  6. `memory_search`
  7. `memory_session_end`
  8. `memory_session_start`
  9. `memory_session_summary`
  10. `memory_timeline`
- **Condición previa:** Requiere que la base de datos cuente con el Esquema 5 (mediante `tui` o `integration-enable`), Esquema 6 (mediante `sessions-enable`), o Esquema 7 (mediante `reinforcement-enable`). El servidor MCP no migra la base al arrancar.
- **Cierre:** Al recibir `EOF` en `stdin` se cierra ordenadamente; con `SIGINT` finaliza con código `130`; con `SIGTERM` finaliza con código `143`.

---

### 2.10. `memory-hook`
Adaptador nativo invocado por ganchos de asistentes de desarrollo al iniciar sesión o enviar prompts.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|antigravity>
```
- **Opciones obligatorias:** `--client <nombre>`
- **Salida:** Emite una estructura JSON nativa comprensible para el cliente especificado inyectando recordatorios contextuales. Para `antigravity` y `opencode`, emite `{}` ya que no utilizan ganchos de eventos administrados en este formato.
- **Efectos secundarios:** **No guarda recuerdos en la base de datos.** La persistencia de recuerdos la realiza el modelo mediante llamadas a `memory_save`.
- **Aviso en Antigravity:** Opera actualmente como *MCP only*. No se instala ningún hook automático (*Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified*).

---

### 2.11. `project-bind`
Asocia manualmente una ruta de carpeta local del disco a un identificador de proyecto (`projectId`) existente.

```bash
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/mi-proyecto" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```
- **Opciones obligatorias:** `--directory <carpeta>`, `--project-id <UUID>`
- **Comportamiento:** Resuelve la ruta canónica del repositorio mediante Git (`git rev-parse --path-format=absolute --git-common-dir`), vinculando de forma unificada ramas vinculadas (*worktrees*) y subcarpetas.
- **Salida JSON:**
  ```json
  {
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "directory": "/Users/usuario/Desktop/mi-proyecto",
    "source": "binding"
  }
  ```

---

### 2.12. `init`
Inicializa programáticamente el espacio global (`~/.forge614/.env` y `~/.forge614/engram.db`) en modo exclusivamente local.

```bash
forge614-engram init
```
- **Salida JSON:** `{"initialized":true,"storage":"sqlite"}`
- **Efectos secundarios:** Es idempotente. Si la base ya existe con recuerdos previos, no borra ni modifica datos.

---

### 2.13. `sync`
Ejecuta una ronda inmediata de sincronización por fusión de tres vías (*3-way merge snapshot sync*) contra el servidor PostgreSQL configurado en `~/.forge614/.env`.

```bash
# Sincronización ordinaria:
forge614-engram sync

# Promoción explícita de réplica a Formato 2 o Formato 3:
forge614-engram sync --upgrade-format
```
- **Opciones opcionales:**
  - `--upgrade-format`: Promueve explícitamente una réplica remota PostgreSQL en formato anterior a **Formato 3** (añade las colecciones `confirmations` y `confirmationRequests`). La promoción está protegida por bloqueo optimista CAS atómico sobre la instantánea en `forge614_sync.state`.
- **Requisitos de Promoción:**
  - Requiere que la base local tenga Esquema 7 (`reinforcement-enable`).
  - **Todos los equipos pares deben haberse actualizado** a Esquema 7 antes de sincronizar con una réplica promovida a Formato 3. Si un cliente sin refuerzo intenta sincronizar un paquete en Formato 3, se detiene arrojando `REINFORCEMENT_REQUIRED`.
- **Salida JSON exitosa:**
  ```json
  {
    "synchronized": true,
    "projects": 3,
    "memories": 15
  }
  ```
- **Errores:**
  - `REINFORCEMENT_REQUIRED`: Si el cliente local carece de Esquema 7 y el servidor remoto está en Formato 3.
  - `SYNC_UPGRADE_REQUIRED`: Si la réplica remota requiere `--upgrade-format` para coincidir con la versión local o viceversa.
  - `SYNC_DISABLED`: Si la sincronización no está configurada en `.env`.
  - `SYNC_CONFLICT`: Si hay modificaciones incompatibles sobre una misma entidad entre local y remoto.
  - `SYNC_TOO_LARGE`: Si la instantánea combinada supera los 8 MiB (`8,388,608 bytes`).
  - `POSTGRES_UNAVAILABLE` / `POSTGRES_URL`: Ante fallos de red, permisos o parámetros inválidos de TLS.

---

### 2.14. `sync-watch`
Ejecuta una ronda inmediata de sincronización y mantiene un bucle en primer plano que reintenta periódicamente.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Opciones opcionales:** `--interval <segundos>` (entero entre 1 y 3600; por defecto `30`).
- **Restricción estricta:** `sync-watch` **no acepta `--upgrade-format`**; si se pasa esta opción arroja `INVALID_INPUT` ("sync-watch no acepta --upgrade-format."). La promoción de formato debe ejecutarse de forma explícita y consciente con una única ronda controlada de `sync --upgrade-format`.
- **Comportamiento:** No instala demonios ni servicios permanentes en segundo plano. Al cerrar la terminal o pulsar `Ctrl+C`, finaliza con código **130** y los datos locales permanecen intactos en SQLite.

---

## 3. Catálogo de Comandos de Proyectos

---

### 3.1. `project-create`
Registra un nuevo proyecto en la base de datos central.

```bash
forge614-engram project-create --name "Motor de Recomendaciones"
```
- **Opciones obligatorias:** `--name <texto>`
- **Salida JSON:** Devuelve el objeto del proyecto con su identificador UUID `projectId` generado.

---

### 3.2. `project-list`
Lista todos los proyectos registrados en la base central.

```bash
forge614-engram project-list
```
- **Salida JSON:** Arreglo con todos los proyectos registrados ordenados cronológicamente.

---

### 3.3. `project-rename`
Actualiza el nombre visible de un proyecto sin alterar su identificador ni sus recuerdos.

```bash
forge614-engram project-rename \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --name "Nuevo Nombre Comercial"
```
- **Opciones obligatorias:** `--project-id <UUID>`, `--name <texto>`

---

## 4. Catálogo de Comandos de Recuerdos

---

### 4.1. `save`
Crea un nuevo recuerdo, actualiza un recuerdo existente por su tema (`--topic`), reintenta idempotentemente por clave (`--request-key`), o registra una confirmación inmutable.

```bash
# Guardar un recuerdo inicial con clave de petición idempotente:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Base de Datos Elegida" \
  --content "Utilizaremos PostgreSQL 16 con réplica física." \
  --type decision \
  --topic "base-de-datos" \
  --request-key "req-db-01" \
  --session-id "ses-arch-01"

# Actualizar un tema existente (requiere expected-version):
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "base-de-datos" \
  --title "Actualización de Motor" \
  --content "Migraremos a PostgreSQL 17." \
  --type decision \
  --expected-version 1

# Guardar un recuerdo compartido universal (scope shared) sin sesión:
forge614-engram save \
  --scope shared \
  --title "Preferencia de Lenguaje" \
  --content "Documentar siempre en español técnico." \
  --type preference

# Guardar un recuerdo compartido universal asociado al contexto de una sesión privada:
forge614-engram save \
  --scope shared \
  --title "Regla Global de Formato" \
  --content "Usar tabulaciones de 2 espacios en JSON." \
  --type preference \
  --session-id "ses-arch-01" \
  --session-project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

- **Opciones:**
  - `--title <texto>`: Título descriptivo (obligatorio).
  - `--content <texto>`: Contenido completo de la nota (obligatorio).
  - `--type <tipo>`: `fact` (por defecto), `decision`, `procedure`, `warning`, `preference`.
  - `--scope <project|shared>`: Alcance (`project` por defecto).
  - `--project-id <UUID>`: Obligatorio si scope es `project`; prohibido si scope es `shared`.
  - `--topic <clave>`: Identificador textual de tema para actualizaciones evolutivas.
  - `--expected-version <entero>`: Versión previa obligatoria al actualizar un tema existente.
  - `--request-key <clave>`: Clave de idempotencia para reintentos seguros.
  - `--pinned <true|false>`: Fija el recuerdo para otorgarle prioridad en búsquedas y contexto.
  - `--session-id <id>`: Identificador de la sesión que origina este recuerdo.
  - `--session-project-id <UUID>`: Proyecto propietario de la sesión cuando se asocia una sesión a un guardado con `--scope shared`.
- **Semántica de Claves de Petición (`--request-key`):**
  - **Reintento Idempotente (*Replay*):** Si se reenvía una petición con la misma `requestKey` y la misma carga (mismo hash SHA-256), Engram devuelve inmediatamente la respuesta almacenada sin modificar el historial, sin subir versión y sin añadir confirmaciones.
  - **Conflicto de Carga (`REQUEST_CONFLICT`):** Si se reutiliza una `requestKey` existente pero enviando diferente título, contenido, alcance o tipo, Engram aborta inmediatamente arrojando `REQUEST_CONFLICT`.
- **Confirmaciones Inmutables (Esquema 7):**
  - Cuando se guarda con una **nueva clave** un contenido idéntico a una nota activa existente:
    - Si la nota tiene tema (`topicKey`), detecta la coincidencia exacta de título, contenido, tipo y estado fijado.
    - Si la nota no tiene tema (`topicKey: null`), busca coincidencias dentro de una **ventana móvil de 15 minutos** (`ahora - 900,000 ms` a `ahora`).
    - En lugar de crear una versión 2 redundante, Engram genera un registro en `confirmations` vinculando la versión actual intacta.
    - El historial de versiones de la nota permanece en **1 sola versión**.
    - **Significado honesto:** Representa una nueva observación del dato; no certifica verdad absoluta ni verificación humana.
  - **Protección de Reloj (`CLOCK_SKEW`):** Si el reloj local del sistema indica una fecha anterior a la fecha de la versión confirmada del recuerdo, se arroja `CLOCK_SKEW`.
- **Reglas de Inferencia y Asociación de Sesiones:**
  - Si se pasa `--session-id`: se asocia explícitamente la entrada cronológica (`sessionSource: "explicit"`). La sesión debe existir y pertenecer al proyecto; si está cerrada arroja `SESSION_CLOSED`.
  - Si se omite `--session-id`:
    - En la CLI (`mode: "independent"`): para recuerdos de proyecto en bases con Esquema 6+, se asocia automáticamente a la sesión manual persistente del proyecto en este equipo (`sessionSource: "manual"`). Para recuerdos compartidos (`scope: "shared"`), no se asocia ninguna sesión (`sessionSource: null`).
    - En asistentes vía MCP (`mode: "assistant"`): busca sesiones en ejecución (*runtime*) activas en los últimos 7 días en la carpeta vinculada:
      - Si hay 0 sesiones activas: recurre a la sesión manual (`sessionSource: "manual"`).
      - Si hay exactamente 1 sesión activa: la asocia automáticamente (`sessionSource: "inferred"`).
      - Si hay múltiples sesiones activas concurrentes: se detiene con `AMBIGUOUS_SESSION`, exigiendo indicar `--session-id`.
  - **Aislamiento de Recuerdos Compartidos:** Al guardar un recuerdo con `--scope shared` asociado a una sesión privada (`--session-id` y `--session-project-id`), en almacenamiento el `projectId` del recuerdo permanece estrictamente como `null`. La respuesta pública y consultas desde otros proyectos omiten los metadatos de la sesión privada para prevenir fugas de información.

---

### 4.2. `search`
Busca recuerdos activos utilizando SQLite FTS5 con tokenizador trigram y ponderación BM25 multiplicada por factores de actualidad y estabilidad.

```bash
# Búsqueda combinada de proyecto y compartidos (scope all por defecto):
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "postgresql replica" \
  --limit 5

# Búsqueda progresiva en modo vista previa (preview):
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "arquitectura" \
  --preview

# Búsqueda exclusiva de recuerdos compartidos:
forge614-engram search --scope shared --query "español"
```
- **Opciones opcionales:**
  - `--preview`: Emite fichas abreviadas (`MemoryPreview`) donde el contenido textual se trunca a un máximo de **300 puntos de código Unicode** (*code points*) y se añade la bandera booleana `truncated`. Reduce drásticamente el consumo de contexto antes de inspeccionar recuerdos específicos.
  - `--limit <n>`: Número máximo de resultados (entero $\ge 1$, por defecto 20).
  - `--scope <all|project|shared>`: Filtro de alcance (`all` por defecto).
- **Estructura del Resultado y Explicación de Ranking:**
  Cada elemento del arreglo devuelto contiene `memory` y `explanation`:
  ```json
  {
    "memory": { ... },
    "explanation": {
      "mode": "fts5",
      "bm25": -2.145,
      "multiplier": 1.069,
      "orderScore": -2.293,
      "reinforcement": {
        "revisionCount": 0,
        "duplicateCount": 1,
        "lastSeenAt": "2026-09-17T12:12:00.000Z",
        "ageDays": 0.005,
        "pinnedBoost": 0,
        "recencyBoost": 0.059,
        "stabilityBoost": 0.008
      }
    }
  }
  ```
  - **Ordenamiento FTS5:** Se ordena ascendente por `orderScore = bm25 * multiplier`, desempatando por `id ASC`. Al ser `bm25` un valor negativo en SQLite FTS5, un multiplicador más alto produce un número más negativo, situando la nota en una posición más destacada.

---

### 4.3. `get`
Obtiene un recuerdo por su identificador UUID, ya sea en su versión activa actual o en una versión histórica específica.

```bash
# Obtener versión activa actual:
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"

# Obtener una revisión histórica específica:
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851" \
  --version 1
```
- **Opciones:**
  - `--id <UUID>`: Identificador del recuerdo (obligatorio).
  - `--version <n>`: Número de versión histórica puntual (opcional, entero $\ge 1$). Devuelve la ficha `VersionRead` con el contenido exacto de esa revisión, `currentVersion` y el estado general (`active` o `archived`).

---

### 4.4. `history`
Devuelve la lista cronológica inmutable de todas las versiones pasadas de un recuerdo.

```bash
forge614-engram history \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

### 4.5. `archive` y `restore`
- `archive`: Retira un recuerdo de las búsquedas normales conservándolo íntegro en el historial.
- `restore`: Devuelve un recuerdo archivado al estado activo.

```bash
forge614-engram archive \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"

forge614-engram restore \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

---

## 5. Catálogo de Comandos de Sesiones Progresivas y Contexto

> [!IMPORTANT]
> Todos los comandos de esta sección requieren que la base de datos se encuentre al menos en el **Esquema 6** (habilitado mediante `forge614-engram sessions-enable` o `reinforcement-enable`).

---

### 5.1. `session-start`
Inicia formalmente una sesión de trabajo en ejecución (*runtime session*) asociada a una carpeta local de proyecto.

```bash
forge614-engram session-start \
  --directory "/Users/usuario/Desktop/mi-proyecto" \
  --session-id "ses-refactor-api"
```
- **Opciones obligatorias:** `--directory <carpeta>`, `--session-id <id>` (texto de 1 a 200 caracteres, sin caracteres de control).
- **Comportamiento:** Resuelve la carpeta canónica mediante Git, vincula el proyecto si no existía colisión y registra la sesión con `kind: "runtime"`, marcando la fecha de inicio (`startedAt`). Registra también la asociación local en `local_session_bindings`.
- **Salida JSON:**
  ```json
  {
    "sessionId": "ses-refactor-api",
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "kind": "runtime",
    "startedAt": "2026-09-17T12:00:00.000Z",
    "endedAt": null
  }
  ```

---

### 5.2. `session-end`
Cierra ordenadamente una sesión en ejecución registrando su fecha de finalización (`endedAt`).

```bash
forge614-engram session-end \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api"
```
- **Opciones obligatorias:** `--project-id <UUID>`, `--session-id <id>`
- **Restricciones:** Solo pueden cerrarse sesiones de tipo `runtime`. Una sesión manual no puede cerrarse (`SESSION_KIND`).

---

### 5.3. `session-summary`
Guarda o actualiza un resumen estructurado al cierre o hito clave de una sesión de trabajo.

```bash
forge614-engram session-summary \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api" \
  --summary-json '{"goal":"Refactorizar API","instructions":"Usar esquemas Zod","discoveries":"Endpoints legados sin tipar","accomplishments":"8 rutas migradas","nextSteps":"Añadir tests de integración","files":["src/routes/api.ts"]}' \
  --request-key "sum-refactor-v1"
```
- **Opciones obligatorias:**
  - `--project-id <UUID>`
  - `--session-id <id>`
  - `--summary-json <json>`: Objeto JSON con exactamente 6 campos: `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps` (textos no vacíos) y `files` (arreglo de cadenas).
  - `--request-key <clave>`: Clave de idempotencia.
- **Opciones opcionales:**
  - `--expected-version <n>`: Versión previa esperada en caso de actualización evolutiva del resumen.
- **Comportamiento:** Persiste un recuerdo de tipo `procedure` con el tema reservado inmutable `session/<sessionId>/summary` y actualiza la tabla `session_summaries`. Los temas con ese prefijo quedan reservados (`SUMMARY_TOPIC_RESERVED`).

---

### 5.4. `timeline`
Reconstruye la línea temporal de acontecimientos ocurridos en torno a un recuerdo específico dentro de una sesión.

```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "ses-refactor-api" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851" \
  --version 1 \
  --before 3 \
  --after 3
```
- **Opciones obligatorias:** `--project-id <UUID>`, `--session-id <id>`, `--id <UUID>`, `--version <n>`
- **Opciones opcionales:** `--before <0..20>` (por defecto 5), `--after <0..20>` (por defecto 5).
- **Comportamiento:** Devuelve el recuerdo en foco (`focus`, abreviado a un máximo de 500 puntos de código) junto con los recuerdos guardados inmediatamente antes (`before`) y después (`after`), abreviados a 150 puntos de código cada uno. Si el recuerdo no pertenece a esa sesión o está archivado, arroja `NO_SESSION_CONTEXT`.

---

### 5.5. `context`
Ensambla una vista integral y clasificada de contexto estructurado para el arranque de sesión o recuperación tras compactación de contexto.

```bash
# Contexto de un proyecto con límite de bytes por defecto (16 KB):
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"

# Contexto compacto (sin previsualizaciones de texto):
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --compact

# Contexto con presupuesto de bytes personalizado (ej. 32 KB):
forge614-engram context --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" --max-bytes 32768

# Contexto global exclusivo de recuerdos compartidos:
forge614-engram context --scope shared
```
- **Opciones:**
  - `--project-id <UUID>` (obligatorio salvo si `--scope shared`).
  - `--scope <project|shared>` (`project` por defecto).
  - `--compact`: Si se especifica, omite el campo `preview` en las filas de notas para ahorrar espacio.
  - `--max-bytes <1024..65536>`: Límite estricto en **bytes UTF-8 del JSON serializado resultante** (por defecto `16384` bytes / 16 KiB). **No es un presupuesto de tokens**.
- **Estructura del Resultado (`ContextResult`):**
  - Divide los recuerdos en 3 secciones priorizadas: `pinned` (notas fijadas), `recent` (recuerdos recientes) y `summaries` (resúmenes de sesiones previas).
  - Incluye contadores de elementos omitidos (`omitted: { pinned, recent, summaries }`) y la bandera booleana `truncated`.

---

## 6. Catálogo de Códigos de Error Oficiales

Cuando la CLI falla, emite un objeto JSON en `stderr` con código de salida `1` conteniendo `{ "error": "<CODIGO>", "message": "<explicacion>" }`:

| Código de Error | Causa Raíz | Acción Correctiva |
| :--- | :--- | :--- |
| `INVALID_INPUT` | Sintaxis incorrecta, opciones desconocidas, repetidas o incompatibles. | Revisar los argumentos y banderas según este manual. |
| `REINFORCEMENT_REQUIRED` | El cliente local no tiene Esquema 7 y el servidor remoto sincroniza Formato 3. | Ejecutar `forge614-engram reinforcement-enable` localmente. |
| `SYNC_UPGRADE_REQUIRED` | La réplica remota o cliente local requiere promoción de formato explícita. | Ejecutar `forge614-engram sync --upgrade-format` de forma deliberada. |
| `CLOCK_SKEW` | El reloj local marca una fecha anterior a la versión del recuerdo a confirmar. | Sincronizar el reloj del sistema mediante NTP o ajustar fecha/hora. |
| `REQUEST_CONFLICT` | Se reutilizó una misma `requestKey` con una carga (título, contenido, etc.) diferente. | Usar una `requestKey` nueva para operaciones distintas. |
| `AMBIGUOUS_SESSION` | Existen 2 o más sesiones abiertas concurrentes para la carpeta y no se pasó `--session-id`. | Especificar explícitamente `--session-id <id>` en el comando. |
| `SESSION_CLOSED` | Se intentó guardar o asociar un recuerdo a una sesión que ya fue finalizada. | Iniciar una sesión nueva o guardar sin asociar a la sesión cerrada. |
| `SESSION_KIND` | Se intentó cerrar con `session-end` una sesión permanente manual. | Solo las sesiones de tipo `runtime` pueden finalizarse. |
| `NO_SESSION_CONTEXT` | La nota solicitada en `timeline` no pertenece a esa sesión o está archivada. | Verificar el identificador de la nota y su sesión de pertenencia. |
| `SUMMARY_TOPIC_RESERVED` | Se intentó usar el prefijo reservado `session/<id>/summary` manualmente en `save`. | Los resúmenes deben guardarse únicamente mediante `session-summary`. |
| `PROJECT_BINDING_REQUIRED` | Una carpeta asociada previamente fue borrada, renombrada o desmontada. | Usar `project-bind` para asociar la ruta actual al proyecto deseado. |
| `CONFLICT` | En OpenCode, existe un plugin local con modificaciones no gestionadas. | Respaldar y conciliar el plugin manualmente antes de usar `tui`. |
| `PUBLISHED_UNVERIFIED` | Un archivo de configuración de asistente fue alterado concurrentemente tras guardarse. | Verificar los archivos de configuración y reintentar la operación. |
| `INTERACTIVE_REQUIRED` | `setup` o `tui` fueron invocados sin una terminal interactiva TTY real. | Ejecutar el comando en una terminal interactiva humana. |
| `SYNC_DISABLED` | Se invocó `sync` pero no hay configuración PostgreSQL en `~/.forge614/.env`. | Ejecutar `forge614-engram setup` para configurar la réplica. |
| `SYNC_CONFLICT` | Conflicto irreconciliable de tres vías entre la base local y la réplica remota. | Resolver la divergencia inspeccionando las versiones en conflicto. |
| `SYNC_TOO_LARGE` | La instantánea acumulada de sincronización supera el límite de 8 MiB. | Purgar o archivar entidades históricas para reducir el paquete. |
| `POSTGRES_UNAVAILABLE` | El servidor PostgreSQL remoto no responde o rechazó la conexión. | Verificar la red, estado del servidor PostgreSQL y credenciales. |

---

## 7. Tabla Resumen Exhaustiva de Opciones por Comando

| Comando | Opciones Obligatorias | Opciones Opcionales | Salida |
| :--- | :--- | :--- | :--- |
| `setup` | Ninguna | Ninguna | Texto interactivo |
| `tui` | Ninguna | Ninguna | Pantalla interactiva |
| `assistant-list` | Ninguna | Ninguna | JSON |
| `integration-enable` | Ninguna | Ninguna | JSON |
| `sessions-enable` | Ninguna | Ninguna | JSON |
| `reinforcement-enable` | Ninguna | Ninguna | JSON |
| `mcp` | Ninguna | Ninguna | JSON-RPC (stdio) |
| `memory-hook` | `--client` | Ninguna | JSON nativo |
| `project-bind` | `--directory`, `--project-id` | Ninguna | JSON |
| `init` | Ninguna | Ninguna | JSON |
| `sync` | Ninguna | `--upgrade-format` | JSON |
| `sync-watch` | Ninguna | `--interval` | JSON continuo |
| `project-create` | `--name` | Ninguna | JSON |
| `project-list` | Ninguna | Ninguna | JSON |
| `project-rename` | `--project-id`, `--name` | Ninguna | JSON |
| `save` | `--title`, `--content` | `--type`, `--scope`, `--project-id`, `--topic`, `--expected-version`, `--request-key`, `--pinned`, `--session-id`, `--session-project-id` | JSON |
| `search` | `--query` | `--project-id`, `--scope`, `--limit`, `--preview` | JSON |
| `get` | `--id` | `--project-id`, `--scope`, `--version` | JSON |
| `history` | `--id` | `--project-id`, `--scope` | JSON |
| `archive` | `--id` | `--project-id`, `--scope` | JSON |
| `restore` | `--id` | `--project-id`, `--scope` | JSON |
| `session-start` | `--directory`, `--session-id` | Ninguna | JSON |
| `session-end` | `--project-id`, `--session-id` | Ninguna | JSON |
| `session-summary`| `--project-id`, `--session-id`, `--summary-json`, `--request-key` | `--expected-version` | JSON |
| `timeline` | `--project-id`, `--session-id`, `--id`, `--version` | `--before`, `--after` | JSON |
| `context` | `--project-id` (o `--scope shared`) | `--compact`, `--max-bytes`, `--scope` | JSON |
| `--version` | Ninguna | Ninguna | Texto plano |
| `help` | Ninguna | Ninguna | Texto plano |
