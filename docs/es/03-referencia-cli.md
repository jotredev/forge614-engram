# 03. Manual Exhaustivo de Terminal (CLI)

> **Etapa:** Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Activo (369 pruebas totales en 69 archivos: 361 superadas y 8 omitidas sin binarios aislados PG; 369 superadas, 0 fallos, 1891 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8)
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
   - **Comandos de datos y automatización (`init`, `sync`, `assistant-list`, `integration-enable`, `sessions-enable`, `project-*`, `save`, `search`, `session-*`, `timeline`, `context`, etc.):** Emiten respuestas en formato **JSON estructurado** a través de `stdout` con código de salida `0` en caso de éxito. En caso de error, emiten un objeto JSON de error a través de `stderr` con código de salida `1`.
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
Asistente interactivo guiado para configurar el espacio central (`~/.forge614/.env` y `~/.forge614/engram.db`) con o sin sincronización PostgreSQL.

```bash
forge614-engram setup
```
- **Opciones:** Ninguna.
- **Requisitos:** Terminal interactiva (`stdin` y `stdout` TTY).
- **Códigos de salida:** `0` al confirmar y aplicar; `130` al cancelar voluntariamente; `1` ante error.

---

### 2.4. `tui`
Menú interactivo de pantalla completa en terminal para auditar, previsualizar y configurar asistentes de inteligencia artificial (Claude Code, Codex, Cursor, OpenCode, Gemini CLI).

```bash
forge614-engram tui
```
- **Opciones:** Ninguna.
- **Requisitos:** Terminal interactiva (`isTTY` verdadero y soporte de *raw mode*). Si se ejecuta en un entorno no interactivo, falla con `INTERACTIVE_REQUIRED`.
- **Teclas de navegación:**
  - `↑` / `↓`: Mover cursor.
  - `Espacio`: Seleccionar o deseleccionar cliente.
  - `r`: Redetectar ejecutables y configuraciones en el sistema.
  - `c`: Personalizar ejecutable o directorio de configuración mediante entrada oculta.
  - `t` / "Probar servidor propio (opcional)": Ejecuta una autoprueba asíncrona de 5 segundos del binario de Engram mediante el SDK oficial de MCP por stdio, verificando las 10 herramientas. Presionar `Escape` durante la prueba cancela únicamente la autoprueba.
  - `Enter`: Avanza entre pantallas (`Lista` $\rightarrow$ `Vista Previa` $\rightarrow$ `Confirmación` $\rightarrow$ `Aplicar`).
  - `Escape`: Retrocede a la pantalla previa.
  - `Ctrl+C`: Cancela la sesión inmediatamente, restaura la terminal y devuelve código `130`.
- **Efectos secundarios:**
  - En Vista Previa: Ninguno (no escribe archivos).
  - Al Confirmar: Ejecuta *preflight*, habilita el Esquema 5 en SQLite, genera respaldos con permisos `0600` y sufijo UUID de los archivos a modificar, aplica los cambios preservando comentarios JSONC/TOML y verifica los bytes exactos publicados (`PUBLISHED_UNVERIFIED` si hubo interferencia externa). Si detecta un plugin existente de OpenCode con contenido divergente, se detiene con conflicto `CONFLICT` sin sobrescribirlo ciegamente.

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

### 2.8. `mcp`
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
- **Condición previa:** Requiere que la base de datos cuente con el Esquema 5 (habilitado mediante `tui` o `integration-enable`) o Esquema 6 (mediante `sessions-enable` para utilizar las herramientas de sesión). El servidor MCP no migra la base al arrancar.
- **Cierre:** Al recibir `EOF` en `stdin` se cierra ordenadamente; con `SIGINT` finaliza con código `130`; con `SIGTERM` finaliza con código `143`.

---

### 2.9. `memory-hook`
Adaptador nativo invocado por ganchos de asistentes de desarrollo al iniciar sesión o enviar prompts.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|gemini-cli>
```
- **Opciones obligatorias:** `--client <nombre>`
- **Salida:** Emite una estructura JSON nativa comprensible para el cliente especificado inyectando recordatorios contextuales.
- **Efectos secundarios:** **No guarda recuerdos en la base de datos.** La persistencia de recuerdos la realiza el modelo mediante llamadas a `memory_save`.

---

### 2.10. `project-bind`
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

### 2.11. `init`
Inicializa programáticamente el espacio global (`~/.forge614/.env` y `~/.forge614/engram.db`) en modo exclusivamente local.

```bash
forge614-engram init
```
- **Salida JSON:** `{"initialized":true,"storage":"sqlite"}`
- **Efectos secundarios:** Es idempotente. Si la base ya existe con recuerdos previos, no borra ni modifica datos.

---

### 2.12. `sync`
Ejecuta una ronda inmediata de sincronización por fusión de tres vías (*3-way merge snapshot sync*) contra el servidor PostgreSQL configurado en `~/.forge614/.env`.

```bash
# Sincronización ordinaria:
forge614-engram sync

# Promoción explícita de réplica Formato 1 a Formato 2:
forge614-engram sync --upgrade-format
```
- **Opciones opcionales:**
  - `--upgrade-format`: Promueve explícitamente una réplica remota PostgreSQL en formato 1 (proyectos y recuerdos) a formato 2 (añade sesiones, entradas cronológicas y resúmenes estructurados). La promoción está protegida por CAS optimista atómico en la tabla `forge614_sync.state`.
- **Salida JSON exitosa:**
  ```json
  {
    "synchronized": true,
    "projects": 3,
    "memories": 15
  }
  ```
- **Errores:**
  - `SYNC_DISABLED`: Si la sincronización no está configurada en `.env`.
  - `SYNC_CONFLICT`: Si hay modificaciones incompatibles sobre una misma entidad entre local y remoto.
  - `SYNC_TOO_LARGE`: Si la instantánea combinada supera los 8 MiB (`8,388,608 bytes`).
  - `POSTGRES_UNAVAILABLE` / `POSTGRES_URL`: Ante fallos de red, permisos o parámetros inválidos de TLS.

---

### 2.13. `sync-watch`
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
Crea un nuevo recuerdo o actualiza un recuerdo existente identificado por su tema (`--topic`).

```bash
# Guardar en un proyecto con sesión explícita:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Base de Datos Elegida" \
  --content "Utilizaremos PostgreSQL 16 con réplica física." \
  --type decision \
  --topic "base-de-datos" \
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
- **Reglas de Inferencia y Asociación de Sesiones:**
  - Si se pasa `--session-id`: se asocia explícitamente la entrada cronológica (`sessionSource: "explicit"`). La sesión debe existir y pertenecer al proyecto; si está cerrada arroja `SESSION_CLOSED`.
  - Si se omite `--session-id`:
    - En la CLI (`mode: "independent"`): para recuerdos de proyecto en bases con Esquema 6, se asocia automáticamente a la sesión manual persistente del proyecto en este equipo (`sessionSource: "manual"`). Para recuerdos compartidos (`scope: "shared"`), no se asocia ninguna sesión (`sessionSource: null`).
    - En asistentes vía MCP (`mode: "assistant"`): busca sesiones en ejecución (*runtime*) activas en los últimos 7 días en la carpeta vinculada:
      - Si hay 0 sesiones activas: recurre a la sesión manual (`sessionSource: "manual"`).
      - Si hay exactamente 1 sesión activa: la asocia automáticamente (`sessionSource: "inferred"`).
      - Si hay múltiples sesiones activas concurrentes: se detiene con `AMBIGUOUS_SESSION`, exigiendo indicar `--session-id`.
  - **Aislamiento de Recuerdos Compartidos:** Al guardar un recuerdo con `--scope shared` asociado a una sesión privada (`--session-id` y `--session-project-id`), en almacenamiento el `projectId` del recuerdo permanece estrictamente como `null`. La respuesta pública y consultas desde otros proyectos omiten los metadatos de la sesión privada para prevenir fugas de información.

---

### 4.2. `search`
Busca recuerdos activos utilizando SQLite FTS5 con tokenizador trigram y ponderación BM25 + recencia.

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
> Todos los comandos de esta sección requieren que la base de datos se encuentre en el **Esquema 6** (habilitado mediante `forge614-engram sessions-enable`).

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

## 6. Tabla Resumen Exhaustiva de Opciones por Comando

| Comando | Opciones Obligatorias | Opciones Opcionales | Salida |
| :--- | :--- | :--- | :--- |
| `setup` | Ninguna | Ninguna | Texto interactivo |
| `tui` | Ninguna | Ninguna | Pantalla interactiva |
| `assistant-list` | Ninguna | Ninguna | JSON |
| `integration-enable` | Ninguna | Ninguna | JSON |
| `sessions-enable` | Ninguna | Ninguna | JSON |
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
