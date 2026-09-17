# 03. Manual Exhaustivo de Terminal (CLI)

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Activo (Verificado con 191 pruebas en macOS con Bun 1.3.8)
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
3. **Comillas obligatorias para textos con espacios:** Todo título, texto o nombre con espacios debe encerrarse entre comillas dobles (`"..."`).
4. **Validación estricta previa:** Si pasas una opción desconocida, repites una opción, o envías argumentos incompatibles (por ejemplo combinar `--scope shared` con `--project-id` en operaciones de recuerdo individual), el programa termina inmediatamente con error de sintaxis **antes de leer la configuración o abrir SQLite**.
5. **Canales de salida y códigos de salida:**
   - **Comandos interactivos (`setup`, `tui`):** Emiten texto comprensible para personas a través de `stdout`. Devuelven código `0` en caso de éxito/confirmación; código `130` si el usuario cancela voluntariamente (`Ctrl+C`, `Escape`, `cancelar`, `q` o `no`); y código `1` si ocurre un error o si se invocan sin terminal interactiva (`isTTY` falso arrojando `INTERACTIVE_REQUIRED`).
   - **Servidor MCP (`mcp`):** Reserva `stdout` exclusivamente para tramas JSON-RPC del protocolo MCP. Al cerrarse con `Ctrl+C` (SIGINT) devuelve código `130`; con SIGTERM devuelve código `143`.
   - **Observador de sincronización (`sync-watch`):** Emite rondas exitosas en JSON a `stdout` y avisos de reintento a `stderr`. Al interrumpirse con `Ctrl+C` finaliza con código `130`.
   - **Comandos de datos y automatización (`init`, `sync`, `assistant-list`, `integration-enable`, `project-*`, `save`, `search`, etc.):** Emiten respuestas en formato **JSON estructurado** a través de `stdout` con código de salida `0` en caso de éxito. En caso de error, emiten un objeto JSON de error a través de `stderr` con código de salida `1`.
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
  - `t` / "Probar servidor propio (opcional)": Ejecuta una autoprueba asíncrona de 5 segundos del binario de Engram mediante el SDK oficial de MCP por stdio, verificando las 5 herramientas. Presionar `Escape` durante la prueba cancela únicamente la autoprueba.
  - `Enter`: Avanza entre pantallas (`Lista` $\rightarrow$ `Vista Previa` $\rightarrow$ `Confirmación` $\rightarrow$ `Aplicar`).
  - `Escape`: Retrocede a la pantalla previa.
  - `Ctrl+C`: Cancela la sesión inmediatamente, restaura la terminal y devuelve código `130`.
- **Efectos secundarios:**
  - En Vista Previa: Ninguno (no escribe archivos).
  - Al Confirmar: Ejecuta *preflight*, habilita el Esquema 5 en SQLite, genera respaldos con permisos `0600` y sufijo UUID de los archivos a modificar, aplica los cambios preservando comentarios JSONC/TOML y verifica los bytes exactos publicados (`PUBLISHED_UNVERIFIED` si hubo interferencia externa).

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

### 2.7. `mcp`
Inicia el servidor local del Protocolo de Contexto de Modelo (*Model Context Protocol*) a través de los canales estándar de comunicación entre procesos (`stdio`).

```bash
forge614-engram mcp
```
- **Opciones:** Ninguna.
- **Canales:** Reserva `stdout` exclusivamente para el intercambio de tramas JSON-RPC del protocolo MCP. Los errores internos se gestionan sin emitir texto que contamine la comunicación.
- **Herramientas expuestas:**
  1. `memory_current_project`
  2. `memory_search`
  3. `memory_get`
  4. `memory_save`
  5. `memory_history`
- **Condición previa:** Requiere que la base de datos cuente con el Esquema 5 (habilitado previamente mediante `tui` o `integration-enable`). El servidor MCP no migra la base al arrancar.
- **Cierre:** Al recibir `EOF` en `stdin` se cierra ordenadamente; con `SIGINT` finaliza con código `130`; con `SIGTERM` finaliza con código `143`.

---

### 2.8. `memory-hook`
Adaptador nativo invocado por ganchos de asistentes de desarrollo al iniciar sesión o enviar prompts.

```bash
forge614-engram memory-hook --client <claude-code|codex|cursor|opencode|gemini-cli>
```
- **Opciones obligatorias:** `--client <nombre>`
- **Salida:** Emite una estructura JSON nativa comprensible para el cliente especificado inyectando recordatorios contextuales.
- **Efectos secundarios:** **No guarda recuerdos en la base de datos.** La persistencia de recuerdos la realiza el modelo mediante llamadas a `memory_save`.

---

### 2.9. `project-bind`
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

### 2.10. `init`
Inicializa programáticamente el espacio global (`~/.forge614/.env` y `~/.forge614/engram.db`) en modo exclusivamente local.

```bash
forge614-engram init
```
- **Salida JSON:** `{"initialized":true,"storage":"sqlite"}`
- **Efectos secundarios:** Es idempotente. Si la base ya existe con recuerdos previos, no borra ni modifica datos.

---

### 2.11. `sync`
Ejecuta una ronda inmediata de sincronización por fusión de tres vías (*3-way merge snapshot sync*) contra el servidor PostgreSQL configurado en `~/.forge614/.env`.

```bash
forge614-engram sync
```
- **Opciones:** Ninguna.
- **Salida JSON exitosa:**
  ```json
  {
    "synchronized": true,
    "projects": 3,
    "memories": 15
  }
  ```
- **Errores:** Si la sincronización no está habilitada devuelve `SYNC_DISABLED`; si hay modificaciones concurrentes incompatibles sobre una misma entidad devuelve `SYNC_CONFLICT`; si la instantánea supera los 8 MiB devuelve `SYNC_TOO_LARGE`.

---

### 2.12. `sync-watch`
Ejecuta una ronda inmediata de sincronización y mantiene un bucle en primer plano que reintenta periódicamente.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Opciones opcionales:** `--interval <segundos>` (entero entre 1 y 3600; por defecto `30`).
- **Comportamiento:** No instala demonios ni servicios en segundo plano. Al cerrar la terminal o pulsar `Ctrl+C`, finaliza con código **130** y los datos locales permanecen intactos en SQLite.

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
# Guardar en un proyecto:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Base de Datos Elegida" \
  --content "Utilizaremos PostgreSQL 16 con réplica física." \
  --type decision \
  --topic "base-de-datos"

# Actualizar un tema existente (requiere expected-version):
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --topic "base-de-datos" \
  --title "Actualización de Motor" \
  --content "Migraremos a PostgreSQL 17." \
  --type decision \
  --expected-version 1

# Guardar un recuerdo compartido universal (scope shared):
forge614-engram save \
  --scope shared \
  --title "Preferencia de Lenguaje" \
  --content "Documentar siempre en español técnico." \
  --type preference
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
  - `--pinned <true|false>`: Fija el recuerdo para otorgarle prioridad en búsquedas.

---

### 4.2. `search`
Busca recuerdos activos utilizando SQLite FTS5 con tokenizador trigram y ponderación BM25.

```bash
# Búsqueda combinada de proyecto y compartidos (scope all por defecto):
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "postgresql replica" \
  --limit 5

# Búsqueda exclusiva de recuerdos compartidos:
forge614-engram search --scope shared --query "español"
```

---

### 4.3. `get`
Obtiene un recuerdo por su identificador UUID.

```bash
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "d290f1ee-6c54-4b01-90e6-d701748f0851"
```

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

## 5. Tabla Resumen de Opciones por Comando

| Comando | Opciones Obligatorias | Opciones Opcionales | Salida |
| :--- | :--- | :--- | :--- |
| `setup` | Ninguna | Ninguna | Texto interactivo |
| `tui` | Ninguna | Ninguna | Pantalla interactiva |
| `assistant-list` | Ninguna | Ninguna | JSON |
| `integration-enable` | Ninguna | Ninguna | JSON |
| `mcp` | Ninguna | Ninguna | JSON-RPC (stdio) |
| `memory-hook` | `--client` | Ninguna | JSON nativo |
| `project-bind` | `--directory`, `--project-id` | Ninguna | JSON |
| `init` | Ninguna | Ninguna | JSON |
| `sync` | Ninguna | Ninguna | JSON |
| `sync-watch` | Ninguna | `--interval` | JSON continuo |
| `project-create` | `--name` | Ninguna | JSON |
| `project-list` | Ninguna | Ninguna | JSON |
| `project-rename` | `--project-id`, `--name` | Ninguna | JSON |
| `save` | `--title`, `--content` | `--type`, `--scope`, `--project-id`, `--topic`, `--expected-version`, `--request-key`, `--pinned` | JSON |
| `search` | `--query` | `--project-id`, `--scope`, `--limit` | JSON |
| `get` | `--id` | `--project-id`, `--scope` | JSON |
| `history` | `--id` | `--project-id`, `--scope` | JSON |
| `archive` | `--id` | `--project-id`, `--scope` | JSON |
| `restore` | `--id` | `--project-id`, `--scope` | JSON |
| `--version` | Ninguna | Ninguna | Texto plano |
| `help` | Ninguna | Ninguna | Texto plano |
