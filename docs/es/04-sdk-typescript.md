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

## Memoria inteligente (desde 1.7.0, esquema 11)

```ts
store.intelligenceEnabled();   // boolean
store.enableIntelligence();    // IntelligenceEnrolment: { migrated, backup }; activa el esquema 11 con respaldo previo
store.save({ projectId, title: "Base de datos", content: "…", type: "decision", topicKey: "db",
  short: "Usamos SQLite local", affects: ["engram", "shell"], supersedes: oldId });
store.searchPreviews(projectId, "sqlite")[0]?.meta;  // MemoryMeta | undefined
store.getVersion(projectId, id)?.marks;              // MemoryMark[] | undefined: "superseded" | "verify"
```

`SaveInput` gana tres campos opcionales que solo se aceptan con el esquema 11 (en un nivel anterior responden `INTELLIGENCE_REQUIRED`): `short` (versión corta de 1 a 300 caracteres), `affects` (de 1 a 20 nombres de proyecto de 1 a 64 caracteres; se recortan, se quitan repetidos y se ordenan) y `supersedes` (id de un recuerdo activo del mismo ámbito y dueño, que queda marcado como reemplazado por este; nunca se archiva; si no existe o es de otro ámbito, `SUPERSEDES_NOT_FOUND`). Estos datos viven fuera de la versión del recuerdo: no crean versión nueva ni cambian su huella, y guardar el mismo texto con metadatos nuevos solo los actualiza. Cada versión nueva de una `decision` o un `procedure` recibe una fecha de revisión a 90 días; cuando pasa, la lectura añade la marca `verify`. Si el contenido cambia sin un `short` nuevo, la versión corta anterior se borra. `searchPreviews` y `getVersion` (y sus variantes `*InGroup`) añaden `meta` y `marks` solo con el esquema 11 y solo cuando el recuerdo tiene metadatos; en otro caso el resultado no cambia de forma. Tipos exportados nuevos: `MemoryMeta` y `MemoryMark`.

Todo guardado (`save`, resúmenes de sesión, CLI y MCP), en cualquier nivel de la base, rechaza con `SECRET_REJECTED` un título, contenido, tema o versión corta que parezca contener un secreto: llave privada, clave de AWS, token de GitHub o Slack, clave `sk-`, JWT, cadena de conexión con usuario y contraseña, o una asignación con valor literal como `password=<valor>`. El error nombra el tipo de secreto, nunca el valor. Nombrar dónde vive una clave sí se permite (`process.env.API_KEY`, `password: <redacted>`).

Desde el esquema 11, `search`, `searchPreviews` (y sus variantes `*InGroup`) usan búsqueda híbrida: la consulta se reparte en un índice por palabras completas y otro por trigramas, se combinan por rango recíproco (RRF) y el resultado se pondera por el mismo multiplicador de refuerzo (fijado, recencia, estabilidad) que ya usaba `fts5`. Un resultado necesita al menos 2 de los términos de la consulta (todos si son menos de 2); si ninguno aplica, la búsqueda no devuelve nada en vez de ruido. `SearchExplanation.mode` gana el valor `"hybrid"`, con el mismo significado de `orderScore` (menor es mejor) que en `fts5`. Consulta el capítulo 5 para la fórmula completa.

Al guardar un recuerdo **nuevo** y **sin tema** se calculan hasta 3 parecidos activos del mismo ámbito y dueño (nunca resúmenes de sesión ni el propio recuerdo) con una similitud de palabras (Jaccard) de al menos 0,25; nunca en una versión nueva de un tema, en una confirmación de texto idéntico ni en una repetición de `requestKey`. `save` sigue devolviendo solo el recuerdo; `saveWithSession` (y `memory_save` por MCP, en los tres ámbitos) añaden `similar?: SimilarCandidate[]` solo cuando hay parecidos. Tipo nuevo exportado: `SimilarCandidate { id, title, version, score }`.

Con el esquema 11, una sesión runtime nueva marca como interrumpida, sin cerrarla, a cualquier otra sesión runtime abierta del mismo proyecto; repetir el arranque con el mismo `sessionId` no marca a nadie. Iniciar o repetir una sesión, guardar un recuerdo o una confirmación con sesión runtime, y cerrar la sesión registran actividad y limpian la marca; una sesión sin actividad por más de 6 horas cuenta como interrumpida al leerla aunque nadie la haya marcado. `store.previousInterrupted(projectId)` devuelve la sesión interrumpida más recientemente activa del proyecto (`PreviousSession { sessionId, interruptedAt, summary }`, con su último resumen si existe) o `null`. `memory_session_start` y `session-start` añaden `previous` solo cuando la llamada crea la sesión, nunca al repetir el arranque. La inferencia de sesión sin `sessionId` explícito ignora las sesiones marcadas o inactivas por más de 6 horas, en vez de la ventana de 7 días usada por debajo de este nivel; por debajo del esquema 11 nada de esto cambia. Tipo nuevo exportado: `PreviousSession`.
