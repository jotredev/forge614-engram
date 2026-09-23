# 04. SDK de TypeScript

Importa únicamente desde la entrada pública del paquete:

```ts
import { MemoryWorkspace, MemoryStore, inspectMemoryInitialization,
  previewMemoryInitialization, applyMemoryInitialization,
  memoryProtocol, type MemoryProtocol } from "forge614-engram";
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

`memoryProtocol()` devuelve el contrato público e inmutable de memoria (`MemoryProtocol`) con el identificador `forge614-engram-memory` y versión `1`. Engines debe consumir este contrato por el comando público `forge614-engram memory-protocol --json` cuando prepare integraciones; este export permite a consumidores del SDK inspeccionarlo sin importar módulos internos. La funcionalidad está disponible desde la release `v1.3.0`.

## Grupos y ecosistema (desde 1.6.0)

Un **grupo** reúne repositorios relacionados que comparten memoria (consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md)). El SDK expone el ámbito nuevo **sin cambiar ninguna firma existente**: todo lo anterior funciona igual y lo nuevo entra por miembros nuevos. Tampoco expone SQLite.

`MemoryWorkspace` añade:

```ts
const workspace = new MemoryWorkspace();
const group = workspace.createGroup("mi-tienda");                    // Group; la primera vez actualiza la base con respaldo
workspace.listGroups();                                              // GroupSummary[]: cada grupo con sus proyectos
const bound = workspace.bindProjectToGroup(project.projectId, "mi-tienda"); // GroupBinding: { group, changed, identityFiles }
workspace.unbindProject(project.projectId);                          // GroupUnbinding: { unbound, identityFiles }
workspace.renameGroup("mi-tienda", "tienda-2");                      // GroupRename: { group, identityFiles }
workspace.moveMemory(memoryId, project.projectId, "tienda-2");       // MemoryMove: { memory, from, to }; origen null = shared
```

`bindProjectToGroup`, `unbindProject` y `renameGroup` mantienen al día el `.forge614/project.json` de las carpetas vinculadas (`identityFiles` cuenta `updated` y `skipped`); `renameProject` también. El grupo se indica por identificador o por nombre único (`GROUP_AMBIGUOUS` si el nombre se repite).

`MemoryStore` añade métodos para el grupo, siempre con el identificador del grupo:

```ts
store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Contrato", content: "…", type: "decision", topicKey: "api" });
store.getInGroup(group.id, id);            store.getByTopicInGroup(group.id, "api");
store.historyInGroup(group.id, id);        store.getVersionInGroup(group.id, id, 1);
store.searchInGroup(group.id, "contrato"); store.searchPreviewsInGroup(group.id, "contrato");
store.contextForGroup(group.id);           store.archiveInGroup(group.id, id);  store.restoreInGroup(group.id, id);
store.saveSessionSummaryInGroup(projectId, sessionId, group.id, fields, { requestKey });
store.createGroup(name); store.listGroups(); store.findGroups(name); store.resolveGroup(ref); store.renameGroup(id, name);
store.bindProjectToGroup(projectId, groupId); store.unbindProject(projectId); store.groupOfProject(projectId);
store.enableEcosystem(); store.ecosystemEnabled();
```

`SaveInput` admite `{ scope: "ecosystem", projectId: null, groupId }`; `MemoryScope` pasa a `"project" | "shared" | "ecosystem"` y un recuerdo de grupo incluye `groupId` (los de proyecto y compartidos no cambian de forma). `search(projectId, …, "all")` incluye automáticamente el grupo del proyecto; `search(projectId, …, "ecosystem")` usa ese grupo. Tipos exportados nuevos: `Group`, `GroupSummary`, `GroupMembership`, `MembershipSource`, `ProjectGroup`, `IdentityEvent`, `GroupBinding`, `GroupUnbinding`, `GroupRename`, `IdentityFilesResult`, `MemoryMove`. `memoryProtocol(3)` devuelve el contrato de la versión 3.

`saveProjectMemoryWithSession`, `startProjectSession` y las demás rutas por `directory` leen primero el `.forge614/project.json` de la carpeta y resuelven por su `id` (consulta el capítulo 11).
