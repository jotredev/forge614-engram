import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import type { ControlCenterMutation, ControlCenterSnapshot } from "../modules/control-center";
import { bindProjectContext } from "./project-context";
import { syncWorkspace } from "./synchronization";
import { MemoryWorkspace } from "./workspace";

function uninitializedSnapshot(): ControlCenterSnapshot {
  return {
    storage: {initialized:false, databasePath:null, capabilities:null, postgres:"not-configured"},
    projects: [],
    shared: null,
  };
}

function safeLabel(value:string):string {
  return value
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "?")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "[URL omitted]");
}

export function readControlCenter(config = new WorkspaceConfig()): ControlCenterSnapshot {
  if (!config.exists()) return uninitializedSnapshot();
  const settings = config.read();
  const store = new MemoryWorkspace(config).open(true);
  try {
    const {capabilities, projects, shared} = store.controlCenter();
    return {
      storage: {
        initialized: true,
        databasePath: config.databasePath,
        capabilities,
        postgres: settings.postgresUrl === undefined ? "not-configured" : "configured",
      },
      projects,
      shared,
    };
  } finally { store.close(); }
}

export async function executeControlCenterMutation(
  config: WorkspaceConfig,
  mutation: ControlCenterMutation,
): Promise<string> {
  config.read();
  const workspace = new MemoryWorkspace(config);
  if (mutation.kind === "create-project") {
    const project = workspace.createProject(mutation.name);
    return `Proyecto creado: ${safeLabel(project.name)} (${project.projectId}).`;
  }
  if (mutation.kind === "rename-project") {
    const project = workspace.renameProject(mutation.projectId, mutation.name);
    return `Proyecto renombrado: ${safeLabel(project.name)} (${project.projectId}).`;
  }
  if (mutation.kind === "bind-directory") {
    const store = workspace.open();
    try {
      const project = bindProjectContext(store, mutation.directory, mutation.projectId);
      return `Directorio vinculado al proyecto ${project.projectId}.`;
    } finally { store.close(); }
  }
  if (mutation.kind === "sync-now") {
    const result = await syncWorkspace(config);
    return `Sincronización completada: ${result.projects} proyectos, ${result.memories} recuerdos.`;
  }
  const store = workspace.open();
  try {
    if (mutation.kind === "enable-integration") {
      store.enableAssistantIntegration();
      return "Integración de asistentes habilitada: esquema 5.";
    }
    if (mutation.kind === "enable-sessions") {
      store.enableSessions();
      return "Sesiones habilitadas: esquema 6.";
    }
    store.enableSearchReinforcement();
    return "Refuerzo de búsqueda habilitado: esquema 7.";
  } finally { store.close(); }
}
