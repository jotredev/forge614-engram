# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo (439 pruebas totales en 76 archivos: 430 superadas y 9 omitidas sin binarios aislados PG; 439 superadas, 0 fallos, 2274 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 38.62s)
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta la API pública en TypeScript de Forge614 Engram, cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias herramientas o extensiones, el soporte del Esquema 7 para confirmaciones inmutables y refuerzo de búsqueda FTS5 sin embeddings, y los tipos formales de recuperación progresiva.

> [!NOTE]
> **Dirigido a desarrolladores:** Este SDK está orientado a programadores que desean integrar memoria estructurada dentro de herramientas o agentes TypeScript. Los usuarios finales de terminal solo necesitan el binario `forge614-engram`. No existe un paquete publicado en npm; las importaciones se realizan localmente desde `./src/index`.

---

## 1. Módulos Exportados e Inicialización

El punto de entrada público principal del SDK es `src/index.ts`:

```typescript
import {
  // Clases principales y configuración
  MemoryWorkspace,
  WorkspaceConfig,
  type WorkspaceSettings,
  MemoryStore,
  MemoryError,
  memoryTypes,
  defaultDatabasePath,

  // Tipos del dominio base y refuerzo (Esquema 7)
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
  type SearchExplanation,
  type ReinforcementExplanation,
  type Confirmation,
  type ConfirmationRequest,
  type MemoryScope,
  type SearchScope,

  // Tipos de sesiones progresivas (Esquema 6)
  type Session,
  type SessionEntry,
  type SessionSummary,
  type SessionSaveOptions,
  type SessionSaveResult,
  type SummaryFields,

  // Tipos de recuperación progresiva y contexto clasificado
  type MemoryPreview,
  type PreviewResult,
  type VersionRead,
  type TimelineInput,
  type TimelineRow,
  type TimelineResult,
  type ContextInput,
  type ContextRow,
  type ContextResult,

  // Funciones auxiliares de contexto de proyecto
  saveProjectMemoryWithSession,
  startProjectSession,
} from "./src/index";
```

### Principios Fundamentales del SDK

- **La API de SQLite permanece 100% síncrona:** Todas las operaciones de lectura, escritura, búsqueda, confirmaciones, sesiones, línea temporal (`timeline`) y contexto (`context`) en `MemoryStore` y `MemoryWorkspace` se ejecutan de forma inmediata y directa sobre SQLite sin requerir llamadas asíncronas (`async`/`await`).
- **Fachada Compatible `MemoryStore`:** La clase `MemoryStore` (ubicada en `src/app/memory-store.ts`) opera como un patrón de diseño Fachada (*facade pattern*): proporciona una interfaz pública estable, idéntica e inmutable a los consumidores del SDK, mientras delega internamente la persistencia a módulos especializados en `src/infrastructure/sqlite/` (`memory.ts`, `confirmations.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`).
- **Eliminación de Rutas Internas Anteriores:** Los archivos históricos en la raíz de `src/` (`src/domain.ts`, `src/store.ts`, `src/identity.ts`, `src/sessions.ts`, `src/retrieval.ts`, `src/schema.ts`, `src/paths.ts`, etc.) han sido **eliminados por completo**. Cualquier herramienta externa debe importar únicamente desde `src/index.ts`. El auditor de TypeScript AST (`tests/architecture/import-rules.ts`) prohíbe además que el código interno importe desde `src/index.ts` para evitar ciclos de importación.
- **Los módulos de red, transporte e interfaz son internos:**
  - El servidor MCP (`src/interfaces/mcp/`)
  - El ejecutor de ganchos de asistentes (`src/interfaces/terminal/` y `src/modules/assistants/`)
  - La interfaz de menú en terminal (`src/interfaces/tui/`)
  - El ejecutor de autoprueba (`src/infrastructure/assistants/self-test.ts`)
  - El motor de sincronización de réplica (`src/infrastructure/postgres/` y `src/app/synchronization.ts`)
  Son componentes especializados que no se reexportan como API pública en `src/index.ts`.
- **No inventes un `AsyncMemoryWorkspace`:** No existe ningún envoltorio asíncrono público. La aplicación interactúa localmente con el almacén síncrono, y la interacción externa con asistentes se realiza mediante el protocolo estándar MCP o comandos de CLI.

---

## 2. Arquitectura de Clases del SDK

1. **`MemoryWorkspace` (Gestor de Alto Nivel):**
   Administra el espacio central del usuario (`~/.forge614/`), inicializa el entorno, gestiona el ciclo de vida de los proyectos (`createProject`, `listProjects`, `renameProject`) y abre conexiones seguras a la base de datos (`open()`).
2. **`WorkspaceConfig` (Gestor de Configuración):**
   Gestiona la lectura y escritura atómica del archivo `~/.forge614/.env`. Valida permisos (`0700` en carpeta, `0600` en archivo), formatos (Formato 2 local y Formato 3 con sincronización) y previene concurrencias con el cerrojo `.config-lock`.
3. **`MemoryStore` (Motor de Base de Datos SQLite):**
   Ejecuta las operaciones directas sobre las tablas de SQLite (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, `enableSearchReinforcement`, `reinforcementEnabled`, etc.).

---

## 3. Métodos de `MemoryWorkspace`

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Prepara el archivo `.env` y la base `engram.db` con permisos seguros. Si ya existen y son válidos, no altera ni reinicia datos.

### `workspace.createProject(name: string): Project`
Crea y registra un nuevo proyecto en la base de datos, asignándole un identificador UUID `projectId` único.

### `workspace.listProjects(): Project[]`
Devuelve la lista de todos los proyectos registrados en la base central, ordenados cronológicamente.

### `workspace.renameProject(projectId: string, name: string): Project`
Actualiza el nombre visible del proyecto manteniendo intactos su `projectId` y sus recuerdos.

### `workspace.open(readonly = false): MemoryStore`
Abre el almacén `MemoryStore` tras validar los permisos y el esquema de la base de datos. Si `readonly` es `true`, abre la conexión en modo de solo lectura.

---

## 4. Métodos de `MemoryStore` (Esquemas 5, 6 y 7)

### Gestión de Esquemas y Asociaciones Locales

#### `store.enableAssistantIntegration(): void`
Habilita explícitamente el soporte de asistentes y asociaciones locales migrando aditivamente SQLite al **Esquema 5** (crea la tabla `project_bindings` y su índice).

#### `store.enableSessions(): void`
Habilita explícitamente el soporte de sesiones progresivas y contexto clasificado migrando aditivamente SQLite al **Esquema 6** (crea las tablas `sessions`, `session_entries`, `session_summaries`, `local_session_bindings` y `local_manual_sessions`).

#### `store.sessionsEnabled(): boolean`
Comprueba de forma síncrona si la base de datos actual cuenta con el Esquema 6 o superior (`PRAGMA user_version >= 6`).

#### `store.enableSearchReinforcement(): void`
Habilita explícitamente el registro de confirmaciones inmutables y el ranking reforzado migrando aditivamente SQLite al **Esquema 7** (crea las tablas `confirmations` y `confirmation_requests`).

#### `store.reinforcementEnabled(): boolean`
Comprueba de forma síncrona si la base de datos actual cuenta con el Esquema 7 (`PRAGMA user_version === 7`).

#### `store.bindProjectDirectory(directory: string, projectId: string): Project`
Asocia una ruta de directorio local a un `projectId` existente en la tabla `project_bindings`. Si la ruta ya estaba vinculada a otro proyecto, arroja `PROJECT_BINDING_CONFLICT`.

#### `store.resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (dir: string) => boolean): { project: Project | null; created: boolean }`
Resuelve la asociación de una carpeta con un proyecto:
- Si la carpeta ya está vinculada, devuelve el proyecto asociado (`created: false`).
- Si `create` es `false` y no está vinculada, devuelve `project: null`.
- Si `create` es `true`: verifica posibles colisiones de nombre o rutas no disponibles (`bindingAvailable`) antes de crear atómicamente el proyecto y registrar la vinculación.

---

### Ciclo de Vida de Sesiones Progresivas (Esquema 6)

#### `store.startSession(projectId: string, sessionId: string, runtimeDirectory?: string): Session`
Registra el inicio de una sesión en ejecución (`kind: "runtime"`) para el proyecto especificado. Si se proporciona `runtimeDirectory`, registra la vinculación local en `local_session_bindings`.

#### `store.endSession(projectId: string, sessionId: string): Session`
Cierra la sesión de ejecución estableciendo `endedAt` con la fecha y hora actual en ISO 8601. Si la sesión era de tipo manual, arroja `SESSION_KIND`.

#### `store.getSession(projectId: string, sessionId: string): Session | null`
Recupera el registro de una sesión validando que pertenezca al `projectId` indicado.

#### `store.startSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, sessionId: string, bindingAvailable?: (dir: string) => boolean): Session`
Resuelve la carpeta canónica de proyecto y arranca la sesión en ejecución en una única transacción atómica.

#### `store.saveSessionSummary(projectId: string, sessionId: string, fields: SummaryFields, request: { requestKey: string; expectedVersion?: number }): SessionSaveResult`
Persiste un resumen de sesión estructurado (con campos obligatorios `goal`, `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`) bajo el tema reservado inmutable `session/<sessionId>/summary` con tipo `procedure`. Actualiza el puntero en `session_summaries`.

---

### Persistencia de Recuerdos, Idempotencia y Confirmaciones (Esquema 7)

#### `store.save(input: SaveInput): MemoryVersion`
Persiste un recuerdo estándar (de proyecto o compartido).
- Si `input.requestKey` se repite con idéntica carga, devuelve la respuesta cacheada (*replay*). Si la carga difiere, arroja `REQUEST_CONFLICT`.
- Si la base cuenta con Esquema 7 y se guarda una repetición idéntica con nueva clave (mismo título, contenido, tipo y fijado) dentro de la ventana de 15 minutos (si `topicKey` es nulo) o con el mismo tema, registra una confirmación inmutable en `confirmations` sin incrementar la versión.
- Si el reloj local del sistema tiene desfase hacia el pasado respecto a la versión confirmada, arroja `CLOCK_SKEW`.

#### `store.saveWithSession(input: SaveInput, options?: SessionSaveOptions): SessionSaveResult`
Persiste un recuerdo asociándolo a una sesión específica:
- `options.sessionId`: Identificador explícito de sesión (`sessionSource: "explicit"`).
- `options.mode`: `"independent"` (CLI) o `"assistant"` (MCP).
- Si se omite `sessionId` en modo asistente, infiere automáticamente la sesión si existe exactamente una activa en los últimos 7 días; si hay múltiples activas arroja `AMBIGUOUS_SESSION`.
- En recuerdos compartidos (`scope: "shared"`), la asociación requiere `sessionId` y `options.projectId` explícito. Al guardarse, el recuerdo permanece con `projectId: null` y la respuesta externa no filtra metadatos privados de la sesión.

#### `store.saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, input: Omit<SaveInput, "projectId" | "scope">, options?: SessionSaveOptions, bindingAvailable?: (dir: string) => boolean): SessionSaveResult`
Resuelve la carpeta del proyecto y guarda el recuerdo con asociación de sesión en una única transacción inmediata.

---

### Recuperación Progresiva y Búsqueda Reforzada

#### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Búsqueda explicable en SQLite FTS5 con tokenizador trigram y ordenación reforzada `orderScore = bm25 * multiplier ASC`. Cada resultado incluye `explanation: SearchExplanation`.

#### `store.searchPreviews(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): PreviewResult[]`
Búsqueda progresiva de bajo consumo que emite fichas `MemoryPreview` truncadas a **300 puntos de código Unicode** (*code points*) con bandera booleana `truncated`.

#### `store.getVersion(projectId: string | null, id: string, version?: number): VersionRead | null`
Obtiene una revisión puntual histórica o la versión activa actual de un recuerdo, reportando `currentVersion` y `state`.

#### `store.timeline(projectId: string, input: TimelineInput): TimelineResult`
Reconstruye la secuencia cronológica de eventos de una sesión alrededor de un recuerdo de enfoque (`focus`), limitando vecinos anteriores (`before`, por defecto 5) y posteriores (`after`, por defecto 5).

#### `store.context(projectId: string | null, input?: ContextInput): ContextResult`
Construye una vista clasificada y ponderada en tres secciones (`pinned`, `recent`, `summaries`) respetando el tope de serialización UTF-8 en bytes (`maxBytes`, entre 1024 y 65536, por defecto 16384). Informa elementos omitidos (`omitted`) y si hubo truncamiento (`truncated`).

---

## 5. Ejemplos de Código Listos para Producción

### Ejemplo 1: Habilitación de Esquema 7, Confirmaciones Inmutables y Búsqueda Reforzada

```typescript
import { MemoryWorkspace, type SearchResult } from "./src/index";

const workspace = new MemoryWorkspace();
workspace.init();

const store = workspace.open();
try {
  // 1. Asegurar Esquema 7 para confirmaciones y ranking reforzado
  if (!store.reinforcementEnabled()) {
    store.enableSearchReinforcement();
  }

  const project = workspace.createProject("Motor de Búsqueda Reforzado");

  // 2. Guardar un recuerdo inicial con clave de petición idempotente
  const v1 = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "Cache en Memoria para Colas",
    content: "Usamos SQLite en modo WAL y transacciones diferidas para alta velocidad.",
    type: "decision",
    requestKey: "req-cola-01",
  });
  console.log(`Recuerdo creado: versión ${v1.version}, ID: ${v1.id}`);

  // 3. Reintento idéntico con la misma clave (Replay) -> Devuelve caché sin cambios
  const v1Replay = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "Cache en Memoria para Colas",
    content: "Usamos SQLite en modo WAL y transacciones diferidas para alta velocidad.",
    type: "decision",
    requestKey: "req-cola-01",
  });
  console.log(`Replay detectado: versión ${v1Replay.version} (idéntica)`);

  // 4. Observación repetida con nueva clave dentro de 15 min -> Confirmación inmutable
  const v1Confirm = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "Cache en Memoria para Colas",
    content: "Usamos SQLite en modo WAL y transacciones diferidas para alta velocidad.",
    type: "decision",
    requestKey: "req-cola-02",
  });
  console.log(`Confirmación registrada: sigue en versión ${v1Confirm.version} sin duplicar`);

  // 5. Búsqueda reforzada: auditar explicaciones matemáticas y multiplicadores
  const results: SearchResult[] = store.search(project.projectId, "sqlite colas wal");
  for (const item of results) {
    console.log(`- ${item.memory.title}`);
    console.log(`  BM25: ${item.explanation.bm25}`);
    console.log(`  Multiplicador: ${item.explanation.multiplier}`);
    console.log(`  OrderScore: ${item.explanation.orderScore}`);
    if (item.explanation.reinforcement) {
      console.log(`  Confirmaciones registradas: ${item.explanation.reinforcement.duplicateCount}`);
      console.log(`  Impulso de estabilidad: ${item.explanation.reinforcement.stabilityBoost}`);
      console.log(`  Impulso de recencia: ${item.explanation.reinforcement.recencyBoost}`);
    }
  }
} finally {
  store.close();
}
```

---

### Ejemplo 2: Ciclo de Sesión Progresiva y Contexto Clasificado

```typescript
import { MemoryWorkspace, type SummaryFields } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open();

try {
  const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const sessionId = "ses-pagos-migracion-v2";

  // Iniciar una sesión en ejecución (runtime session)
  const session = store.startSession(projectId, sessionId);
  console.log(`Sesión iniciada: ${session.sessionId}`);

  // Guardar resumen estructurado al término de la sesión
  const summary: SummaryFields = {
    goal: "Implementar idempotencia en pasarela de pagos",
    instructions: "Usar Redis SETNX con TTL de 86400 segundos",
    discoveries: "Se encontraron duplicados ocasionales por reintentos de Stripe",
    accomplishments: "Filtro de idempotencia implementado y probado",
    nextSteps: "Monitorear tasa de colisiones en producción",
    files: ["src/payments/webhooks.ts", "src/redis/client.ts"],
  };

  store.saveSessionSummary(projectId, sessionId, summary, {
    requestKey: "req-summary-pagos-01",
  });

  // Cerrar la sesión
  store.endSession(projectId, sessionId);

  // Ensamblar contexto clasificado respetando límite estricto de 16 KiB
  const context = store.context(projectId, {
    compact: false,
    maxBytes: 16384,
  });

  console.log(`Contexto clasificado: ${context.pinned.length} fijados, ${context.recent.length} recientes, ${context.summaries.length} resúmenes.`);
} finally {
  store.close();
}
```
