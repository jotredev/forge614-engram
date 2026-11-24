/**
 * Registra las herramientas MCP (protocolo de contexto de modelo) de sesión y contexto: `memory_session_start`,
 * `memory_session_end`, `memory_session_summary`, `memory_timeline` y `memory_context`. `tools.ts` llama a
 * `registerSessionTools` junto a `registerMemoryTools` al construir el servidor.
 */
import { pinnedPageFor, readProjectContext, resolveProjectContext, startProjectSessionWithNotices, waitForCloud } from "../../app";
import { MemoryError } from "../../shared/errors";
import { sessionNotice } from "../../modules/sessions";
import { toolSchemas } from "./schemas";
import type { ToolContext } from "./context";
import { ecosystemTarget, noGroupNote, projectNotBound, unboundProjectNote } from "./memory-tools";
import type { ContextResult } from "../../modules/search";

/**
 * Forma vacía de `contextForGroup` (`ContextResult`: formato 1, sin fijadas, recientes ni resúmenes, nada omitido ni truncado). `memory_context` con scope
 * ecosystem la devuelve, junto con la nota `project` (carpeta sin proyecto) o `ecosystem` (proyecto ligado sin grupo), cuando no hay grupo del que leer.
 */
const EMPTY_GROUP_CONTEXT:ContextResult={format:1,pinned:[],recent:[],summaries:[],omitted:{pinned:0,recent:0,summaries:0},truncated:false};

/** Da de alta las cinco herramientas de sesión y contexto sobre el `ToolContext` recibido. */
export function registerSessionTools(tools:ToolContext):void {
  const {register,safely,memoryStore,projectDirectory}=tools;
  register("memory_session_start", {
    description:"Start or replay an explicit conversation session for the atomically resolved project directory.",
    inputSchema:toolSchemas.memory_session_start,
  }, safely(async ({directory,sessionId}) => {
    const store=memoryStore();
    const started=startProjectSessionWithNotices(store,await projectDirectory(directory),sessionId);
    // El aviso de sesión (dejada abierta, abierta en paralelo, o de nube) se calcula aparte, a partir de lo que devolvió el arranque y de los avisos de nube pendientes (D4, D11).
    const notice=sessionNotice(started.previous,started.parallel,store.takeCloudNotices());
    return {...started.session,...(started.previous?{previous:started.previous}:{}),...(started.parallel?{parallel:started.parallel}:{}),...(started.notices.length?{notices:started.notices}:{}),...(notice?{sessionNotice:notice}:{})};
  }));

  register("memory_session_end", {
    description:"Close an explicit session after its summary has been saved.",
    inputSchema:toolSchemas.memory_session_end,
  }, safely(async ({directory,sessionId}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw projectNotBound(context);
    return memoryStore().endSession(context.projectId,sessionId);
  }));

  register("memory_session_summary", {
    description:"Save a structured durable session summary before closing the explicit session.",
    inputSchema:toolSchemas.memory_session_summary,
  }, safely(async ({directory,sessionId,summary,requestKey,expectedVersion,scope,groupIntent}) => {
    // scope ecosystem exige groupIntent y guarda el resumen contra el grupo del proyecto, no contra el proyecto solo.
    if(scope==="ecosystem") {
      if(!groupIntent) throw new MemoryError("GROUP_INTENT_REQUIRED","scope ecosystem requiere explicar por qué aplica a todo el ecosistema (groupIntent).");
      const target=await ecosystemTarget(tools,directory);
      return memoryStore().saveSessionSummaryInGroup(target.projectId,sessionId,target.group.id,summary,{requestKey,...(expectedVersion?{expectedVersion}:{})});
    }
    if(groupIntent!==undefined) throw new MemoryError("INVALID_INPUT","groupIntent solo se acepta con scope ecosystem.");
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw projectNotBound(context);
    return memoryStore().saveSessionSummary(context.projectId,sessionId,summary,{requestKey,...(expectedVersion?{expectedVersion}:{})});
  }));

  register("memory_timeline", {
    description:"Read owner-checked neighboring session decisions around an exact memory version.",
    inputSchema:toolSchemas.memory_timeline,
  }, safely(async ({directory,sessionId,id:memoryId,version,before,after}) => {
    const context=resolveProjectContext(memoryStore(),await projectDirectory(directory),false);
    if(!context.projectId) throw projectNotBound(context);
    return memoryStore().timeline(context.projectId,{sessionId,memoryId,version,...(before===undefined?{}:{before}),...(after===undefined?{}:{after})});
  }));

  register("memory_context", {
    description:"Return bounded orientation without a query. Set pinnedOnly to list active pins by scope and pass nextCursor as cursor to continue.",
    inputSchema:toolSchemas.memory_context,
  }, safely(async ({directory,scope,compact,maxBytes,pinnedOnly,cursor}) => {
    if (!pinnedOnly && (scope === "project" || cursor !== undefined)) {
      throw new MemoryError("INVALID_INPUT", "scope project y cursor requieren pinnedOnly: true.");
    }
    const store=memoryStore();
    // Espera de arranque (D8): con nube prendida, baja y aplica lo nuevo con un tope de 1000 ms antes de leer; sin nube, vuelve enseguida sin conectar.
    await waitForCloud(store);
    if (pinnedOnly) {
      const options = { ...(cursor === undefined ? {} : { cursor }), ...(maxBytes === undefined ? {} : { maxBytes }) };
      if (scope === "shared") return pinnedPageFor(store, { projectId: null, groupId: null, scope }, options);
      const context = resolveProjectContext(store, await projectDirectory(directory), false);
      const notes = !context.projectId ? { project: unboundProjectNote(context) }
        : scope === "ecosystem" && !context.group ? { ecosystem: noGroupNote() }
        : context.notices ? { notices: context.notices } : {};
      return pinnedPageFor(store, { projectId: context.projectId, groupId: context.group?.id ?? null, ...(scope ? { scope } : {}) }, options, notes);
    }
    const options={...(compact===undefined?{}:{compact}),...(maxBytes===undefined?{}:{maxBytes})};
    // shared no depende de resolver el proyecto de la carpeta; sin scope explícito, cae al contexto del proyecto (con su bloque de ecosistema si pertenece a un grupo).
    if(scope==="shared") return store.context(null,options);
    const context=resolveProjectContext(store,await projectDirectory(directory),false);
    if(scope==="ecosystem") {
      if(!context.projectId) return {...EMPTY_GROUP_CONTEXT,project:unboundProjectNote(context)};
      if(!context.group) return {...EMPTY_GROUP_CONTEXT,ecosystem:noGroupNote()};
      return store.contextForGroup(context.group.id,options);
    }
    if(!context.projectId) return {...store.context(null,options),project:unboundProjectNote(context)};
    const result=readProjectContext(store,context.projectId,options);
    return context.notices ? {...result,notices:context.notices} : result;
  }));
}
