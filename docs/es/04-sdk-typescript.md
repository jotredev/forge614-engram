# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.4.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync)
> **Estado:** Vigente y Activo (Verificado con 90 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias aplicaciones, pruebas automatizadas y scripts de TypeScript dentro de este repositorio.

> [!NOTE]
> **Dirigido a programadores:** Este SDK es para desarrolladores que desean integrar memoria estructurada en aplicaciones TypeScript. Los usuarios finales de terminal solo necesitan utilizar la herramienta de comandos `forge614-engram`. No existe un paquete publicado en npm; las importaciones se realizan directamente desde `./src/index`.

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
- **La API de SQLite permanece 100% síncrona:** Todas las operaciones de lectura, escritura y búsqueda en `MemoryStore` y `MemoryWorkspace` se ejecutan en tiempo real sobre SQLite sin requerir llamadas asíncronas (`async`/`await`).
- **Los módulos de sincronización son infraestructura interna:** Módulos como `sync-runner.ts`, `synchronize.ts`, `sync-postgres.ts`, `sync-snapshot.ts` y `sync-local.ts` son componentes internos encargados del transporte y conciliación de red. **No se reexportan como API pública en `src/index.ts`**.
- **No inventes un `AsyncMemoryWorkspace`:** No existe ningún envoltorio asíncrono público. La aplicación interactúa localmente con el almacén síncrono, y la sincronización con PostgreSQL se gestiona mediante los comandos de terminal (`sync`, `sync-watch`) o ejecutores internos dedicados.
- **Métodos internos de sincronización en `MemoryStore`:** Los métodos `store.enableSync()`, `store.syncSnapshot()`, `store.syncCheckpoint()` y `store.applySync()` son utilizados por el motor de sincronización. No están destinados a que el usuario inyecte JSON arbitrario ni manipule checkpoints manualmente.

---

## 2. Arquitectura de Clases del SDK

1. **`MemoryWorkspace` (Gestor de Alto Nivel):**
   Gestiona el ciclo de vida del espacio global del usuario (`~/.forge614/`). Es la interfaz recomendada para inicializar el entorno, administrar proyectos (`createProject`, `listProjects`, `renameProject`) y abrir conexiones seguras a la base (`open()`).
2. **`WorkspaceConfig` (Lector y Administrador de Configuración):**
   Controla la lectura y escritura atómica del archivo global `~/.forge614/.env`. Verifica permisos (`0700` en carpeta, `0600` en archivo), gestiona el soporte de formato 2 (local) y formato 3 (con `postgresUrl`), y previene concurrencias mediante el cerrojo `.config-lock`.
3. **`MemoryStore` (Motor de Bajo Nivel):**
   Maneja las operaciones directas de base de datos SQLite (`save`, `get`, `history`, `search`, `archive`, `restore`).

---

## 3. Métodos de `MemoryWorkspace`

```typescript
const workspace = new MemoryWorkspace();
```

### `workspace.init(): void`
Prepara el archivo `.env` y la base de datos `engram.db` en modo seguro. Si ya existen y son válidos, no realiza cambios ni reinicia datos.

### `workspace.createProject(name: string): Project`
Crea y registra un nuevo proyecto en la base, asignándole un `projectId` único (UUIDv4).
⚠️ **Buenas prácticas:** No llames a `createProject()` en cada inicio de tu aplicación, ya que generaría una nueva identidad cada vez. Registra el proyecto una sola vez y reutiliza su `projectId` consultándolo mediante `listProjects()`.

### `workspace.listProjects(): Project[]`
Devuelve la lista de todos los proyectos registrados en la base central, ordenados por nombre. Si el espacio aún no ha sido inicializado, devuelve un arreglo vacío `[]`.

### `workspace.renameProject(projectId: string, name: string): Project`
Actualiza el nombre visible del proyecto manteniendo intactos su `projectId` y sus recuerdos.

### `workspace.open(readonly = false): MemoryStore`
Valida la configuración global y abre el almacén `MemoryStore`. Si `readonly` es `true`, abre la base en modo de solo lectura (utilizado para inspección sin mutar archivos).

---

## 4. Métodos de `MemoryStore`

Una vez abierto el almacén con `workspace.open()` o `new MemoryStore()`:

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

### `store.get(projectId: string | null, id: string): Memory`
Recupera la ficha activa o archivada de un recuerdo.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Devuelve el histórico cronológico inmutable de fotos (*snapshots*) de cada versión del recuerdo.

### `store.archive(projectId: string | null, id: string): Memory`
Oculta el recuerdo de las búsquedas normales sin borrar su historial ni sus versiones.

### `store.restore(projectId: string | null, id: string): Memory`
Reactivar un recuerdo archivado y devuelve su visibilidad en las búsquedas.

### `store.close(): void`
Cierra la conexión con SQLite.

---

## 5. Ejemplos Prácticos de Integración en Código

### Ejemplo 1: Inicializar el Espacio y Registrar un Proyecto
```typescript
import { MemoryWorkspace } from "./src/index";

const workspace = new MemoryWorkspace();

// Inicializar el espacio global si no existe
workspace.init();

// Buscar o crear nuestro proyecto
let project = workspace.listProjects().find(p => p.name === "Mi Plataforma");
if (!project) {
  project = workspace.createProject("Mi Plataforma");
  console.log(`Proyecto creado con ID: ${project.projectId}`);
} else {
  console.log(`Proyecto existente: ${project.projectId}`);
}
```

### Ejemplo 2: Guardar Recuerdos Propios y Compartidos
```typescript
const store = workspace.open();

try {
  // 1. Guardar recuerdo privado del proyecto
  const docMemory = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "Documentación API",
    content: "Usamos OpenAPI 3.1 para documentar los endpoints",
    type: "decision",
    topicKey: "api/docs",
    requestKey: "req-api-01",
  });
  console.log(`Recuerdo guardado con ID: ${docMemory.id}, Versión: ${docMemory.version}`);

  // 2. Guardar preferencia compartida universal (projectId debe ser null)
  const langMemory = store.save({
    scope: "shared",
    projectId: null,
    title: "Idioma de Respuestas",
    content: "Explicar siempre en español técnico",
    type: "preference",
    topicKey: "preferences/language",
    requestKey: "req-lang-01",
  });
  console.log(`Preferencia compartida con ID: ${langMemory.id}`);
} finally {
  store.close();
}
```

### Ejemplo 3: Búsqueda Combinada con Explicabilidad
```typescript
const store = workspace.open();

try {
  // Búsqueda combinada: devuelve notas del proyecto y notas compartidas
  const results = store.search(project.projectId, "OpenAPI español", 5, "all");

  for (const { memory, explanation } of results) {
    console.log(`[${memory.scope.toUpperCase()}] ${memory.title}`);
    console.log(`  Contenido: ${memory.content}`);
    console.log(`  Puntaje: ${explanation.orderScore} (BM25: ${explanation.bm25}, Multiplicador: ${explanation.multiplier})`);
  }
} finally {
  store.close();
}
```

### Ejemplo 4: Actualización Segura con `expectedVersion`
```typescript
const store = workspace.open();

try {
  // Actualizar la versión de la documentación de la API
  const updated = store.save({
    scope: "project",
    projectId: project.projectId,
    title: "Documentación API",
    content: "Migramos de OpenAPI 3.1 a TypeSpec para generar contratos",
    type: "decision",
    topicKey: "api/docs",
    expectedVersion: 1, // Exige que la versión previa leída sea exactamente 1
    requestKey: "req-api-02",
  });

  console.log(`Nueva versión registrada: ${updated.version}`);
} catch (error: any) {
  if (error.code === "VERSION_CONFLICT") {
    console.error("Conflicto: la versión en la base cambió antes de guardar.");
  } else {
    throw error;
  }
} finally {
  store.close();
}
```
