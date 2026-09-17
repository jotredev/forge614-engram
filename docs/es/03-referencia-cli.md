# 03. Manual Exhaustivo de Terminal (CLI)

> **Etapa:** Etapa 1 — Memoria Local (Una Sola Base y Recuerdos Compartidos)
> **Versiones de esta entrega:** Programa 0.2.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Activo
> **Traducción hermana:** [03 (EN). Terminal CLI Command Reference](../en/03-cli-reference.md)

Esta guía documenta exhaustivamente todos los comandos, opciones, reglas de sintaxis y formatos de respuesta JSON de la interfaz de línea de comandos (CLI) de Forge614 Engram.

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
   - **Éxito:** La respuesta se emite en formato **JSON estructurado** a través del canal estándar (`stdout`) con código de salida `0`.
   - **Error:** La descripción del fallo se emite en formato JSON a través del canal de errores (`stderr`) con código de salida `1`.
6. **Banderas eliminadas que NO se admiten:**
   - `--db`: No se admite. La base de datos es fija: `~/.forge614/engram.db`.
   - `--project` (por nombre): No se admite. El identificador es estrictamente `--project-id <UUID>`.
   - `--id-project`: No se admite. El parámetro oficial es `--project-id`.

---

## 2. Catálogo de Comandos de Espacio y Proyecto

---

### 2.1. `--version`
Muestra el nombre del programa y la versión actual instalada.

```bash
forge614-engram --version
```
- **Salida:** `forge614-engram 0.2.0`
- **Opciones:** No acepta ninguna opción adicional.
- **Efectos secundarios:** Ninguno. No lee ni crea archivos en disco.

---

### 2.2. `help`
Imprime el manual de referencia rápida en la terminal.

```bash
forge614-engram help
```
- **Opciones:** No acepta opciones adicionales.
- **Efectos secundarios:** Ninguno. No interactúa con el disco.

---

### 2.3. `init`
Inicializa el espacio de almacenamiento central del usuario (`~/.forge614/`) creando el archivo de configuración global `.env` (modo `0600`) y la base de datos SQLite `engram.db` (modo `0600`).

```bash
forge614-engram init
```
- **Opciones:** No requiere opciones.
- **Comportamiento:** Es una operación idempotente (repetible sin riesgo). Si la configuración y la base ya existen y son válidas, confirma el estado sin reiniciar ni alterar tus datos.
- **Salida estándar (JSON):**
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

---

### 2.4. `project-create`
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

### 2.5. `project-list`
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

### 2.6. `project-rename`
Actualiza el nombre visual de un proyecto existente.

```bash
forge614-engram project-rename --project-id <UUID> --name <nuevo-nombre>
```
- **Opciones:**
  - `--project-id <UUID>` (**Obligatoria**): Identificador UUID del proyecto.
  - `--name <nuevo-nombre>` (**Obligatoria**): Nuevo nombre visible no vacío.
- **Comportamiento:** Modifica únicamente la columna `name` y actualiza `updatedAt`. El `projectId`, los recuerdos asociados, las versiones y las claves de petición permanecen inalterados.
- **Salida estándar (JSON):**
```json
{
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Mi aplicación renombrada",
  "createdAt": "2026-09-16T20:00:00.000Z",
  "updatedAt": "2026-09-16T20:30:00.000Z"
}
```

---

## 3. Catálogo de Comandos de Recuerdos

---

### 3.1. `save`
Guarda un nuevo recuerdo o crea una nueva versión de un tema existente.

#### Reglas de Alcance en `save`:
- **Para un recuerdo de proyecto:** Especifica `--project-id <UUID>` (toma el alcance `project` por defecto).
- **Para un recuerdo compartido:** Especifica `--scope shared` (prohíbe el uso de `--project-id`).

#### Opciones de `save`:
| Opción | Obligatoria | Valor por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `--title <título>` | **Sí** | *(Ninguno)* | Título breve y descriptivo de la nota. |
| `--content <texto>` | **Sí** | *(Ninguno)* | Texto completo o contenido detallado del recuerdo. |
| `--type <tipo>` | No | `fact` | Categoría conceptual: `fact`, `decision`, `procedure`, `warning`, `preference`. |
| `--topic <tema>` | No | `null` | Clave de clasificación temática para control de versiones (ej. `architecture/database`). Sensible a mayúsculas. |
| `--expected-version <n>` | Condicional | `null` | Entero positivo ($\ge 1$). **Obligatorio si el tema ya existía** en ese alcance. Debe ser igual a la versión actual. |
| `--request-key <clave>` | No | `null` | Clave de envío para idempotencia. Reenviar el mismo contenido con la misma clave devuelve el registro existente sin escribir duplicados. |
| `--pinned <true\|false>` | No | `false` | Marca la nota como prioritaria en las búsquedas (añade bonificación en la fórmula de ordenamiento). |

#### Ejemplo A: Guardar un recuerdo de proyecto
```bash
forge614-engram save --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --title "Base de datos" --content "Usaremos SQLite" --type decision --topic architecture/database
```

#### Ejemplo B: Guardar un recuerdo compartido universal
```bash
forge614-engram save --scope shared --title "Idioma preferido" --content "Prefiero explicaciones en español" --type preference --topic preferences/language
```

---

### 3.2. `search`
Busca recuerdos activos mediante coincidencia de texto explicable (SQLite FTS5 trigram o modo literal).

#### Sintaxis de Selección de Alcance:
- **Desde un proyecto:** `--project-id <UUID> [--scope all|project|shared]`
  - `all` (**Predeterminado**): Devuelve recuerdos relevantes del proyecto **más** recuerdos compartidos relevantes (aplicando la regla de sustitución por tema si el proyecto tiene una excepción activa).
  - `project`: Limita la búsqueda únicamente a los recuerdos del proyecto.
  - `shared`: Devuelve únicamente recuerdos compartidos.
- **Búsqueda compartida pura:** `--scope shared` (sin `--project-id`).
  - *(Nota: Sin `--project-id`, la CLI **exige obligatoriamente** `--scope shared`. No existe una búsqueda universal descontrolada a través de todos los proyectos de la base).*

#### Opciones de `search`:
| Opción | Obligatoria | Valor por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `--query <texto>` | **Sí** | *(Ninguno)* | Términos de búsqueda. Todas las palabras deben coincidir. |
| `--limit <1..100>` | No | `10` | Cantidad máxima de resultados a devolver. |

#### Ejemplo: Búsqueda combinada en un proyecto
```bash
forge614-engram search --project-id 7c9e6679-7425-40de-944b-e07fc1f90ae7 --query "SQLite" --limit 5
```

**Salida estándar (JSON):**
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Base de datos",
      "content": "Usaremos SQLite",
      "pinned": false,
      "version": 1,
      "state": "active",
      "createdAt": "2026-09-16T20:11:00.000Z",
      "updatedAt": "2026-09-16T20:11:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.059999,
      "orderScore": -0.000001059999
    }
  }
]
```

---

### 3.3. `get`
Recupera un recuerdo individual por su identificador UUID.

```bash
# Recuerdo de proyecto:
forge614-engram get --project-id <UUID> --id <UUID-recuerdo>

# Recuerdo compartido:
forge614-engram get --scope shared --id <UUID-recuerdo>
```
- Devuelve la ficha completa del recuerdo en JSON. Si no existe en el alcance especificado, devuelve el error `NOT_FOUND`.

---

### 3.4. `history`
Consulta el historial cronológico inmutable de todas las revisiones guardadas para un recuerdo.

```bash
# Para proyecto:
forge614-engram history --project-id <UUID> --id <UUID-recuerdo>

# Para compartido:
forge614-engram history --scope shared --id <UUID-recuerdo>
```
- Devuelve un arreglo JSON con cada fotografía histórica (*snapshot*) desde la versión 1 hasta la actual.

---

### 3.5. `archive`
Retira un recuerdo de las búsquedas activas sin borrar sus datos ni su historia.

```bash
# Para proyecto:
forge614-engram archive --project-id <UUID> --id <UUID-recuerdo>

# Para compartido:
forge614-engram archive --scope shared --id <UUID-recuerdo>
```
- Actualiza el campo `state` a `"archived"` y registra un evento de auditoría en la tabla `events`.

---

### 3.6. `restore`
Reactiva un recuerdo previamente archivado, volviéndolo elegible para las búsquedas.

```bash
# Para proyecto:
forge614-engram restore --project-id <UUID> --id <UUID-recuerdo>

# Para compartido:
forge614-engram restore --scope shared --id <UUID-recuerdo>
```
- Actualiza el campo `state` a `"active"` y registra un evento de auditoría en la tabla `events`.
