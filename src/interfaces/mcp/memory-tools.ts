/**
 * Registra las herramientas MCP (protocolo de contexto de modelo) que leen y guardan recuerdos: `memory_current_project`,
 * `memory_search`, `memory_get`, `memory_save` y `memory_history`. `tools.ts` llama a `registerMemoryTools` una sola vez
 * al construir el servidor; `sessions-tools.ts` reutiliza `ecosystemTarget` para resolver el grupo de ecosistema del proyecto.
 */
import { resolveProjectContext, saveProjectMemoryWithSessionAndNotices } from "../../app";
import type { ToolContext } from "./context";
import { MemoryError } from "../../shared/errors";
import type { MemoryType, SearchScope } from "../../modules/memory";
import { toolSchemas } from "./schemas";

/** Resuelve el proyecto vinculado a un directorio y el grupo de ecosistema al que pertenece; ambos son obligatorios para el alcance (scope) ecosystem. */
export async function ecosystemTarget({memoryStore,projectDirectory}:ToolContext, directory:string|undefined):Promise<{projectId:string;group:{id:string;name:string}}> {
  const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
  if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
  if(!context.group) throw new MemoryError("GROUP_REQUIRED","El proyecto no pertenece a un grupo de ecosistema; vincúlalo a uno o usa otro alcance.");
  return {projectId:context.projectId,group:context.group};
}

/** Texto de la nota que acompaña a las lecturas de orientación (`memory_search`, `memory_context`) en una carpeta que todavía no tiene proyecto. */
export const UNBOUND_PROJECT_MESSAGE="Esta carpeta todavía no tiene proyecto en Engram, así que no hay recuerdos de proyecto ni de grupo. Se crea al iniciar sesión (memory_session_start) o al guardar.";

/** Campo `project` que se agrega a la respuesta de una lectura de orientación en una carpeta sin proyecto; mismo `status` "unbound" que usa `startup-context`. */
export function unboundProjectNote():{status:"unbound";message:string} {
  return {status:"unbound",message:UNBOUND_PROJECT_MESSAGE};
}

/** Da de alta las cinco herramientas de lectura y guardado de recuerdos sobre el `ToolContext` recibido. */
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
    // El alcance shared no necesita proyecto vinculado: se busca directamente con projectId nulo.
    if (selected === "shared") return {format:2,results:memoryStore().searchPreviews(null,query,limit ?? 10,"shared")};
    // Cualquier otro alcance (project, ecosystem o all) resuelve primero el proyecto de la carpeta.
    const directoryPath = await projectDirectory(directory);
    const context = resolveProjectContext(memoryStore(),directoryPath,false);
    // Una carpeta sin proyecto no es un error: no tiene recuerdos de proyecto ni de grupo. Con scope all quedan los de shared; en ambos casos se agrega la nota y la lectura no registra la carpeta.
    if (!context.projectId) return {format:2,results:selected === "all" ? memoryStore().searchPreviews(null,query,limit ?? 10,"shared") : [],project:unboundProjectNote()};
    return {format:2,results:memoryStore().searchPreviews(context.projectId,query,limit ?? 10,selected as SearchScope),...(context.notices?{notices:context.notices}:{})};
  }));

  register("memory_get", {
    description:"Get one memory after verifying it belongs to the selected project or explicit shared scope.",
    inputSchema:toolSchemas.memory_get,
  }, safely(async ({ directory,id,scope,version }) => {
    // El alcance ecosystem se resuelve aparte: busca por grupo, no por projectId, y no pasa por getVersion.
    if (scope === "ecosystem") {
      const { group } = await ecosystemTarget(tools,directory);
      const found = memoryStore().getVersionInGroup(group.id,id,version);
      if (!found) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
      return found;
    }
    let projectId: string | null = null;
    let notices: unknown[] | undefined;
    // shared usa projectId nulo a propósito; cualquier otro alcance necesita el proyecto de la carpeta.
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
      expectedVersion?:number; requestKey?:string; short?:string; supersedes?:string; affects?:string[] } = { title:input.title,content:input.content,type:input.type };
    if (input.topicKey !== undefined) saveInput.topicKey = input.topicKey;
    if (input.pinned !== undefined) saveInput.pinned = input.pinned;
    if (input.expectedVersion !== undefined) saveInput.expectedVersion = input.expectedVersion;
    if (input.requestKey !== undefined) saveInput.requestKey = input.requestKey;
    if (input.short !== undefined) saveInput.short = input.short;
    if (input.supersedes !== undefined) saveInput.supersedes = input.supersedes;
    if (input.affects !== undefined) saveInput.affects = input.affects;
    // Alcance ecosystem: exige groupIntent, prohíbe los campos propios de shared y guarda contra el grupo del proyecto (no contra un projectId).
    if (scope === "ecosystem") {
      if (!groupIntent) throw new MemoryError("GROUP_INTENT_REQUIRED","scope ecosystem requiere explicar por qué aplica a todo el ecosistema (groupIntent).");
      if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
      if (sessionProjectId !== undefined) throw new MemoryError("INVALID_INPUT","sessionProjectId solo se acepta con scope shared.");
      const target = await ecosystemTarget(tools,directory);
      const saved = memoryStore().saveWithSession({ ...saveInput,scope:"ecosystem",projectId:null,groupId:target.group.id,fromProjectId:target.projectId },
        {mode:"assistant",...(sessionId?{sessionId,projectId:target.projectId}:{})});
      return saved.similar ? {...saved.memory,similar:saved.similar} : saved.memory;
    }
    if (groupIntent !== undefined) throw new MemoryError("INVALID_INPUT","groupIntent solo se acepta con scope ecosystem.");
    // Alcance shared: exige globalIntent y, si se da sessionId o sessionProjectId, exige los dos juntos; guarda con projectId nulo.
    if (scope === "shared") {
      if (!globalIntent) throw new MemoryError("SHARED_INTENT_REQUIRED","scope shared requiere explicar la intención global explícita del usuario.");
      if ((sessionId === undefined) !== (sessionProjectId === undefined)) throw new MemoryError("INVALID_INPUT","sessionId y sessionProjectId son obligatorios juntos para shared.");
      const saved = memoryStore().saveWithSession({ ...saveInput,scope:"shared",projectId:null },
        {mode:"assistant",...(sessionId?{sessionId}:{}),...(sessionProjectId?{projectId:sessionProjectId}:{})});
      return saved.similar ? {...saved.memory,similar:saved.similar} : saved.memory;
    }
    // Sin scope explícito (project, el caso por defecto): globalIntent y sessionProjectId no aplican; se resuelve o crea el proyecto de la carpeta.
    if (globalIntent !== undefined) throw new MemoryError("INVALID_INPUT","globalIntent solo se acepta con scope shared explícito.");
    if (sessionProjectId !== undefined) throw new MemoryError("INVALID_INPUT","sessionProjectId solo se acepta con scope shared.");
    const directoryPath = await projectDirectory(directory);
    const {saved,notices}=saveProjectMemoryWithSessionAndNotices(memoryStore(),directoryPath,saveInput,{mode:"assistant",...(sessionId?{sessionId}:{})});
    return {...saved.memory,sessionId:saved.sessionId,sessionSource:saved.sessionSource,...(saved.similar?{similar:saved.similar}:{}),...(notices.length?{notices}:{})};
  }));

  register("memory_history", {
    description:"List all versions after verifying memory ownership in the selected scope.",
    inputSchema:toolSchemas.memory_history,
  }, safely(async ({ directory,id,scope }) => {
    // Igual que en memory_get: ecosystem se resuelve por grupo, aparte de la ruta por projectId.
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
