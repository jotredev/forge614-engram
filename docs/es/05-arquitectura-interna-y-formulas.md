# 05. Arquitectura Interna, SQLite FTS5, PostgreSQL Sync y Fórmulas Matemáticas

> **Etapa:** Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.4.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync)
> **Estado:** Vigente y Verificado (90 pruebas totales en macOS con Bun 1.3.8)
> **Traducción hermana:** [05 (EN). Internal Architecture, FTS5, PostgreSQL Sync, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento expone a máximo rigor técnico la arquitectura interna de Forge614 Engram: parámetros del motor SQLite, esquemas relacionales locales v3 y v4, esquema remoto PostgreSQL `forge614_sync`, protocolo de conciliación de tres vías (*3-way snapshot merge*), disparadores reactivos, el mecanismo SQL de sustitución por tema (*topic override*) y el desglose matemático exhaustivo del algoritmo **BM25**, la curva de recencia y las fórmulas de ordenamiento explicable.

---

## 1. Parámetros del Motor SQLite (Pragmas), Concurrencia e Inicialización WAL

Forge614 Engram opera sobre el motor nativo de SQLite integrado en Bun (`bun:sqlite`), inicializado con directivas estrictas de seguridad e integridad:

1. **`PRAGMA foreign_keys = ON;`**
   Garantiza la integridad referencial en todo momento. Por ejemplo, una fila en `memory_versions` no puede existir si no apunta a un `id` existente en `memories`, y un recuerdo no puede asociarse a un `projectId` que no esté registrado en la tabla `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   Si dos procesos intentan escribir al mismo tiempo en la base, SQLite no fallará de inmediato: **esperará hasta 5,000 milisegundos (5 segundos)** a que la transacción en curso termine antes de emitir un error de concurrencia.
3. **`PRAGMA application_id = 1177956660;`**
   Número identificador exclusivo de Forge614 Engram. Se comprueba antes de abrir cualquier archivo para asegurar que no se manipulen bases ajenas ni corruptas.
4. **`PRAGMA user_version = 3` o `4`;**
   - **Versión 3:** Almacenamiento local puro sin sincronización.
   - **Versión 4:** Almacenamiento con sincronización PostgreSQL habilitada. La tabla `sync_checkpoints` se añade mediante una migración aditiva estricta sin destruir ni reconstruir datos.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - En modo WAL, los procesos lectores leen del archivo principal mientras las escrituras se añaden a un diario auxiliar rápido (`engram.db-wal`).
   - Los lectores no bloquean a los escritores y los escritores no bloquean a los lectores.
   - Las escrituras continúan serializadas (un único proceso escribe a la vez).

### Ajuste de Inicialización WAL (Transacción Inmediata Vacía)
Al inicializar una nueva base de datos, el motor ejecuta:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
En Bun bajo macOS, abrir inmediatamente una base SQLite recién creada en modo de solo lectura (`readonly: true`, como hace `workspace.open(true)` en `setup`) fallaba si el archivo WAL nunca había tenido una transacción física materializada en disco. La transacción inmediata vacía fuerza la sincronización de cabeceras en `engram.db-wal` y `engram.db-shm`.

---

## 2. Esquema Relacional Local en SQLite (Versiones 3 y 4)

```text
┌─────────────────────────────────┐
│            projects             │
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
```

### Restricciones de Coherencia en SQL:
1. **Exclusión Mutua del Alcance (`scope`):**
   ```sql
   CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
   ```
2. **Índices Únicos Parciales por Tema:**
   ```sql
   CREATE UNIQUE INDEX memories_project_topic ON memories(projectId, topic_key) WHERE scope='project';
   CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
   ```
3. **Idempotencia Parcial en Peticiones:**
   ```sql
   CREATE UNIQUE INDEX requests_project_key ON requests(projectId, request_key) WHERE scope='project';
   CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
   ```

---

## 3. Esquema Remoto en PostgreSQL (`forge614_sync`) y Concurrencia CAS

Cuando se habilita la sincronización, Forge614 Engram crea y valida exclusivamente el esquema `forge614_sync` dentro de la base de datos PostgreSQL:

```sql
CREATE SCHEMA forge614_sync;

CREATE TABLE forge614_sync.revisions (
  hash text PRIMARY KEY CHECK (length(hash) = 64),
  payload text NOT NULL
);

CREATE TABLE forge614_sync.state (
  id integer PRIMARY KEY CHECK (id = 1),
  format integer NOT NULL CHECK (format = 1),
  replica uuid NOT NULL,
  head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);
```

### Mecanismos de Seguridad y Concurrencia en PostgreSQL:
1. **Bloqueo Consultivo para Inicialización DDL:**
   Al crear el esquema por primera vez, el sistema adquiere `SELECT pg_advisory_xact_lock(1177956660, 7)`. Esto garantiza que dos procesos concurrentes ejecutando `setup` no generen condiciones de carrera sobre DDL.
2. **Validación Exhaustiva de Esquema:**
   Forge614 no se conforma con `CREATE TABLE IF NOT EXISTS`. Inspecciona las columnas, tipos exactos, nulabilidades, llaves foráneas y confirma que no existan disparadores, procedimientos ni reglas ajenas en `forge614_sync`. Si encuentra alteraciones, detiene la operación con `POSTGRES_SCHEMA`.
3. **Bloqueo CAS de Cabecera (*Compare-And-Swap*):**
   Al publicar una nueva revisión, ejecuta:
   ```sql
   SELECT head FROM forge614_sync.state WHERE id = 1 FOR UPDATE;
   ```
   Si el valor de `head` no coincide con la versión esperada por el cliente local (otra réplica publicó primero), aborta inmediatamente con `SYNC_REMOTE_CHANGED`.
4. **Inmutabilidad de Revisiones:**
   Los estados se indexan por su hash canónico SHA-256. Se insertan mediante `INSERT INTO revisions ... ON CONFLICT (hash) DO NOTHING`. El historial publicado en PostgreSQL jamás se sobreescribe ni se borra.

---

## 4. Protocolo de Conciliación de Tres Vías (*3-Way Snapshot Merge*)

La sincronización se basa en comparar tres fotografías completas del espacio de trabajo:
- **`base`:** La fotografía acordada en la última sincronización con esa réplica específica (almacenada en `sync_checkpoints`).
- **`local`:** La fotografía exportada del estado actual de SQLite.
- **`remote`:** La fotografía correspondiente a la cabeza actual (`head`) en PostgreSQL.

### Estructura Canónica del Snapshot
```typescript
interface SyncSnapshot {
  format: 1;
  projects: Project[];
  memories: MemoryBundle[];
}

interface MemoryBundle {
  memory: Memory;
  versions: MemoryVersion[];
  requests: { request_key: string; payload_hash: string; version: number }[];
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
```

### Reglas de Fusión y Límites Estrictos:
1. **Límite de Tamaño Estricto (8 MiB):**
   Cada snapshot se valida antes de procesarse. Si `Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024`, se rechaza con `SYNC_TOO_LARGE`.
2. **Prohibición de Borrado Físico Arbitrario:**
   No existe un protocolo de borrado físico. Si un registro existía en `base` y desaparece en `local` o `remote`, se declara `SYNC_CONFLICT`.
3. **Fusión Entidad por Entidad:**
   - Si una entidad no cambió localmente (`local === base`), se adopta el cambio remoto.
   - Si una entidad no cambió remotamente (`remote === base`), se mantiene el cambio local.
   - Si ambas partes modificaron de forma diferente la misma entidad respecto a `base`, se genera un conflicto irresoluble (`SYNC_CONFLICT`).
4. **Verificación de Extensión Inmutable (`assertExtension`):**
   Antes y después de la fusión, el sistema comprueba que el nuevo estado sea una extensión matemática pura del anterior: no puede recortar versiones pasadas, alterar fechas de creación ni mutilar eventos.
5. **Aplicación Atómica en SQLite (`applySnapshot`):**
   Se ejecuta en una transacción `IMMEDIATE`. Verifica que el estado local no haya cambiado mientras se esperaba la respuesta de red (`snapshotHash(current) === snapshotHash(expected)`). Si hubo escrituras concurrentes locales, arroja `SYNC_LOCAL_CHANGED` y preserva todo intacto.

---

## 5. El Principio Fundamental: SQLite y FTS5 Siempre son Locales

> [!IMPORTANT]
> **No existe modo `postgres-fts`, ni `tsvector`, ni `ts_rank_cd`.**
> Todas las búsquedas (`search`) y consultas (`get`) se resuelven **siempre en SQLite local**. PostgreSQL actúa exclusivamente como almacén de réplica y sincronización de fotografías.
> Cuando una ronda de sincronización importa recuerdos desde PostgreSQL, los disparadores reactivos de SQLite (`memory_insert`, `memory_update`, `memory_delete`) actualizan de forma automática la tabla virtual `memories_fts` en tu máquina.

---

## 6. Disparadores Reactivos FTS5 en SQLite

```sql
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, topic_key)
  VALUES(new.rowid, new.title, new.content, new.topic_key);
END;

CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, topic_key)
  VALUES('delete', old.rowid, old.title, old.content, old.topic_key);
END;

CREATE TRIGGER memory_update AFTER UPDATE OF title, content, topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, topic_key)
  VALUES('delete', old.rowid, old.title, old.content, old.topic_key);
  INSERT INTO memories_fts(rowid, title, content, topic_key)
  VALUES(new.rowid, new.title, new.content, new.topic_key);
END;
```

---

## 7. Consulta SQL de Búsqueda y Sustitución de Temas (*Topic Override*)

Al consultar desde un proyecto con `--scope all`:

```sql
SELECT m.*, bm25(memories_fts, 5.0, 1.0, 3.0) AS bm25,
  (1 + 0.10 * m.pinned + 0.06 / (1 + MAX(0, julianday('now') - julianday(m.updated_at)) / 30)) AS multiplier
FROM memories_fts
JOIN memories m ON m.rowid = memories_fts.rowid
WHERE memories_fts MATCH ?
  AND (
    m.projectId = ?
    OR (
      m.scope = 'shared'
      AND (
        m.topic_key IS NULL
        OR m.topic_key NOT IN (
          SELECT topic_key FROM memories
          WHERE projectId = ? AND scope = 'project' AND topic_key IS NOT NULL AND state = 'active'
        )
      )
    )
  )
  AND m.state = 'active'
ORDER BY bm25 * multiplier ASC, m.id ASC
LIMIT ?;
```

---

## 8. Desglose Matemático del Algoritmo BM25

La puntuación BM25 para un documento $D$ frente a una consulta $Q = \{q_1, q_2, \dots, q_n\}$ se rige por:

$$\text{Score}_{\text{BM25}}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

### Variables:
- $f(q_i, D)$: Frecuencia del término en el documento.
- $|D|$: Longitud del documento en tokens.
- $\text{avgdl}$: Longitud promedio de todos los documentos en la colección.
- $k_1 = 1.2$: Constante de saturación de frecuencia de término.
- $b = 0.75$: Constante de penalización por longitud.
- Ponderación de columnas: Título ($5.0$), Tema ($3.0$), Contenido ($1.0$).

---

## 9. Multiplicador de Prioridad y Curva de Recencia Temporal

$$\text{Multiplier} = 1 + 0.10 \cdot \text{pinned} + \frac{0.06}{1 + \frac{\max(0, \Delta t)}{30}}$$

Donde:
- $\text{pinned} \in \{0, 1\}$: $0.10$ de bonificación si la nota está fijada.
- $\Delta t$: Días transcurridos desde `updated_at`.
- Vida media de 30 días: Una nota recién actualizada recibe una bonificación inicial del 6%, reduciéndose al 3% a los 30 días.
- Puntuación final de ordenación: $\text{orderScore} = \text{BM25} \cdot \text{Multiplier}$ (los valores más negativos aparecen en primer lugar).
