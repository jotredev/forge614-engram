import { resolveProjectContext, startProjectSession } from "../../app";
import { MemoryError } from "../../shared/errors";
import { toolSchemas } from "./schemas";
import type { ToolContext } from "./context";

export function registerSessionTools({register,safely,memoryStore,projectDirectory}:ToolContext):void {
  register("memory_session_start", {
    description:"Start or replay an explicit conversation session for the atomically resolved project directory.",
    inputSchema:toolSchemas.memory_session_start,
  }, safely(async ({directory,sessionId}) => startProjectSession(memoryStore(),await projectDirectory(directory),sessionId)));

  register("memory_session_end", {
    description:"Close an explicit session after its summary has been saved.",
    inputSchema:toolSchemas.memory_session_end,
  }, safely(async ({directory,sessionId}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().endSession(context.projectId,sessionId);
  }));

  register("memory_session_summary", {
    description:"Save a structured durable session summary before closing the explicit session.",
    inputSchema:toolSchemas.memory_session_summary,
  }, safely(async ({directory,sessionId,summary,requestKey,expectedVersion}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().saveSessionSummary(context.projectId,sessionId,summary,{requestKey,...(expectedVersion?{expectedVersion}:{})});
  }));

  register("memory_timeline", {
    description:"Read owner-checked neighboring session decisions around an exact memory version.",
    inputSchema:toolSchemas.memory_timeline,
  }, safely(async ({directory,sessionId,id:memoryId,version,before,after}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    return memoryStore().timeline(context.projectId,{sessionId,memoryId,version,...(before===undefined?{}:{before}),...(after===undefined?{}:{after})});
  }));

  register("memory_context", {
    description:"Return bounded project or shared orientation without a query.",
    inputSchema:toolSchemas.memory_context,
  }, safely(async ({directory,scope,compact,maxBytes}) => {
    let projectId:string|null=null;
    if(scope!=="shared") {
      const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
      if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
      projectId=context.projectId;
    }
    return memoryStore().context(projectId,{...(compact===undefined?{}:{compact}),...(maxBytes===undefined?{}:{maxBytes})});
  }));
}
