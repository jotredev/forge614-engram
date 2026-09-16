# 05. Arquitectura Interna, SQLite FTS5 y Fórmulas Matemáticas

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [05 (EN). Internal Architecture, FTS5, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento detalla a máximo rigor técnico el funcionamiento interno de Forge614 Engram: parámetros del motor SQLite, esquema relacional de tablas, disparadores automáticos, y el desglose matemático profundo del algoritmo **BM25**, la curva de recencia y las fórmulas de ordenamiento.

---

## 1. Configuración del Motor SQLite (Pragmas) y Concurrencia

Forge614 Engram utiliza el motor SQLite integrado en Bun (`bun:sqlite`), inicializado bajo estrictos estándares de integridad:

1. **`PRAGMA foreign_keys = ON;`**  
   Garantiza la integridad referencial en cascada. Por ejemplo, una fila en `memory_versions` no puede existir si no apunta a un identificador válido en `memories`.
2. **`PRAGMA busy_timeout = 5000;`**  
   Si dos procesos intentan escribir concurrentemente en la base de datos, SQLite no fallará de inmediato: **esperará pacientemente hasta 5,000 milisegundos (5 segundos)** a que el escritor activo termine su transacción antes de arrojar un error de base ocupada (`SQLITE_BUSY`).
3. **`PRAGMA application_id = 1177956660;`**  
   Número de identificación exclusivo de Forge614. Se valida al abrir el archivo para asegurar que no se manipulen bases ajenas.
4. **`PRAGMA user_version = 1;`**  
   Control de versión del esquema. Si en el futuro existe una versión `2`, el software de la versión `1` rechazará abrirla para evitar corrupciones.
5. **`PRAGMA journal_mode = WAL;` (Write-Ahead Logging)**  
   - En modo WAL, los lectores leen desde el archivo principal mientras las escrituras se añaden a un diario auxiliar rápido (`engram.db-wal`).
   - **Aclaración de concurrencia:** En modo WAL los lectores no bloquean a los escritores y los escritores no bloquean a los lectores. Sin embargo, **las escrituras siguen estando serializadas** (SQLite solo permite un escritor activo a la vez).
   - ⚠️ **Precaución de respaldo:** Nunca copies únicamente el archivo `.db` mientras haya procesos escribiendo; espera a que se cierren las conexiones para asegurar que el contenido del diario WAL se haya volcado al archivo principal.

Ubicación centralizada: `~/.forge614/engram.db` (junto con `engram.db-wal` y `engram.db-shm`).

---

## 2. Esquema Relacional de Tablas

```text
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            memories             │       │         memory_versions         │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ rowid (PK interno de SQLite)    │       │ memory_id (FK -> memories.id)   │◄──┐
│ id (UUID texto único)           │◄──┐   │ version (Entero >= 1)           │   │
│ project (Texto normalizado)     │   │   │ snapshot (JSON validado)        │   │
│ topic_key (Tema único/opcional) │   │   └─────────────────────────────────┘   │
│ type (Categoría)                │   │                     ▲                   │
│ title (Título vigente)          │   │                     │                   │
│ content (Cuerpo vigente)        │   │                     │                   │
│ pinned (0 o 1)                  │   │   ┌─────────────────┴───────────────┐   │
│ version (Entero vigente)        │   │   │            requests             │   │
│ state ('active' | 'archived')   │   │   ├─────────────────────────────────┤   │
│ created_at / updated_at         │   │   │ project (Texto)                 │   │
└─────────────────────────────────┘   │   │ request_key (Texto)             │   │
                 ▲                    │   │ payload_hash (SHA-256)          │   │
                 │                    │   │ memory_id, version (FK) ────────┼───┘
┌────────────────┴────────────────┐   │   └─────────────────────────────────┘
│             events              │   │
├─────────────────────────────────┤   │   ┌─────────────────────────────────┐
│ id (Entero autoincremental)     │   │   │          memories_fts           │
│ memory_id (FK -> memories.id)   ├───┘   ├─────────────────────────────────┤
│ action ('save'|'archive'|'rest')│       │ Tabla Virtual FTS5 (trigram)    │
│ version (Entero)                │       │ title (5.0), topic_key (3.0),   │
│ created_at (Timestamp ISO)      │       │ content (1.0)                   │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

- **`memories`:** Ficha vigente de cada recuerdo. Restricción `UNIQUE(project, topic_key)` que garantiza un único recuerdo por tema en cada proyecto.
- **`memory_versions`:** Copias fotográficas inmutables con `CHECK(json_valid(snapshot))` para auditoría y trazabilidad histórica.
- **`requests`:** Registro de peticiones para idempotencia con huella criptográfica SHA-256 de los datos normalizados.
- **`events`:** Registro cronológico de auditoría de cada acción ejecutada (`save`, `archive`, `restore`).
- **`memories_fts`:** Tabla virtual FTS5 de texto completo con tokenizador `trigram`.

### Disparadores Automáticos (Triggers)
La sincronización del índice FTS5 es 100% reactiva mediante disparadores internos de SQLite:
- `memory_insert`: Al insertar en `memories`, añade la entrada en `memories_fts`.
- `memory_delete`: Al eliminar en `memories`, purga la entrada en `memories_fts`.
- `memory_update`: Al actualizar `title`, `content` o `topic_key`, reemplaza la entrada en `memories_fts` atómicamente.

---

## 3. ¿Qué es BM25 y Cómo Funciona?

**BM25** significa **"Best Matching 25"** (*Mejor Coincidencia, iteración 25*). Es el algoritmo probabilístico estándar de la industria desarrollado por Stephen Robertson y Karen Spärck Jones (Okapi BM25) para motores de búsqueda como Elasticsearch y SQLite FTS5.

### Los Tres Pilares Matemáticos de BM25
1. **Saturación de Frecuencia de Término (TF):**  
   Cuantas más veces aparece una palabra en un recuerdo, más relevante es. Sin embargo, BM25 aplica una curva asintótica: pasar de 0 a 1 mención da un gran salto de relevancia; pasar de 10 a 20 menciones aporta muy poca relevancia adicional, evitando que textos repetitivos dominen los resultados.
2. **Frecuencia Inversa de Documento (IDF):**  
   Mide la especificidad de una palabra. Palabras comunes que aparecen en muchos recuerdos reciben una puntuación muy baja; palabras raras o técnicas (como `"SQLite"`, `"idempotencia"`, `"WAL"`) reciben una ponderación muy alta.
3. **Normalización por Longitud del Documento:**  
   Evita que notas muy largas ganen injustamente solo por tener más palabras totales. Si un recuerdo de 10 palabras contiene 2 veces `"SQLite"` (20% de concentración), se considera mucho más relevante que un documento de 1,000 palabras donde `"SQLite"` aparece 2 veces dispersas.

### ¿Por qué SQLite FTS5 devuelve Números Negativos?
En la teoría matemática pura, BM25 produce un número positivo donde mayor es mejor.

**Sin embargo, en SQLite FTS5 la función `bm25()` devuelve números negativos a propósito.**  
La razón es la optimización nativa de SQL: las consultas en bases de datos se ordenan de menor a mayor (`ASC` / ascendente). Para que la mejor coincidencia quede en primer lugar sin cálculos extras, SQLite invierte el signo:
- **Los números más negativos (más alejados del cero hacia la izquierda en la recta numérica) representan la mejor coincidencia.**
- Una nota con BM25 de `-4.5` es **más relevante** que una con `-2.1` o `-0.3`.

---

## 4. Desglose Matemático de las 4 Fórmulas de Búsqueda

```
[Búsqueda del Usuario]
         │
         ▼
Fórmula 1: bm25(memories_fts, 5.0, 1.0, 3.0) ─────────► Valor BM25 negativo (ej. -2.00)
         │
         ▼
Fórmula 2: r = 1 / (1 + max(0, días)/30) ─────────────► Factor de frescura r entre 0.0 y 1.0
         │
         ▼
Fórmula 3: multiplicador = 1 + (0.10*pinned) + (0.06*r) ► Factor multiplicador entre 1.00 y 1.16
         │
         ▼
Fórmula 4: orderScore = BM25 * multiplicador ──────────► Puntuación final (ordenada ASC)
```

---

### Fórmula 1: Ponderación de Columnas BM25
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$

En la tabla FTS5 de Forge614 Engram se ponderan las 3 columnas con pesos diferenciados:
- **`title` (Título):** Peso **`5.0`** ($\times 5$). Si la palabra aparece en el título, es 5 veces más relevante porque el título define el tema central de la nota.
- **`content` (Contenido):** Peso **`1.0`** ($\times 1$). Relevancia base del cuerpo de texto.
- **`topic_key` (Tema):** Peso **`3.0`** ($\times 3$). Si la palabra coincide con la clave temática (ej. `architecture/database`), es 3 veces más relevante.

---

### Fórmula 2: Curva de Decaimiento por Recencia ($r$)
$$r = \frac{1}{1 + \frac{\max(0, \text{días})}{30}}$$

Esta fórmula calcula el **factor de frescura** ($r$) de la nota en función del tiempo transcurrido desde su última modificación (`updatedAt`).

- **El valor 30 es la "vida media" (en días):** A los 30 días, la frescura de la nota se reduce exactamente a la mitad ($0.5$).
- **Valores concretos en el tiempo:**
  - **Día 0 (Modificada hoy):**  
    $\text{días} = 0 \rightarrow r = \frac{1}{1 + 0/30} = \frac{1}{1} = \mathbf{1.0}$ (frescura máxima).
  - **Día 30 (1 mes de antigüedad):**  
    $\text{días} = 30 \rightarrow r = \frac{1}{1 + 30/30} = \frac{1}{2} = \mathbf{0.5}$.
  - **Día 60 (2 meses de antigüedad):**  
    $\text{días} = 60 \rightarrow r = \frac{1}{1 + 60/30} = \frac{1}{3} \approx \mathbf{0.333}$.
  - **Día 180 (6 meses de antigüedad):**  
    $\text{días} = 180 \rightarrow r = \frac{1}{1 + 180/30} = \frac{1}{7} \approx \mathbf{0.142}$.
- **`max(0, días)`:** Evita números negativos ante cualquier micro-desfase de reloj hacia el futuro.

---

### Fórmula 3: Multiplicador de Prioridad y Frescura
$$\text{multiplicador} = 1 + (0.10 \times \text{pinned}) + (0.06 \times r)$$

Determina el factor de bonificación que recibirá la nota sobre su relevancia textual pura:

1. **Base neutra `1.0`:** Toda nota parte de un factor base de 1.0.
2. **Bono por Nota Prioritaria (`pinned`):**
   - Si la nota fue guardada con `--pinned true`, `pinned = 1`. Recibe una bonificación fija de **`+0.10`** (un 10% de ventaja).
   - Si no está fijada, `pinned = 0`, sumando `+0.00`.
3. **Bono por Frescura ($r$):**
   - Si la nota se actualizó hoy ($r=1.0$), suma un bono máximo de $0.06 \times 1.0 = \mathbf{+0.06}$ (un 6% de ventaja).
   - Si tiene 30 días ($r=0.5$), suma $0.06 \times 0.5 = \mathbf{+0.03}$.
   - Si es muy antigua ($r \approx 0$), suma prácticamente `+0.00`.

**Rango del multiplicador:** Siempre se encuentra entre **`1.00`** (nota antigua sin prioridad) y **`1.16`** (nota fijada como prioritaria y modificada hoy).

---

### Fórmula 4: Puntuación Final de Ordenamiento (`orderScore`)
$$\text{orderScore} = \text{BM25} \times \text{multiplicador}$$

Dado que el valor BM25 es **negativo** (ej. `-2.00`), al multiplicarlo por un factor mayor a 1 (ej. `1.16`), el resultado se vuelve **más negativo**:

$$-2.00 \times 1.16 = \mathbf{-2.32}$$

En la base de datos se ejecuta:
```sql
ORDER BY bm25 * multiplier ASC, m.id ASC
```

Como la consulta ordena en orden ascendente (`ASC`, de menor a mayor), en la recta numérica de los números negativos:
$$\mathbf{-2.32} < -2.06$$

Por lo tanto, **el número más negativo (-2.32) es menor y aparece en primer lugar**.

#### Ejemplo Comparativo en Vivo:
Imagina dos notas con idéntica coincidencia textual ($\text{BM25} = -2.00$):
- **Nota A:** Marcada como prioritaria (`pinned = 1`) y modificada hoy ($r = 1.0$).  
  $\text{multiplicador} = 1 + 0.10(1) + 0.06(1.0) = 1.16$  
  $$\text{orderScore}_A = -2.00 \times 1.16 = \mathbf{-2.32}$$
- **Nota B:** Nota normal (`pinned = 0`) modificada hace 30 días ($r = 0.5$).  
  $\text{multiplicador} = 1 + 0.10(0) + 0.06(0.5) = 1.03$  
  $$\text{orderScore}_B = -2.00 \times 1.03 = \mathbf{-2.06}$$

**Resultado de la consulta:** La **Nota A (-2.32)** aparece antes que la **Nota B (-2.06)**.

---

## 5. Modo Literal de Respaldo (Términos Cortos < 3 Caracteres)

Si **cualquiera** de las palabras buscadas tiene menos de 3 caracteres (ej. `"UI"`, `"DB"`, `"Go"` o `"UI árbol"`):
1. SQLite trigram no puede indexar fragmentos de 1 o 2 letras.
2. El sistema conmuta automáticamente al **modo literal**: recorre las memorias activas del proyecto mediante un cursor preparado (`statement.iterate`).
3. Compara en minúsculas Unicode nativas (`toLowerCase()`), admitiendo acentos y caracteres internacionales sin romperse.
4. En este modo no se calcula BM25:
   - `explanation.mode = "literal"`
   - `explanation.bm25 = null`
   - `explanation.multiplier = 1`
   - `explanation.orderScore = null`
5. Se ordenan colocando primero las notas prioritarias (`pinned DESC`), luego las más recientes (`updated_at DESC`) y finalmente por identificador (`id ASC`).
