# 04. Guía de Integración con el SDK de TypeScript

> **Etapa:** Etapa 1 — Memoria Local (Configuración Interactiva y Base Única)
> **Versiones de esta entrega:** Programa 0.3.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Activo
> **Traducción hermana:** [04 (EN). TypeScript SDK Guide (MemoryStore)](../en/04-typescript-sdk.md)

Esta guía documenta cómo utilizar las clases `MemoryWorkspace`, `WorkspaceConfig` y `MemoryStore` en tus propias aplicaciones, pruebas automatizadas y scripts de TypeScript dentro de este repositorio.

> [!NOTE]
> **Dirigido a programadores:** Este SDK es para desarrolladores que desean integrar memoria estructurada en aplicaciones TypeScript. Los usuarios finales de terminal solo necesitan utilizar la herramienta de comandos `forge614-engram`. No existe un paquete publicado en npm; las importaciones se realizan directamente desde `./src/index`.

---

## 1. Módulos Exportados e Inicialización

El punto de entrada principal es `src/index.ts`:

```typescript
import {
  MemoryWorkspace,
  WorkspaceConfig,
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

### Arquitectura de Clases del SDK:
1. **`MemoryWorkspace` (Gestor de Alto Nivel):**
   Gestiona el ciclo de vida del espacio global del usuario (`~/.forge614/`). Es la interfaz recomendada para inicializar el entorno, administrar proyectos (`createProject`, `listProjects`, `renameProject`) y abrir conexiones seguras a la base (`open()`).
2. **`WorkspaceConfig` (Lector de Configuración):**
   Controla la lectura y escritura atómica del archivo global `~/.forge614/.env`. Verifica permisos (`0700` en carpeta, `0600` en archivo) y rechaza configuraciones antiguas (`projects/`) con el error `LEGACY_CONFIG`.
3. **`MemoryStore` (Motor de Bajo Nivel):**
   Maneja las operaciones directas de base de datos SQLite (`save`, `get`, `history`, `search`, `archive`, `restore`).

---

## 2. Métodos de `MemoryWorkspace`

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
Valida la configuración global y abre el almacén `MemoryStore`. Si `readonly` es `true`, abre la base en modo de solo lectura (utilizado por ejemplo para validar compatibilidad sin modificar archivos).

---

## 3. Métodos de `MemoryStore`

Una vez abierto el almacén con `workspace.open()` o `new MemoryStore()`:

### `store.save(input: SaveInput): Memory`
Guarda un nuevo recuerdo o crea una nueva versión de un tema existente:
- Requiere `title`, `content` y `type`.
- Si `scope` es `'project'`, requiere `projectId`.
- Si `scope` es `'shared'`, `projectId` debe ser `null`.
- Si el tema ya existe, exige `expectedVersion` con la versión actual para prevenir sobreescrituras ciegas.
- Admite `--request-key` para idempotencia (evitar duplicados).

### `store.search(projectId: string | null, query: string, limit = 10, scope: SearchScope = "all"): SearchResult[]`
Ejecuta la búsqueda explicable en SQLite FTS5:
- Si se especifica `projectId`, por defecto busca en `all` (recuerdos del proyecto + compartidos, aplicando la sustitución de temas).
- Devuelve cada recuerdo junto con su objeto `explanation` (`bm25`, `multiplier`, `orderScore`).

### `store.get(projectId: string | null, id: string): Memory`
Recupera la ficha activa o archivada de un recuerdo.

### `store.history(projectId: string | null, id: string): MemoryVersion[]`
Devuelve el histórico cronológico inmutable de fotos (snapshots) de cada versión del recuerdo.

### `store.archive(projectId: string | null, id: string): Memory`
Oculta el recuerdo de las búsquedas normales sin borrar su historial ni sus versiones.

### `store.restore(projectId: string | null, id: string): Memory`
Reactiva un recuerdo archivado y devuelve su visibilidad en las búsquedas.

---

## 4. Ejemplo Práctico de Integración Completo

Crea un archivo de prueba llamado `ejemplo-sdk.ts` en la raíz del repositorio y ejecútalo con `bun run ejemplo-sdk.ts`:

```typescript
import { MemoryWorkspace } from "./src/index";

// 1. Instanciamos el gestor del espacio
const workspace = new MemoryWorkspace();

// 2. Inicializamos el entorno seguro (idempotente)
workspace.init();

// 3. Obtenemos o creamos nuestro proyecto
const proyectos = workspace.listProjects();
let project = proyectos.find(p => p.name === "Mi Aplicación");

if (!project) {
  project = workspace.createProject("Mi Aplicación");
  console.log("Nuevo proyecto creado con ID:", project.projectId);
} else {
  console.log("Reutilizando proyecto existente:", project.projectId);
}

// 4. Abrimos el almacén para operar
const store = workspace.open();

try {
  // A. Guardar un recuerdo propio del proyecto
  const memProyecto = store.save({
    projectId: project.projectId,
    title: "Base de Datos",
    content: "Usaremos SQLite localmente con modo WAL",
    type: "decision",
    topicKey: "architecture/storage",
  });
  console.log("Recuerdo de proyecto guardado:", memProyecto.id);

  // B. Guardar una preferencia compartida universal
  const memCompartida = store.save({
    scope: "shared",
    projectId: null,
    title: "Idioma de Interacción",
    content: "Prefiero explicaciones claras en español",
    type: "preference",
    topicKey: "preferences/language",
  });
  console.log("Recuerdo compartido guardado:", memCompartida.id);

  // C. Búsqueda combinada desde el proyecto (encuentra ambos recuerdos)
  console.log("\n--- Búsqueda combinada en el proyecto ---");
  const resultados = store.search(project.projectId, "español");
  for (const r of resultados) {
    console.log(`[${r.memory.scope.toUpperCase()}] ${r.memory.title}: ${r.memory.content}`);
    console.log(`Puntaje de orden: ${r.explanation.orderScore}`);
  }

  // D. Búsqueda exclusiva en el espacio compartido
  console.log("\n--- Búsqueda exclusiva compartida ---");
  const compartidos = store.search(null, "español", 5, "shared");
  console.log("Total compartidos encontrados:", compartidos.length);

} finally {
  // 5. Cierre obligatorio para liberar SQLite
  store.close();
}
```

---

## 5. Módulo de Configuración Interactiva (`src/setup.ts`)

Para interfaces de usuario, adaptadores de terminal personalizados o suites de prueba, el repositorio incluye la función `runSetup`:

```typescript
import { runSetup, type SetupIO, type SetupResult } from "./src/setup";
import { WorkspaceConfig } from "./src/workspace-config";

// Adaptador de entrada/salida personalizado
const miTerminalIO: SetupIO = {
  write: (mensaje: string) => console.log(mensaje),
  ask: async (pregunta: string) => {
    // Proporcionar la respuesta o null si se cancela
    return "si";
  },
};

const resultado: SetupResult = await runSetup(miTerminalIO, new WorkspaceConfig());

if (resultado.cancelled) {
  console.log("Configuración cancelada sin cambios.");
} else {
  console.log("Almacenamiento global inicializado:", resultado.storage);
}
```

> [!IMPORTANT]
> **Cierre limpio con `try ... finally`:** Mantén siempre tus operaciones de `MemoryStore` envueltas en un bloque `try ... finally { store.close(); }` para evitar bloqueos del diario WAL y garantizar que la base de datos se cierre de manera ordenada.
