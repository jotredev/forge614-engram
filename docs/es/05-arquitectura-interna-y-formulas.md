# 05. Arquitectura Interna, Protocolo MCP, SQLite FTS5 y Fórmulas Matemáticas

> **Etapa:** Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Activo (Verificado con 250 pruebas en 18 archivos en macOS con Bun 1.3.8)
> **Traducción hermana:** [05 (EN). Internal Architecture, MCP Protocol, FTS5, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento expone con rigor de tesis técnica la arquitectura interna de Forge614 Engram: parámetros del motor SQLite, esquemas relacionales v3 a v6, ciclo de vida y asociación de sesiones progresivas, resolución canónica de proyectos por Git, servidor MCP con 10 herramientas, sincronización de réplica con promoción CAS a Formato 2 en PostgreSQL y las fórmulas matemáticas de BM25, recencia y presupuesto estricto de bytes.

---

## 1. Parámetros del Motor SQLite (Pragmas), Concurrencia e Inicialización WAL

Forge614 Engram opera sobre el motor nativo de SQLite integrado en Bun (`bun:sqlite`), inicializado con directivas estrictas:

1. **`PRAGMA foreign_keys = ON;`**
   Garantiza integridad referencial absoluta. Las versiones históricas, eventos, sesiones, vinculaciones y resúmenes exigen claves foráneas válidas.
2. **`PRAGMA busy_timeout = 5000;`**
   Si dos procesos intentan escribir concurrentemente en la base, SQLite **espera hasta 5,000 milisegundos (5 segundos)** a que la transacción en curso concluya antes de emitir un fallo de concurrencia.
3. **`PRAGMA application_id = 1177956660;`**
   Identificador exclusivo de Forge614 Engram verificado antes de interactuar con cualquier base de datos.
4. **`PRAGMA user_version = 3`, `4`, `5` o `6`;**
   - **Versión 3:** Almacenamiento local puro sin sincronización ni asociaciones.
   - **Versión 4:** Almacenamiento con réplica PostgreSQL habilitada (añade `sync_checkpoints`).
   - **Versión 5:** Almacenamiento con integración de asistentes y asociaciones de carpetas (añade `project_bindings`).
   - **Versión 6:** Almacenamiento con sesiones progresivas, resúmenes y contexto clasificado (añade `sessions`, `session_entries`, `session_summaries`, `local_session_bindings`, `local_manual_sessions`).
   - **Regla de oro de apertura:** Una apertura normal de SQLite (`workspace.open()`), comandos habituales de recuerdos o el servidor MCP **jamás auto-migran la base de datos**. Las promociones de esquema son estrictamente explícitas y aditivas (`setup`, `tui`, `integration-enable`, `sessions-enable`).
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - Los lectores no bloquean a los escritores y los escritores no bloquean a los lectores.
   - Lecturas en frío de solo lectura bajo macOS son garantizadas mediante una transacción inmediata inicial (`BEGIN IMMEDIATE; COMMIT;`) al crear la base.

---

## 2. Esquema Relacional Local en SQLite (Esquemas 3 al 6)

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
                 │ (Exclusivo Esquema 4 - Migración Aditiva de Sincronización)
┌────────────────┴────────────────┐
│        sync_checkpoints         │
├─────────────────────────────────┤
│ replica TEXT PRIMARY KEY        │
│ snapshot TEXT (JSON válido)     │
└─────────────────────────────────┘
                 ▲
                 │ (Exclusivo Esquema 5 - Migración Aditiva de Asistentes)
┌────────────────┴────────────────┐
│        project_bindings         │
├─────────────────────────────────┤
│ directory TEXT PRIMARY KEY      │  (Ruta local canónica del disco)
│ projectId TEXT REFERENCES proj  ├───► projects.projectId
│ createdAt TEXT NOT NULL         │
└─────────────────────────────────┘
  CREATE INDEX project_bindings_project ON project_bindings(projectId);
                 ▲
                 │ (Exclusivo Esquema 6 - Migración Aditiva de Sesiones Progresivas)
┌────────────────┴────────────────────────────────────────────────────────┐
│                               sessions                                 │
├────────────────────────────────────────────────────────────────────────┤
│ sessionId TEXT PRIMARY KEY                                             │
│ projectId TEXT REFERENCES projects(projectId)                          │
│ kind TEXT ('runtime' | 'manual')                                       │
│ startedAt TEXT NOT NULL                                                │
│ endedAt TEXT NULLABLE                                                  │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
      ┌───────────────────────────┼───────────────────────────┐
      ▼                           ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│      session_entries      │ │     session_summaries     │ │ local_session_bindings    │
├───────────────────────────┤ ├───────────────────────────┤ ├───────────────────────────┤
│ sessionId REFERENCES sess │ │ sessionId PK REFERENCES s │ │ sessionId REFERENCES sess │
│ memoryId REFERENCES mem   │ │ memoryId REFERENCES mem   │ │ directory TEXT            │
│ version INTEGER           │ │ version INTEGER           │ │ createdAt TEXT            │
│ recordedAt TEXT NOT NULL  │ └───────────────────────────┘ └───────────────────────────┘
└───────────────────────────┘                               (Exclusivo local, no sync)
                 ▲
                 │
┌────────────────┴───────────────┐
│     local_manual_sessions      │
├────────────────────────────────┤
│ projectId PK REFERENCES proj   │  (Asociación manual de conveniencia por equipo)
│ sessionId REFERENCES sessions  │
└────────────────────────────────┘
```

---

## 3. Resolución Canónica de Proyectos y Git

1. **Resolución de la Raíz Común de Git (`git rev-parse --path-format=absolute --git-common-dir`):**
   - **Ramas de trabajo vinculadas (*linked worktrees*):** Todas las ramas (`git worktree add`) comparten el mismo `.git` común, por lo que acceden exactamente al mismo `projectId` y a los mismos recuerdos.
   - **Subcarpetas:** Cualquier ruta interior se resuelve unificadamente a la raíz del repositorio.
2. **Dependencia cerrada de Git:** Git es obligatorio para comprobar pertenencia a repositorios; si Git no está accesible, la resolución falla cerrada arrojando `PROJECT_IDENTITY_UNAVAILABLE`.
3. **Bloqueo Conservador ante Carpetas Desconocidas:** Si alguna ruta previamente vinculada en `project_bindings` ya no existe en el disco (carpeta renombrada o volumen desmontado), Engram bloquea la creación ciega de proyectos arrojando `PROJECT_BINDING_REQUIRED`.

---

## 4. Arquitectura del Servidor MCP Local (10 Herramientas)

El servidor MCP opera a través de `stdio` bajo el estándar oficial de Model Context Protocol:

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
│  - Transport: StdioServerTransport (256 KB buffer)     │
│  - Stdout: 100% reservado para tramas JSON-RPC         │
│  - Stderr: No emite logs humanos ni escapes ANSI       │
├────────────────────────────────────────────────────────┤
│                    10 Herramientas                     │
│ 1. memory_current_project(directory?)                  │
│ 2. memory_search(query, directory?, limit?, scope?)    │
│ 3. memory_get(id, directory?, scope?, version?)        │
│ 4. memory_save(title, content, type, directory?, ...)  │
│ 5. memory_history(id, directory?, scope?)              │
│ 6. memory_session_start(directory, sessionId)          │
│ 7. memory_session_end(directory?, sessionId)           │
│ 8. memory_session_summary(directory?, sessionId, ...)  │
│ 9. memory_timeline(directory?, sessionId, id, v, ...)  │
│ 10. memory_context(directory?, scope?, compact?, ...)  │
└──────────────────────────┬─────────────────────────────┘
                           │ Operaciones síncronas
                           ▼
┌────────────────────────────────────────────────────────┐
│               SQLite Local (engram.db)                 │
│               Esquemas 5 y 6 + FTS5 Trigram            │
└────────────────────────────────────────────────────────┘
```

### Directrices del Protocolo (`MEMORY_PROTOCOL`):
- Engram almacena memoria duradera y curada, **no transcripciones conversacionales crudas**.
- Invocar `memory_context` o `memory_search` al arrancar la sesión o tras una compactación de contexto antes de repetir investigación.
- Guardar únicamente decisiones, procedimientos, advertencias y preferencias explícitas. **Nunca guardar contraseñas ni secretos**.
- Para `scope shared`, se exige justificación en `globalIntent`.
- Si se asocia una sesión a un guardado compartido (`scope shared`), en almacenamiento el recuerdo tiene `projectId: null` y sus metadatos de sesión no se filtran a otros proyectos.

---

## 5. Adaptadores de Configuración y Seguridad de Archivos

| Cliente | Archivo de Configuración | Ganchos / Plugin |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude.json` | `~/.claude/settings.json` |
| **Codex** | `~/.codex/config.toml` | `~/.codex/hooks.json` (requiere `/hooks` trust) |
| **Cursor** | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` |
| **OpenCode** | `~/.config/opencode/opencode.json` (o `.jsonc`) | `plugins/forge614-engram.js` en fuente global |
| **Gemini CLI** | `~/.gemini/settings.json` | Sección `hooks` interna |

### Protocolo de Modificación Segura:
1. **Preflight:** Verificación estricta de rutas, rechazo de symlinks sospechosos y validación de tamaño.
2. **Copia de Respaldo Privada:** Archivo `.bak` con permisos `0600` y sufijo UUID con los bytes anteriores exactos.
3. **Preservación:** Lectura y edición mediante AST con `jsonc-parser` y `smol-toml`.
4. **Verificación Posterior:** Comprobación de bytes exactos publicados. Si otro proceso modificó el archivo simultáneamente, emite `PUBLISHED_UNVERIFIED` sin destrucción ni rollback ciego.
5. **Detección de Conflicto en Plugin de OpenCode:** Si el archivo dedicado `plugins/forge614-engram.js` ya existe con un contenido distinto, Engram falla de forma cerrada con `CONFLICT`. No se sobrescribe automáticamente; el usuario debe inspeccionar y reconciliar el archivo manualmente.

---

## 6. Sincronización PostgreSQL y Promoción a Formato 2

La sincronización entre réplicas mediante PostgreSQL opera bajo un esquema atómico de tres vías (*3-way merge*):

- **Formato 1:** Instantánea clásica que comprende proyectos, recuerdos, revisiones de memoria, peticiones y eventos.
- **Formato 2:** Instantánea extendida que añade la sincronización completa de sesiones (`sessions`), entradas de sesión (`sessionEntries`) y resúmenes estructurados (`sessionSummaries`).
- **Promoción Explícita y Controlada:**
  La promoción de una réplica remota en formato 1 a formato 2 **solo ocurre mediante `forge614-engram sync --upgrade-format`**.
  - Está gobernada por un bloqueo optimista CAS atómico sobre la fila única de `forge614_sync.state`.
  - El comando `sync-watch` rechaza terminantemente `--upgrade-format` con error `INVALID_INPUT` para evitar promociones no asistidas.
  - Las tablas de vinculaciones exclusivas por máquina (`local_session_bindings` y `local_manual_sessions`) **nunca se transmiten a la réplica**.
- **Límite de Carga:** Si la instantánea combinada supera los 8 MiB (`8,388,608 bytes`), se reporta `SYNC_TOO_LARGE` en lugar de un falso conflicto histórico.

---

## 7. Fórmulas Matemáticas de Búsqueda y Ordenamiento

### 7.1. Ponderación BM25 en SQLite FTS5

SQLite FTS5 evalúa las coincidencias utilizando la función de ranking BM25 (*Best Matching 25*):

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- Parámetros del motor: $k_1 = 1.2$, $b = 0.75$.
- Ponderación por columnas en Engram: `title: 5.0`, `topic_key: 3.0`, `content: 1.0`.
- **Naturaleza del puntaje en SQLite FTS5:** La función nativa `bm25()` de SQLite devuelve **valores negativos**, donde un valor más negativo representa una coincidencia más fuerte y relevante.

### 7.2. Multiplicador de Fijación y Recencia

Para integrar la prioridad y la frescura temporal con el puntaje BM25 de SQLite:

$$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \frac{\text{ageDays}}{30}}, \quad (\text{ageDays} \ge 0)$$

donde:
- $\text{pinned} \in \{0, 1\}$: Vale 1 si el recuerdo está fijado, 0 en caso contrario.
- $\text{ageDays} = \max\left(0, \text{julianday}('now') - \text{julianday}(m.\text{updated\_at})\right)$: Antigüedad del recuerdo en días.
- Si el recuerdo es nuevo ($\text{ageDays} = 0$) y está fijado ($\text{pinned} = 1$), el multiplicador alcanza su máximo de $1.16$.
- Conforme transcurre el tiempo, el término de recencia converge suavemente a 0 y el multiplicador converge a $1.00$ (o $1.10$ si permanece fijado).

**Cálculo de Ordenamiento:**
$$\text{orderScore} = \text{bm25} \times \text{multiplier}$$

Dado que $\text{bm25}$ es un número negativo, al multiplicarlo por $\text{multiplier} \ge 1.0$, los mejores resultados obtienen números aún más negativos. La consulta ordena ascendentemente:
```sql
ORDER BY bm25 * multiplier ASC, m.id ASC
```
lo que posiciona en primer lugar los recuerdos más relevantes y recientes, resolviendo empates de forma determinista mediante el identificador UUID `m.id`.

### 7.3. Consultas Literales de Términos Cortos
Para búsquedas de menos de 3 caracteres, el motor conmuta a un escaneo literal que preserva caracteres Unicode mediante minúsculas plegadas (*Unicode lowercase folding*), ordenando estrictamente por:
```sql
ORDER BY m.pinned DESC, m.updated_at DESC, m.id ASC
```
En este modo, `bm25` y `orderScore` se reportan formalmente como `null` con `multiplier: 1`.

---

## 8. Presupuesto de Recuperación Progresiva y Abreviación

Forge614 Engram establece límites rigurosos para optimizar la transferencia de datos y el consumo de contexto:

1. **Previsualizaciones en Puntos de Código Unicode (*Unicode Code Points*):**
   - En `memory_search` con `--preview` y en `memory_context`: el texto se abrevia a un máximo de **300 puntos de código Unicode**, indicando si hubo truncamiento con la bandera `truncated: true`.
   - En `memory_timeline`: el recuerdo en foco se abrevia a un máximo de **500 puntos de código**, y los recuerdos vecinos a **150 puntos de código**.
2. **Presupuesto Máximo de Serialización (`--max-bytes`):**
   - La opción `--max-bytes` en `memory_context` admite valores enteros entre `1024` y `65536` (por defecto `16384` bytes / 16 KiB).
   - **Garantía formal:** Este límite restringe el **tamaño total en bytes UTF-8 del JSON serializado resultante**, incluyendo estructura, metadatos y arreglo de omisiones.
   - **No es un presupuesto de tokens:** La ventana de tokens del modelo es gestionada por el cliente de IA; Engram garantiza un techo predecible en el transporte de datos entre procesos.

---

## 9. Atribución y Linaje de Diseño

El diseño de recuperación progresiva de Forge614 Engram incorpora influencias arquitectónicas reconocidas:
- **Inspiración en Gentleman:** El modelo de consulta progresiva, visualización de vistas previas (*previews*) y reconstrucción temporal de sesiones (*timeline*) se inspira en el paradigma de Gentleman.
- **Adaptaciones e Innovaciones de Forge614:**
  - Identidad de proyectos por UUID desacoplada de la ruta o del nombre visible.
  - Sesiones explícitas y manuales por equipo con resolución canónica mediante Git.
  - Aislamiento de vinculaciones locales del sistema de archivos (`local_session_bindings`).
  - Protocolo de réplica PostgreSQL de tres vías con promoción segura CAS a Formato 2.
