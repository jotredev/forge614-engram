# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Activo (Verificado con 191 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta la API pública en TypeScript de Forge614 Engram, cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias aplicaciones, las extensiones del Esquema 5 para asociaciones locales de proyectos y la frontera arquitectónica con los módulos internos de MCP, asistentes y sincronización.

> [!NOTE]
> **Dirigido a desarrolladores:** Este SDK está orientado a programadores que desean integrar memoria estructurada dentro de herramientas o agentes TypeScript. Los usuarios finales de terminal solo necesitan el binario `forge614-engram`. No existe un paquete público en npm; las importaciones se realizan desde `./src/index`.

---

## 1. Módulos Exportados e Inicialización

El punto de entrada público principal del SDK es `src/index.ts`:

```typescript
import {
  MemoryWorkspace,
  WorkspaceConfig,
  type WorkspaceSettings,
  MemoryStore,
  MemoryError,
  memoryTypes,
  defaultDatabasePath,
  type Project,
  type SaveInput,
  type Memory,
  type MemoryVersion,
  type SearchResult,
  type MemoryScope,
  type SearchScope,
} from "./src/index";
```

### Principio Fundamental del SDK: Operación Local Síncrona
- **La API de SQLite permanece 100% síncrona:** Todas las operaciones de lectura, escritura, búsqueda y asociación en `MemoryStore` y `MemoryWorkspace` se ejecutan de forma inmediata y directa sobre SQLite sin requerir llamadas asíncronas (`async`/`await`).
- **Los módulos de sincronización, MCP y TUI son infraestructura interna:**
  - El servidor MCP (`src/mcp.ts`)
  - El motor de resolución Git (`src/project-context.ts`)
  - Los adaptadores de configuración de asistentes (`src/assistants/*`)
  - La interfaz de terminal (`src/assistant-tui.ts`)
  - El ejecutor de autoprueba (`src/assistant-self-test.ts`)
  - El motor de sincronización de réplica (`src/sync-*.ts`)
  Son componentes especializados de infraestructura interna y **no se reexportan como API pública en `src/index.ts`**.
- **No inventes un `AsyncMemoryWorkspace`:** No existe ningún envoltorio asíncrono público. La aplicación interactúa localmente con el almacén síncrono, y la interacción con asistentes se realiza mediante el protocolo estándar MCP o comandos de CLI.

---

## 2. Arquitectura de Clases del SDK

1. **`MemoryWorkspace` (Gestor de Alto Nivel):**
   Administra el espacio central del usuario (`~/.forge614/`), inicializa el entorno, gestiona el ciclo de vida de los proyectos (`createProject`, `listProjects`, `renameProject`) y abre conexiones seguras a la base de datos (`open()`).
2. **`WorkspaceConfig` (Gestor de Configuración):**
   Gestiona la lectura y escritura atómica del archivo `~/.forge614/.env`. Valida permisos (`0700` en carpeta, `0600` en archivo), formatos (Formato 2 local y Formato 3 con sincronización) y previene concurrencias con el cerrojo `.config-lock`.
3. **`MemoryStore` (Motor de Base de Datos SQLite):**
   Ejecuta las operaciones directas sobre las tablas de SQLite (`save`, `get`, `history`, `search`, `archive`, `restore`, `enableAssistantIntegration`, `bindProjectDirectory`, `resolveProjectDirectory`, `saveForProjectDirectory`).

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

## 4. Métodos de `MemoryStore` (Incluyendo Esquema 5)

### `store.enableAssistantIntegration(): void`
Habilita explícitamente el soporte de asistentes y asociaciones locales migrando aditivamente SQLite al **Esquema 5** (crea la tabla `project_bindings` y su índice). Es una operación segura e irreversible: no borra recuerdos ni altera datos previos.

### `store.bindProjectDirectory(directory: string, projectId: string): Project`
Asocia una ruta de directorio local a un `projectId` existente en la tabla `project_bindings`. Si la ruta ya estaba vinculada a otro proyecto, arroja `PROJECT_BINDING_CONFLICT`.

### `store.resolveProjectDirectory(directory: string, name: string, create: boolean, bindingAvailable?: (dir: string) => boolean): { project: Project | null; created: boolean }`
Resuelve la asociación de una carpeta con un proyecto:
- Si la carpeta ya está vinculada, devuelve el proyecto asociado (`created: false`).
- Si `create` es `false` y no está vinculada, devuelve `project: null`.
- Si `create` es `true`:
  - Si existe una colisión de nombre, arroja `PROJECT_BINDING_REQUIRED`.
  - Si alguna carpeta registrada de cualquier proyecto no está disponible en el disco (`bindingAvailable`), arroja `PROJECT_BINDING_REQUIRED` para evitar crear proyectos huérfanos por error.
  - De lo contrario, crea el proyecto atómicamente, inserta la vinculación en `project_bindings` y devuelve el proyecto (`created: true`).

### `store.saveForProjectDirectory(directory: string, name: string, input: Omit<SaveInput, "projectId" | "scope">, bindingAvailable?: (dir: string) => boolean): MemoryVersion`
Resuelve la carpeta (creando el proyecto y la vinculación de forma atómica si es el primer guardado) y almacena el recuerdo con `scope: "project"`.

### `store.save(input: SaveInput): MemoryVersion`
Guarda un nuevo recuerdo o crea una nueva versión de un tema existente:
- Requiere `title`, `content` y `type`.
- Si `scope` es `'project'`, requiere `projectId`.
- Si `scope` es `'shared'`, `projectId` debe ser estrictamente `null`.
- Si el tema ya existe, exige `expectedVersion` con la versión actual para prevenir sobreescrituras ciegas.
- Admite `requestKey` para idempotencia (evitar duplicados en peticiones repetidas).

### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Ejecuta la búsqueda explicable en SQLite FTS5:
- Si se especifica `projectId`, por defecto busca en `all` (recuerdos del proyecto + compartidos, aplicando la sustitución de temas).
- Devuelve cada recuerdo junto con su objeto `explanation` (`bm25`, `multiplier`, `orderScore`).

### `store.get(projectId: string | null, id: string): Memory | null`
Recupera la ficha activa o archivada de un recuerdo por su UUID.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Devuelve la lista cronológica de revisiones históricas inmutables del recuerdo.

### `store.archive(projectId: string | null, id: string): Memory`
Archiva un recuerdo activo retirándolo de las búsquedas sin eliminar su historial.

### `store.restore(projectId: string | null, id: string): Memory`
Restaura un recuerdo archivado devolviéndolo al estado activo.

---

## 5. Ejemplos de Código Listos para Producción

### Ejemplo 1: Inicialización, Esquema 5 y Vinculación Local de Carpetas

```typescript
import { MemoryWorkspace } from "./src/index";

// 1. Inicializar el espacio central (~/.forge614/)
const workspace = new MemoryWorkspace();
workspace.init();

// 2. Abrir conexión con permisos de escritura
const store = workspace.open();
try {
  // 3. Habilitar la integración de asistentes (Esquema 5)
  store.enableAssistantIntegration();

  // 4. Crear un proyecto formal
  const project = workspace.createProject("Servicio de Pagos");
  console.log(`Proyecto creado: ${project.name} (${project.projectId})`);

  // 5. Vincular la carpeta local del proyecto
  const rutaLocal = "/Users/usuario/Proyectos/servicio-pagos";
  store.bindProjectDirectory(rutaLocal, project.projectId);
  console.log(`Carpeta vinculada correctamente: ${rutaLocal}`);
} finally {
  store.close();
}
```

---

### Ejemplo 2: Guardado Atómico de Memoria por Directorio

```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();
const store = workspace.open();

try {
  // Guardar un recuerdo resolviendo la carpeta automáticamente
  const version = store.saveForProjectDirectory(
    "/Users/usuario/Proyectos/servicio-pagos",
    "Servicio de Pagos",
    {
      title: "Proveedor de Pasarela",
      content: "Se implementa Stripe Connect con webhooks idempotentes.",
      type: "decision",
      topicKey: "pasarela-pagos",
    }
  );

  console.log(`Recuerdo guardado con ID: ${version.memoryId}, Versión: ${version.version}`);
} finally {
  store.close();
}
```

---

### Ejemplo 3: Consulta del Protocolo MCP mediante el SDK Oficial

Para interactuar con el servidor MCP de Engram desde otra herramienta o agente:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // Configurar transporte stdio apuntando al binario instalado
  const transport = new StdioClientTransport({
    command: "forge614-engram",
    args: ["mcp"],
    stderr: "ignore",
  });

  const client = new Client(
    { name: "mi-asistente-ia", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. Listar herramientas disponibles
  const tools = await client.listTools();
  console.log("Herramientas MCP disponibles:", tools.tools.map(t => t.name));

  // 2. Resolver proyecto actual
  const currentProject = await client.callTool({
    name: "memory_current_project",
    arguments: { directory: process.cwd() },
  });
  console.log("Proyecto actual:", currentProject.content);

  // 3. Buscar recuerdos relevantes
  const searchResult = await client.callTool({
    name: "memory_search",
    arguments: {
      query: "pasarela",
      limit: 3,
    },
  });
  console.log("Recuerdos encontrados:", searchResult.content);

  await client.close();
}

main().catch(console.error);
```
