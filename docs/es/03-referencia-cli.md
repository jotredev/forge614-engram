# 03. Referencia de Comandos de Terminal (CLI)

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [03 (EN). Terminal CLI Command Reference](../en/03-cli-reference.md)

Esta guía documenta exhaustivamente la interfaz de línea de comandos (CLI) de Forge614 Engram.

---

## 1. Reglas Generales de Uso de la Terminal

1. **Orden estricto:** El comando debe escribirse inmediatamente después del nombre del ejecutable:
   ```bash
   forge614-engram <comando> [opciones...]
   # o en desarrollo dentro del repositorio:
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
| `--db <ruta>` | No | `~/.forge614/engram.db` | Ruta al archivo de base de datos SQLite. Por defecto usa la base compartida en la carpeta del usuario. Si la base no existe, se crea automáticamente al ejecutar una operación válida. |

---

## 3. Catálogo de Comandos

---

### 3.1. `--version`
Muestra el nombre del paquete y la versión actual instalada.

```bash
forge614-engram --version
```
- **Salida:** `forge614-engram 0.1.0`
- **Opciones:** No acepta opciones adicionales.
- **Efecto secundario:** Ninguno. No abre ni crea la base de datos.

---

### 3.2. `help`
Muestra la lista rápida de comandos y opciones en pantalla.

```bash
forge614-engram help
```
- **Opciones:** No acepta ninguna opción adicional (ej. `forge614-engram help --project demo` causará un error).
- **Efecto secundario:** Ninguno. No crea archivos ni carpetas en el disco.

---

### 3.3. `save`
Crea una nueva memoria o guarda una nueva revisión de un tema existente.

> [!NOTE]
> `save` es una operación manual en esta etapa. La integración automática con asistentes de código mediante MCP está planificada para la Etapa 2.

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
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite localmente" --type decision --topic architecture/database --request-key demo-v1
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
forge614-engram save --project demo --title "Base de datos" --content "Usamos SQLite y conservamos revisiones" --type decision --topic architecture/database --expected-version 1 --request-key demo-v2
```

> [!WARNING]
> **Conserva tipo y prioridad al actualizar:** El comando `save` reemplaza el contenido completo. Si en la versión 1 especificaste `--type decision` y `--pinned true`, y al guardar la versión 2 omites esas banderas, la versión 2 tomará los valores predeterminados (`fact` y `false`). Especifica siempre los valores deseados al actualizar.

---

### 3.4. `search`
Busca recuerdos activos dentro del proyecto indicado.

#### Opciones específicas de `search`:
| Opción | Obligatoria | Valor predeterminado | Descripción |
| :--- | :--- | :--- | :--- |
| `--query <texto>` | **Sí** | *(Ninguno)* | Palabras a buscar. Todas las palabras deben coincidir. |
| `--limit <n>` | No | `10` | Límite de resultados a devolver. Entero entre `1` y `100`. |

#### Ejemplo de búsqueda:
```bash
forge614-engram search --project demo --query SQLite --limit 5
```

---

### 3.5. `get`
Recupera la ficha vigente de un recuerdo específico mediante su identificador.

```bash
forge614-engram get --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.6. `history`
Devuelve la lista cronológica ascendente (versión 1, versión 2, etc.) de todas las fotos de contenido guardadas para ese recuerdo.

```bash
forge614-engram history --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
```

---

### 3.7. `archive` y `restore`
- `archive`: Oculta el recuerdo de las búsquedas normales sin destruir sus versiones.
  ```bash
  forge614-engram archive --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
  ```
- `restore`: Reactiva un recuerdo previamente archivado haciéndolo visible de nuevo en las búsquedas.
  ```bash
  forge614-engram restore --project demo --id 5617e6cd-7072-48cc-a922-1a4b269e73be
  ```
