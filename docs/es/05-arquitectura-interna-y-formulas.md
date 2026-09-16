# Arquitectura Interna, Almacenamiento y Fórmulas

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/05-internal-architecture-and-formulas.md)

Este documento detalla el funcionamiento interno de Forge614 Engram a nivel de motor de almacenamiento, esquemas de bases de datos relacionales, sincronización reactiva y las fórmulas matemáticas que determinan la relevancia en las búsquedas.

---

## 1. Configuración de Base de Datos y Parámetros SQLite (Pragmas)

Forge614 Engram utiliza el motor SQLite integrado en Bun (`bun:sqlite`) configurado bajo estándares estrictos de integridad de datos:

1. **`PRAGMA foreign_keys = ON;`**  
   Garantiza que no existan registros huérfanos. Por ejemplo, una versión en `memory_versions` no puede existir si no apunta a un recuerdo válido en `memories`.
2. **`PRAGMA busy_timeout = 5000;`**  
   Si dos procesos intentan escribir al mismo tiempo en el mismo archivo, el segundo proceso esperará pacientemente hasta **5 segundos** a que el primero termine su transacción antes de fallar por base ocupada (`SQLITE_BUSY`).
3. **`PRAGMA application_id = 1177956660;`**  
   Número de identificación exclusivo de Forge614. Al abrir una base de datos existente, el sistema comprueba este número mágico. Si el archivo pertenece a otra aplicación, se rechaza inmediatamente para evitar corromper bases de datos ajenas.
4. **`PRAGMA user_version = 1;`**  
   Control de versión del esquema estructural. Si en el futuro se introduce una versión `2` y un programa antiguo intenta abrirla, el sistema la rechazará protegiendo tus datos.
5. **`PRAGMA journal_mode = WAL;`**  
   Activa el diario de escritura por adelantado (*Write-Ahead Logging*). En este modo, las lecturas no bloquean a las escrituras y las escrituras no bloquean a las lecturas, permitiendo un rendimiento de ultra alta velocidad.
   - **Archivos auxiliares en disco:** Este modo genera junto a `memory.sqlite` dos archivos temporales: `memory.sqlite-wal` (donde se anotan las escrituras pendientes) y `memory.sqlite-shm` (memoria compartida de índices).
   - ⚠️ **Precaución de respaldo:** Nunca copies únicamente el archivo `.sqlite` mientras haya procesos escribiendo en él; para hacer una copia segura, espera a que los procesos cierren la base.

---

## 2. Esquema Relacional de Tablas

La base de datos organiza la información en 4 tablas relacionales principales y 1 tabla virtual de búsqueda:

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            memories             │       │         memory_versions         │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ rowid (PK interno)              │       │ memory_id (FK -> memories.id)   │◄──┐
│ id (UUID único)                 │◄──┐   │ version (Entero >= 1)           │   │
│ project (Texto normalizado)     │   │   │ snapshot (JSON validado)        │   │
│ topic_key (Tema único/opcional) │   │   └─────────────────────────────────┘   │
│ type (Categoría conceptual)     │   │                     ▲                   │
│ title (Título)                  │   │                     │                   │
│ content (Texto vigente)         │   │                     │                   │
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
│ id (Autoincremental)            │   │   │          memories_fts           │
│ memory_id (FK -> memories.id)   ├───┘   ├─────────────────────────────────┤
│ action ('save'|'archive'|'rest')│       │ Tabla Virtual FTS5 (trigram)    │
│ version (Entero)                │       │ Reflejo de title, content, topic│
│ created_at (Timestamp ISO)      │       └─────────────────────────────────┘
└─────────────────────────────────┘
```

### Detalle de cada tabla:

1. **`memories` (Estado actual):**  
   Almacena la versión vigente de cada recuerdo. Posee una restricción de unicidad compuesta `UNIQUE(project, topic_key)` que garantiza que un mismo proyecto no tenga dos notas activas compitiendo por el mismo tema.
2. **`memory_versions` (Auditoría inmutable):**  
   Almacena cada foto histórica de contenido con la restricción `CHECK(json_valid(snapshot))`. La clave primaria compuesta `(memory_id, version)` asegura que una versión no pueda ser sobreescrita jamás.
3. **`requests` (Idempotencia y seguridad de reintentos):**  
   Registra cada clave de petición (`request_key`) asociada a su huella digital criptográfica SHA-256 (`payload_hash`). Si un cliente reenvía la misma clave con el mismo contenido, se devuelve la versión guardada sin escribir filas nuevas.
4. **`events` (Registro cronológico de acciones):**  
   Anota cada operación realizada (`save`, `archive`, `restore`) con su fecha y versión resultante.
5. **`memories_fts` (Motor de texto completo):**  
   Tabla virtual basada en el módulo FTS5 de SQLite configurada con el tokenizador `tokenize='trigram'`.

---

## 3. Disparadores Automáticos (Triggers)

Para garantizar que el índice de búsqueda nunca quede desincronizado del texto real, la base cuenta con tres disparadores automáticos a nivel de motor:

- **`memory_insert`:** Al insertar una memoria, añade inmediatamente su fila correspondiente en `memories_fts`.
- **`memory_delete`:** Si se eliminara una fila de `memories`, purga su entrada en el índice FTS.
- **`memory_update`:** Al actualizar título, contenido o tema, borra la entrada vieja del índice y registra la nueva en una única operación atómica.

---

## 4. Fórmulas de Búsqueda y Ordenamiento

La búsqueda de recuerdos en Forge614 Engram opera en dos modos mutuamente excluyentes según la longitud de los términos ingresados:

### Modo 1: Búsqueda FTS5 Trigram con Algoritmo BM25 Modificado

Se activa cuando **todas las palabras de la consulta tienen 3 o más caracteres** (ej. `"base datos sqlite"`).

#### Paso A: Ponderación por Campos
El algoritmo BM25 evalúa la presencia de las palabras asignando pesos diferenciados según dónde aparecen:
$$\text{bm25}(\text{memories\_fts}, 5.0, 1.0, 3.0)$$
- **Título (`title`):** Peso `5.0` (las coincidencias en el título son 5 veces más relevantes).
- **Contenido (`content`):** Peso `1.0` (relevancia base).
- **Tema (`topic_key`):** Peso `3.0` (las coincidencias en la clave temática tienen alta relevancia).

> [!NOTE]
> En la implementación interna de SQLite, **los valores de BM25 son números negativos**, donde los valores más alejados de cero (más negativos) representan una coincidencia textual más fuerte.

#### Paso B: Factor de Recencia Temporal ($r$)
El sistema calcula cuánto tiempo ha pasado desde la última modificación (`updatedAt`) utilizando una curva de decaimiento suave con referencia a 30 días:

$$r = \frac{1}{1 + \frac{\max(0, \text{días transcurridos})}{30}}$$

- Si la nota se actualizó **hoy** ($\text{días} = 0$): $r = \frac{1}{1 + 0} = 1.0$ (máxima frescura).
- Si la nota se actualizó hace **30 días**: $r = \frac{1}{1 + 1} = 0.5$ (frescura media).
- Si la nota se actualizó hace **90 días**: $r = \frac{1}{1 + 3} = 0.25$.

#### Paso C: Multiplicador de Prioridad y Frescura
Se calcula un factor multiplicador que premia notas marcadas con prioridad alta (`pinned = true`) y notas recién actualizadas:

$$\text{multiplicador} = 1 + (0.10 \times \text{pinned}) + (0.06 \times r)$$

- Si la nota está fijada (`pinned = true`), suma un bono fijo de `+0.10`.
- La frescura temporal suma hasta un máximo de `+0.06` (cuando $r=1.0$).

#### Paso D: Puntuación Final de Ordenamiento (`orderScore`)
$$\text{orderScore} = \text{BM25} \times \text{multiplicador}$$

Dado que el valor BM25 es negativo (ej. `-2.0`), al multiplicarlo por un factor mayor a 1 (ej. `1.13`), el resultado se vuelve **más negativo** (ej. `-2.26`), escalando posiciones en la consulta:
```sql
ORDER BY bm25 * multiplier ASC, m.id ASC
```

#### Ejemplo Numérico Ilustrativo:
Imagina dos notas que tienen idéntica coincidencia textual ($\text{BM25} = -2.0$):
1. **Nota A:** Modificada hoy ($r=1.0$), con prioridad activa ($\text{pinned}=1$).  
   $\text{multiplicador} = 1 + 0.10(1) + 0.06(1.0) = 1.16$  
   $\text{orderScore} = -2.0 \times 1.16 = \mathbf{-2.32}$
2. **Nota B:** Modificada hace 30 días ($r=0.5$), sin prioridad ($\text{pinned}=0$).  
   $\text{multiplicador} = 1 + 0 + 0.06(0.5) = 1.03$  
   $\text{orderScore} = -2.0 \times 1.03 = \mathbf{-2.06}$

Al ordenar de menor a mayor (`ASC`), la **Nota A (-2.32)** aparece antes que la **Nota B (-2.06)**.

---

### Modo 2: Búsqueda Literal de Respaldo (Términos Cortos)

Si **cualquiera** de las palabras ingresadas tiene menos de 3 caracteres (por ejemplo: `"UI"`, `"DB"`, `"C"`, `"Go"` o `"UI árbol"`), el índice de trigramas de SQLite no puede indexarlas.

En este caso, el sistema conmuta de forma transparente al **modo literal**:
1. Abre un cursor preparado (`statement.iterate`) para no saturar la memoria RAM.
2. Compara cada recuerdo activo del proyecto usando minúsculas Unicode nativas (`toLowerCase()`). Esto permite encontrar palabras cortas y caracteres con acentos o tildes (a diferencia del comando `LIKE` de SQL que solo funciona con el abecedario inglés ASCII).
3. En este modo no se computa el valor BM25:
   - `explanation.mode = "literal"`
   - `explanation.bm25 = null`
   - `explanation.multiplier = 1`
   - `explanation.orderScore = null`
4. Se ordenan colocando primero las notas con prioridad (`pinned DESC`), luego las más recientemente modificadas (`updated_at DESC`) y finalmente por identificador (`id ASC`).

---

## 5. Garantía de Atomicidad y Reversión ante Fallos (Rollback)

Toda operación de escritura se ejecuta dentro de una transacción inmediata:
```typescript
this.db.transaction(() => { ... }).immediate();
```
Esto garantiza la regla del **todo o nada**: si al guardar una nueva versión falla la escritura del historial, la inserción del evento o la actualización del índice FTS, la base de datos revierte automáticamente todos los cambios al estado previo exacto, evitando cualquier corrupción parcial.
