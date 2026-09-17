# 03. Manual Exhaustivo de Terminal (CLI)

> **Etapa:** Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.4.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync)
> **Estado:** Vigente y Activo (Verificado con 90 pruebas en macOS con Bun 1.3.8)
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
4. **Validación estricta previa:** Si pasas una opción desconocida, repites una opción, o envías argumentos incompatibles (por ejemplo combinar `--scope shared` con `--project-id` en operaciones de recuerdo), el programa termina inmediatamente con error de sintaxis **antes de leer la configuración o abrir SQLite**.
5. **Canales de salida y códigos de salida:**
   - **Comando interactivo (`setup`):** Emite texto comprensible para personas a través de `stdout`. Devuelve código de salida `0` si el usuario confirma; código `130` si el usuario cancela voluntariamente (`cancelar`, `q`, `Ctrl+C`, EOF o `no`/Enter); y código `1` si ocurre un error o si se invoca sin terminal interactiva (`isTTY` falso).
   - **Observador de sincronización (`sync-watch`):** Emite rondas exitosas en JSON a `stdout` y avisos de reintento/desconexión a `stderr`. Al interrumpirse con `Ctrl+C` finaliza con código `130`.
   - **Comandos de datos y automatización (`init`, `sync`, `project-*`, `save`, `search`, etc.):** Emiten respuestas en formato **JSON estructurado** a través de `stdout` con código de salida `0` en caso de éxito. En caso de error, emiten un objeto JSON de error a través de `stderr` con código de salida `1`.
6. **Banderas eliminadas que NO se admiten:**
   - `--db`: No se admite. La base de datos es fija: `~/.forge614/engram.db`.
   - `--project` (por nombre): No se admite. El identificador es estrictamente `--project-id <UUID>`.
   - `--id-project`: No se admite. El parámetro oficial es `--project-id`.

---

## 2. Catálogo de Comandos de Configuración y Espacio

---

### 2.1. `--version`
Muestra el nombre del programa y la versión actual instalada.

```bash
forge614-engram --version
```
- **Salida:** `forge614-engram 0.4.0`
- **Opciones:** No acepta ninguna opción adicional.
- **Efectos secundarios:** Ninguno. No lee ni crea archivos en disco.

---

### 2.2. `help`
Imprime el manual de referencia rápida oficial en la terminal.

```bash
forge614-engram help
```
- **Salida oficial:**
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync            Sincroniza todo el espacio local con PostgreSQL configurado.
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
get      --id <recuerdo>
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         Con proyecto, all es el valor por defecto: proyecto + shared.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada en setup.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup puede añadir metadatos de sincronización al esquema 3 sin borrar recuerdos.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup muestra texto y requiere terminal; cancelar devuelve código 130.
Los demás resultados son JSON; errores a stderr y código de salida 1, sin conexiones privadas.
save es manual/programático; la integración memory_save con asistentes está pendiente.
```

---

### 2.3. `setup`
Asistente interactivo guiado para personas. Explica las rutas globales (`~/.forge614/.env` y `~/.forge614/engram.db`), valida instalaciones existentes en modo de solo lectura, ofrece configurar la sincronización opcional con PostgreSQL y solicita una confirmación explícita antes de inicializar o modificar el almacenamiento.

```bash
forge614-engram setup
```
- **Opciones:** No acepta banderas ni parámetros (rechaza `--project`, `--yes`, rutas, etc.).
- **Requisito:** Requiere una terminal interactiva para entrada y salida (`process.stdin.isTTY` y `process.stdout.isTTY`). Si se invoca sin terminal (en tuberías, scripts o segundo plano), falla con código de salida 1 y emite el error JSON `INTERACTIVE_REQUIRED` en stderr:
  ```json
  {"error":{"code":"INTERACTIVE_REQUIRED","message":"setup necesita una terminal interactiva. Para scripts utiliza init y project-create --name <nombre>."}}
  ```
- **Pregunta de Sincronización PostgreSQL:**
  ```text
  ¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
  No
  Sí, configurar PostgreSQL
  Elige [si/NO]:
  ```
  - Acepta exactamente `No` (o vacío/Enter) para conservar el uso exclusivamente local.
  - Acepta `si`, `sí`, `s`, `yes`, `y` para habilitar PostgreSQL.
- **Entrada Oculta de URL:**
  Si eliges configurar PostgreSQL, la terminal solicita la URL en modo confidencial:
  `URL PostgreSQL (entrada oculta): [oculto]`
  Las pulsaciones del teclado y el texto pegado no se imprimen en pantalla para proteger contraseñas.
- **Advertencia de Alcance Completo:**
  Advierte que se replicará todo el espacio (todos los proyectos, recuerdos compartidos, versiones, peticiones y eventos).
- **Confirmación Final:**
  ```text
  ¿Confirmar? [si/NO]:
  ```
- **Cancelación:** Si respondes `no`, `n`, presionas Enter (respuesta vacía), escribes `q`, `cancelar`, pulsas `Ctrl+C` o envías fin de archivo (EOF / `Ctrl+D`), la ejecución se cancela con **código de salida 130**. En un entorno limpio, no se crea la carpeta ni archivos.
- **Sin Gestión de Proyectos:** `setup` **no pregunta, no lista, no crea ni selecciona ningún proyecto**.
- **Sin Transmisión Inmediata:** Configurar PostgreSQL no envía recuerdos automáticamente en ese instante; te instruye a iniciar la sincronización con `sync` o `sync-watch`.
- **Salida estándar:** Texto plano legible para personas.

---

### 2.4. `init`
Inicializa silenciosamente el espacio de almacenamiento central del usuario (`~/.forge614/`), creando el archivo `.env` (modo `0600`) y la base de datos `engram.db` (modo `0600`).

```bash
forge614-engram init
```
- **Opciones:** No requiere opciones.
- **Uso ideal:** Scripts, integración continua (CI/CD) o entornos automatizados sin terminal interactiva.
- **Comportamiento:** Operación idempotente. Si la configuración y la base ya existen y son válidas, confirma el estado sin reiniciar ni alterar tus datos.
- **Salida estándar (JSON):**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

---

### 2.5. `sync`
Ejecuta una única ronda completa de sincronización entre el almacenamiento SQLite local y la base de datos PostgreSQL configurada.

```bash
forge614-engram sync
```
- **Opciones:** No acepta opciones.
- **Requisitos:** Requiere que la sincronización con PostgreSQL haya sido habilitada previamente mediante `setup` (el archivo `~/.forge614/.env` debe tener `FORMAT_VERSION="3"` y `POSTGRES_URL`). Si la sincronización está desactivada, termina con código de salida 1 y emite el error `SYNC_DISABLED`:
  ```json
  {"error":{"code":"SYNC_DISABLED","message":"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."}}
  ```
- **Comportamiento:**
  - Descarga la última fotografía de PostgreSQL y extrae la fotografía local de SQLite.
  - Ejecuta una conciliación de tres vías (*3-way merge*) comparando con el último punto de control acordado.
  - Si hay novedades locales, las publica en PostgreSQL mediante bloqueo CAS atómico (`FOR UPDATE`).
  - Si hay novedades remotas, las aplica atómicamente en SQLite y actualiza el índice FTS5.
  - Si detecta cambios incompatibles sobre la misma entidad, aborta la ronda con `SYNC_CONFLICT` sin modificar ninguna base.
  - Si la fotografía excede los 8 MiB, aborta con `SYNC_TOO_LARGE`.
- **Salida estándar (JSON):**
```json
{
  "synchronized": true,
  "projects": 1,
  "memories": 2
}
```

---

### 2.6. `sync-watch`
Inicia una ronda de sincronización inmediata y continúa ejecutando reintentos periódicos en primer plano mientras el comando permanezca abierto en la terminal.

```bash
forge614-engram sync-watch [--interval <1..3600>]
```
- **Opciones:**
  - `--interval <segundos>` (Opcional): Tiempo de espera en segundos entre rondas de sincronización. Valor por defecto: `30`. Rango admitido: `1` a `3600`.
- **Comportamiento:**
  - Proceso interactivo en primer plano. **No instala demonios en segundo plano**, agentes del sistema operativo ni tareas programadas de cron.
  - En cada ronda exitosa emite el resultado JSON a `stdout`:
    ```json
    {"synchronized":true,"projects":1,"memories":2}
    ```
  - Si la conexión a PostgreSQL falla o la red se interrumpe, emite un aviso controlado a `stderr` y espera pacientemente al siguiente ciclo:
    ```json
    {"code":"POSTGRES_UNAVAILABLE","error":"Sincronización pendiente; los datos locales se conservan."}
    ```
  - **Resiliencia fuera de línea:** Las operaciones locales de lectura y escritura (`save`, `get`, `search`, etc.) no esperan ni dependen de `sync-watch`. Puedes seguir trabajando con normalidad.
  - **Cancelación:** Termina con `Ctrl+C` (código de salida `130`).

---

## 3. Catálogo de Comandos de Proyectos

---

### 3.1. `project-create`
Registra un nuevo proyecto en la tabla `projects` de la base de datos central.

```bash
forge614-engram project-create --name <nombre>
```
- **Opciones:**
  - `--name <nombre>` (**Obligatoria**): Nombre visible y legible del proyecto. Se eliminan espacios en los extremos y no puede estar vacío.
- **Comportamiento:** Si el espacio de almacenamiento aún no está inicializado, `project-create` inicializa la base y la configuración automáticamente. Genera un nuevo `projectId` (UUIDv4 en minúsculas).
- **Ejemplo:**
```bash
forge614-engram project-create --name "Mi aplicación"
```
- **Salida estándar (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Mi aplicación",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:00:00.000Z"
}
```

---

### 3.2. `project-list`
Lista todos los proyectos registrados en la base de datos central.

```bash
forge614-engram project-list
```
- **Opciones:** Ninguna.
- **Comportamiento:** Si el espacio aún no ha sido inicializado, devuelve `[]` sin crear archivos. Si la base existe, devuelve la lista ordenada alfabéticamente por nombre.
- **Salida estándar (JSON):**
```json
[
  {
    "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "Mi aplicación",
    "createdAt": "2026-09-16T20:00:00.000Z",
    "updatedAt": "2026-09-16T20:00:00.000Z"
  }
]
```

---

### 3.3. `project-rename`
Actualiza el nombre visible de un proyecto registrado.

```bash
forge614-engram project-rename --project-id <UUID> --name <nuevo-nombre>
```
- **Opciones:**
  - `--project-id <UUID>` (**Obligatoria**): Identificador UUID del proyecto.
  - `--name <nombre>` (**Obligatoria**): Nuevo nombre visible.
- **Comportamiento:** Actualiza el registro en la tabla `projects` manteniendo intacto el `projectId` y todos sus recuerdos asociados.
- **Salida estándar (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Nuevo Nombre",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:05:00.000Z"
}
```

---

## 4. Catálogo de Comandos de Recuerdos

---

### 4.1. `save`
Guarda un nuevo recuerdo o actualiza la versión de un recuerdo temático existente.

```bash
# Para recuerdo propio de un proyecto (scope project por defecto):
forge614-engram save --project-id <UUID> --title <título> --content <texto> [opciones...]

# Para preferencia compartida universal (scope shared):
forge614-engram save --scope shared --title <título> --content <texto> [opciones...]
```

- **Opciones obligatorias de alcance (mutuamente excluyentes):**
  - `--project-id <UUID>`: Identificador del proyecto. Establece `scope: "project"` por defecto.
  - `--scope shared`: Guarda en el espacio compartido universal (no admite `--project-id`).
- **Opciones obligatorias de contenido:**
  - `--title <título>`: Título breve y descriptivo de la nota.
  - `--content <texto>`: Cuerpo del recuerdo.
- **Opciones complementarias:**
  - `--type <fact|decision|procedure|warning|preference>`: Tipo de nota (por defecto `fact`).
  - `--topic <tema>`: Clave temática para control de versiones y excepciones.
  - `--expected-version <número>`: Exigido al actualizar un tema existente (control optimista).
  - `--request-key <clave>`: Identificador único de petición para prevenir duplicados (idempotencia).
  - `--pinned <true|false>`: Fija la nota para otorgarle máxima prioridad en las búsquedas (por defecto `false`).
- **Salida estándar (JSON):**
```json
{
  "id": "a3b1c2d3-e4f5-4678-8901-abcdef012345",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usaremos SQLite localmente",
  "pinned": false,
  "version": 1,
  "state": "active",
  "createdAt": "2026-09-16T20:01:00.000Z",
  "updatedAt": "2026-09-16T20:01:00.000Z"
}
```

---

### 4.2. `search`
Ejecuta una búsqueda de texto completo explicable mediante el motor SQLite FTS5.

```bash
# Búsqueda desde un proyecto (por defecto --scope all):
forge614-engram search --project-id <UUID> --query <texto> [--limit <1..100>] [--scope all|project|shared]

# Búsqueda exclusiva en recuerdos compartidos:
forge614-engram search --scope shared --query <texto> [--limit <1..100>]
```

- **Opciones:**
  - `--query <texto>` (**Obligatoria**): Palabras de búsqueda. Se requiere que todas las palabras coincidan (*AND* lógico).
  - `--limit <1..100>` (Opcional): Número máximo de resultados (por defecto `10`).
  - `--scope all|project|shared` (Opcional con proyecto):
    - `all` (**Predeterminado al pasar `--project-id`**): Devuelve recuerdos del proyecto y recuerdos compartidos universales, aplicando la sustitución de temas (*topic overrides*).
    - `project`: Restringe la búsqueda exclusivamente a notas privadas del proyecto.
    - `shared`: Restringe la búsqueda exclusivamente a notas compartidas universales.
- **Salida estándar (JSON):** Devuelve un arreglo de objetos con la nota (`memory`) y su desglose matemático de relevancia (`explanation`: `mode`, `bm25`, `multiplier`, `orderScore`).

---

### 4.3. `get`
Recupera la ficha completa de un recuerdo activo o archivado por su ID.

```bash
forge614-engram get --id <recuerdo-id> [--project-id <UUID> | --scope shared]
```

---

### 4.4. `history`
Devuelve el historial cronológico inmutable de fotos (*snapshots*) de un recuerdo por su ID.

```bash
forge614-engram history --id <recuerdo-id> [--project-id <UUID> | --scope shared]
```

---

### 4.5. `archive`
Oculta un recuerdo de las búsquedas habituales sin borrar sus versiones ni su trazabilidad histórica.

```bash
# Archivar recuerdo de proyecto:
forge614-engram archive --project-id <UUID> --id <recuerdo-id>

# Archivar recuerdo compartido:
forge614-engram archive --scope shared --id <recuerdo-id>
```

---

### 4.6. `restore`
Reactiva un recuerdo previamente archivado, devolviéndolo a las búsquedas habituales.

```bash
# Restaurar recuerdo de proyecto:
forge614-engram restore --project-id <UUID> --id <recuerdo-id>

# Restaurar recuerdo compartido:
forge614-engram restore --scope shared --id <recuerdo-id>
```
