import { resolveProjectContext, saveProjectMemoryWithSessionAndNotices } from "../../app";
import type { ToolContext } from "./context";
import { MemoryError } from "../../shared/errors";
import type { MemoryType, SearchScope } from "../../modules/memory";
import { toolSchemas } from "./schemas";

/** The bound project of a directory and the ecosystem group it belongs to; both are required for the ecosystem scope. */
export async function ecosystemTarget({memoryStore,projectDirectory}:ToolContext, directory:string|undefined):Promise<{projectId:string;group:{id:string;name:string}}> {
  const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
  if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
  if(!context.group) throw new MemoryError("GROUP_REQUIRED","El proyecto no pertenece a un grupo de ecosistema; vincúlalo a uno o usa otro alcance.");
  return {projectId:context.projectId,group:context.group};
}

export function registerMemoryTools(tools:ToolContext):void {
  const {register,safely,memoryStore,projectDirectory}=tools;
  register("memory_current_project", {
    description:"Resolve the current local project binding without creating a project.",
    inputSchema:toolSchemas.memory_current_project,
  }, safely(async ({ directory }) => {
    const selected = await projectDirectory(directory);
    return resolveProjectContext(memoryStore(),selected,false);
  }));

  register("memory_search", {
    description:"Search active memories and return format 2 preview results. Previews can omit details; use memory_get before relying on them.",
    inputSchema:toolSchemas.memory_search,
  }, safely(async ({ directory,query,limit,scope }) => {
    const selected = scope ?? "all";
    if (selected === "shared") return {format:2,results:memoryStore().searchPreviews(null,query,limit ?? 10,"shared")};
    const directoryPath = await projectDirectory(directory);
    const context = resolveProjectContext(memoryStore(),directoryPath,false);
    if (!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla.");
    return {format:2,results:memoryStore().searchPreviews(context.projectId,query,limit ?? 10,selected as SearchScope),...(context.notices?{notices:context.notices}:{})};
  }));

  register("memory_get", {
    description:"Get one memory after verifying it belongs to the selected project or explicit shared scope.",
    inputSchema:toolSchemas.memory_get,
  }, safely(async ({ directory,id,scope,version }) => {
    if (scope === "ecosystem") {
      const { group } = await ecosystemTarget(tools,directory);
      const found = memoryStore().getVersionInGroup(group.id,id,version);
      if (!found) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
      return found;
    }
    let projectId: string | null = null;
    let notices: unknown[] | undefined;
    if (scope !== "shared") {
      const directoryPath = await projectDirectory(directory);
      const context = resolveProjectContext(memoryStore(),directoryPath,false);
      projectId = context.projectId; notices = context.notices;
    }
    if (scope !== "shared" && !projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const memory = memoryStore().getVersion(projectId,id,version);
    if (!memory) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
    return notices ? {...memory,notices} : memory;
  }));

  register("memory_save", {
    description:"Save or revise a curated durable memory. Project is default; shared requires explicit scope and global intent; ecosystem (knowledge shared by the repositories of the project's group) requires explicit scope and group intent.",
    inputSchema:toolSchemas.memory_save,
  }, safely(async ({ directory,scope,globalIntent,groupIntent,sessionId,sessionProjectId,...input }) => {
    const saveInput: { title:string; content:string; type:MemoryType; topicKey?:string; pinned?:boolean;
      expectedVersion?:number; requestKey?:string } = { title:input.title,content:input.content,type:input.type };
    if (input.topicKey !== undefined) saveInput.topicKey = input.topicKey;
    if (input.pinned !== undefined) saveInput.pinned = input.pinned;
    if (input.expectedVersion !== undefined) saveInput.expectedVersion = input.expectedVersion;
    if (input.requestKey !== undefined) saveInput.requestKey = input.requestKey;
    if (scope === "ecosystem") {
      if (!groupIntent) throw new MemoryError("GROUP_INTENT_REQUIRED","scope ecosystem requiere explicar por qué aplica a todo el ecosistema (groupIntent).");
      if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
      if (sessionProjectId !== undefined) throw new MemoryError("INVALID_INPUT","sessionProjectId solo se acepta con scope shared.");
      const target = await ecosystemTarget(tools,directory);
      return memoryStore().saveWithSession({ ...saveInput,scope:"ecosystem",projectId:null,groupId:target.group.id },
        {mode:"assistant",...(sessionId?{sessionId,projectId:target.projectId}:{})}).memory;
    }
    if (groupIntent !== undefined) throw new MemoryError("INVALID_INPUT","groupIntent solo se acepta con scope ecosystem.");
    if (scope === "shared") {
      if (!globalIntent) throw new MemoryError("SHARED_INTENT_REQUIRED","scope shared requiere explicar la intención global explícita del usuario.");
      if ((sessionId === undefined) !== (sessionProjectId === undefined)) throw new MemoryError("INVALID_INPUT","sessionId y sessionProjectId son obligatorios juntos para shared.");
      return memoryStore().saveWithSession({ ...saveInput,scope:"shared",projectId:null },
        {mode:"assistant",...(sessionId?{sessionId}:{}),...(sessionProjectId?{projectId:sessionProjectId}:{})}).memory;
    }
    if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
    if (sessionProjectId !== undefined) throw new MemoryError("INVALID_INPUT","sessionProjectId solo se acepta con scope shared.");
    const directoryPath = await projectDirectory(directory);
    const {saved,notices}=saveProjectMemoryWithSessionAndNotices(memoryStore(),directoryPath,saveInput,{mode:"assistant",...(sessionId?{sessionId}:{})});
    return {...saved.memory,sessionId:saved.sessionId,sessionSource:saved.sessionSource,...(notices.length?{notices}:{})};
  }));

  register("memory_history", {
    description:"List all versions after verifying memory ownership in the selected scope.",
    inputSchema:toolSchemas.memory_history,
  }, safely(async ({ directory,id,scope }) => {
    if (scope === "ecosystem") {
      const { group } = await ecosystemTarget(tools,directory);
      const versions = memoryStore().historyInGroup(group.id,id);
      if (versions.length === 0) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
      return versions;
    }
    let projectId: string | null = null;
    if (scope !== "shared") {
      const directoryPath = await projectDirectory(directory);
      projectId = resolveProjectContext(memoryStore(),directoryPath,false).projectId;
    }
    if (scope !== "shared" && !projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const history = memoryStore().history(projectId,id);
    if (history.length === 0) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
    return history;
  }));

}
