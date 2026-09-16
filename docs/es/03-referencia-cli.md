# Referencia de Comandos de Terminal (CLI)

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/03-cli-reference.md)

Esta guía documenta exhaustivamente la interfaz de línea de comandos (CLI) de Forge614 Engram.

---

## 1. Reglas Generales de Uso de la Terminal

1. **Orden estricto:** El comando debe escribirse inmediatamente después de `cli`:
   ```bash
   bun run cli <comando> [opciones...]
   ```
2. **Formato de opciones:** Cada bandera (`--opcion`) debe ir separada por un espacio de su valor. No se admite la sintaxis `--opcion=valor`.
   - ✅ Correcto: `--project demo --limit 5`
   - ❌ Incorrecto: `--project=demo`, `--limit=5`
3. **Comillas obligatorias para textos con espacios:** Todo título, texto o ruta con espacios debe encerrarse entre comillas dobles (`"..."`).
4. **Sin opciones duplicadas ni desconocidas:** Si repites una opción (ej. `--title "A" --title "B"`) o pasas una opción inexistente, el programa termina con error de inmediato antes de abrir la base de datos.
5. **Canales de salida y códigos de estado:**
   - **Éxito:** La respuesta se emite en formato **JSON estructurado** a través del canal estándar (`stdout`) con código de salida `0`.
   - **Error:** La descripción del fallo se emite en formato JSON a través del canal de errores (`stderr`) con código de salida `1`.

---

## 2. Opciones Universales

Las siguientes opciones aplican a **todos los comandos de datos**:

| Opción | Obligatoria | Valor predeterminado | Descripción y Comportamiento |
| :--- | :--- | :--- | :--- |
| `--project <nombre>` | **Sí** | *(Ninguno)* | Nombre del proyecto. Se eliminan espacios en los extremos y se pasa automáticamente a minúsculas (`Mi Proyecto` $\rightarrow$ `mi proyecto`). |
| `--db <ruta>` | No | `.forge614/memory.sqlite` | Ruta al archivo de base de datos SQLite. Es relativa a la carpeta donde ejecutas el comando. Si la base no existe, se crea automáticamente. |

---

## 3. Catálogo de Comandos

---

### 3.1. `help`
Muestra la lista rápida de comandos y opciones en pantalla.

```bash
bun run cli help
```

- **Opciones:** No acepta ninguna opción adicional (ej. `bun run cli help --project demo` causará un error).
- **Efecto secundario:** Ninguno. No crea archivos ni carpetas en el disco.

---

### 3.2. `save`
Crea una nueva memoria o guarda una nueva revisión de un tema existente.

#### Opciones específicas de `save`:
| Opción | Obligatoria | Valor predeterminado | Descripción |
| :--- | :--- | :--- | :--- |
| `--title <título>` | **Sí** | *(Ninguno)* | Título o encabezado descriptivo. Se eliminan espacios en los extremos. |
| `--content <texto>` | **Sí** | *(Ninguno)* | Texto completo o cuerpo de la memoria. |
| `--type <tipo>` | No | `fact` | Categoría conceptual. Valores válidos: `fact`, `decision`, `procedure`, `warning`, `preference`. |
| `--topic <tema>` | No | `null` | Clave temática única para versionado (ej. `architecture/database`). Distingue mayúsculas y minúsculas. |
| `--expected-version <n>` | Condicional | `null` | Entero positivo ($\ge 1$). **Obligatorio si el `--topic` ya existía** en el proyecto. Debe coincidir con la versión actual en la base. |
| `--request-key <clave>` | No | `null` | Clave de envío para idempotencia. Si se reenvía el mismo contenido con la misma clave, devuelve la versión previa sin escribir. |
| `--pinned <true\|false>` | No | `false` | Bandera de prioridad. Acepta únicamente las palabras literales `true` o `false`. |

#### Ejemplo 1: Guardar una memoria inicial con tema y clave de petición
```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
```

**Salida estándar (JSON):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite localmente",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:19:51.746Z"
}
```

#### Ejemplo 2: Actualizar a la versión 2 indicando `--expected-version 1`
```bash
bun run cli save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

**Salida estándar (JSON):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```

> [!WARNING]
> **Conserva tipo y prioridad al actualizar:** El comando `save` reemplaza el contenido completo. Si en la versión 1 especificaste `--type decision` y `--pinned true`, y al guardar la versión 2 omites esas banderas, la versión 2 tomará los valores predeterminados (`fact` y `false`). Especifica siempre los valores deseados al actualizar.

---

### 3.3. `search`
Busca recuerdos activos dentro del proyecto indicado.

#### Opciones específicas de `search`:
| Opción | Obligatoria | Valor predeterminado | Descripción |
| :--- | :--- | :--- | :--- |
| `--query <texto>` | **Sí** | *(Ninguno)* | Palabras a buscar. Todas las palabras deben coincidir. |
| `--limit <n>` | No | `10` | Límite de resultados a devolver. Entero entre `1` y `100`. |

#### Ejemplo de búsqueda:
```bash
bun run cli search --project demo --query SQLite --limit 5
```

**Salida estándar (JSON):**
```json
[
  {
    "memory": {
      "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
      "project": "demo",
      "topicKey": "architecture/database",
      "type": "decision",
      "title": "Base de datos",
      "content": "Usamos SQLite y conservamos revisiones",
      "pinned": false,
      "version": 2,
      "state": "active",
      "createdAt": "2026-09-16T16:19:51.746Z",
      "updatedAt": "2026-09-16T16:20:31.248Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -0.000001,
      "multiplier": 1.0599996,
      "orderScore": -0.00000105999
    }
  }
]
```

---

### 3.4. `get`
Recupera la ficha vigente de un recuerdo específico mediante su identificador.

#### Opciones específicas de `get`:
| Opción | Obligatoria | Descripción |
| :--- | :--- | :--- |
| `--id <uuid>` | **Sí** | Identificador único del recuerdo (obtenido previamente al guardar o buscar). |

#### Ejemplo:
```bash
bun run cli get --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

**Salida estándar (JSON):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "state": "active",
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```

> [!NOTE]
> A diferencia de `search`, el comando `get` sí devuelve el recuerdo aunque se encuentre en estado `state: "archived"`. Si el identificador no existe en el proyecto, emite un error con código `NOT_FOUND` y salida `1`.

---

### 3.5. `history`
Devuelve la lista cronológica ascendente (versión 1, versión 2, etc.) de todas las fotos de contenido guardadas para ese recuerdo.

#### Opciones específicas de `history`:
| Opción | Obligatoria | Descripción |
| :--- | :--- | :--- |
| `--id <uuid>` | **Sí** | Identificador único del recuerdo. |

#### Ejemplo:
```bash
bun run cli history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

**Salida estándar (JSON):**
```json
[
  {
    "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
    "project": "demo",
    "topicKey": "architecture/database",
    "type": "decision",
    "title": "Base de datos",
    "content": "Usamos SQLite localmente",
    "pinned": false,
    "version": 1,
    "createdAt": "2026-09-16T16:19:51.746Z",
    "updatedAt": "2026-09-16T16:19:51.746Z"
  },
  {
    "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
    "project": "demo",
    "topicKey": "architecture/database",
    "type": "decision",
    "title": "Base de datos",
    "content": "Usamos SQLite y conservamos revisiones",
    "pinned": false,
    "version": 2,
    "createdAt": "2026-09-16T16:19:51.746Z",
    "updatedAt": "2026-09-16T16:20:31.248Z"
  }
]
```

---

### 3.6. `archive`
Oculta el recuerdo de las búsquedas activas sin destruir sus versiones.

#### Opciones específicas de `archive`:
| Opción | Obligatoria | Descripción |
| :--- | :--- | :--- |
| `--id <uuid>` | **Sí** | Identificador único del recuerdo a archivar. |

#### Ejemplo:
```bash
bun run cli archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

**Salida estándar (JSON):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "state": "archived",
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```

---

### 3.7. `restore`
Reactiva un recuerdo previamente archivado, haciéndolo visible de nuevo en las búsquedas.

#### Opciones específicas de `restore`:
| Opción | Obligatoria | Descripción |
| :--- | :--- | :--- |
| `--id <uuid>` | **Sí** | Identificador único del recuerdo a restaurar. |

#### Ejemplo:
```bash
bun run cli restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

**Salida estándar (JSON):**
```json
{
  "id": "5617e6cd-7072-48cc-a922-1a4b269e73be",
  "project": "demo",
  "topicKey": "architecture/database",
  "type": "decision",
  "title": "Base de datos",
  "content": "Usamos SQLite y conservamos revisiones",
  "pinned": false,
  "version": 2,
  "state": "active",
  "createdAt": "2026-09-16T16:19:51.746Z",
  "updatedAt": "2026-09-16T16:20:31.248Z"
}
```
