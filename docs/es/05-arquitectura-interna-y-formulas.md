# 05. Arquitectura Interna, SQLite FTS5 y Fórmulas Matemáticas

> **Etapa:** Etapa 1 — Memoria Local (Configuración Interactiva y Base Única)
> **Versiones de esta entrega:** Programa 0.3.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Verificado
> **Traducción hermana:** [05 (EN). Internal Architecture, FTS5, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento expone a máximo rigor técnico la arquitectura interna de Forge614 Engram: parámetros del motor SQLite, esquema relacional de tablas en su versión 3, ajuste de inicialización WAL, disparadores reactivos, el mecanismo SQL de sustitución por tema (*topic override*) y el desglose matemático exhaustivo del algoritmo **BM25**, la curva de recencia y las fórmulas de ordenamiento explicable.

---

## 1. Parámetros del Motor SQLite (Pragmas), Concurrencia e Inicialización WAL

Forge614 Engram opera sobre el motor nativo de SQLite integrado en Bun (`bun:sqlite`), inicializado con directivas estrictas de seguridad e integridad:

1. **`PRAGMA foreign_keys = ON;`**
   Garantiza la integridad referencial en todo momento. Por ejemplo, una fila en `memory_versions` no puede existir si no apunta a un `id` existente en `memories`, y un recuerdo no puede asociarse a un `projectId` que no esté registrado en la tabla `projects`.
2. **`PRAGMA busy_timeout = 5000;`**
   Si dos procesos intentan escribir al mismo tiempo en la base, SQLite no fallará de inmediato: **esperará hasta 5,000 milisegundos (5 segundos)** a que la transacción en curso termine antes de emitir un error de concurrencia.
3. **`PRAGMA application_id = 1177956660;`**
   Número identificador exclusivo de Forge614 Engram. Se comprueba antes de abrir cualquier archivo para asegurar que no se manipulen bases ajenas ni corruptas.
4. **`PRAGMA user_version = 3;`**
   Versión oficial del esquema relacional en esta entrega. Si una base contiene una versión 1 o 2 (diseños previos), el sistema rechaza abrirla con el error `MIGRATION_REQUIRED` para preservar tus datos intactos.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**
   - En modo WAL, los procesos lectores leen del archivo principal mientras las escrituras se añaden a un diario auxiliar rápido (`engram.db-wal`).
   - Los lectores no bloquean a los escritores y los escritores no bloquean a los lectores.
   - **Nota de concurrencia:** Las escrituras continúan estando serializadas (un único proceso puede escribir a la vez).

### Ajuste de Inicialización WAL (Transacción Inmediata Vacía)
Al inicializar una nueva base de datos, el motor ejecuta:
```sql
PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
COMMIT;
```
- **Justificación técnica:** En Bun 1.3.8 bajo macOS, abrir inmediatamente una base SQLite recién creada en modo de solo lectura (`readonly: true`, como realiza `workspace.open(true)` en el comando `setup` para validar sin mutar) fallaba si el archivo WAL nunca había tenido una transacción física materializada en disco.
- La ejecución de una transacción vacía e inmediata (`BEGIN IMMEDIATE; COMMIT;`) fuerza la sincronización de cabeceras en `engram.db-wal` y `engram.db-shm`, garantizando que conexiones de solo lectura posteriores funcionen al instante, incluso en una base recién creada sin proyectos ni recuerdos.
- **Aclaración sobre migraciones:** Este ajuste no modifica tablas, columnas ni índices, por lo que **no constituye un cambio de esquema ni una nueva versión de migración** (el esquema se mantiene en `user_version = 3`).
- **Naturaleza de los archivos auxiliares:** Los archivos `engram.db-wal` y `engram.db-shm` son auxiliares del motor; no son bases de datos independientes. Inspeccionar la base existente puede generar actividad normal del sistema operativo sobre ellos.

---

## 2. Esquema Relacional de Tablas (Versión 3)

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
│ memory_id TEXT (FK memories.id) │       ├─────────────────────────────────┤
│ action ('save'|'archive'|'rest')│       │ Tabla Virtual FTS5 (trigram)    │
│ version INTEGER                 │       │ title (5.0), topic_key (3.0),   │
│ created_at TIMESTAMP            │       │ content (1.0)                   │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

### Restricciones de Coherencia en SQL:
1. **Exclusión Mutua del Alcance (`scope`):**
   La tabla `memories` impone a nivel de base de datos que si `scope = 'project'`, el campo `projectId` debe ser obligatorio; y si `scope = 'shared'`, el campo `projectId` debe ser estrictamente nulo:
   ```sql
   CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
   ```
2. **Índices Únicos Parciales por Tema:**
   Garantizan que un proyecto no pueda tener dos recuerdos con el mismo tema, y que el espacio compartido no tenga temas repetidos:
   ```sql
   CREATE UNIQUE INDEX memories_project_topic ON memories(projectId, topic_key) WHERE scope='project';
   CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
   ```
3. **Idempotencia Parcial en Peticiones:**
   La tabla `requests` aplica la misma separación para que una clave de petición no colisione entre proyectos ni en el espacio compartido:
   ```sql
   CREATE UNIQUE INDEX requests_project_key ON requests(projectId, request_key) WHERE scope='project';
   CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
   ```

### Disparadores Automáticos (Triggers)
La sincronización del índice virtual FTS5 es completamente reactiva mediante tres disparadores:
- `memory_insert`: Al insertar en `memories`, añade la fila en `memories_fts`.
- `memory_delete`: Al eliminar en `memories`, elimina la entrada en `memories_fts`.
- `memory_update`: Al modificar `title`, `content` o `topic_key`, reemplaza la entrada en `memories_fts` atómicamente.

---

## 3. Mecanismo SQL de Sustitución por Tema (*Topic Override*)

Cuando se realiza una búsqueda combinada desde un proyecto (`--scope all`), la consulta SQL utiliza una subconsulta correlacionada para decidir si una preferencia compartida debe mostrarse o si debe ceder el paso a una excepción del proyecto:

```sql
SELECT m.*, bm25(memories_fts, 5.0, 1.0, 3.0) AS bm25,
  (1 + 0.10 * m.pinned + 0.06 / (1 + MAX(0, julianday('now') - julianday(m.updated_at)) / 30)) AS multiplier
FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
WHERE memories_fts MATCH ? AND (
  m.projectId = ? OR (
    m.scope = 'shared' AND NOT EXISTS (
      SELECT 1 FROM memories p
      WHERE p.projectId = ?
        AND p.scope = 'project'
        AND p.state = 'active'
        AND p.topic_key = m.topic_key
    )
  )
) AND m.state = 'active'
ORDER BY bm25 * multiplier ASC, m.id ASC LIMIT ?;
```

### ¿Cómo funciona la condición `NOT EXISTS`?
1. Si el recuerdo evaluado pertenece al proyecto (`m.projectId = ?`), se incluye de inmediato.
2. Si el recuerdo evaluado es compartido (`m.scope = 'shared'`), el motor revisa si existe algún recuerdo en el proyecto que cumpla tres condiciones simultáneas:
   - Que pertenezca al mismo proyecto (`p.projectId = ?`).
   - Que se encuentre activo (`p.state = 'active'`).
   - Que tenga **exactamente la misma clave temática** (`p.topic_key = m.topic_key`).
3. Si existe una excepción activa en el proyecto, la condición `NOT EXISTS` resulta falsa y **el recuerdo compartido se descarta silenciosamente de los resultados**.
4. Si el proyecto archiva su excepción (`state = 'archived'`), la condición `NOT EXISTS` vuelve a ser verdadera y la regla compartida reaparece automáticamente.

---

## 4. ¿Qué es BM25 y por qué devuelve Números Negativos?

**BM25** (*Best Matching 25*) es el algoritmo estándar de recuperación de información que pondera:
1. **Frecuencia del Término (TF):** Cuántas veces aparece la palabra en la nota, aplicando una curva de saturación decreciente.
2. **Frecuencia Inversa de Documento (IDF):** Cuán rara o específica es la palabra en el conjunto de recuerdos. Palabras comunes puntúan bajo; palabras técnicas puntúan alto.
3. **Normalización por Longitud:** Premia notas breves y concisas donde la palabra buscada representa un porcentaje alto del texto total.

### ¿Por qué la función `bm25()` de SQLite devuelve valores negativos?
En bases de datos SQL, las ordenaciones por defecto son ascendentes (`ASC`, de menor a mayor). Para optimizar el rendimiento sin requerir transformaciones adicionales:
- **SQLite FTS5 invierte el signo: los números más negativos representan la mayor relevancia.**
- Una nota con un BM25 de `-3.8` es **más relevante** que una nota con `-1.2` o `-0.1`.

---

## 5. Las Fórmulas Matemáticas del Buscador

### Fórmula 1: Ponderación de Campos en BM25
Al evaluar coincidencias en FTS5, se asignan pesos diferentes a cada columna:
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$
- **Título (`title`):** Peso `5.0` (máxima prioridad textual).
- **Contenido (`content`):** Peso `1.0` (peso base).
- **Clave Temática (`topic_key`):** Peso `3.0` (alta prioridad de clasificación).

---

### Fórmula 2: Multiplicador de Prioridad y Recencia
El multiplicador amplifica el valor de la nota combinando su condición de fijada (`pinned`) y su antigüedad en días ($r$):

$$\text{multiplier} = 1 + (0.10 \times \text{pinned}) + \frac{0.06}{1 + \frac{\max(0, \text{julianday('now')} - \text{julianday}(\text{updated\_at}))}{30}}$$

Donde:
- $\text{pinned}$ vale `1` si la nota está fijada como prioritaria, o `0` si no lo está (aporta hasta $+10\%$ de bonificación).
- $r = \max(0, \text{julianday('now')} - \text{julianday}(\text{updated\_at}))$ es la edad de la nota en días transcurridos.
- El factor de juventud aporta un máximo de $+6\%$ cuando la nota es recién creada ($r = 0$) y se reduce suavemente a $+3\%$ a los 30 días.

---

### Fórmula 3: Puntuación Final de Ordenamiento (*orderScore*)
$$\text{orderScore} = \text{bm25} \times \text{multiplier}$$

Dado que `bm25` es un valor negativo, multiplicar por un factor mayor que `1` (por ejemplo `1.16`) hace que el número sea **aún más negativo** (alejándose hacia la izquierda en la recta numérica).
Al ordenar por `ORDER BY bm25 * multiplier ASC`, las notas con mejor coincidencia, fijadas y recientes quedan en los primeros lugares.

---

### Fórmula 4: Modo Literal de Respaldo para Términos Cortos
El tokenizador `trigram` de SQLite FTS5 requiere términos de al menos 3 caracteres. Si la consulta incluye palabras cortas (como `"UI"`, `"DB"` o `"Go"`):
- El sistema cambia automáticamente a **modo literal (`mode: "literal"`)**.
- Aplica plegado a minúsculas compatible con Unicode (`toLowerCase()`).
- Recorre las notas activas del alcance mediante un iterador eficiente sin cargar la base completa en memoria RAM.
- Asigna `bm25 = null`, `multiplier = 1`, `orderScore = null`.
- Ordena los resultados por: `ORDER BY m.pinned DESC, m.updated_at DESC, m.id ASC`.
