# 05. Arquitectura Interna, Monolito Modular por Funcionalidad, SQLite FTS5 y Fórmulas Matemáticas

> **Etapa:** FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo (439 pruebas totales en 76 archivos: 430 superadas y 9 omitidas sin binarios aislados PG; 439 superadas, 0 fallos, 2274 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 38.62s)
> **Traducción hermana:** [05 (EN). Internal Architecture, Modular Monolith, FTS5, and Ranking Formulas](../en/05-internal-architecture-and-formulas.md)

Este documento expone con rigor de tesis técnica la arquitectura interna de Forge614 Engram: los fundamentos de la reorganización en **monolito modular por funcionalidad**, los problemas resueltos, el árbol de directorios real y responsabilidades, las reglas de dependencias y auditoría automática mediante AST, las transacciones compuestas, la guía de colocación de cambios, la organización de pruebas colocadas (*colocated tests*), los esquemas relacionales SQLite 3 a 7, el protocolo de replicación PostgreSQL Formatos 1 a 3, y las fórmulas matemáticas exactas de BM25 ponderado, recencia de 30 días, saturación asintótica por confirmaciones inmutables y deduplicación por ventana móvil sin embeddings.

---

## 1. El Patrón Elegido: Monolito Modular por Funcionalidad

### 1.1. Nombre y Definición del Patrón
El patrón arquitectónico adoptado en Forge614 Engram es el **Monolito Modular por Funcionalidad (*Feature-Oriented Modular Monolith*)**.

- **Monolito (*Monolith*):** Significa que el sistema se compila, empaqueta y distribuye como un único artefacto ejecutable desplegable en el sistema operativo (`forge614-engram`), que corre en un solo proceso local en tu computadora. No se divide en múltiples microservicios remotos, ni utiliza comunicación de red interna, ni requiere demonios adicionales para funcionar.
- **Modular por Funcionalidad (*Feature-Oriented Modular*):** Significa que el código interno está dividido en fronteras lógicas cohesivas según el concepto de dominio al que sirven (memoria, confirmaciones, proyectos, sesiones, búsqueda, sincronización, espacio central, asistentes), en lugar de agruparse únicamente por el rol técnico de los archivos. Cada módulo es dueño exclusivo de sus reglas y define una puerta de entrada explícita (`index.ts`).

> [!NOTE]
> **Elección Contextual, no Dogma Universal:** La adopción del monolito modular por funcionalidad es una decisión técnica deliberada y contextual para un CLI local y SDK síncrono que opera sobre un único archivo de configuración (`~/.forge614/.env`) y una única base SQLite (`~/.forge614/engram.db`). No se vende aquí como un estándar obligatorio ni universal para todo proyecto informático.

### 1.2. Problemas Concretos Anteriores y Razones de la Reorganización
Antes de la modularización, el código fuente de Engram crecía acumulando problemas de cohesión:
1. **Mezcla indiscriminada en la raíz de `src/`:** Almacenamiento SQL, tipos de datos, validaciones de sesiones, búsquedas FTS5, adaptadores de configuración, menús de terminal y herramientas MCP residían juntos en el mismo directorio plano.
2. **Hipertrofia de `MemoryStore`:** La clase `MemoryStore` actuaba como un objeto dios (*God Object*), reuniendo sentencias SQL DDL, manipulación de proyectos, control inmutable de versiones, transacciones de eventos, validación de sesiones progresivas, búsquedas ponderadas e instantáneas de sincronización.
3. **Acoplamiento de presentación con infraestructura:** La interfaz de terminal TUI resolvía directamente rutas ejecutables en el disco, ejecutaba procesos de autoprueba e insertaba configuraciones de clientes, dificultando probar la interfaz de usuario de forma aislada.
4. **Fragilidad en pruebas:** Diversas pruebas dependían de rutas relativas frágiles hacia archivos profundos de `src/`, rompiéndose ante cualquier ajuste cosmético.

### 1.3. Alternativas Evaluadas y sus Costes Reales

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       COMPARATIVA DE ENFOQUES ARQUITECTÓNICOS                   │
├───────────────────────┬───────────────────────────────┬─────────────────────────┤
│ Enfoque               │ Ventajas                      │ Costes / Desventajas    │
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Carpetas Globales por │ Separación técnica simple     │ Dispersión funcional:   │
│ Capas (Layered)       │ (models/, services/, repos/)  │ una sola característica │
│                       │ intuitiva al inicio.          │ (e.g. sesiones) queda   │
│                       │                               │ repartida en 4 carpetas │
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Hexagonal Estricta    │ Sustituibilidad abstracta     │ Sobre-ingeniería total: │
│ (Ports & Adapters con │ total de cualquier tecnología │ repositorios genéricos, │
│ DI Container)         │ mediante interfaces puras.    │ contenedores DI y 3x    │
│                       │                               │ clases para CLI local.  │
├───────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Monolito Modular por  │ Cohesión por concepto, bajo   │ Requiere disciplina de  │
│ Funcionalidad         │ acoplamiento, SDK síncrono    │ imports, barriles       │
│ (ELEGIDO)             │ transparente, SQL directo y   │ explícitos y auditoría  │
│                       │ verificación AST automática.  │ continua con TypeScript.│
└───────────────────────┴───────────────────────────────┴─────────────────────────┘
```

- **Por qué se descartó la Arquitectura por Capas Global (*Layered Architecture*):** Agrupar todo el sistema en carpetas técnicas globales (`src/models/`, `src/services/`, `src/repositories/`) fragmenta cada funcionalidad. Para modificar cómo funciona una sesión o confirmación, un desarrollador debía editar archivos en múltiples extremos distantes del proyecto, perdiendo visión de conjunto.
- **Por qué se descartó la Arquitectura Hexagonal Estricta (*Strict Hexagonal Architecture*):** Introducir puertos formales para cada consulta, repositorios abstractos genéricos, entidades desconectadas de SQLite y un contenedor de inyección de dependencias (*Dependency Injection Container*) para un programa CLI que corre de forma local y síncrona representaba una sobre-ingeniería innecesaria que multiplicaba la complejidad sin aportar valor al usuario.
- **No es DDD completo ni Microservicios:** No se pretende etiquetar a Engram como *Domain-Driven Design* (DDD) purista, ni se utilizan eventos de integración distribuidos ni microservicios. Se toman los límites y fronteras útiles de diseño modular sin asumir la parafernalia dogmática.
- **Costes reales asumidos:** Mantener este patrón exige disciplina de exportaciones (`index.ts` por módulo), impedir activamente imports cruzados y auditar el código mediante un analizador de sintaxis (*AST auditor*).

---

## 2. Árbol Final Real y Responsabilidades por Directorio

El árbol de código fuente de producción en `src/` se organiza en cuatro capas conceptuales concéntricas, más una entrada ejecutable mínima y una biblioteca pública compartida:

```text
src/
├── cli.ts                         # [Arranque Mínimo] 2 líneas exactas de delegación
├── index.ts                       # [API Pública SDK] Barril único y estable
│
├── app/                           # [Coordinación de Flujos]
│   ├── index.ts                   # Exportaciones de coordinación
│   ├── memory-store.ts            # Fachada compatible con MemoryStore histórico
│   ├── workspace.ts               # Ciclo de vida y apertura del espacio central
│   ├── project-context.ts         # Resolución de identidad Git y vinculaciones
│   ├── synchronization.ts         # Coordinación de réplica y snapshots (sin I/O terminal)
│   ├── setup.ts                   # Secuencia de inicialización asistida (SetupIO)
│   └── assistants.ts              # Coordinación de detección y configuración de asistentes
│
├── modules/                       # [Reglas de Negocio Puras y Tipos] (Sin I/O)
│   ├── memory/                    # Tipos, validación, confirmaciones y ranking FTS5
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── validation.ts
│   │   ├── confirmations.ts       # Interfaces y lógica pura de confirmaciones
│   │   └── ranking.ts             # Fórmulas de multiplicador y explicación
│   ├── projects/                  # Identidad inmutable de proyectos (UUID)
│   ├── sessions/                  # Ciclo de sesiones, timbrado e inferencia
│   ├── search/                    # Términos, límites Unicode/bytes y proyecciones
│   ├── synchronization/           # Validación de snapshots y reconciliación 3-way
│   │   ├── index.ts
│   │   ├── snapshot.ts
│   │   └── confirmations.ts       # Serialización y merge de confirmaciones
│   ├── workspace/                 # Contratos de configuración global del entorno
│   └── assistants/                # Catálogo, protocolo de memoria y ganchos
│
├── infrastructure/                # [Adaptadores de Entrada/Salida Concretos]
│   ├── sqlite/                    # Conexión, esquemas y operaciones especializadas
│   │   ├── connection.ts          # Apertura con WAL y pragmas estrictos
│   │   ├── schema.ts              # DDL de Esquemas 3, 4, 5, 6 y 7
│   │   ├── projects.ts            # Consultas de proyectos y vínculos
│   │   ├── memory.ts              # Consultas de recuerdos y versiones
│   │   ├── confirmations.ts       # Persistencia y consultas de confirmaciones/requests
│   │   ├── writes.ts              # Transacciones compuestas atómicas exteriores
│   │   ├── sessions.ts            # Consultas de sesiones y entradas
│   │   ├── search.ts              # Consultas SQLite FTS5 y proyecciones
│   │   ├── snapshots.ts           # Lectura/escritura de instantáneas locales (Formato 3)
│   │   └── workspace-database.ts  # Ciclo de vida de la base de datos
│   ├── postgres/                  # Adaptador de red y réplica remota CAS (replica.ts)
│   ├── filesystem/                # Acceso a disco (.env, permisos 0700/0600, locks)
│   └── assistants/                # Adaptadores de clientes, JSONC, TOML y autoprueba
│
├── interfaces/                    # [Puntos de Entrada y Presentación]
│   ├── cli/                       # Intérprete de comandos y formateadores JSON
│   ├── mcp/                       # Servidor MCP sobre stdio (10 herramientas)
│   ├── terminal/                  # Adaptadores de ganchos nativos de asistentes
│   └── tui/                       # Menú interactivo TUI en pantalla completa
│
└── shared/                        # [Primitivas Compartidas]
    └── errors.ts                  # Clase MemoryError y catálogo de códigos de error
```

---

## 3. Reglas de Dependencias y Auditoría Automática con AST

Para evitar acoplamientos espagueti y ciclos entre componentes, el proyecto impone un flujo unidireccional estricto:

```text
interfaces  ──►  app  ──►  modules  ──►  shared
     │            │
     ▼            ▼
infrastructure ───┘
```

### Reglas Formales de Importación:
1. `modules/` jamás importa de `infrastructure/`, `app/`, ni `interfaces/`. Contiene TypeScript puro sin I/O.
2. `infrastructure/` implementa persistencia y adaptadores concretos; no depende de `interfaces/` ni de `app/`.
3. `app/` orquesta casos de uso invocando `modules/` e `infrastructure/`.
4. `interfaces/` recibe peticiones del usuario o asistente y delega en `app/`.
5. `src/index.ts` es la única puerta de entrada para consumidores externos; el código interno tiene prohibido importar desde `src/index.ts`.

### Auditor de Arquitectura AST (`tests/architecture/import-rules.ts`):
- Lee los archivos fuente y extrae todas las declaraciones de `import`, `export`, tipos `import(...)` y llamadas a `require`.
- Construye un grafo dirigido entre componentes (`graph.set(origen, destino)`).
- Ejecuta una búsqueda en profundidad (*Depth-First Search - DFS*) rastreando caminos activos mediante dos conjuntos: `visiting` (nodos en la pila actual) y `visited` (nodos ya validados).
- Si durante la exploración se encuentra un nodo que ya está en `visiting`, el auditor aborta la suite reportando: `component cycle: A -> B -> C -> A`.

---

## 4. Esquemas Relacionales SQLite (Esquemas 3 a 7)

SQLite almacena el estado de esquema en `PRAGMA user_version`.

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     EVOLUCIÓN DE ESQUEMAS SQLITE EN ENGRAM                      │
├─────────┬───────────────────────────────────┬───────────────────────────────────┤
│ Esquema │ Tablas Añadidas                   │ Propósito                         │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 3       │ projects, memories,               │ Almacenamiento local básico con   │
│         │ memory_versions, events, requests │ control inmutable de versiones.   │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 4       │ sync_checkpoints                  │ Soporte de réplica PostgreSQL.    │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 5       │ project_bindings                  │ Ganchos de asistentes y carpetas  │
│         │                                   │ locales vinculadas a proyectos.   │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 6       │ sessions, session_entries,        │ Sesiones progresivas de trabajo,  │
│         │ session_summaries,                │ líneas temporales y contexto      │
│         │ local_session_bindings,           │ clasificado en tres particiones.  │
│         │ local_manual_sessions             │                                   │
├─────────┼───────────────────────────────────┼───────────────────────────────────┤
│ 7       │ confirmations,                    │ Confirmaciones inmutables de      │
│         │ confirmation_requests             │ observaciones repetidas y ranking │
│         │                                   │ FTS5 reforzado sin embeddings.    │
└─────────┴───────────────────────────────────┴───────────────────────────────────┘
```

### 4.1. DDL del Esquema 7 (Confirmaciones y Refuerzo de Búsqueda)

```sql
-- Registro de confirmaciones inmutables de recuerdos
CREATE TABLE IF NOT EXISTS confirmations (
  confirmation_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(session_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmations_memory_id ON confirmations(memory_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_recorded_at ON confirmations(recorded_at);

-- Registro de peticiones idempotentes por clave
CREATE TABLE IF NOT EXISTS confirmation_requests (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_version INTEGER,
  confirmation_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_confirmation_requests_key ON confirmation_requests(request_key);
```

---

## 5. Fórmulas Matemáticas de Búsqueda FTS5 Reforzada (Sin Embeddings)

El motor de búsqueda de Forge614 Engram optimiza la recuperación de información mediante SQLite FTS5 combinando la ponderación léxica de BM25 con factores de recencia y estabilidad basados en confirmaciones inmutables.

### 5.1. Ponderación Léxica BM25 en SQLite FTS5

SQLite FTS5 evalúa las coincidencias utilizando la función BM25 (*Best Matching 25*):

$$\text{BM25}(D, Q) = \sum_{i=1}^{N} \text{IDF}(q_i) \cdot \frac{f(q_i, D) \cdot (k_1 + 1)}{f(q_i, D) + k_1 \cdot \left(1 - b + b \cdot \frac{|D|}{\text{avgdl}}\right)}$$

- **Parámetros del motor:** $k_1 = 1.2$, $b = 0.75$.
- **Ponderación por columnas en Engram:**
  - `title`: peso $5.0$
  - `topic_key`: peso $3.0$
  - `content`: peso $1.0$
- **Naturaleza del puntaje en SQLite FTS5:** La función nativa `bm25(memories_fts, 5.0, 3.0, 1.0)` devuelve **valores negativos**, donde un valor más negativo representa una coincidencia más fuerte y relevante.

### 5.2. Los Tres Factores del Multiplicador de Refuerzo

Para cada recuerdo candidato, Engram calcula tres variables de soporte evaluadas contra un reloj único determinista (`request_clock = nowMs`):
1. $\text{revisionCount} = \text{version} - 1$ (revisiones históricas excluyendo la creación inicial).
2. $\text{duplicateCount} = \text{count}(\text{confirmations})$ (número de confirmaciones inmutables registradas).
3. $\text{lastSeenAt} = \max(\text{updatedAt}, \max(\text{recordedAt}))$ (último momento en que el dato fue visto o confirmado).
4. $\text{ageDays} = \max\left(0, \frac{\text{nowMs} - \text{lastSeenAtMs}}{86,400,000}\right)$ (antigüedad en días decimales).
5. $n = \text{revisionCount} + \text{duplicateCount}$ (número total de observaciones y revisiones acumuladas).

El multiplicador total de refuerzo combina tres impulsos complementarios:

$$\text{multiplier} = 1 + \underbrace{0.10 \times \text{pinned}}_{\text{Impulso de Fijado}} + \underbrace{\frac{0.06}{1 + \frac{\text{ageDays}}{30}}}_{\text{Impulso de Recencia}} + \underbrace{0.04 \times \frac{n}{n + 4}}_{\text{Impulso de Estabilidad}}$$

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     DESGLOSE DEL MULTIPLICADOR DE REFUERZO                      │
├─────────────────────┬──────────────┬──────────────┬─────────────────────────────┤
│ Componente          │ Factor Máx.  │ Rango        │ Comportamiento              │
├─────────────────────┼──────────────┼──────────────┼─────────────────────────────┤
│ Base                │ 1.00         │ 1.00         │ Valor neutral mínimo.       │
│ Impulso Fijado      │ +0.10        │ {0, 0.10}    │ 0.10 si pinned es verdadero;│
│                     │              │              │ 0 si es falso.              │
│ Impulso Recencia    │ +0.06        │ (0, 0.06]    │ Escala de 30 días:          │
│                     │              │              │ 0.06 al instante 0;         │
│                     │              │              │ 0.03 a los 30 días;         │
│                     │              │              │ converge a 0 con el tiempo. │
│ Impulso Estabilidad │ +0.04        │ [0, 0.04)    │ Saturación asintótica:      │
│                     │              │              │ n=0 -> 0.00                 │
│                     │              │              │ n=1 -> 0.008                │
│                     │              │              │ n=4 -> 0.020                │
│                     │              │              │ n=8 -> 0.0267               │
│                     │              │              │ converge a 0.04 al infinito.│
├─────────────────────┼──────────────┼──────────────┼─────────────────────────────┤
│ Multiplicador Total │ 1.20         │ [1.00, 1.20] │ Rango dinámico acotado.     │
└─────────────────────┴──────────────┴──────────────┴─────────────────────────────┘
```

### 5.3. Puntaje de Ordenamiento (*Order Score*) y Dirección ASC

$$\text{orderScore} = \text{BM25} \times \text{multiplier}$$

**Por qué se ordena en dirección ASC:**
- Dado que el valor BM25 de SQLite es **negativo** (ej. $-2.0$), al multiplicarlo por un $\text{multiplier} > 1.0$, el resultado se vuelve **más negativo** (menor algebraicamente).
- **Ejemplo práctico de desempate:**
  - Recuerdo A: $\text{BM25} = -2.0$, $\text{multiplier} = 1.18$ $\implies \text{orderScore} = -2.36$.
  - Recuerdo B: $\text{BM25} = -2.0$, $\text{multiplier} = 1.06$ $\implies \text{orderScore} = -2.12$.
  - Comparación: $-2.36 < -2.12$.
  - Al ordenar de menor a mayor (`ORDER BY orderScore ASC, id ASC`), el Recuerdo A (más reforzado) aparece **antes** que el Recuerdo B.

### 5.4. Evaluación Determinista y Ordenación Antes del LIMIT
- **Reloj Único de Consulta:** Engram evalúa una sola marca temporal `request_clock(nowMs)` por consulta de búsqueda. No utiliza llamadas repetidas a funciones de reloj de sistema por fila, impidiendo distorsiones de tiempo en bases de datos extensas.
- **Ordenación Previa a LIMIT:** El cálculo del multiplicador y el ordenamiento `orderScore ASC` se aplican en la sentencia SQL **antes de la cláusula `LIMIT`**. Esto garantiza que los mejores $K$ resultados sean globalmente exactos y no una muestra truncada arbitrariamente.
- **Búsqueda Literal:** Si la consulta no produce coincidencias FTS5 o se realiza una búsqueda exacta literal, `bm25` y `orderScore` son `null`. El ordenamiento recurre a:
  ```sql
  ORDER BY m.pinned DESC, last_seen_at DESC, m.id ASC
  ```

---

## 6. Deduplicación por Ventana Móvil, Replay y Manejo de Conflictos

### 6.1. Ventana Móvil de 15 Minutos para Recuerdos sin Tema
Cuando se guarda un recuerdo sin tema (`topicKey: null`):
- Engram busca notas candidatas activas cuyo contenido, título, tipo y estado fijado coincidan exactamente.
- **Restricción temporal estricta:** Solo se consideran candidatos observados en los últimos **15 minutos** (rango inclusivo entre `nowMs - 900,000` y `nowMs`).
- Se descartan marcas temporales futuras.
- Si existen múltiples candidatos dentro de la ventana, se selecciona el que tenga mayor `lastSeenAt`, resolviendo empates por `id ASC`.
- Si han transcurrido más de 15 minutos, Engram crea un recuerdo completamente nuevo para preservar la independencia de hechos temporalmente separados.

### 6.2. Reintento Idempotente por Clave de Petición (*Request Key Replay*)
- Si se reenvía una petición con una `requestKey` existente y el hash criptográfico SHA-256 de su carga coincide exactamente con el registrado en `confirmation_requests`, Engram devuelve inmediatamente la respuesta previamente almacenada.
- **No añade confirmaciones ni incrementa versiones.**

### 6.3. Conflicto de Carga en Reintento (`REQUEST_CONFLICT`)
- Si se reutiliza una `requestKey` existente pero con un contenido o título diferente (hash SHA-256 divergente), la operación se cancela arrojando `REQUEST_CONFLICT`.

### 6.4. Protección de Reloj Local (*Clock Skew*) (`CLOCK_SKEW`)
- Si el reloj local del sistema indica una fecha anterior a la fecha registrada en la versión del recuerdo existente que se pretende confirmar, la operación aborta con `CLOCK_SKEW` para preservar la causalidad cronológica inmutable.

---

## 7. Protocolo de Sincronización PostgreSQL y Formato 3

### 7.1. Tabla Remota Física Invariable (`state.format = 1`)
En el servidor PostgreSQL, la tabla física de sincronización `forge614_sync.state` conserva su columna estructural `format = 1`:
- El esquema relacional físico de PostgreSQL no requiere alteraciones DDL destructivas ni migraciones en producción.
- Lo que evoluciona es la cabecera del snapshot encapsulado en el payload JSON.

### 7.2. Snapshot en Formato 3
El Formato 3 extiende la estructura de la instantánea añadiendo dos colecciones serializadas:
- `confirmations`: Arreglo con todos los registros inmutables de confirmación (`confirmationId`, `memoryId`, `version`, `recordedAt`, `sessionId`).
- `confirmationRequests`: Arreglo con las peticiones idempotentes cacheadas.

### 7.3. Promoción Explícita CAS y Rechazo en `sync-watch`
- **Promoción Controlada:** La promoción a Formato 3 exige ejecutar explícitamente `forge614-engram sync --upgrade-format`.
- **Rechazo en Modo Continuo:** El comando `sync-watch` rechaza terminantemente `--upgrade-format` con `INVALID_INPUT` para evitar que un proceso automático no supervisado promueva formatos sin conocimiento del operador.
- **Compatibilidad con Pares:** Todos los equipos pares deben haberse actualizado a Esquema 7 (`reinforcement-enable`) antes de sincronizar con una réplica promovida a Formato 3. Si un cliente no reforzado recibe un snapshot en Formato 3, aborta con `REINFORCEMENT_REQUIRED`.

---

## 8. Organización de Pruebas Colocadas (*Colocated Tests*) y Conteo Oficial

### 8.1. Correspondencia Uno a Uno
Cada uno de los **53 archivos de producción que contienen lógica de negocio** cuenta con un archivo hermano colocado de prueba (`<nombre>.test.ts`):
- `src/infrastructure/sqlite/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- `src/modules/memory/ranking.ts` $\leftrightarrow$ `ranking.test.ts`
- `src/modules/memory/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- `src/modules/synchronization/confirmations.ts` $\leftrightarrow$ `confirmations.test.ts`
- Pruebas de integración de colaboración en `src/app/__tests__/`:
  - `confirmations.integration.test.ts`
  - `confirmations-sync.integration.test.ts`

### 8.2. Historial Oficial de Pruebas

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      HISTORIAL Y VERIFICACIÓN DE PRUEBAS                        │
├───────────────────────────────┬──────────────┬───────────────┬──────────────────┤
│ Hito de Verificación          │ Pruebas      │ Archivos      │ Estado           │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ Baseline Previo (Handoff 09)  │ 250 pass     │ 18 archivos   │ 1506 aserciones  │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ Monolito Modular (Handoff 10) │ 369 pass*    │ 69 archivos   │ 1891 aserciones  │
├───────────────────────────────┼──────────────┼───────────────┼──────────────────┤
│ FTS5 Reforzado (Entrega 11)   │ 439 pass**   │ 76 archivos   │ 2274 aserciones  │
│                               │ (430 pass /  │               │ (38.62s)         │
│                               │  9 skip PG)  │               │                  │
└───────────────────────────────┴──────────────┴───────────────┴──────────────────┘
* Nota: Con binario PG temporal configurado (361 pass / 8 skip sin binario).
** Nota: 430 superadas y 9 omitidas sin binarios aislados PG. Con FORGE614_TEST_POSTGRES_BIN
   configurado, se ejecutan y superan 439 pass, 0 fail, 2274 aserciones en 38.62s.
```

---

## 9. Atribución y Linaje de Diseño

- **Inspiración en Gentleman Programming:** El modelo de recuperación progresiva mediante vistas previas acotadas, lectura de versiones históricas bajo demanda, reconstrucción de líneas temporales de sesión y refuerzo de relevancia se inspira en los conceptos desarrollados por Gentleman (vinculado al commit `2cdda9041c1bff86f6b769171fd407fa677027cb`).
- **Innovaciones Propias de Forge614:**
  - Fórmula matemática exacta de ordenamiento $BM25 \times \text{multiplier}$ con saturación asintótica $\frac{n}{n+4}$ y decaimiento suave en escala de 30 días.
  - Reloj único de evaluación de consulta `request_clock(nowMs)` para evitar derivas mid-query.
  - Confirmaciones inmutables en tabla dedicada `confirmations` sin fabricar versiones redundantes de recuerdos.
  - Deduplicación por ventana móvil de 15 minutos para recuerdos sin tema.
  - Caché de peticiones idempotentes por hash criptográfico SHA-256 con detección de conflicto `REQUEST_CONFLICT`.
  - Promoción explícita CAS atómica a Formato 3 en réplica PostgreSQL con invariabilidad del esquema físico (`state.format = 1`).
  - Monolito modular con 53 componentes lógicos respaldados por pruebas hermanas colocadas y verificación estricta de imports por AST.
