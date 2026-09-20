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
