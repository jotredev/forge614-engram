# 05. Arquitectura Interna, Protocolo MCP, SQLite FTS5 y Fórmulas Matemáticas

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Verificado (191 pruebas totales en macOS con Bun 1.3.8)
> **Traducción hermana:** [05 (EN). Internal Architecture, MCP Protocol, FTS5, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento expone con rigor de tesis técnica la arquitectura interna de Forge614 Engram: parámetros del motor SQLite, esquemas relacionales locales v3, v4 y v5 (`project_bindings`), motor de resolución canónica Git para proyectos y entornos de trabajo vinculados (*linked worktrees*), arquitectura del servidor MCP nativo por stdio, adaptadores de configuración con respaldo atómico (`0600`/UUID) y verificación posterior, protocolo de réplica de tres vías (*3-way merge*) con PostgreSQL y el desglose matemático exhaustivo del algoritmo **BM25**, recencia y ordenamiento explicable.

---

## 1. Parámetros del Motor SQLite (Pragmas), Concurrencia e Inicialización WAL

Forge614 Engram opera sobre el motor nativo de SQLite integrado en Bun (`bun:sqlite`), inicializado con directivas estrictas:

1. **`PRAGMA foreign_keys = ON;`**
   Garantiza la integridad referencial en todo momento. Por ejemplo, una fila en `memory_versions` no puede existir si no apunta a un `id` existente en `memories`, y un recuerdo o una asociación de proyecto en `project_bindings` no puede existir si no apunta a un `projectId` válido en la tabla `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   Si dos procesos intentan escribir concurrentemente en la base, SQLite no fallará de inmediato: **esperará hasta 5,000 milisegundos (5 segundos)** a que la transacción en curso termine antes de emitir un error de concurrencia.
3. **`PRAGMA application_id = 1177956660;`**
   Número identificador exclusivo de Forge614 Engram. Se comprueba antes de abrir cualquier archivo para asegurar que no se manipulen bases ajenas ni corruptas.
4. **`PRAGMA user_version = 3`, `4` o `5`;**
   - **Versión 3:** Almacenamiento local puro sin sincronización ni asociaciones.
   - **Versión 4:** Almacenamiento con sincronización PostgreSQL habilitada (añade tabla `sync_checkpoints`).
   - **Versión 5:** Almacenamiento con soporte de asistentes y asociaciones locales (añade tabla `project_bindings` e índice).
   - **Regla de apertura:** Una apertura normal de SQLite (`workspace.open()`) **jamás migra la base de datos automáticamente**. Las migraciones a los esquemas 4 y 5 son explícitas y aditivas (mediante `setup`, `tui` o `integration-enable`). No se admite *downgrade*.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Los lectores leen del archivo principal mientras las escrituras se añaden a un diario auxiliar rápido (`engram.db-wal`).
   - Los lectores no bloquean a los escritores y los escritores no bloquean a los lectores.
   - Las escrituras continúan serializadas (un único proceso escribe a la vez).

### Ajuste de Inicialización WAL (Transacción Inmediata Vacía)
Al inicializar una base de datos nueva:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
Fuerza la sincronización física de cabeceras en `engram.db-wal` y `engram.db-shm` para permitir lecturas en frío de solo lectura bajo macOS.

---

## 2. Esquema Relacional Local en SQLite (Esquemas 3, 4 y 5)

```text
┌─────────────────────────────────┐
│            projects             │
│ (Identidad global del proyecto) │
├─────────────────────────────────┤
│ projectId TEXT (PK UUIDv4)      │◄──┐
│ name TEXT (No vacío)            │   │
│ createdAt / updatedAt           │   │
└─────────────────────────────────┘   │
                 ▲                    │
                 │ Clave foránea      │
┌────────────────┴────────────────┐   │   ┌─────────────────────────────────┐
│            memories             │   │   │         memory_versions         │
├─────────────────────────────────┤   │   ├─────────────────────────────────┤
│ rowid INTEGER (PK interno)      │   │   │ memory_id TEXT (FK memories.id) │◄──┐
│ id TEXT (UUID único)            │◄──┼───┤ version INTEGER (>= 1)          │   │
│ projectId TEXT (FK nullable)    ├───┘   │ snapshot TEXT (JSON válido)     │   │
│ scope TEXT ('project'|'shared') │       └─────────────────────────────────┘   │
│ topic_key TEXT (Opcional)       │                         ▲                   │
│ type TEXT (Categoría)           │                         │                   │
│ title / content TEXT            │       ┌─────────────────┴───────────────┐   │
│ pinned INTEGER (0 o 1)          │       │            requests             │   │
│ version INTEGER (>= 1)          │       ├─────────────────────────────────┤   │
│ state ('active'|'archived')     │       │ projectId TEXT (FK nullable)    ├───┤
│ created_at / updated_at         │       │ scope TEXT ('project'|'shared') │   │
└─────────────────────────────────┘       │ request_key TEXT (No vacío)     │   │
                 ▲                        │ payload_hash TEXT (SHA-256)     │   │
                 │                        │ memory_id, version (FK) ────────┼───┘
┌────────────────┴────────────────┐       └─────────────────────────────────┘
│             events              │
├─────────────────────────────────┤       ┌─────────────────────────────────┐
│ id INTEGER (PK autoincrement)   │       │          memories_fts           │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ memory_id TEXT (FK memories.id) │       │ Tabla Virtual FTS5 (trigram)    │
│ action ('save'|'archive'|'rest')│       │ title (5.0), topic_key (3.0),   │
│ version INTEGER                 │       │ content (1.0)                   │
│ created_at TIMESTAMP            │       └─────────────────────────────────┘
└─────────────────────────────────┘
                 ▲
                 │ (Exclusivo Esquema 4 - Additive Migration)
┌────────────────┴────────────────┐
│        sync_checkpoints         │
├─────────────────────────────────┤
│ replica TEXT PRIMARY KEY        │
│ snapshot TEXT (JSON válido)     │
└─────────────────────────────────┘
                 ▲
                 │ (Exclusivo Esquema 5 - Additive Migration)
┌────────────────┴────────────────┐
│        project_bindings         │
├─────────────────────────────────┤
│ directory TEXT PRIMARY KEY      │  (Ruta local canónica del disco)
│ projectId TEXT REFERENCES proj  ├───► projects.projectId
│ createdAt TEXT NOT NULL         │
└─────────────────────────────────┘
  CREATE INDEX project_bindings_project ON project_bindings(projectId);
```

### Tabla `project_bindings` (Esquema 5):
Permite asociar una carpeta local de este equipo a un `projectId`:
- `directory`: Ruta absoluta y canónica del directorio en el sistema de archivos local (`PRIMARY KEY`).
- `projectId`: Identificador UUID del proyecto referenciado (`REFERENCES projects(projectId)`).
- `createdAt`: Fecha de creación en formato ISO 8601.
- Índice secundario: `CREATE INDEX project_bindings_project ON project_bindings(projectId);` para optimizar consultas inversas.

---

## 3. Resolución Canónica de Proyectos y Git

Para resolver a qué proyecto pertenece una carpeta cuando un asistente invoca una herramienta MCP o cuando se ejecuta `project-bind`:

1. **Resolución de la Raíz Común de Git (*Git Common Directory*):**
   Engram ejecuta:
   ```bash
   git rev-parse --path-format=absolute --git-common-dir
   ```
   - **Ramas vinculadas (*linked worktrees*):** Si trabajas en un worktree creado con `git worktree add`, la salida de `--git-common-dir` apunta a la carpeta `.git` del repositorio principal. Por lo tanto, todas las ramas y copias de trabajo del repositorio comparten la misma identidad canónica de proyecto y los mismos recuerdos.
   - **Subcarpetas anidadas:** Cualquier carpeta dentro del árbol del repositorio se resuelve automáticamente a la raíz canónica.
2. **Carpetas sin Git:**
   Si una carpeta no pertenece a un repositorio Git, Engram exige indicar el parámetro `directory` de forma explícita o disponer de una única raíz MCP. **Jamás se utiliza la carpeta del ejecutable binario como proyecto implícito**.
3. **Dependencia estricta de Git:**
   Git es obligatorio incluso para comprobar que una carpeta no pertenece a Git. Si Git no está instalado o no se encuentra en el PATH, la resolución falla cerrada arrojando `PROJECT_IDENTITY_UNAVAILABLE`.
4. **Bloqueo Conservador ante Carpetas Desconocidas:**
   Antes de crear automáticamente un nuevo proyecto para una carpeta no vinculada:
   - Se revisan las rutas registradas en `project_bindings`.
   - Si **todas las rutas de algún proyecto registrado se encuentran ausentes del disco**, Engram arroja inmediatamente `PROJECT_BINDING_REQUIRED`.
   - Esto previene crear proyectos duplicados u huérfanos cuando un usuario movió una carpeta o cuando un disco externo no está montado.
   - **Solución:** Vincular explícitamente la carpeta con `project-bind --directory /ruta --project-id <UUID>` obtenido de `project-list`.
5. **Aislamiento de Rutas Locales en Sincronización:**
   Las instantáneas de sincronización (`sync`) replican proyectos, recuerdos, versiones, peticiones y eventos, **pero jamás sincronizan las rutas del sistema de archivos local (`project_bindings`)**, ya que las rutas de disco son exclusivas de cada máquina.

---

## 4. Arquitectura del Servidor MCP Local por stdio

El comando `forge614-engram mcp` implementa el protocolo oficial **Model Context Protocol** a través de canales estándar (`stdio`):

```text
┌────────────────────────────────────────────────────────┐
│                   Cliente de IA                        │
│   (Claude Code / Codex / Cursor / OpenCode / Gemini)   │
└──────────────────────────┬─────────────────────────────┘
                           │ JSON-RPC vía stdio
                           ▼
┌────────────────────────────────────────────────────────┐
│             forge614-engram mcp (Server)               │
│                                                        │
│  - Instructions: MEMORY_PROTOCOL                       │
│  - Transport: StdioServerTransport (256 KB buffer)     │
│  - Stdout: 100% reservado para tramas JSON-RPC         │
│  - Stderr: No emite logs humanos ni escapes ANSI       │
├────────────────────────────────────────────────────────┤
│                     5 Herramientas                     │
│ 1. memory_current_project(directory?)                  │
│ 2. memory_search(query, directory?, limit?, scope?)    │
│ 3. memory_get(id, directory?, scope?)                  │
│ 4. memory_save(title, content, type, directory?, ...)  │
│ 5. memory_history(id, directory?, scope?)              │
└──────────────────────────┬─────────────────────────────┘
                           │ Operaciones síncronas
                           ▼
┌────────────────────────────────────────────────────────┐
│               SQLite Local (engram.db)                 │
│               FTS5 Trigram BM25 + Esquema 5            │
└────────────────────────────────────────────────────────┘
```

### Instrucciones del Protocolo (`MEMORY_PROTOCOL`)
El servidor transfiere al modelo las directrices de operación:
- Tratar Engram como memoria curada y duradera, **no como una transcripción de la conversación**.
- Al iniciar una tarea, tras compactar contexto o al reanudar trabajo, invocar primero `memory_current_project` y `memory_search` antes de repetir investigación.
- Guardar únicamente decisiones técnicas, correcciones de errores, advertencias y preferencias explícitas.
- **Nunca guardar contraseñas, secretos, credenciales, datos personales, transcripciones completas ni salidas crudas de herramientas.**
- El alcance predeterminado es `project`. El alcance `shared` requiere intención global explícita (`globalIntent`).
- Actualizar temas existentes con `expectedVersion` para prevenir sobreescrituras concurrentes.

---

## 5. Adaptadores de Configuración de Clientes y Respaldo Seguro

El comando `tui` automatiza la configuración de cinco asistentes de desarrollo:

| Cliente | Archivo de Configuración | Ganchos / Plugin |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` |
| **Codex** | `~/.codex/config.toml` | `~/.codex/hooks.json` |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` |
| **OpenCode** | `~/.config/opencode/opencode.json` (o `.jsonc`) | `plugins/forge614-engram.js` en fuente global activa |
| **Gemini CLI** | `~/.gemini/settings.json` | `hooks` dentro del mismo archivo |

### Protocolo de Escritura Segura:
1. **Preflight:** Comprueba que las rutas no sean enlaces simbólicos ajenos, valida permisos y verifica que los archivos no superen tamaños máximos permitidos.
2. **Copia de Respaldo Privada:** Antes de escribir, genera una copia de respaldo con los bytes exactos anteriores, permisos `0600` y sufijo UUID (ej. `mcp.json.3a8f...bak`).
3. **Preservación de Comentarios:** Utiliza `jsonc-parser` para archivos JSON/JSONC y `smol-toml` para archivos TOML, preservando comentarios y campos ajenos.
4. **Verificación Posterior (*Post-Publication Verification*):** Tras publicar, vuelve a leer el archivo y verifica que los bytes en disco coincidan exactamente con lo planificado. Si otro proceso modificó el archivo durante la operación, reporta `PUBLISHED_UNVERIFIED` («Publicado sin verificar»), conserva las copias de respaldo y no realiza marcha atrás destructiva.
5. **OpenCode Multi-fuente:** Si se define `OPENCODE_CONFIG_DIR`, Engram reconoce que añade una fuente adicional pero no reemplaza la fuente XDG global. Si existen configuraciones ambiguas, el menú requiere seleccionar el archivo explícitamente. Reutiliza el plugin global único en lugar de duplicarlo.

---

## 6. Cobertura de Eventos y Ganchos Nativos

| Cliente | Eventos con Guía de Contexto | Limitaciones Operativas |
| :--- | :--- | :--- |
| **Claude Code** | `SessionStart`, `UserPromptSubmit` | Sujeto a permisos y políticas del modelo. |
| **Codex** | `SessionStart`, `UserPromptSubmit` | **Requiere revisar y autorizar ganchos nuevos en Codex con `/hooks`**. |
| **Cursor** | `sessionStart` | Solo inicio de sesión; no dispone de gancho verificado de prompt o post-compactación. |
| **OpenCode** | `experimental.chat.system.transform`, `experimental.session.compacting` | Callbacks experimentales de plugin upstream. |
| **Gemini CLI** | `SessionStart`, `BeforeAgent` | No garantiza callback posterior a compactación de contexto. |

---

## 7. Fórmulas Matemáticas de Búsqueda y Ordenamiento Explicable

Toda búsqueda ejecuta el cálculo transparente de relevancia combinando **BM25**, prioridad y recencia:

$$\text{orderScore} = \text{bm25Score} \times \text{multiplier}$$

### 7.1. Algoritmo BM25
El puntaje de similitud textual viene dado por:

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- $k_1 = 1.2$: Saturación de frecuencia de términos.
- $b = 0.75$: Penalización por longitud del documento frente al promedio de la colección ($\text{avgdl}$).
- Pesos por columna en FTS5: `title: 5.0`, `topic_key: 3.0`, `content: 1.0`.

### 7.2. Multiplicador de Prioridad y Recencia
El multiplicador combina la fijación explícita del recuerdo y su frescura temporal:

$$\text{multiplier} = \text{priorityFactor} \times \text{recencyFactor}$$

1. **Factor de Prioridad:**
   - Si `pinned == 1`: $\text{priorityFactor} = 1.5$
   - Si `pinned == 0`: $\text{priorityFactor} = 1.0$
2. **Factor de Recencia (Decaimiento Exponencial Suave):**
   $$\text{recencyFactor} = 1.0 + 0.2 \cdot e^{-\lambda \cdot \Delta t}$$
   donde $\Delta t$ es la antigüedad en días y $\lambda = \frac{\ln(2)}{30} \approx 0.0231$ (vida media de 30 días). Un recuerdo recién creado recibe un factor de $1.20$, convergiendo asintóticamente a $1.00$ conforme transcurre el tiempo.
