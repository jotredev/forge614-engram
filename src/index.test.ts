import { describe, expect, test } from "bun:test";
import * as sdk from "./index";
import { MemoryError as SharedMemoryError } from "./shared/errors";
import { projectIdentity } from "./modules/projects";
import { sessionIdentity } from "./modules/sessions";
import { validateSearchLimit } from "./modules/search";
import type { AssistantDescriptor, AssistantLocation, AssistantOptions, AssistantPaths, ClientId } from "./index";

const RUNTIME_EXPORTS = [
  "MemoryError", "MemoryStore", "MemoryWorkspace", "WorkspaceConfig",
  "defaultDatabasePath", "memoryTypes", "saveProjectMemoryWithSession", "startProjectSession",
  "inspectMemoryInitialization", "previewMemoryInitialization", "applyMemoryInitialization",
  "CLIENT_IDS", "LABELS", "isClientId", "inspectAssistant", "resolveAssistantPaths", "coverageWarnings",
];

type AssistantDetectionSdkTypes = {
  id: ClientId;
  location: AssistantLocation;
  options: AssistantOptions;
  descriptor: AssistantDescriptor;
  paths: AssistantPaths;
};

const PUBLIC_STORE_METHODS = [
  "applySync", "archive", "bindProjectDirectory", "close", "context", "controlCenter", "createProject",
  "enableAssistantIntegration", "enableSessions", "enableSync", "endSession", "get", "getProject",
  "enableSearchReinforcement", "getSession", "getVersion", "history", "listProjects", "reinforcementEnabled",
  "projectForDirectory", "renameProject", "resolveProjectDirectory", "restore", "save",
  "saveForProjectDirectory", "saveSessionSummary", "saveWithSession", "saveWithSessionForProjectDirectory",
  "search", "searchPreviews", "sessionsEnabled", "startSession",
  "startSessionForProjectDirectory", "syncCheckpoint", "syncSnapshot", "timeline",
];

describe("public SDK contract", () => {
  test("keeps literal runtime exports and public store methods", () => {
    expect(Object.keys(sdk).sort()).toEqual(RUNTIME_EXPORTS.sort());
    expect(Object.getOwnPropertyNames(sdk.MemoryStore.prototype)
      .filter(name => name !== "constructor").sort())
      .toEqual(PUBLIC_STORE_METHODS.sort());
  });

  test("exports the assistant-detection API needed by sibling Forge614 products", () => {
    const typeContract: AssistantDetectionSdkTypes | undefined = undefined;
    expect(typeContract).toBeUndefined();
    expect(sdk.CLIENT_IDS).toContain("claude-code");
    expect(sdk.isClientId("codex")).toBe(true);
    expect(typeof sdk.inspectAssistant).toBe("function");
    expect(typeof sdk.resolveAssistantPaths).toBe("function");
    expect(typeof sdk.coverageWarnings).toBe("function");
  });

  test("exports the nonvisual initialization API needed by Forge614 Shell", () => {
    expect(typeof sdk.inspectMemoryInitialization).toBe("function");
    expect(typeof sdk.previewMemoryInitialization).toBe("function");
    expect(typeof sdk.applyMemoryInitialization).toBe("function");
  });

  test("uses one MemoryError identity across module validation", () => {
    expect(sdk.MemoryError).toBe(SharedMemoryError);
    for (const operation of [() => projectIdentity("bad"), () => sessionIdentity(" bad"), () => validateSearchLimit(0)]) {
      try { operation(); throw new Error("expected rejection"); }
      catch (error) { expect(error).toBeInstanceOf(sdk.MemoryError); }
    }
  });

});

test("preserves project save, read, version and request replay through the SDK", () => {
  const store = new sdk.MemoryStore(":memory:");
  try {
    const project = store.createProject("Contract");
    const first = store.save({projectId:project.projectId,title:"Topic",content:"one",type:"fact",topicKey:"topic",requestKey:"request-1"});
    const replay = store.save({projectId:project.projectId,title:"Topic",content:"one",type:"fact",topicKey:"topic",requestKey:"request-1"});
    expect(replay).toEqual(first);
    expect(store.get(project.projectId,first.id)?.content).toBe("one");
    const second = store.save({projectId:project.projectId,title:"Topic",content:"two",type:"fact",topicKey:"topic",expectedVersion:1});
    expect(second.version).toBe(2);
    expect(store.getVersion(project.projectId,first.id,1)?.memory.content).toBe("one");
  } finally { store.close(); }
});
