# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** Monolito Modular por Funcionalidad, Sesiones Progresivas de Memoria, Contexto Clasificado, MCP Local (10 Herramientas), Menú TUI de Asistentes y Réplica PostgreSQL Formato 2
> **Versiones de esta entrega:** Programa 0.5.0 | Formatos de configuración 2 (local) / 3 (con sync) | Esquemas SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y contexto clasificado) | Formatos PostgreSQL 1 y 2
> **Estado:** Vigente y Activo (369 pruebas totales en 69 archivos: 361 superadas y 8 omitidas sin binarios aislados PG; 369 superadas, 0 fallos, 1891 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8)
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta la API pública en TypeScript de Forge614 Engram, cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias herramientas o extensiones, el soporte del Esquema 6 para sesiones progresivas y contexto clasificado, y los tipos formales de recuperación progresiva.

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

  // Tipos del dominio base
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
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

- **La API de SQLite permanece 100% síncrona:** Todas las operaciones de lectura, escritura, búsqueda, sesiones, línea temporal (`timeline`) y contexto (`context`) en `MemoryStore` y `MemoryWorkspace` se ejecutan de forma inmediata y directa sobre SQLite sin requerir llamadas asíncronas (`async`/`await`).
- **Fachada Compatible `MemoryStore`:** La clase `MemoryStore` (ubicada en `src/app/memory-store.ts`) opera como un patrón de diseño Fachada (*facade pattern*): proporciona una interfaz pública estable, idéntica e inmutable a los consumidores del SDK, mientras delega internamente la persistencia a módulos especializados en `src/infrastructure/sqlite/` (`memory.ts`, `sessions.ts`, `writes.ts`, `search.ts`, `projects.ts`, `snapshots.ts`).
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
   Ejecuta las operaciones directas sobre las tablas de SQLite (`save`, `saveWithSession`, `search`, `searchPreviews`, `get`, `getVersion`, `history`, `timeline`, `context`, `startSession`, `endSession`, `saveSessionSummary`, `enableSessions`, etc.).

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

## 4. Métodos de `MemoryStore` (Esquemas 5 y 6)

### Gestión de Esquemas y Asociaciones Locales

#### `store.enableAssistantIntegration(): void`
Habilita explícitamente el soporte de asistentes y asociaciones locales migrando aditivamente SQLite al **Esquema 5** (crea la tabla `project_bindings` y su índice).

#### `store.enableSessions(): void`
Habilita explícitamente el soporte de sesiones progresivas y contexto clasificado migrando aditivamente SQLite al **Esquema 6** (crea las tablas `sessions`, `session_entries`, `session_summaries`, `local_session_bindings` y `local_manual_sessions`).

#### `store.sessionsEnabled(): boolean`
Comprueba de forma síncrona si la base de datos actual cuenta con el Esquema 6 (`PRAGMA user_version === 6`).

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

### Persistencia de Recuerdos y Asociaciones

#### `store.save(input: SaveInput): MemoryVersion`
Persiste un recuerdo estándar (de proyecto o compartido). Si la base cuenta con Esquema 6 y el alcance es `project`, asocia automáticamente la entrada a la sesión manual del proyecto en este equipo.

#### `store.saveWithSession(input: SaveInput, options?: SessionSaveOptions): SessionSaveResult`
Persiste un recuerdo asociándolo a una sesión específica:
- `options.sessionId`: Identificador explícito de sesión (`sessionSource: "explicit"`).
- `options.mode`: `"independent"` (CLI) o `"assistant"` (MCP).
- Si se omite `sessionId` en modo asistente, infiere automáticamente la sesión si existe exactamente una activa en los últimos 7 días; si hay múltiples activas arroja `AMBIGUOUS_SESSION`.
- En recuerdos compartidos (`scope: "shared"`), la asociación requiere `sessionId` y `options.projectId` explícito. Al guardarse, el recuerdo permanece con `projectId: null` y la respuesta externa no filtra metadatos privados de la sesión.

#### `store.saveWithSessionForProjectDirectory(directory: string, name: string, runtimeDirectory: string, input: Omit<SaveInput, "projectId" | "scope">, options?: SessionSaveOptions, bindingAvailable?: (dir: string) => boolean): SessionSaveResult`
Resuelve la carpeta del proyecto y guarda el recuerdo con asociación de sesión en una única transacción inmediata.

---

### Recuperación Progresiva y Contexto Clasificado

#### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Búsqueda explicable en SQLite FTS5 con tokenizador trigram y ordenación `bm25 * multiplier ASC`.

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

### Ejemplo 1: Habilitación de Esquema 6, Ciclo de Sesión y Guardado Asociado

```typescript
import { MemoryWorkspace, type SummaryFields } from "./src/index";

const workspace = new MemoryWorkspace();
workspace.init();

const store = workspace.open();
try {
  // 1. Asegurar Esquema 6 para sesiones progresivas
  if (!store.sessionsEnabled()) {
    store.enableSessions();
  }

  // 2. Crear proyecto y carpeta vinculada
  const project = workspace.createProject("Servicio de Pagos");
  const localDir = "/Users/usuario/Proyectos/servicio-pagos";
  store.bindProjectDirectory(localDir, project.projectId);

  // 3. Iniciar una sesión en ejecución (runtime session)
  const sessionId = "ses-pagos-migracion-v2";
  const session = store.startSession(project.projectId, sessionId, localDir);
  console.log(`Sesión iniciada: ${session.sessionId} a las ${session.startedAt}`);

  // 4. Guardar un recuerdo asociado explícitamente a la sesión
  const result = store.saveWithSession(
    {
      scope: "project",
      projectId: project.projectId,
      title: "Migración a Webhooks Idempotentes",
      content: "Se registran llaves de idempotencia en Redis con expiración de 24h.",
      type: "decision",
      topicKey: "webhooks-idempotencia",
    },
    { sessionId: session.sessionId }
  );

  console.log(`Recuerdo guardado con ID ${result.memory.id} (Fuente de sesión: ${result.sessionSource})`);

  // 5. Guardar resumen estructurado al término de la sesión
  const summary: SummaryFields = {
    goal: "Implementar idempotencia en pasarela de pagos",
    instructions: "Usar Redis SETNX con TTL de 86400 segundos",
    discoveries: "Se encontraron duplicados ocasionales por reintentos de Stripe",
    accomplishments: "Filtro de idempotencia implementado y probado",
    nextSteps: "Monitorear tasa de colisiones en producción",
    files: ["src/payments/webhooks.ts", "src/redis/client.ts"],
  };

  store.saveSessionSummary(project.projectId, sessionId, summary, {
    requestKey: "req-summary-pagos-01",
  });

  // 6. Cerrar la sesión ordenadamente
  const closedSession = store.endSession(project.projectId, sessionId);
  console.log(`Sesión cerrada exitosamente a las ${closedSession.endedAt}`);
} finally {
  store.close();
}
```

---

### Ejemplo 2: Recuperación Progresiva (Previews, Timeline y Contexto Clasificado)

```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open(true); // Conexión de solo lectura

try {
  const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  // 1. Búsqueda progresiva ligera (MemoryPreview con tope de 300 caracteres)
  const previews = store.searchPreviews(projectId, "webhooks", 5);
  for (const item of previews) {
    console.log(`- [${item.memory.type}] ${item.memory.title}: "${item.memory.preview}" (Truncado: ${item.memory.truncated})`);
  }

  // 2. Inspección temporal de sucesos dentro de una sesión
  if (previews.length > 0) {
    const memoryId = previews[0]!.memory.id;
    const version = previews[0]!.memory.version;
    const timeline = store.timeline(projectId, {
      sessionId: "ses-pagos-migracion-v2",
      memoryId,
      version,
      before: 2,
      after: 2,
    });

    console.log(`Timeline para sesión ${timeline.sessionId}:`);
    console.log(`  En foco: ${timeline.focus.memory.title}`);
    console.log(`  Vecinos previos: ${timeline.before.length}, Vecinos posteriores: ${timeline.after.length}`);
  }

  // 3. Ensamblaje de contexto clasificado con presupuesto estricto de bytes
  const context = store.context(projectId, {
    compact: false,
    maxBytes: 16384, // 16 KiB en bytes serializados UTF-8
  });

  console.log(`Contexto clasificado: ${context.pinned.length} fijados, ${context.recent.length} recientes, ${context.summaries.length} resúmenes.`);
  console.log(`Omitidos por límite de bytes:`, context.omitted);
} finally {
  store.close();
}
```

---

### Ejemplo 3: Interacción con el Servidor MCP (10 Herramientas) desde un Cliente

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "forge614-engram",
    args: ["mcp"],
    stderr: "ignore",
  });

  const client = new Client(
    { name: "agente-desarrollo", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. Confirmar las 10 herramientas disponibles
  const tools = await client.listTools();
  console.log("Total herramientas expuestas:", tools.tools.length); // 10 herramientas

  // 2. Obtener contexto clasificado al iniciar la tarea
  const contextResponse = await client.callTool({
    name: "memory_context",
    arguments: { directory: process.cwd() },
  });
  console.log("Contexto clasificado recibido:", contextResponse.content);

  // 3. Iniciar sesión de trabajo en el agente
  await client.callTool({
    name: "memory_session_start",
    arguments: {
      directory: process.cwd(),
      sessionId: "ses-agente-tarea-42",
    },
  });

  await client.close();
}

main().catch(console.error);
```
