# 04. SDK de TypeScript

Importa únicamente desde la entrada pública del paquete:

```ts
import { MemoryWorkspace, MemoryStore, inspectMemoryInitialization,
  previewMemoryInitialization, applyMemoryInitialization } from "forge614-engram";
```

`MemoryWorkspace` es dueño de la única base del producto. Usa `init()`, `createProject()`, `listProjects()`, `renameProject()` y `open()`. Siempre cierra el store:

```ts
const workspace = new MemoryWorkspace();
const project = workspace.createProject("Repositorio");
const store = workspace.open();
try {
  store.save({ projectId: project.projectId, title: "Decisión", content: "Mantener SQLite local", type: "decision", topicKey: "storage" });
  const memory = store.getByTopic(project.projectId, "storage");
} finally { store.close(); }
```

`MemoryStore` expone proyectos, `save`, `get`, `getByTopic`, `history`, `search`, `searchPreviews`, `context`, archivo/restauración, sesiones y habilitaciones explícitas. No expone acceso crudo a la base.

Para inicialización no visual, llama `inspectMemoryInitialization()`, genera una solicitud con `previewMemoryInitialization()` y después llama `applyMemoryInitialization()` con la revisión de la vista previa. Un producto hermano no debe leer archivos privados de Engram ni importar carpetas internas.

Atlas usa este SDK para escrituras estructuradas y consultas exactas por `topicKey`. La detección de motores de IA pertenece a Forge614 Engines, no a este SDK.
