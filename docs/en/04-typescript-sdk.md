# 04 (EN). TypeScript SDK

Import only from the public package entry:

```ts
import { MemoryWorkspace, MemoryStore, inspectMemoryInitialization,
  previewMemoryInitialization, applyMemoryInitialization } from "forge614-engram";
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
