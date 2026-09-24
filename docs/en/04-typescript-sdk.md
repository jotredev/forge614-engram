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

## Memory intelligence (since 1.7.0, schema 11)

```ts
store.intelligenceEnabled();   // boolean
store.enableIntelligence();    // IntelligenceEnrolment: { migrated, backup }; enables schema 11 after a backup
store.save({ projectId, title: "Database", content: "…", type: "decision", topicKey: "db",
  short: "We use local SQLite", affects: ["engram", "shell"], supersedes: oldId });
store.searchPreviews(projectId, "sqlite")[0]?.meta;  // MemoryMeta | undefined
store.getVersion(projectId, id)?.marks;              // MemoryMark[] | undefined: "superseded" | "verify"
```

`SaveInput` gains three optional fields accepted only with schema 11 (an earlier level answers `INTELLIGENCE_REQUIRED`): `short` (a 1–300 character short version), `affects` (1–20 project names of 1–64 characters; trimmed, deduplicated and sorted) and `supersedes` (the id of an active memory with the same scope and owner, which is marked as replaced by this one; it is never archived; if it does not exist or belongs to another scope, `SUPERSEDES_NOT_FOUND`). This data lives outside the memory version: it creates no new version and does not change the memory's hash, and saving the same text with new metadata only updates it. Every new version of a `decision` or `procedure` gets a review date 90 days ahead; once it passes, reads add the `verify` mark. When the content changes without a new `short`, the previous short version is cleared. `searchPreviews` and `getVersion` (and their `*InGroup` variants) add `meta` and `marks` only with schema 11 and only when the memory has metadata; otherwise the result keeps its shape. New exported types: `MemoryMeta` and `MemoryMark`.

Every save (`save`, session summaries, CLI and MCP), at any database level, rejects with `SECRET_REJECTED` a title, content, topic or short version that looks like it contains a secret: a private key, an AWS key, a GitHub or Slack token, an `sk-` key, a JWT, a connection string with user and password, or an assignment with a literal value such as `password=<value>`. The error names the kind of secret, never the value. Naming where a key lives is allowed (`process.env.API_KEY`, `password: <redacted>`).

From schema 11, `search`, `searchPreviews` (and their `*InGroup` variants) use hybrid search: the query is split across a whole-word index and a trigram index, the two are combined by reciprocal rank fusion, and the result is weighted by the same reinforcement multiplier (pinned, recency, stability) that `fts5` already used. A result needs at least 2 of the query terms (all of them when there are fewer than 2); when none apply, the search returns nothing instead of noise. `SearchExplanation.mode` gains the value `"hybrid"`, with the same meaning for `orderScore` (lower is better) as in `fts5`. See chapter 5 for the full formula.

When a **new** memory **without a topic** is saved, up to 3 active look-alikes are computed of the same scope and owner (never session summaries or the memory itself) with a word similarity (Jaccard) of at least 0.25; never on a new version of a topic, on an identical-text confirmation, or on a `requestKey` replay. `save` still returns only the memory; `saveWithSession` (and MCP's `memory_save`, in all three scopes) add `similar?: SimilarCandidate[]` only when there are look-alikes. New exported type: `SimilarCandidate { id, title, version, score }`.

With schema 11, a new runtime session marks every other open runtime session of the project as interrupted, without closing it; a repeated start with the same `sessionId` marks nobody. Starting or replaying a session, saving a memory or a confirmation with a runtime session, and closing the session record activity and clear the mark; a session with no activity for more than 6 hours counts as interrupted when read even if nobody marked it. `store.previousInterrupted(projectId)` returns the project's most recently active interrupted session (`PreviousSession { sessionId, interruptedAt, summary }`, with its last session summary if any) or `null`. `memory_session_start` and `session-start` add `previous` only when the call creates the session, never on a repeated start. Session inference without an explicit `sessionId` ignores sessions that are marked or idle for more than 6 hours, instead of the 7-day window used below this level; below schema 11 none of this changes. New exported type: `PreviousSession`.
