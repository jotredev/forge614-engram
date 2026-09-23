import { readProjectContext, resolveProjectContext, startProjectSessionWithNotices } from "../../app";
import { MemoryError } from "../../shared/errors";
import { toolSchemas } from "./schemas";
import type { ToolContext } from "./context";
import { ecosystemTarget } from "./memory-tools";

export function registerSessionTools(tools:ToolContext):void {
  const {register,safely,memoryStore,projectDirectory}=tools;
  register("memory_session_start", {
    description:"Start or replay an explicit conversation session for the atomically resolved project directory.",
    inputSchema:toolSchemas.memory_session_start,
  }, safely(async ({directory,sessionId}) => {
    const started=startProjectSessionWithNotices(memoryStore(),await projectDirectory(directory),sessionId);
    return started.notices.length ? {...started.session,notices:started.notices} : started.session;
  }));

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
  }, safely(async ({directory,sessionId,summary,requestKey,expectedVersion,scope,groupIntent}) => {
    if(scope==="ecosystem") {
      if(!groupIntent) throw new MemoryError("GROUP_INTENT_REQUIRED","scope ecosystem requiere explicar por qué aplica a todo el ecosistema (groupIntent).");
      const target=await ecosystemTarget(tools,directory);
      return memoryStore().saveSessionSummaryInGroup(target.projectId,sessionId,target.group.id,summary,{requestKey,...(expectedVersion?{expectedVersion}:{})});
    }
    if(groupIntent!==undefined) throw new MemoryError("INVALID_INPUT","groupIntent solo se acepta con scope ecosystem.");
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
    description:"Return bounded project, ecosystem or shared orientation without a query. A project in a group also gets its ecosystem block.",
    inputSchema:toolSchemas.memory_context,
  }, safely(async ({directory,scope,compact,maxBytes}) => {
    const options={...(compact===undefined?{}:{compact}),...(maxBytes===undefined?{}:{maxBytes})};
    if(scope==="shared") return memoryStore().context(null,options);
    if(scope==="ecosystem") return memoryStore().contextForGroup((await ecosystemTarget(tools,directory)).group.id,options);
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw new MemoryError("PROJECT_NOT_BOUND","La carpeta no está vinculada a un proyecto.");
    const result=readProjectContext(memoryStore(),context.projectId,options);
    return context.notices ? {...result,notices:context.notices} : result;
  }));
}
