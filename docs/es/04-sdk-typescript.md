# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Detección e Inspección de Asistentes para Atlas, Hogar Propio de Producto (`~/.forge614/engram/`), Migración Segura, Menú TUI de Asistentes y Réplica PostgreSQL Formatos 1, 2 y 3
> **Versiones de esta entrega:** Programa 1.1.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) / 7 (confirmaciones inmutables y refuerzo de búsqueda) | Formatos PostgreSQL 1, 2 y 3
> **Estado:** Vigente y Activo v1.1.0 (572 pruebas superadas, 15 omitidas en 90 archivos, tipos y valores de SDK verificados en macOS ARM64 con Bun 1.3.8)
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta la API pública en TypeScript de Forge614 Engram, cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias herramientas o extensiones, el soporte del Esquema 7 para confirmaciones inmutables y refuerzo de búsqueda FTS5 sin embeddings, los tipos formales de recuperación progresiva y del Centro de Control, y la superficie pública de detección e inspección de asistentes de IA utilizada por productos hermanos como Forge614 Atlas.

> [!NOTE]
> **Dirigido a desarrolladores y productos hermanos:** Este SDK está orientado a programadores y herramientas hermanas (como Forge614 Atlas) que integran memoria estructurada o necesitan detectar qué motores de inteligencia artificial están instalados en la máquina local. Los usuarios finales de terminal solo necesitan el binario `forge614-engram`. En aplicaciones consumidoras se importa desde `forge614-engram`.

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

  // Detección e inspección de asistentes de IA (para productos hermanos como Atlas)
  CLIENT_IDS,
  LABELS,
  isClientId,
  inspectAssistant,
  resolveAssistantPaths,
  coverageWarnings,
  type ClientId,
  type AssistantLocation,
  type AssistantOptions,
  type AssistantDescriptor,
  type AssistantPaths,
} from "forge614-engram";
```

### Principios Fundamentales del SDK

- **La API de SQLite permanece 100% síncrona:** Todas las operaciones de lectura, escritura, búsqueda, confirmaciones, sesiones, línea temporal (`timeline`) y contexto (`context`) en `MemoryStore` y `MemoryWorkspace` se ejecutan de forma inmediata y directa sobre SQLite sin requerir llamadas asíncronas (`async`/`await`).
- **Fachada Compatible `MemoryStore`:** La clase `MemoryStore` (ubicada en `src/app/memory-store.ts`) opera como un patrón de diseño Fachada (*facade pattern*): proporciona una interfaz pública estable, idéntica e inmutable a los consumidores del SDK, mientras delega internamente la persistencia a módulos especializados en `src/infrastructure/sqlite/` (`memory.ts`, `confirmations.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`, `control-center.ts`).
- **Eliminación de Rutas Internas Anteriores:** Los archivos históricos en la raíz de `src/` (`src/domain.ts`, `src/store.ts`, `src/identity.ts`, `src/sessions.ts`, `src/retrieval.ts`, `src/schema.ts`, `src/paths.ts`, etc.) han sido **eliminados por completo**. Cualquier herramienta externa debe importar únicamente desde la raíz del paquete `forge614-engram` (`src/index.ts`). El auditor de TypeScript AST (`tests/architecture/import-rules.ts`) prohíbe además que el código interno importe desde `src/index.ts` para evitar ciclos de importación.
- **Importación directa desde la raíz sin rutas profundas:** Los consumidores del SDK (como Atlas) deben importar siempre desde `forge614-engram`. No se debe importar ni recomendar rutas internas como `forge614-engram/src/...` o `forge614-engram/src/modules/...`.
- **Detección de Asistentes pública pero de solo lectura:** Mientras que los configuradores mutativos de ganchos (`src/interfaces/terminal/`) y el servidor MCP (`src/interfaces/mcp/`) permanecen como interfaces internas, la **detección pasiva e inspección de rutas** (`CLIENT_IDS`, `LABELS`, `isClientId`, `inspectAssistant`, `resolveAssistantPaths`, `coverageWarnings`) es una capacidad oficial de primer nivel expuesta por el SDK para que productos hermanos puedan auditar el entorno local sin ejecutar CLI ni modificar configuraciones.
- **No inventes un `AsyncMemoryWorkspace`:** No existe ningún envoltorio asíncrono público. La aplicación interactúa localmente con el almacén síncrono, y la interacción externa con asistentes se realiza mediante el protocolo estándar MCP o comandos de CLI.

---

## 2. Arquitectura de Clases del SDK

1. **`MemoryWorkspace` (Gestor de Alto Nivel):**
   Administra el espacio central del usuario en su hogar propio (`~/.forge614/engram/`), inicializa el entorno asegurando permisos (`0700`) y ejecutando la migración segura y automática de archivos de versiones anteriores, gestiona el ciclo de vida de los proyectos (`createProject`, `listProjects`, `renameProject`) y abre conexiones seguras a la base de datos (`open()`).
2. **`WorkspaceConfig` (Gestor de Configuración):**
   Gestiona la lectura y escritura atómica del archivo de configuración `~/.forge614/engram/.env`. Valida permisos (`0700` en carpeta, `0600` en archivo), formatos (Formato 2 local y Formato 3 con sincronización) y previene concurrencias con el cerrojo `.config-lock`. Su método `prepare()` ejecuta la migración atómica de archivos antiguos sueltos en `~/.forge614/` hacia `~/.forge614/engram/` antes de asegurar la carpeta en `0700`. Su propiedad `databasePath` apunta de forma predeterminada a `~/.forge614/engram/engram.db`. Incluye `repairExistingRoot()` para restringir automáticamente a `0700` directorios ordinarios preexistentes propiedad del usuario.
3. **`MemoryStore` (Motor de Base de Datos SQLite):**
   Ejecuta las operaciones directas sobre las tablas de SQLite (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, `enableSearchReinforcement`, `reinforcementEnabled`, `controlCenter`, etc.).
4. **`defaultDatabasePath(): string` (Ruta Predeterminada de Base de Datos):**
   Función auxiliar exportada que devuelve la ruta canónica hacia la base de datos local SQLite: `join(engramHome(), "engram.db")` (por defecto `~/.forge614/engram/engram.db`).

---

## 3. Métodos de `MemoryWorkspace`

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Repara automáticamente los permisos de un directorio preexistente propiedad del usuario a `0700` (`config.repairExistingRoot()`), migra de forma automática archivos antiguos sueltos si existen (`config.prepare()`), y asegura el archivo `.env` y la base `engram.db` con permisos seguros (`0700`/`0600`) dentro de `~/.forge614/engram/`. Si ya existen y son válidos, no altera ni reinicia datos.

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

### Métodos del Centro de Control (Supervisión y Estadísticas)

#### `store.controlCenter(): { capabilities: CapabilityState; projects: ProjectSummary[]; shared: SharedSummary | null }`
Consulta agregados estadísticos y estado de capacidades de la base de datos de forma 100% de solo lectura:
- `capabilities`: `{ schema: 3 | 4 | 5 | 6 | 7; assistantIntegration: boolean; sessions: boolean; reinforcement: boolean }`
- `projects`: Lista de proyectos con `projectId`, `name`, `createdAt`, `updatedAt`, lista de rutas `bindings` vinculadas, y conteos `{ active: number; archived: number; lastUpdatedAt: string | null }`.
- `shared`: Conteo `{ active: number; archived: number; lastUpdatedAt: string | null }` de recuerdos universales compartidos.
- **Privacidad estricta:** Esta consulta realiza únicamente agregaciones relacionales (`LEFT JOIN`) sin cargar en memoria títulos ni contenidos de recuerdos.

#### Función de Coordinación de Aplicación: `readControlCenter(config?: WorkspaceConfig): ControlCenterSnapshot`
(Ubicada en `src/app/control-center.ts`):
Carga un snapshot completo y seguro para la interfaz de usuario:
- Si `config.exists()` es `false`, devuelve un snapshot de estado no inicializado sin crear archivos ni base de datos en el disco.
- Abre un `MemoryStore` en modo de solo lectura (`readonly: true`), obtiene los agregados de `store.controlCenter()`, agrega la información segura de almacenamiento (`databasePath`, `postgres: "configured" | "not-configured"`) y garantiza el cierre del almacén en un bloque `finally`.

---

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
import { MemoryWorkspace, type SearchResult } from "forge614-engram";

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
import { MemoryWorkspace, type SummaryFields } from "forge614-engram";

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

---

## 6. Detección e Inspección de Asistentes de IA (Integración con Atlas)

### Propósito y Contexto de Integración

**Forge614 Atlas** (producto hermano de automatización y orquestación de agentes de IA) importa **Forge614 Engram** como un paquete o biblioteca TypeScript (`import { ... } from "forge614-engram"`), y **no** a través de comandos del CLI de terminal.

Atlas utiliza esta superficie pública del SDK para inspeccionar qué asistentes de desarrollo o motores de agente (`claude -p`, y en el futuro Codex u otros) están instalados en la máquina del usuario, con el fin de elegir el motor adecuado al coordinar subagentes autónomos.

### Aclaraciones Obligatorias de Seguridad (Operación Estrictamente Pasiva)

Esta capacidad opera bajo estrictas garantías de aislamiento y seguridad:

- **Inspección y cálculo de rutas de solo lectura:** No ejecuta comandos arbitrarios, no inicia procesos de asistentes ni altera archivos del sistema.
- **No conecta, configura, instala ni modifica asistentes:** No descarga programas, no modifica archivos de configuración ajenos (`.claude.json`, `config.toml`, `mcp.json`, `opencode.json`) ni altera permisos.
- **No agrega servidores MCP automáticamente:** La vinculación de herramientas MCP requiere los flujos explícitos de configuración de Engram (`forge614-engram setup` o `assistant-config`); este SDK solo informa si el asistente está instalado y en qué rutas se ubicaría su configuración.
- **No toca la base de datos ni abre archivos de memoria:** No inicializa `~/.forge614/engram/`, no lee ni escribe `.env`, y no abre conexiones SQLite (`engram.db`) ni PostgreSQL.
- **Separación estricta de responsabilidades:** Atlas toma las decisiones operativas sobre qué motor invocar; Engram se limita a proporcionar información objetiva, uniforme y segura sobre la presencia y rutas de los asistentes en el equipo.
- **Sin importaciones internas profundas:** El consumidor debe importar exclusivamente desde `forge614-engram`. No se debe importar desde rutas internas como `forge614-engram/src/...` ni `forge614-engram/src/modules/...`.

---

### Catálogo de Valores y Funciones Exportadas

Las siguientes herramientas de detección se encuentran disponibles directamente en la raíz de `forge614-engram`:

```typescript
import {
  CLIENT_IDS,
  LABELS,
  isClientId,
  inspectAssistant,
  resolveAssistantPaths,
  coverageWarnings,
} from "forge614-engram";
```

#### `CLIENT_IDS`
Lista constante e inmutable (`readonly string[]`) con los identificadores oficiales de los 5 asistentes conocidos y soportados actualmente:
```typescript
export const CLIENT_IDS = [
  "claude-code",
  "codex",
  "cursor",
  "opencode",
  "antigravity",
] as const;
```

#### `LABELS: Record<ClientId, string>`
Diccionario que asigna a cada identificador técnico su nombre legible oficial para interfaces de usuario y registros:
- `"claude-code"` → `"Claude Code"`
- `"codex"` → `"Codex"`
- `"cursor"` → `"Cursor"`
- `"opencode"` → `"OpenCode"`
- `"antigravity"` → `"Antigravity"`

#### `isClientId(value: string): value is ClientId`
Función de comprobación de tipo (*type guard*) en TypeScript. Recibe una cadena de texto arbitraria y valida si corresponde exactamente a uno de los identificadores válidos de `ClientId` antes de realizar operaciones de inspección o resolución de rutas.

#### `resolveAssistantPaths(clientId: ClientId, options?: AssistantOptions): AssistantPaths`
Calcula de manera puramente matemática y determinista las rutas esperadas en disco para el asistente consultado (según las variables de entorno de la plataforma y el directorio de usuario `$HOME`).
- **Retorno:** Objeto `AssistantPaths`:
  - `directory`: Directorio base de configuración del asistente (ej. `~/.claude`, `~/.codex`, `~/.cursor`).
  - `config`: Ruta absoluta al archivo principal de configuración (ej. `~/.claude.json`, `~/.cursor/mcp.json`).
  - `hooks`: Ruta al archivo de ganchos de eventos, si el cliente los soporta (ej. `settings.json` o `hooks.json`). En Antigravity es omitido (`undefined`).
  - `plugin`: Ruta al plugin integrado de Engram (`plugins/forge614-engram.js`).
  - `activeConfigs`: Lista de todas las rutas de configuración activas consideradas (crítico en OpenCode donde pueden coexistir orígenes globales XDG y específicos).
  - `activePlugins`: Lista de rutas de plugins considerados.
- **Invariante:** No crea carpetas ni archivos; únicamente proyecta las rutas canónicas del sistema de archivos.

#### `inspectAssistant(clientId: ClientId, options?: AssistantOptions): AssistantDescriptor`
Inspecciona de forma segura la máquina anfitriona sin lanzar subprocesos ni ejecutar binarios. Busca la presencia del ejecutable en las carpetas listadas en `PATH` y en rutas predeterminadas de la plataforma (macOS, Linux y Windows), comprueba si existen archivos de configuración y devuelve un descriptor estructurado `AssistantDescriptor`:
- `id`: Identificador del cliente consultado (`ClientId`).
- `label`: Nombre legible del asistente.
- `detected`:
  - `installed`: Booleano que confirma si el ejecutable fue encontrado y posee permisos de ejecución (`accessSync(..., X_OK)`).
  - `executable`: Ruta absoluta al ejecutable localizado en el disco, o `null` si no fue hallado.
  - `configFound`: Booleano que indica si se localizó al menos un archivo de configuración en disco.
  - `evidence`: Lista de evidencias objetivas recolectadas (rutas detectadas, origen en PATH, etc.).
- `configuration`:
  - `status`: Estado actual de configuración (`"absent"`, `"needs-configuration"`, `"configured"`, `"conflict"`, `"malformed"`, `"blocked"`).
  - `paths`: Rutas de configuración comprobadas en el disco.
  - `message`: Mensaje descriptivo opcional en caso de conflicto o configuración anómala.
- `automation`:
  - `coverage`: Nivel de cobertura de ganchos soportado por el asistente (`"session-and-prompt"`, `"session-only"`, `"experimental-system-and-compaction"`, `"mcp-only"`).
  - `warnings`: Lista de advertencias sobre las limitaciones reales de automatización de dicho asistente.

#### `coverageWarnings(clientId: ClientId, options?: AssistantOptions): string[]`
Genera una lista de advertencias claras sobre las limitaciones reales de automatización de cada asistente (por ejemplo, que Cursor solo inyecta orientación al inicio de sesión y no ante compactación, que Codex requiere aprobar ganchos nuevos en `/hooks`, o que Antigravity no dispone de ganchos duraderos hasta que exista un evento oficial verificado).

> [!IMPORTANT]
> **Punto Crítico de Arquitectura: Versión de Infraestructura vs Versión Pura de `coverageWarnings`**
> En la base de código existen internamente dos funciones con el nombre `coverageWarnings`:
> 1. Una función pura en `src/modules/assistants/catalog.ts` que requiere que se le suministren explícitamente las variables de entorno si se desean evaluar anulaciones como `OPENCODE_CONFIG_CONTENT`.
> 2. Una función de infraestructura en `src/infrastructure/assistants/catalog.ts` que implementa:
>    ```typescript
>    export function coverageWarnings(id: ClientId, options: AssistantOptions = {}): string[] {
>      return pureCoverageWarnings(id, { ...options, env: options.env ?? process.env });
>    }
>    ```
> **El SDK público exporta exclusivamente la versión de infraestructura.** Esto garantiza que consumidores externos, como Forge614 Atlas, inspeccionen automáticamente la situación real del equipo del usuario (`process.env`) sin necesidad de inyectar variables del sistema de forma manual. Jamás debe recurrirse a la importación de la versión pura desde rutas profundas.

---

### Tipos de TypeScript Exportados

```typescript
import type {
  ClientId,
  AssistantLocation,
  AssistantOptions,
  AssistantDescriptor,
  AssistantPaths,
} from "forge614-engram";
```

- **`ClientId`:** Tipo de unión literal `'claude-code' | 'codex' | 'cursor' | 'opencode' | 'antigravity'`.
- **`AssistantLocation`:** Estructura que permite especificar anulaciones manuales de rutas (`configDir`, `configFile`, `executable`).
- **`AssistantOptions`:** Opciones de inspección para pruebas o entornos personalizados (`home`, `env`, `path`, `platform`, `locations`, `engramExecutable`).
- **`AssistantDescriptor`:** Contrato formal completo retornado por `inspectAssistant()`.
- **`AssistantPaths`:** Contrato formal retornado por `resolveAssistantPaths()`.

---

### Ejemplo de Código de Producción para Proyectos Hermanos (Atlas)

El siguiente ejemplo ilustra el patrón estándar de consumo para que una herramienta externa o producto hermano (como Atlas) detecte los motores disponibles en la máquina del usuario antes de invocar subagentes:

```typescript
import {
  CLIENT_IDS,
  inspectAssistant,
  isClientId,
  resolveAssistantPaths,
} from "forge614-engram";

// 1. Recorrer todos los asistentes conocidos para auditar cuáles están instalados
for (const clientId of CLIENT_IDS) {
  const assistant = inspectAssistant(clientId);

  if (assistant.detected.installed) {
    console.log(`${assistant.label} está disponible en ${assistant.detected.executable}`);
    console.log(`Estado de configuración: ${assistant.configuration.status}`);
    console.log(`Nivel de automatización: ${assistant.automation.coverage}`);
  }
}

// 2. Validar un identificador dinámico de asistente antes de usarlo
const requestedClient = "claude-code";

if (isClientId(requestedClient)) {
  // 3. Resolver las rutas canónicas del asistente de forma segura
  const paths = resolveAssistantPaths(requestedClient);
  console.log(`Directorio base: ${paths.directory}`);
  console.log(`Archivo de configuración: ${paths.config}`);
  if (paths.hooks) {
    console.log(`Archivo de ganchos: ${paths.hooks}`);
  }
} else {
  console.error(`El cliente '${requestedClient}' no es un asistente soportado.`);
}
```

---

### Verificación y Calidad del Contrato del SDK

La superficie pública del SDK se verifica mediante una prueba de contrato estricta en `src/index.test.ts`:
1. **Verificación de Tipos y Tiempo de Ejecución:** Confirma que `CLIENT_IDS`, `LABELS`, `isClientId`, `inspectAssistant`, `resolveAssistantPaths` y `coverageWarnings` están definidos como funciones o constantes públicas y que los tipos TypeScript compilan sin errores.
2. **Suite Completa:** Ejecutada con `bun test src/index.test.ts` (4 pruebas correctas, 0 fallos) y `bun test` en toda la suite.
3. **Tipado Estricto:** Verificado con `bun run typecheck` (`tsc --noEmit`).
4. **Espacios y Formato:** Verificado con `git diff --check`.
