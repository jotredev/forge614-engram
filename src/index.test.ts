/** Comprueba que el contrato público del SDK (qué exporta `index.ts` y qué métodos tiene `MemoryStore`) no cambie sin querer, y que un flujo real de guardado siga funcionando a través de él. */
import { describe, expect, test } from "bun:test";
import * as sdk from "./index";
import { MemoryError as SharedMemoryError } from "./shared/errors";
import { projectIdentity } from "./modules/projects";
import { sessionIdentity } from "./modules/sessions";
import { validateSearchLimit } from "./modules/search";

const RUNTIME_EXPORTS = [
  "MemoryError", "MemoryStore", "MemoryWorkspace", "WorkspaceConfig",
  "defaultDatabasePath", "memoryTypes", "saveProjectMemoryWithSession", "startProjectSession",
  "memoryProtocol",
  "inspectMemoryInitialization", "previewMemoryInitialization", "applyMemoryInitialization",
];

const PUBLIC_STORE_METHODS = [
  "applySync", "archive", "bindProjectDirectory", "close", "context", "createProject",
  "enableProjectBindings", "enableSessions", "enableSync", "endSession", "get", "getByTopic", "getProject",
  "enableSearchReinforcement", "getSession", "getVersion", "history", "listProjects", "reinforcementEnabled",
  "projectForDirectory", "renameProject", "resolveProjectDirectory", "restore", "save",
  "saveForProjectDirectory", "saveSessionSummary", "saveWithSession", "saveWithSessionForProjectDirectory",
  "search", "searchPreviews", "sessionsEnabled", "startSession",
  "startSessionForProjectDirectory", "syncCheckpoint", "syncSnapshot", "timeline",
];
// Agregados en 1.6.0 con el alcance de ecosistema. La lista de arriba solo crece.
const ECOSYSTEM_STORE_METHODS = [
  "archiveInGroup", "bindProjectToGroup", "contextForGroup", "createGroup", "ecosystemEnabled", "enableEcosystem",
  "ensureGroup", "findGroups", "getByTopicInGroup", "getGroup", "getInGroup", "getVersionInGroup", "groupOfProject",
  "historyInGroup", "identityEvents", "listGroups", "renameGroup", "resolveGroup", "restoreInGroup",
  "searchInGroup", "searchPreviewsInGroup", "unbindProject", "registerProject", "rebindProjectDirectory", "projectDirectories", "moveMemoryToGroup", "saveSessionSummaryInGroup",
];
// Agregados en 1.7.0 con la inteligencia de memoria. Las listas de arriba solo crecen.
const INTELLIGENCE_STORE_METHODS = ["enableIntelligence", "intelligenceEnabled", "previousInterrupted", "setGroupSource", "groupSource", "demoteMemory", "startupBlock"];
// Agregado en 1.7.1: el aviso de sesión paralela (avisar según el momento, no marcar desde el inicio). Las listas de arriba solo crecen.
const PARALLEL_SESSIONS_STORE_METHODS = ["parallelSessions"];
// Agregado en 1.8.0 con la sincronización con la nube (D1/D7/D8): activar el nivel 12, saber si está activo, el ciclo (subida+bajada, y solo bajada para la espera de arranque) y recoger avisos. Las listas de arriba solo crecen.
const CLOUD_STORE_METHODS = ["enableCloud", "cloudEnabled", "syncCloudCycle", "downloadCloudChanges", "takeCloudNotices", "cloudQueueStatus"];

// El contrato público del SDK agrupa varias comprobaciones relacionadas con qué expone `index.ts`.
describe("public SDK contract", () => {
  // Los nombres exportados y los métodos públicos de MemoryStore deben ser exactamente los listados, ni más ni menos.
  test("keeps literal runtime exports and public store methods", () => {
    expect(Object.keys(sdk).sort()).toEqual(RUNTIME_EXPORTS.sort());
    expect(Object.getOwnPropertyNames(sdk.MemoryStore.prototype)
      .filter(name => name !== "constructor").sort())
      .toEqual([...PUBLIC_STORE_METHODS, ...ECOSYSTEM_STORE_METHODS, ...INTELLIGENCE_STORE_METHODS, ...PARALLEL_SESSIONS_STORE_METHODS, ...CLOUD_STORE_METHODS].sort());
  });

  // Forge614 Shell necesita estas tres funciones de inicialización sin interfaz visual para integrarse.
  test("exports the nonvisual initialization API needed by Forge614 Shell", () => {
    expect(typeof sdk.inspectMemoryInitialization).toBe("function");
    expect(typeof sdk.previewMemoryInitialization).toBe("function");
    expect(typeof sdk.applyMemoryInitialization).toBe("function");
  });

  // Forge614 Engines necesita el protocolo de memoria versionado, con su identificador y versión estables.
  test("exports the versioned memory protocol for Forge614 Engines", () => {
    expect(sdk.memoryProtocol()).toMatchObject({
      id: "forge614-engram-memory",
      version: 1,
    });
  });

  // El SDK y los módulos internos deben lanzar la misma clase MemoryError, no dos clases distintas con igual nombre.
  test("uses one MemoryError identity across module validation", () => {
    expect(sdk.MemoryError).toBe(SharedMemoryError);
    for (const operation of [() => projectIdentity("bad"), () => sessionIdentity(" bad"), () => validateSearchLimit(0)]) {
      try { operation(); throw new Error("expected rejection"); }
      catch (error) { expect(error).toBeInstanceOf(sdk.MemoryError); }
    }
  });

});

// Un flujo real a través del SDK público (crear proyecto, guardar, repetir la misma solicitud, versionar) debe comportarse igual que usando los módulos internos directamente.
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
