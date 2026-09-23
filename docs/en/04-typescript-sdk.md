# 04 (EN). TypeScript SDK

Import only from the public package entry:

```ts
import { MemoryWorkspace, MemoryStore, inspectMemoryInitialization,
  previewMemoryInitialization, applyMemoryInitialization,
  memoryProtocol, type MemoryProtocol } from "forge614-engram";
```

`MemoryWorkspace` owns the single product database. Use `init()`, `createProject()`, `listProjects()`, `renameProject()`, and `open()`. Always close a store:

```ts
const workspace = new MemoryWorkspace();
const project = workspace.createProject("Repository");
const store = workspace.open();
try {
  store.save({ projectId: project.projectId, title: "Decision", content: "Keep SQLite local", type: "decision", topicKey: "storage" });
  const memory = store.getByTopic(project.projectId, "storage");
} finally { store.close(); }
```

`MemoryStore` exposes project management, `save`, `get`, `getByTopic`, `history`, `search`, `searchPreviews`, `context`, archive/restore, session lifecycle, and explicit capability methods. It does not expose raw database access.

For a nonvisual initializer, call `inspectMemoryInitialization()`, generate a `previewMemoryInitialization()` request, then call `applyMemoryInitialization()` with the preview's revision. Do not read Engram's private files or import internal folders from a sibling product.

Atlas uses this SDK for structured memory writes and exact `topicKey` lookup. AI-engine detection belongs to Forge614 Engines, not this SDK.

`memoryProtocol()` returns the immutable public memory contract (`MemoryProtocol`) with identifier `forge614-engram-memory` and version `1`. Engines must consume the public `forge614-engram memory-protocol --json` command when preparing integrations; this export lets SDK consumers inspect the contract without importing internal modules. The capability is available from release `v1.3.0`.

## Groups and ecosystem (since 1.6.0)

A **group** gathers related repositories that share memory (see [11. Scopes and Ecosystems](11-scopes-and-ecosystems.md)). The SDK exposes the new scope **without changing any existing signature**: everything earlier works the same and the new capability arrives through new members. It does not expose SQLite either.

`MemoryWorkspace` adds:

```ts
const workspace = new MemoryWorkspace();
const group = workspace.createGroup("mi-tienda");                    // Group; the first time it upgrades the database with a backup
workspace.listGroups();                                              // GroupSummary[]: each group with its projects
const bound = workspace.bindProjectToGroup(project.projectId, "mi-tienda"); // GroupBinding: { group, changed, identityFiles }
workspace.unbindProject(project.projectId);                          // GroupUnbinding: { unbound, identityFiles }
workspace.renameGroup("mi-tienda", "tienda-2");                      // GroupRename: { group, identityFiles }
workspace.moveMemory(memoryId, project.projectId, "tienda-2");       // MemoryMove: { memory, from, to }; source null = shared
```

`bindProjectToGroup`, `unbindProject`, and `renameGroup` keep the `.forge614/project.json` of the bound folders in step (`identityFiles` counts `updated` and `skipped`); so does `renameProject`. A group is given by identifier or by a unique name (`GROUP_AMBIGUOUS` when the name repeats).

`MemoryStore` adds group methods, always taking the group identifier:

```ts
store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Contract", content: "…", type: "decision", topicKey: "api" });
store.getInGroup(group.id, id);            store.getByTopicInGroup(group.id, "api");
store.historyInGroup(group.id, id);        store.getVersionInGroup(group.id, id, 1);
store.searchInGroup(group.id, "contract"); store.searchPreviewsInGroup(group.id, "contract");
store.contextForGroup(group.id);           store.archiveInGroup(group.id, id);  store.restoreInGroup(group.id, id);
store.saveSessionSummaryInGroup(projectId, sessionId, group.id, fields, { requestKey });
store.createGroup(name); store.listGroups(); store.findGroups(name); store.resolveGroup(ref); store.renameGroup(id, name);
store.bindProjectToGroup(projectId, groupId); store.unbindProject(projectId); store.groupOfProject(projectId);
store.enableEcosystem(); store.ecosystemEnabled();
```

`SaveInput` accepts `{ scope: "ecosystem", projectId: null, groupId }`; `MemoryScope` becomes `"project" | "shared" | "ecosystem"` and a group memory includes `groupId` (project and shared memories keep their shape). `search(projectId, …, "all")` automatically includes the project's group; `search(projectId, …, "ecosystem")` uses that group. New exported types: `Group`, `GroupSummary`, `GroupMembership`, `MembershipSource`, `ProjectGroup`, `IdentityEvent`, `GroupBinding`, `GroupUnbinding`, `GroupRename`, `IdentityFilesResult`, `MemoryMove`. `memoryProtocol(3)` returns the version 3 contract.

`saveProjectMemoryWithSession`, `startProjectSession`, and the other `directory`-based paths read the folder's `.forge614/project.json` first and resolve by its `id` (see chapter 11).
