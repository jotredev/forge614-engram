/**
 * Operaciones de escritura (todo lo que crea, actualiza, archiva o mueve datos) sobre la base
 * SQLite del recuerdo (memory, la unidad de información guardada) durable de Forge614 Engram.
 * Existe para reunir en un solo lugar las reglas de negocio de guardar un recuerdo y de manejar
 * proyectos y sesiones, de modo que cada operación compuesta controle su propia transacción
 * (conjunto de cambios que se aplican todos juntos o ninguno) y las funciones internas (helpers)
 * reutilicen la misma conexión sin abrir transacciones propias.
 *
 * Lo usa la capa de aplicación (src/app/memory-store.ts), que a su vez exponen las herramientas
 * MCP (Model Context Protocol, el protocolo con el que un asistente llama a estas funciones).
 *
 * Piezas principales:
 * - Proyectos y carpetas: resolveProjectDirectory, renameProject, bindProjectDirectory,
 *   rebindProjectDirectory.
 * - Sesiones: startSession, endSession, startSessionForProjectDirectory.
 * - Guardar recuerdos: save, saveWithSession, saveForProjectDirectory,
 *   saveWithSessionForProjectDirectory, saveSessionSummary, y el motor común saveCore.
 * - Ciclo de vida de un recuerdo: archive, restore, moveMemoryToGroup (pasar un recuerdo al
 *   alcance ecosystem, el tablero compartido entre varios proyectos de un mismo grupo).
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { boardTypeAllowed,ECOSYSTEM_AFFECTS_MIN,ECOSYSTEM_BOARD_LIMIT,ECOSYSTEM_STATUS_MAX,ECOSYSTEM_STATUS_TOPIC,groupIdentity } from "../../modules/ecosystem";
import { findSecret,memoryTypes,normalizeAffects,normalizeShort,reviewAfterFor,sameConfirmationPayload,type Memory,type MemoryMeta,type MemoryOwner,type MemoryVersion,type SaveInput } from "../../modules/memory";
import { projectIdentity,type Project } from "../../modules/projects";
import { sessionIdentity,summaryContent,type Session,type SessionSaveOptions,type SessionSaveResult,type SummaryFields } from "../../modules/sessions";
import { MemoryError } from "../../shared/errors";
import { touchSession } from "./activity";
import { confirmationCandidate,confirmationRequest,reinforcementEnabled } from "./confirmations";
import { intelligenceEnabled } from "./intelligence";
import { readMeta,upsertMeta } from "./meta";
import { similarTo } from "./similar";
import { getGroup,recordIdentityEvent,requireEcosystem } from "./ecosystem-groups";
import { groupSource } from "./board";
import { get,required,type Row } from "./memory";
import { getProject,projectForDirectory,requireProjectBindings,resolveProjectDirectory as resolveProjectDirectoryInTransaction } from "./projects";
import { endRuntimeSession,inferredSessions,manualSession,requireSessions,sessionsEnabled,startRuntimeSession,validateSelectedSession } from "./sessions";

// Las escrituras compuestas (varios pasos combinados) son dueñas aquí de su transacción externa;
// las funciones internas (helpers) de hoja reutilizan esa misma conexión.
/**
 * Encuentra o crea el proyecto vinculado a una carpeta (directory) local. Si ya existe un vínculo
 * para esa carpeta lo devuelve tal cual; si no existe y `create` es verdadero, crea el proyecto y
 * el vínculo dentro de una transacción (para que ambas escrituras se apliquen juntas o ninguna).
 * @param db conexión abierta a la base SQLite.
 * @param directory ruta de la carpeta a resolver.
 * @param name nombre a usar si hay que crear el proyecto.
 * @param create si es falso, solo busca el vínculo existente y nunca crea nada.
 * @param bindingAvailable función opcional que dice si la carpeta de un vínculo ya guardado sigue
 *   existiendo en disco; se usa para decidir si hace falta un vínculo explícito antes de crear.
 * @param origin remoto de Git crudo de la carpeta (D6, T3b), o `null`/`undefined` si no se conoce;
 *   ver `resolveProjectDirectory` de `./projects` para cómo se usa.
 * @returns el proyecto encontrado o creado (o null si no existe y `create` es falso) y si se creó.
 * @throws MemoryError con código MIGRATION_REQUIRED si los vínculos de proyecto no están
 *   habilitados, INVALID_INPUT si `directory` o `name` están vacíos, o PROJECT_BINDING_REQUIRED
 *   si hace falta vincular a mano (nombre repetido sin remoto coincidente, o carpeta nueva que puede ser un proyecto cuyas carpetas registradas ya no existen).
 */
export function resolveProjectDirectory(db: Database, directory: string, name: string, create: boolean,
    bindingAvailable?: (directory:string)=>boolean, origin?: string | null): { project: Project | null; created: boolean } {
  requireProjectBindings(db);
  const path = required(directory,"directory"), displayName = required(name,"name");
  const operation = () => resolveProjectDirectoryInTransaction(db,path,displayName,create,bindingAvailable,origin);
  // Solo cuando puede crear hace falta transacción: crear el proyecto y su vínculo son dos
  // escrituras que deben quedar juntas; una simple búsqueda no escribe nada y no la necesita.
  return create ? db.transaction(operation).immediate() : operation();
}

/**
 * Cambia el nombre visible de un proyecto ya existente.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto a renombrar.
 * @param name nuevo nombre.
 * @returns el proyecto con el nombre actualizado.
 * @throws MemoryError con código PROJECT_NOT_FOUND si el proyecto no existe, o INVALID_INPUT si
 *   `projectId` o `name` no son válidos.
 */
export function renameProject(db: Database, projectId: string, name: string): Project {
    const identity = projectIdentity(projectId);
    const displayName = required(name, "name");
    return db.transaction(() => {
      // Se comprueba dentro de la transacción para que la lectura y la escritura vean el mismo estado.
      if (!getProject(db, identity)) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
      db.query("UPDATE projects SET name=?,updatedAt=? WHERE projectId=?")
        .run(displayName,new Date().toISOString(),identity);
      return getProject(db, identity)!;
    }).immediate();
  }

/**
 * Abre (o reabre) una sesión de ejecución (runtime, el proceso del asistente que está corriendo)
 * para un proyecto ya existente.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto dueño de la sesión.
 * @param sessionId identificador de la sesión a abrir.
 * @param runtimeDirectory carpeta desde la que corre esa sesión, si se conoce.
 * @returns la sesión abierta.
 * @throws MemoryError con código MIGRATION_REQUIRED si las sesiones no están habilitadas,
 *   PROJECT_NOT_FOUND si el proyecto no existe, o SESSION_CONFLICT si el identificador ya
 *   pertenece a otro proyecto, a otro tipo de sesión o a una sesión ya cerrada.
 */
export function startSession(db: Database, projectId: string, sessionId: string, runtimeDirectory?: string): Session {
    requireSessions(db);
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const directory = runtimeDirectory === undefined ? undefined : required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => startRuntimeSession(db,project,id,directory)).immediate();
  }

/**
 * Cierra una sesión de ejecución abierta.
 * @param db conexión abierta a la base SQLite.
 * @param projectId identificador del proyecto dueño de la sesión.
 * @param sessionId identificador de la sesión a cerrar.
 * @returns la sesión ya cerrada.
 * @throws MemoryError con código MIGRATION_REQUIRED si las sesiones no están habilitadas,
 *   SESSION_NOT_FOUND si no existe para ese proyecto, o SESSION_KIND si es una sesión manual
 *   (las sesiones manuales no se cierran).
 */
export function endSession(db: Database, projectId: string, sessionId: string): Session {
    requireSessions(db);
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    return db.transaction(() => endRuntimeSession(db,project,id)).immediate();
  }

/**
 * Resuelve (o crea) el proyecto de una carpeta y abre en él una sesión de ejecución, todo en una
 * sola transacción para que ninguna de las dos escrituras quede sin la otra.
 * @param db conexión abierta a la base SQLite.
 * @param directory carpeta cuyo proyecto se resuelve o crea.
 * @param name nombre a usar si hay que crear el proyecto.
 * @param runtimeDirectory carpeta desde la que corre la sesión.
 * @param sessionId identificador de la sesión a abrir.
 * @param bindingAvailable ver resolveProjectDirectory.
 * @param origin ver resolveProjectDirectory (D6, T3b).
 * @returns la sesión abierta.
 * @throws MemoryError con los mismos códigos que resolveProjectDirectory y startRuntimeSession.
 */
export function startSessionForProjectDirectory(db: Database, directory: string, name: string, runtimeDirectory: string, sessionId: string,
    bindingAvailable?: (directory:string)=>boolean, origin?: string | null): Session {
    requireSessions(db);
    const id = sessionIdentity(sessionId); const runtime = required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable,origin);
      return startRuntimeSession(db,context.project!.projectId,id,runtime);
    }).immediate();
  }

/**
 * Vincula explícitamente una carpeta a un proyecto ya existente, sin mover nada si ya estaba
 * vinculada a otro proyecto.
 * @param db conexión abierta a la base SQLite.
 * @param directory carpeta a vincular.
 * @param projectId proyecto al que se vincula.
 * @returns el proyecto vinculado.
 * @throws MemoryError con código MIGRATION_REQUIRED si los vínculos no están habilitados,
 *   PROJECT_NOT_FOUND si el proyecto no existe, o PROJECT_BINDING_CONFLICT si la carpeta ya
 *   pertenece a otro proyecto.
 */
export function bindProjectDirectory(db: Database, directory: string, projectId: string): Project {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const identity = projectIdentity(projectId);
    return db.transaction(() => {
      const project = getProject(db, identity);
      if (!project) throw new MemoryError("PROJECT_NOT_FOUND","Proyecto no encontrado en esta base.");
      const bound = projectForDirectory(db, path);
      // Vincular ya vinculado a otro proyecto sería mover en silencio: se rechaza en vez de sobrescribir.
      if (bound && bound.projectId !== identity) {
        throw new MemoryError("PROJECT_BINDING_CONFLICT","La carpeta ya está vinculada a otro proyecto.");
      }
      // Si ya estaba vinculada al mismo proyecto no hay nada que insertar; solo se crea el vínculo si faltaba.
      if (!bound) db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
        .run(path,identity,new Date().toISOString());
      return project;
    }).immediate();
  }

/**
 * El archivo de identidad (identity file, el archivo que declara a qué proyecto pertenece una
 * carpeta) manda sobre un vínculo por ruta: mueve la carpeta al proyecto que declara el archivo
 * y deja registrado el evento de identidad.
 * @param db conexión abierta a la base SQLite.
 * @param directory carpeta cuyo vínculo se corrige.
 * @param projectId proyecto que declara el archivo de identidad.
 * @returns el proyecto anterior al que estaba vinculada la carpeta, o null si no tenía vínculo o
 *   ya era el mismo.
 * @throws MemoryError con código MIGRATION_REQUIRED si los vínculos no están habilitados,
 *   PROJECT_NOT_FOUND si el proyecto no existe, o MIGRATION_REQUIRED (vía requireEcosystem) si
 *   hay que mover un vínculo existente y el alcance ecosystem no está habilitado.
 */
export function rebindProjectDirectory(db: Database, directory: string, projectId: string): { previousProjectId: string | null } {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const identity = projectIdentity(projectId);
    return db.transaction(() => {
      if (!getProject(db, identity)) throw new MemoryError("PROJECT_NOT_FOUND","Proyecto no encontrado en esta base.");
      const bound = projectForDirectory(db, path);
      // Ya apunta al proyecto correcto: no hay nada que mover ni que registrar.
      if (bound?.projectId === identity) return { previousProjectId: null };
      // Mover un vínculo existente es un evento de identidad, así que requiere el alcance ecosystem.
      if (bound) requireEcosystem(db);
      // Se borra el vínculo viejo antes de insertar el nuevo (la carpeta es única en la tabla).
      if (bound) db.query("DELETE FROM project_bindings WHERE directory=?").run(path);
      db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)").run(path,identity,new Date().toISOString());
      // El evento solo se registra cuando de verdad se movió algo, no en la primera vinculación.
      if (bound) recordIdentityEvent(db, { action: "PROJECT_REBOUND_FROM_FILE", projectId: identity, previousProjectId: bound.projectId, directory: path });
      return { previousProjectId: bound?.projectId ?? null };
    }).immediate();
  }

/**
 * Resuelve (o crea) el proyecto de una carpeta y guarda en él un recuerdo, todo en una sola
 * transacción para que crear el proyecto y guardar el recuerdo queden juntos o ninguno.
 * @param db conexión abierta a la base SQLite.
 * @param directory carpeta cuyo proyecto se resuelve o crea.
 * @param name nombre a usar si hay que crear el proyecto.
 * @param input datos del recuerdo a guardar (sin projectId ni scope, que los pone esta función).
 * @param bindingAvailable ver resolveProjectDirectory.
 * @param origin ver resolveProjectDirectory (D6, T3b).
 * @returns la versión del recuerdo guardado.
 * @throws MemoryError con los códigos de resolveProjectDirectory y de saveCore.
 */
export function saveForProjectDirectory(db: Database, directory: string, name: string, input: Omit<SaveInput,"projectId"|"scope">,
    bindingAvailable?: (directory:string)=>boolean, origin?: string | null): MemoryVersion {
    requireProjectBindings(db);
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable,origin);
      return saveCore(db, { ...input, scope:"project", projectId:context.project!.projectId },{},new Date().toISOString()).memory;
    }).immediate();
  }

/**
 * Igual que saveForProjectDirectory, pero además asocia el guardado a una sesión de ejecución
 * (runtime) según `options`.
 * @param db conexión abierta a la base SQLite.
 * @param directory carpeta cuyo proyecto se resuelve o crea.
 * @param name nombre a usar si hay que crear el proyecto.
 * @param runtimeDirectory carpeta desde la que corre la sesión, para inferirla si no se indica una explícita.
 * @param input datos del recuerdo a guardar.
 * @param options opciones de asociación con la sesión (sessionId explícito, modo, etc).
 * @param bindingAvailable ver resolveProjectDirectory.
 * @param origin ver resolveProjectDirectory (D6, T3b).
 * @returns el recuerdo guardado junto con la sesión asociada.
 * @throws MemoryError con los códigos de resolveProjectDirectory y de saveCore.
 */
export function saveWithSessionForProjectDirectory(db: Database, directory: string, name: string, runtimeDirectory: string, input: Omit<SaveInput,"projectId"|"scope">,
    options: SessionSaveOptions = {}, bindingAvailable?: (directory:string)=>boolean, origin?: string | null): SessionSaveResult {
    requireProjectBindings(db);
    const runtime = required(runtimeDirectory,"runtimeDirectory");
    return db.transaction(() => {
      const context = resolveProjectDirectoryInTransaction(db, directory,name,true,bindingAvailable,origin);
      return saveCore(db, { ...input, scope:"project", projectId:context.project!.projectId },
        { ...options, runtimeDirectory:runtime },new Date().toISOString());
    }).immediate();
  }

/**
 * Guarda un recuerdo sin asociarlo a ninguna sesión. Envoltura simple sobre saveCore que abre su
 * propia transacción.
 * @param db conexión abierta a la base SQLite.
 * @param input datos del recuerdo a guardar.
 * @returns la versión del recuerdo guardado.
 * @throws MemoryError con los códigos documentados en saveCore.
 */
export function save(db: Database, input: SaveInput): MemoryVersion {
    return db.transaction(() => saveCore(db, input,{},new Date().toISOString()).memory).immediate();
  }

/**
 * Guarda un recuerdo y, según `options`, lo asocia a una sesión de ejecución explícita, inferida
 * o manual.
 * @param db conexión abierta a la base SQLite.
 * @param input datos del recuerdo a guardar.
 * @param options opciones de asociación con la sesión.
 * @returns el recuerdo guardado junto con la sesión asociada (si aplica).
 * @throws MemoryError con los códigos documentados en saveCore.
 */
export function saveWithSession(db: Database, input: SaveInput, options: SessionSaveOptions = {}): SessionSaveResult {
    return db.transaction(() => saveCore(db, input,options,new Date().toISOString())).immediate();
  }

/**
 * Guarda (o actualiza) el resumen de una sesión como un recuerdo de tipo procedure (procedimiento),
 * en el tema reservado `session/{sessionId}/summary`, y mantiene un puntero en session_summaries
 * a su memoria y versión más reciente. El resumen puede vivir en el proyecto de la sesión o, si se
 * indica `groupId`, en el tablero del grupo del ecosistema.
 * @param db conexión abierta a la base SQLite.
 * @param projectId proyecto dueño de la sesión.
 * @param sessionId sesión cuyo resumen se guarda.
 * @param fields campos estructurados del resumen (objetivo, instrucciones, hallazgos, etc).
 * @param request clave de petición (requestKey, para hacerla repetible sin duplicar) y versión
 *   esperada opcional.
 * @param groupId grupo del ecosistema donde guardar el resumen, si aplica.
 * @returns el recuerdo guardado junto con la sesión asociada.
 * @throws MemoryError con código INVALID_INPUT si expectedVersion no es un entero positivo,
 *   MIGRATION_REQUIRED si las sesiones o el ecosistema no están habilitados, GROUP_NOT_FOUND si el
 *   grupo no existe, SUMMARY_TOPIC_CONFLICT si el tema ya pertenece a otro recuerdo o no coincide
 *   con el puntero guardado, y los demás códigos documentados en saveCore.
 */
export function saveSessionSummary(db: Database, projectId: string, sessionId: string, fields: SummaryFields, request: {requestKey:string;expectedVersion?:number}, groupId?: string): SessionSaveResult {
    const project = projectIdentity(projectId); const id = sessionIdentity(sessionId);
    const group = groupId === undefined ? null : groupIdentity(groupId);
    const requestKey = required(request?.requestKey,"requestKey");
    if (request.expectedVersion !== undefined && (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1)) {
      throw new MemoryError("INVALID_INPUT","expectedVersion debe ser un entero positivo.");
    }
    // summaryContent valida y da forma al texto final; el tema fijo identifica de forma única el
    // resumen de esta sesión, sea cual sea su alcance (project o ecosystem).
    const content = summaryContent(fields); const topicKey = `session/${id}/summary`;
    return db.transaction(() => {
      requireSessions(db);
      // El puntero guardado antes de este guardado dice a qué recuerdo y versión apuntaba el resumen.
      const pointer = db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId=?").get(id) as
        {memoryId:string;version:number}|null;
      if (group !== null) { requireEcosystem(db); if (!getGroup(db, group)) throw new MemoryError("GROUP_NOT_FOUND","Grupo no encontrado en esta base."); }
      // Si el tema ya tiene un recuerdo activo pero no coincide con el puntero de esta sesión, el
      // tema fue tomado por otra cosa (no debería pasar, pero se rechaza en vez de sobrescribir).
      const occupied = (group === null
        ? db.query("SELECT id FROM memories WHERE scope='project' AND projectId=? AND topic_key=?").get(project,topicKey)
        : db.query("SELECT id FROM memories WHERE scope='ecosystem' AND groupId=? AND topic_key=?").get(group,topicKey)) as {id:string}|null;
      if (occupied && (!pointer || occupied.id !== pointer.memoryId)) {
        throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El tema reservado ya pertenece a otro recuerdo.");
      }
      // Se comprueba por adelantado si la petición ya se sirvió antes (en la tabla de peticiones o,
      // si el refuerzo de confirmaciones está activo, en sus confirmaciones), para no reinsertar el
      // puntero de session_summaries cuando saveCore ya se limita a repetir la respuesta anterior.
      const replay = (group === null
        ? db.query("SELECT 1 FROM requests WHERE scope='project' AND projectId=? AND request_key=?").get(project,requestKey)
        : db.query("SELECT 1 FROM requests WHERE scope='ecosystem' AND groupId=? AND request_key=?").get(group,requestKey)) !== null
        || (reinforcementEnabled(db) && confirmationRequest(db,group===null?"project":"ecosystem",group===null?project:group,requestKey)!==null);
      const summaryInput = {title:`Session summary: ${id}`,content,type:"procedure" as const,topicKey,
        requestKey,...(request.expectedVersion === undefined ? {} : {expectedVersion:request.expectedVersion})};
      // saveCore hace el guardado real; el último argumento `true` (summary) le dice que no aplique
      // la comprobación normal de "tema reservado para un resumen de sesión", porque este guardado
      // es precisamente ese resumen.
      const result = group === null
        ? saveCore(db, {projectId:project,...summaryInput},{sessionId:id},new Date().toISOString(),true)
        : saveCore(db, {scope:"ecosystem",projectId:null,groupId:group,...summaryInput},{sessionId:id,projectId:project},new Date().toISOString(),true);
      // Si la petición ya se había servido, saveCore devolvió la respuesta anterior sin tocar nada
      // más: el puntero no necesita actualizarse de nuevo.
      if (replay) return result;
      // El puntero ya apunta a este mismo recuerdo y versión: nada que actualizar.
      if (pointer?.memoryId === result.memory.id && pointer.version === result.memory.version) return result;
      // El puntero existía pero apunta a otro recuerdo: sería un cambio de identidad del resumen, se rechaza.
      if (pointer && pointer.memoryId !== result.memory.id) throw new MemoryError("SUMMARY_TOPIC_CONFLICT","El resumen no coincide con su puntero.");
      // Inserta el puntero si es la primera vez, o lo actualiza a la nueva versión si ya existía.
      db.query(`INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET memoryId=excluded.memoryId,version=excluded.version`)
        .run(id,result.memory.id,result.memory.version);
      return result;
    }).immediate();
  }

/**
 * Si la clave de petición (requestKey) ya se sirvió antes, para este mismo dueño (owner: el
 * proyecto o el grupo) y alcance (scope), devuelve la misma respuesta que se dio entonces en vez
 * de guardar de nuevo; así una petición repetida (por ejemplo, un reintento de red) es idempotente
 * (repetirla no cambia el resultado ni crea una segunda versión). Busca el registro en dos sitios
 * posibles: la tabla `requests` (peticiones ya completadas) y, si el refuerzo de confirmaciones
 * está activo, sus `confirmation_requests`.
 * @param db conexión abierta a la base SQLite.
 * @param input alcance y dueño de la petición, la propia clave, el hash (huella corta y
 *   determinista) del contenido que se intenta guardar ahora, la sesión explícita indicada (si la
 *   hay) y el proyecto de opción (para decidir si la sesión de origen puede mostrarse).
 * @returns la respuesta anterior, con la visibilidad de su sesión recalculada para esta llamada, o
 *   null si la petición es nueva y hay que guardarla de verdad.
 * @throws MemoryError con código REQUEST_CONFLICT si la petición está registrada en ambos sitios a
 *   la vez, si el contenido no coincide con el que se guardó, o si la sesión explícita indicada
 *   ahora no es la misma que la petición original asoció; también propaga los códigos de
 *   validateSelectedSession si la sesión explícita ya no es válida.
 */
function requestReplay(db: Database, input: {
  scope:Memory["scope"];projectId:string|null;groupId:string|null;request:string;hash:string;explicit:string|null;optionProject:string|null;
}): SessionSaveResult|null {
  const column=input.scope==="ecosystem" ? "groupId" : "projectId";
  const ownerId=input.scope==="ecosystem" ? input.groupId : input.projectId;
  // Camino 1: la petición ya quedó grabada como un guardado real, con su propia fila en `requests`.
  const previous=db.query(`SELECT payload_hash,memory_id,version FROM requests WHERE scope=? AND ${column} IS ? AND request_key=?`)
    .get(input.scope,ownerId,input.request) as {payload_hash:string;memory_id:string;version:number}|null;
  // Camino 2: la petición quedó grabada como una confirmación (el contenido no cambió respecto a
  // lo ya guardado, así que no generó una versión nueva). Solo se busca si el refuerzo está activo.
  const confirmed=reinforcementEnabled(db) ? confirmationRequest(db,input.scope,ownerId,input.request) : null;
  // Los dos caminos son mutuamente excluyentes por diseño; que ambos existan es un estado imposible.
  if(previous && confirmed) throw new MemoryError("REQUEST_CONFLICT","La clave de petición tiene registros incompatibles.");
  if(previous) {
    // Misma clave de petición pero contenido distinto: no se puede reproducir con seguridad.
    if(previous.payload_hash!==input.hash) throw new MemoryError("REQUEST_CONFLICT","La clave de petición ya corresponde a otro contenido.");
    // Reconstruye el recuerdo tal como quedó guardado entonces, a partir de su foto (snapshot) versionada.
    const row=db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(previous.memory_id,previous.version) as {snapshot:string};
    const memory=JSON.parse(row.snapshot) as MemoryVersion;
    // Busca con qué sesión quedó asociado ese guardado original (si las sesiones estaban habilitadas entonces).
    const origin=sessionsEnabled(db) ? db.query(`SELECT e.sessionId,s.kind,s.projectId FROM session_entries e
      JOIN sessions s ON s.sessionId=e.sessionId WHERE e.memoryId=? AND e.version=?`).get(previous.memory_id,previous.version) as
      {sessionId:string;kind:Session["kind"];projectId:string}|null : null;
    // Si ahora se pide una sesión explícita distinta a la que quedó asociada, es una petición incompatible.
    if(input.explicit!==null && origin?.sessionId!==input.explicit) throw new MemoryError("REQUEST_CONFLICT","La petición ya tiene otra asociación de sesión.");
    // La sesión explícita se revalida igual que en un guardado nuevo (sin exigir que siga abierta: `false`).
    if(input.explicit!==null) validateSelectedSession(db,input.explicit,input.scope,input.projectId,input.optionProject,false);
    // La sesión de origen solo se revela si el alcance es project, si se pidió una sesión explícita,
    // o si el proyecto de opción coincide con el proyecto de esa sesión: evita filtrar a qué sesión
    // de qué proyecto quedó asociado un recuerdo shared o ecosystem hacia quien consulta sin ese contexto.
    const visible=input.scope==="project" || input.explicit!==null || (input.optionProject!==null && origin?.projectId===input.optionProject);
    return {memory,sessionId:visible ? origin?.sessionId??null:null,
      sessionSource:visible && origin ? (input.explicit ? "explicit" : origin.kind==="manual" ? "manual" : "inferred") : null};
  }
  // Ninguno de los dos caminos tiene registro: la petición es nueva y debe guardarse de verdad.
  if(!confirmed) return null;
  if(confirmed.payloadHash!==input.hash) throw new MemoryError("REQUEST_CONFLICT","La clave de petición ya corresponde a otro contenido.");
  const stored=confirmed.response;
  if(input.explicit!==null && stored.sessionId!==input.explicit) throw new MemoryError("REQUEST_CONFLICT","La petición ya tiene otra asociación de sesión.");
  if(input.explicit!==null) validateSelectedSession(db,input.explicit,input.scope,input.projectId,input.optionProject,false);
  // Aquí el origen se reconstruye desde la sesión guardada en la propia respuesta de la confirmación.
  const origin=stored.sessionId===null ? null : db.query("SELECT projectId FROM sessions WHERE sessionId=?").get(stored.sessionId) as {projectId:string}|null;
  const visible=input.scope==="project" || input.explicit!==null || (input.optionProject!==null && origin?.projectId===input.optionProject);
  return {...stored,sessionId:visible?stored.sessionId:null,sessionSource:visible?stored.sessionSource:null};
}

// Metadatos del nivel 11 del esquema (short, reviewAfter, supersededBy, affects) para un guardado.
// El recuerdo al que se reemplaza (supersedes) debe estar activo y ser del mismo alcance y dueño.
/**
 * Actualiza los metadatos de nivel 11 (short: resumen corto; reviewAfter: fecha de revisión;
 * supersededBy: quién lo reemplazó; affects: proyectos que afecta en el tablero del ecosistema)
 * asociados a un recuerdo recién guardado, y si aplica marca al recuerdo reemplazado como
 * reemplazado por este.
 * @param db conexión abierta a la base SQLite.
 * @param input datos del guardado: id del recuerdo, su tipo, el instante actual, si se creó una
 *   versión nueva, si el contenido cambió, los valores short/affects/supersedes recibidos, y el
 *   alcance y dueño para validar que el reemplazado pertenece al mismo sitio.
 * @returns nada; solo escribe la fila de metadatos (y la del reemplazado, si corresponde).
 * @throws MemoryError con código INVALID_INPUT si `supersedes` es el propio id, o
 *   SUPERSEDES_NOT_FOUND si el recuerdo a reemplazar no existe, no está activo o no es del mismo
 *   alcance y dueño.
 */
function applySaveMeta(db: Database, input: { id: string; type: SaveInput["type"]; now: string; newVersion: boolean; contentChanged: boolean;
    short: string | undefined; affects: string[] | undefined; supersedes: string | null; scope: Memory["scope"]; ownerColumn: string; ownerId: string | null }): void {
  if (input.supersedes !== null) {
    if (input.supersedes === input.id) throw new MemoryError("INVALID_INPUT", "Un recuerdo no puede reemplazarse a sí mismo.");
    const target = db.query(`SELECT id FROM memories WHERE scope=? AND ${input.ownerColumn} IS ? AND id=? AND state='active'`)
      .get(input.scope, input.ownerId, input.supersedes) as { id: string } | null;
    if (!target) throw new MemoryError("SUPERSEDES_NOT_FOUND", "El recuerdo a reemplazar no existe o no es del mismo alcance.");
  }
  const previous = readMeta(db, input.id);
  const patch: Partial<MemoryMeta> = {};
  if (input.newVersion) {
    // Cada versión nueva recalcula su propia fecha de revisión (o la borra si el tipo ya no la necesita).
    const reviewAfter = reviewAfterFor(input.type, input.now);
    if (reviewAfter !== null || previous?.reviewAfter) patch.reviewAfter = reviewAfter;
    // Si el contenido cambió y no se mandó un short nuevo, el resumen corto anterior queda obsoleto y se limpia.
    if (input.short === undefined && input.contentChanged && previous?.short) patch.short = null;
  }
  if (input.short !== undefined) patch.short = input.short;
  if (input.affects !== undefined) patch.affects = input.affects;
  // Solo se escribe si de verdad hay algún campo que cambiar (evita una escritura vacía de más).
  if (Object.keys(patch).length > 0) upsertMeta(db, input.id, patch, input.now);
  if (input.supersedes !== null) upsertMeta(db, input.supersedes, { supersededBy: input.id }, input.now);
}

/**
 * Motor común de todo guardado de un recuerdo (memory). Valida la entrada, decide el alcance
 * (scope: project, shared o ecosystem) y su dueño, aplica las reglas del tablero del ecosistema
 * cuando corresponde, resuelve o crea la fila (nueva o nueva versión de una existente), la asocia
 * a una sesión si aplica, y deja registro en las tablas de versiones, eventos, peticiones y
 * metadatos. Cualquier función `save*` de este archivo termina llamando aquí dentro de su propia
 * transacción.
 * @param db conexión abierta a la base SQLite.
 * @param input datos del recuerdo a guardar (título, contenido, tipo, alcance, tema, etc).
 * @param options opciones de asociación con una sesión de ejecución.
 * @param requestNow instante (ISO) que se usa como "ahora" para toda la operación, para que sea
 *   estable aunque la función tarde en ejecutarse.
 * @param summary true cuando quien llama es saveSessionSummary, para no aplicar la comprobación de
 *   "tema reservado para un resumen de sesión" al resumen mismo.
 * @returns el recuerdo guardado (nuevo o repetido de una petición anterior), la sesión asociada y,
 *   si es un recuerdo nuevo sin tema, hasta tres parecidos.
 * @throws MemoryError con código INVALID_INPUT (alcance, campos vacíos, tipo o pinned inválidos,
 *   expectedVersion sin tema, mode inválido), SECRET_REJECTED (el texto parece contener un
 *   secreto), INTELLIGENCE_REQUIRED (short/supersedes/affects sin memoria inteligente),
 *   PROJECT_NOT_FOUND, MIGRATION_REQUIRED (ecosistema o sesiones no habilitados), GROUP_NOT_FOUND,
 *   AMBIGUOUS_SESSION, SUMMARY_TOPIC_RESERVED, ARCHIVED, VERSION_CONFLICT,
 *   ECOSYSTEM_STATUS_FORBIDDEN, ECOSYSTEM_TYPE_NOT_ALLOWED, ECOSYSTEM_STATUS_TOO_LONG,
 *   ECOSYSTEM_AFFECTS_REQUIRED, ECOSYSTEM_AFFECTS_UNKNOWN, ECOSYSTEM_BOARD_FULL, CLOCK_SKEW,
 *   REQUEST_CONFLICT (vía requestReplay), SESSION_NOT_FOUND/SESSION_KIND/SESSION_CLOSED (vía
 *   validateSelectedSession) y SUPERSEDES_NOT_FOUND (vía applySaveMeta).
 */
function saveCore(db: Database, input: SaveInput, options: SessionSaveOptions, requestNow: string, summary = false): SessionSaveResult {
    // El alcance por defecto es project; solo project, shared y ecosystem son válidos.
    const scope = input.scope === undefined ? "project" : input.scope;
    if (scope !== "project" && scope !== "shared" && scope !== "ecosystem") throw new MemoryError("INVALID_INPUT", "scope debe ser project o shared.");
    // shared y ecosystem no cuelgan de ningún proyecto: su projectId debe venir en null.
    if (scope === "shared" && input.projectId !== null) throw new MemoryError("INVALID_INPUT", "Un recuerdo shared no pertenece a un proyecto: projectId debe ser null.");
    if (scope === "ecosystem" && input.projectId !== null) throw new MemoryError("INVALID_INPUT", "Un recuerdo ecosystem pertenece a un grupo: projectId debe ser null.");
    const projectId = scope !== "project" ? null : projectIdentity(input.projectId);
    const groupId = scope === "ecosystem" ? groupIdentity((input as { groupId: unknown }).groupId) : null;
    // La columna y el valor de "dueño" cambian según el alcance: proyecto para project/shared (con
    // projectId en null para shared), grupo para ecosystem. El resto del código ya no distingue los
    // tres casos y solo usa ownerColumn/ownerId.
    const ownerColumn = scope === "ecosystem" ? "groupId" : "projectId";
    const ownerId = scope === "ecosystem" ? groupId : projectId;
    const title = required(input.title, "title");
    const content = required(input.content, "content");
    if (!memoryTypes.includes(input.type)) throw new MemoryError("INVALID_INPUT", "Tipo de recuerdo no válido.");
    if (input.pinned !== undefined && typeof input.pinned !== "boolean") throw new MemoryError("INVALID_INPUT", "pinned debe ser booleano.");
    const topic = input.topicKey === undefined ? null : required(input.topicKey, "topicKey");
    const request = input.requestKey === undefined ? null : required(input.requestKey, "requestKey");
    const expected = input.expectedVersion ?? null;
    // expectedVersion es control de concurrencia optimista (evita pisar un cambio ajeno) y solo
    // tiene sentido junto a un tema: sin tema no hay una versión previa contra la que comparar.
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1 || !topic)) {
      throw new MemoryError("INVALID_INPUT", "expectedVersion requiere un tema y un entero positivo.");
    }
    // Se escanean todos los campos de texto visibles (título, contenido, tema, short y affects) en
    // busca de credenciales (findSecret); si aparece alguna, el guardado se rechaza entero.
    const secret = findSecret([title, content, topic ?? "", typeof input.short === "string" ? input.short : "",
      ...(Array.isArray(input.affects) ? input.affects.filter(name => typeof name === "string") : [])].join("\n"));
    if (secret !== null) throw new MemoryError("SECRET_REJECTED", `El recuerdo parece contener un secreto (${secret}); guárdalo sin el valor.`);
    // short, supersedes y affects son metadatos del nivel 11 (memoria inteligente); pedirlos sin
    // ese nivel habilitado se rechaza en vez de ignorarse en silencio.
    const wantsMeta = input.short !== undefined || input.supersedes !== undefined || input.affects !== undefined;
    if (wantsMeta && !intelligenceEnabled(db)) throw new MemoryError("INTELLIGENCE_REQUIRED", "short, supersedes y affects requieren la memoria inteligente (forge614-engram intelligence-enable).");
    const short = input.short === undefined ? undefined : normalizeShort(input.short);
    const affects = input.affects === undefined ? undefined : normalizeAffects(input.affects);
    const supersedes = input.supersedes === undefined ? null : required(input.supersedes, "supersedes");
    let pinned = input.pinned ?? false;
    // La nota de estado del ecosistema (ECOSYSTEM_STATUS_TOPIC) siempre queda fijada (pinned), sin
    // que quien llama tenga que pedirlo.
    if (scope === "ecosystem" && intelligenceEnabled(db) && topic === ECOSYSTEM_STATUS_TOPIC) pinned = true;
    // Hash (huella corta y determinista) del contenido relevante del guardado; sirve para detectar
    // si una petición repetida (mismo requestKey) trae el mismo contenido o uno distinto. Se
    // recalcula más abajo, una vez que `pinned` puede haber cambiado por las reglas del ecosistema.
    let hash = createHash("sha256").update(JSON.stringify([scope,ownerId,title,content,input.type,topic,pinned,expected])).digest("hex");
    if (options.mode !== undefined && options.mode !== "independent" && options.mode !== "assistant") throw new MemoryError("INVALID_INPUT","mode no válido.");
    const explicit = options.sessionId === undefined ? null : sessionIdentity(options.sessionId);
    const optionProject = options.projectId === undefined ? null : projectIdentity(options.projectId);
    const runtimeDirectory = options.runtimeDirectory === undefined ? null : required(options.runtimeDirectory,"runtimeDirectory");
      // El proyecto (o el grupo) dueño del recuerdo debe existir de antemano; nada se crea aquí.
      if (projectId !== null && !getProject(db, projectId)) throw new MemoryError("PROJECT_NOT_FOUND", "Crea el proyecto antes de guardar.");
      if (groupId !== null) {
        requireEcosystem(db);
        if (!getGroup(db, groupId)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      }
      // Primer punto de salida por petición repetida: si requestKey ya se sirvió, se devuelve esa
      // respuesta sin evaluar nada más (ni siquiera la sesión).
      if (request !== null) {
        const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
        if(replay) return replay;
      }
      let selected: string|null = null;
      let source: SessionSaveResult["sessionSource"] = null;
      if (explicit !== null) {
        // Se pidió una sesión concreta: debe existir, ser de ejecución (runtime) y seguir abierta.
        requireSessions(db); validateSelectedSession(db, explicit,scope,projectId,optionProject,true);
        selected=explicit; source="explicit";
      } else if (sessionsEnabled(db) && scope === "project") {
        if ((options.mode ?? "independent") === "assistant") {
          // En modo assistant se intenta adivinar la sesión por la carpeta desde la que corre; si
          // hay más de una candidata no se puede decidir solo y se pide que se indique a mano.
          const candidates = runtimeDirectory === null ? [] : inferredSessions(db, projectId!,runtimeDirectory,requestNow);
          if (candidates.length > 1) throw new MemoryError("AMBIGUOUS_SESSION",`AMBIGUOUS_SESSION: indica sessionId (${candidates.join(", ")}).`);
          if (candidates.length === 1) { selected=candidates[0]!; source="inferred"; }
        }
        // Sin sesión inferida (o en modo independent), el guardado cae en la sesión manual del
        // proyecto (una sesión estable que agrupa los guardados hechos sin sesión de ejecución).
        if (selected === null) { selected=manualSession(db, projectId!,requestNow); source="manual"; }
      } else if (scope !== "project" && explicit === null) {
        // shared y ecosystem no tienen sesión manual propia: sin sesión explícita, quedan sin sesión.
        selected=null; source=null;
      }
      if (!summary && topic !== null && sessionsEnabled(db)) {
        // El tema `session/{id}/summary` está reservado para el resumen de esa sesión; ningún otro
        // guardado puede tomarlo (salvo el propio resumen, que llega aquí con `summary=true`).
        const reserved = db.query(`SELECT 1 FROM sessions s WHERE s.projectId IS ? AND ?=('session/'||s.sessionId||'/summary') LIMIT 1`)
          .get(projectId,topic);
        if (reserved) throw new MemoryError("SUMMARY_TOPIC_RESERVED","El tema está reservado para un resumen de sesión.");
      }
      // Sin tema, "existing" (el recuerdo que ya podría estar guardado) se busca por refuerzo de
      // confirmaciones (mismo contenido reciente, visto como candidato a confirmar en vez de
      // duplicar); con tema, se busca por su clave exacta, que es única por alcance y dueño.
      const existing = topic === null
        ? (reinforcementEnabled(db) ? confirmationCandidate(db,{scope,projectId,groupId,title,content,type:input.type,topicKey:topic,pinned},requestNow) : null)
        : db.query(`SELECT * FROM memories WHERE scope=? AND ${ownerColumn} IS ? AND topic_key=?`).get(scope,ownerId,topic) as Row | null;
      if (existing?.state === "archived") throw new MemoryError("ARCHIVED", "Restaura el recuerdo antes de actualizar su tema.");
      // Si hay un recuerdo existente en ese tema, su versión debe coincidir con la esperada (o no
      // haberse pedido ninguna); si no hay recuerdo, no debe haberse pedido una versión esperada.
      if (topic!==null && (existing ? existing.version !== expected : expected !== null)) {
        throw new MemoryError("VERSION_CONFLICT", "La versión esperada no coincide. Lee el tema antes de actualizarlo.");
      }
      if (scope === "ecosystem" && intelligenceEnabled(db) && !summary) {
        const status = topic === ECOSYSTEM_STATUS_TOPIC;
        if (status) {
          // La nota de estado del grupo solo puede guardarla su proyecto fuente (el que declaró el
          // grupo), y solo si de verdad pertenece a él.
          const source = groupSource(db, groupId!);
          const from = (input as { fromProjectId?: string }).fromProjectId;
          if (!source || !from || source.projectId !== from || db.query("SELECT 1 FROM ecosystem_memberships WHERE groupId=? AND projectId=?").get(groupId, from) === null) {
            throw new MemoryError("ECOSYSTEM_STATUS_FORBIDDEN", "Solo el proyecto fuente del grupo puede guardar la nota de estado.");
          }
          if (!boardTypeAllowed(input.type, topic)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
          // La nota de estado tiene un límite de caracteres propio (se cuenta por caracteres reales
          // con Array.from, no por unidades UTF-16, para no cortar mal los emojis o acentos).
          if (Array.from(content).length > ECOSYSTEM_STATUS_MAX) throw new MemoryError("ECOSYSTEM_STATUS_TOO_LONG", "La nota de estado no puede superar 600 caracteres.");
          pinned = true;
        } else {
          // Cualquier otro recuerdo del tablero del ecosistema (no la nota de estado) debe ser de un
          // tipo permitido y declarar a qué proyectos afecta.
          if (!boardTypeAllowed(input.type, topic)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
          // Si esta llamada no trae affects mismo, se reutiliza el que ya tenía guardado el recuerdo existente.
          const previous = existing ? readMeta(db, existing.id)?.affects : null;
          const effective = affects ?? previous;
          if (!effective || effective.length < ECOSYSTEM_AFFECTS_MIN) throw new MemoryError("ECOSYSTEM_AFFECTS_REQUIRED", "El tablero requiere al menos dos proyectos afectados.");
          // Cada nombre en affects debe ser un proyecto que de verdad pertenezca al grupo.
          const names = db.query("SELECT p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId WHERE m.groupId=?").all(groupId) as { name: string }[];
          const valid = new Set(names.map(row => row.name)); const unknown = effective.filter(name => !valid.has(name));
          if (unknown.length) throw new MemoryError("ECOSYSTEM_AFFECTS_UNKNOWN", `Proyectos desconocidos: ${unknown.join(", ")}. Válidos: ${names.map(row => row.name).sort().join(", ")}.`);
          if (!existing) {
            // El tablero (recuerdos activos del grupo, sin contar la nota de estado ni los resúmenes
            // de sesión) tiene un cupo máximo; solo se comprueba al crear un recuerdo nuevo, nunca al
            // actualizar uno que ya estaba dentro.
            const board = db.query("SELECT title FROM memories WHERE scope='ecosystem' AND groupId=? AND state='active' AND (topic_key IS NULL OR (topic_key<>? AND topic_key NOT GLOB 'session/*/summary')) ORDER BY title,id").all(groupId, ECOSYSTEM_STATUS_TOPIC) as { title: string }[];
            if (board.length >= ECOSYSTEM_BOARD_LIMIT) throw new MemoryError("ECOSYSTEM_BOARD_FULL", `El tablero tiene ${board.length} recuerdos activos: ${board.map(row => row.title).join(" · ")}. Consolida o baja uno.`);
          }
        }
      }
      // Se recalcula el hash porque `pinned` pudo cambiar más arriba (nota de estado forzada a pinned).
      hash = createHash("sha256").update(JSON.stringify([scope,ownerId,title,content,input.type,topic,pinned,expected])).digest("hex");
      const now = requestNow;
      if (reinforcementEnabled(db) && existing) {
        const versionRow=db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(existing.id,existing.version) as {snapshot:string};
        const confirmed=JSON.parse(versionRow.snapshot) as MemoryVersion;
        // Si el contenido que se intenta guardar es idéntico al de la última versión, no hace falta
        // una versión nueva: se registra como una simple confirmación (reinforcement) de que sigue vigente.
        if(sameConfirmationPayload(confirmed,{title,content,type:input.type,topicKey:topic,pinned})) {
          // El reloj local no puede retroceder respecto a la versión que se está confirmando, o el
          // orden de los eventos dejaría de tener sentido.
          if(Date.parse(now)<Date.parse(confirmed.updatedAt)) {
            throw new MemoryError("CLOCK_SKEW","El reloj local es anterior a la versión confirmada; corrige la hora antes de registrar la confirmación.");
          }
          // Segundo punto de salida por petición repetida, ya sabiendo que este guardado sería una
          // confirmación: si la petición ya se sirvió como confirmación, se repite esa respuesta.
          if(request!==null) {
            const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
            if(replay) return replay;
          }
          const confirmationId=crypto.randomUUID();
          const response:SessionSaveResult={memory:confirmed,sessionId:selected,sessionSource:source};
          db.query("INSERT INTO confirmations(confirmationId,memoryId,version,recordedAt,sessionId) VALUES(?,?,?,?,?)")
            .run(confirmationId,confirmed.id,confirmed.version,now,selected);
          if (selected !== null && source !== "manual") touchSession(db, selected, now);
          // Si venía con requestKey, se registra también la confirmación como su respuesta, para
          // que una repetición futura de la misma petición encuentre este mismo camino.
          if(request!==null) db.query(`INSERT INTO confirmation_requests(memoryId,requestKey,payloadHash,expectedVersion,confirmationId,response)
            VALUES(?,?,?,?,?,?)`).run(confirmed.id,request,hash,expected,confirmationId,JSON.stringify(response));
          if (intelligenceEnabled(db) && wantsMeta) applySaveMeta(db, { id: confirmed.id, type: input.type, now, newVersion: false, contentChanged: false,
            short, affects, supersedes, scope, ownerColumn, ownerId });
          return response;
        }
      }
      // A partir de aquí el contenido sí cambia (o el recuerdo es nuevo): toca crear una versión nueva de verdad.
      const id = existing?.id ?? crypto.randomUUID();
      const version = (existing?.version ?? 0) + 1;
      const snapshot: MemoryVersion = { id, projectId, scope, topicKey: topic, type: input.type, title, content, pinned, version,
        createdAt: existing?.created_at ?? now, updatedAt: now, ...(groupId !== null ? { groupId } : {}) };
      // Tercer punto de salida por petición repetida: se repite justo antes de escribir, por si el
      // contenido cambió respecto al hash original pero la petición ya se había servido con este.
      if(request!==null) {
        const replay=requestReplay(db,{scope,projectId,groupId,request,hash,explicit,optionProject});
        if(replay) return replay;
      }
      if (existing) {
        // Actualiza la fila existente en el sitio: mismo id, nueva versión y nuevos datos.
        db.query("UPDATE memories SET type=?,title=?,content=?,pinned=?,version=?,updated_at=? WHERE id=?").run(input.type,title,content,Number(pinned),version,now,id);
      } else if (groupId !== null) {
        // Inserta una fila nueva de alcance ecosystem (con su columna groupId).
        db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at,groupId) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,?)")
          .run(id,projectId,scope,topic,input.type,title,content,Number(pinned),version,now,now,groupId);
      } else {
        // Inserta una fila nueva de alcance project o shared (sin columna groupId).
        db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)")
          .run(id,projectId,scope,topic,input.type,title,content,Number(pinned),version,now,now);
      }
      // La foto (snapshot) de esta versión se guarda tal cual, para poder reconstruirla exacta
      // más adelante (por ejemplo, desde requestReplay o desde history).
      db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(id,version,JSON.stringify(snapshot));
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(id,version,now);
      if (request !== null) {
        // La fila de `requests` es lo que hace repetible esta misma petición en el futuro; su forma
        // cambia solo para incluir groupId cuando el alcance es ecosystem.
        if (groupId !== null) db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version,groupId) VALUES(?,?,?,?,?,?,?)").run(projectId,scope,request,hash,id,version,groupId);
        else db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?,?)").run(projectId,scope,request,hash,id,version);
      }
      if (selected !== null) db.query("INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)")
        .run(selected,id,version,now);
      if (selected !== null && source !== "manual") touchSession(db, selected, now);
      if (intelligenceEnabled(db)) applySaveMeta(db, { id, type: input.type, now, newVersion: true, contentChanged: existing?.content !== content,
        short, affects, supersedes, scope, ownerColumn, ownerId });
      // Un recuerdo totalmente nuevo y sin tema informa hasta tres parecidos (look-alikes) para que
      // quien llama decida fusionarlo con uno de ellos o reemplazarlo (supersede) en vez de duplicar.
      const similar = intelligenceEnabled(db) && !existing && topic === null
        ? similarTo(db, { scope, ownerColumn, ownerId, title, content, excludeId: id }) : [];
      return {memory:snapshot,sessionId:selected,sessionSource:source,...(similar.length > 0 ? { similar } : {})};
  }

/**
 * Archiva un recuerdo (lo marca como no activo, sin borrarlo ni tocar su historial de versiones).
 * @param db conexión abierta a la base SQLite.
 * @param owner alcance donde buscarlo (un proyecto, null para shared, o un grupo del ecosistema).
 * @param id identificador del recuerdo a archivar.
 * @returns el recuerdo con su estado ya en "archived".
 * @throws MemoryError con código NOT_FOUND si no existe en ese alcance.
 */
export function archive(db: Database, owner: MemoryOwner, id: string): Memory { return setState(db, owner,id,"archived"); }

/**
 * Restaura un recuerdo archivado, dejándolo activo de nuevo.
 * @param db conexión abierta a la base SQLite.
 * @param owner alcance donde buscarlo.
 * @param id identificador del recuerdo a restaurar.
 * @returns el recuerdo con su estado ya en "active".
 * @throws MemoryError con código NOT_FOUND si no existe en ese alcance.
 */
export function restore(db: Database, owner: MemoryOwner, id: string): Memory { return setState(db, owner,id,"active"); }

/**
 * Cambia el estado (active/archived) de un recuerdo y deja registrado el evento correspondiente
 * (archive o restore). Es la función interna compartida por archive y restore.
 * @param db conexión abierta a la base SQLite.
 * @param owner alcance donde buscar el recuerdo.
 * @param id identificador del recuerdo.
 * @param state estado nuevo a aplicar.
 * @returns el recuerdo con el estado ya aplicado.
 * @throws MemoryError con código NOT_FOUND si no existe en ese alcance.
 */
function setState(db: Database, owner: MemoryOwner, id: string, state: Memory["state"]): Memory {
    return db.transaction(() => {
      const current = get(db, owner,id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el alcance seleccionado.");
      // Ya está en el estado pedido: no hay nada que cambiar ni que registrar como evento nuevo.
      if (current.state === state) return current;
      db.query("UPDATE memories SET state=? WHERE id=?").run(state,current.id);
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,?,?,?)")
        .run(current.id,state === "active" ? "restore" : "archive",current.version,new Date().toISOString());
      return { ...current,state };
    }).immediate();
  }

/**
 * Recorte explícito y registrado hacia un grupo del ecosistema (re-scoping). El recuerdo conserva
 * su id y todas sus versiones anteriores; una versión nueva deja constancia del cambio de alcance.
 * No se copia, sobrescribe ni borra nada.
 * @param db conexión abierta a la base SQLite.
 * @param from proyecto de origen (null si el recuerdo era shared).
 * @param id identificador del recuerdo a mover.
 * @param groupId grupo del ecosistema al que se mueve.
 * @returns el recuerdo ya movido (con su nueva versión y alcance ecosystem) y el alcance del que venía.
 * @throws MemoryError con código MIGRATION_REQUIRED si el ecosistema no está habilitado,
 *   GROUP_NOT_FOUND si el grupo no existe, NOT_FOUND si el recuerdo no existe en el alcance de
 *   origen, SUMMARY_TOPIC_RESERVED si es el resumen de una sesión (esos no se mueven),
 *   ECOSYSTEM_STATUS_FORBIDDEN si es la nota de estado del ecosistema, ECOSYSTEM_TYPE_NOT_ALLOWED,
 *   ECOSYSTEM_AFFECTS_REQUIRED, ECOSYSTEM_AFFECTS_UNKNOWN o ECOSYSTEM_BOARD_FULL si no cumple las
 *   reglas del tablero, TOPIC_CONFLICT si el grupo ya tiene un recuerdo con ese mismo tema, o
 *   REQUEST_CONFLICT si alguna de sus claves de petición ya existe en el grupo destino.
 */
export function moveMemoryToGroup(db: Database, from: string | null, id: string, groupId: string):
    { memory: Memory; from: { scope: "project" | "shared"; projectId: string | null } } {
    const identity = groupIdentity(groupId);
    requireEcosystem(db);
    return db.transaction(() => {
      if (!getGroup(db, identity)) throw new MemoryError("GROUP_NOT_FOUND", "Grupo no encontrado en esta base.");
      const current = get(db, from, id);
      if (!current) throw new MemoryError("NOT_FOUND", "Recuerdo no encontrado en el alcance seleccionado.");
      // El resumen de una sesión pertenece a su proyecto por diseño (session_summaries lo apunta ahí); moverlo rompería ese puntero.
      const reserved = sessionsEnabled(db) && db.query("SELECT 1 FROM session_summaries WHERE memoryId=?").get(current.id);
      if (reserved) throw new MemoryError("SUMMARY_TOPIC_RESERVED", "Un resumen de sesión pertenece a su proyecto y no puede moverse.");
      if (intelligenceEnabled(db)) {
        // La nota de estado del ecosistema solo se guarda directamente en ecosystem (ver saveCore);
        // no puede llegar ahí moviendo un recuerdo desde otro alcance.
        if (current.topicKey === ECOSYSTEM_STATUS_TOPIC) throw new MemoryError("ECOSYSTEM_STATUS_FORBIDDEN", "La nota de estado no puede moverse al tablero.");
        if (!boardTypeAllowed(current.type, current.topicKey)) throw new MemoryError("ECOSYSTEM_TYPE_NOT_ALLOWED", "Ese tipo no está permitido en el tablero del ecosistema.");
        // El recuerdo debe traer ya sus affects (proyectos que afecta) guardados desde antes de moverlo.
        const affects = readMeta(db, current.id)?.affects;
        if (!affects || affects.length < ECOSYSTEM_AFFECTS_MIN) throw new MemoryError("ECOSYSTEM_AFFECTS_REQUIRED", "El tablero requiere al menos dos proyectos afectados.");
        const names = db.query("SELECT p.name FROM ecosystem_memberships m JOIN projects p ON p.projectId=m.projectId WHERE m.groupId=?").all(identity) as { name: string }[];
        const valid = new Set(names.map(row => row.name)); const unknown = affects.filter(name => !valid.has(name));
        if (unknown.length) throw new MemoryError("ECOSYSTEM_AFFECTS_UNKNOWN", `Proyectos desconocidos: ${unknown.join(", ")}. Válidos: ${names.map(row => row.name).sort().join(", ")}.`);
        // Mismo cupo máximo de tablero que en saveCore, comprobado también aquí porque mover un
        // recuerdo hacia el grupo suma un recuerdo activo más a su tablero.
        const board = db.query("SELECT title FROM memories WHERE scope='ecosystem' AND groupId=? AND state='active' AND (topic_key IS NULL OR (topic_key<>? AND topic_key NOT GLOB 'session/*/summary')) ORDER BY title,id").all(identity, ECOSYSTEM_STATUS_TOPIC) as { title: string }[];
        if (board.length >= ECOSYSTEM_BOARD_LIMIT) throw new MemoryError("ECOSYSTEM_BOARD_FULL", `El tablero tiene ${board.length} recuerdos activos: ${board.map(row => row.title).join(" · ")}. Consolida o baja uno.`);
      }
      // El grupo destino no puede tener ya un recuerdo con el mismo tema: el tema debe seguir siendo
      // único por alcance y dueño, y aquí no se sobrescribe el que ya estuviera.
      if (current.topicKey !== null && db.query("SELECT 1 FROM memories WHERE scope='ecosystem' AND groupId=? AND topic_key=?").get(identity, current.topicKey)) {
        throw new MemoryError("TOPIC_CONFLICT", "El grupo ya tiene un recuerdo con ese tema; no se sobrescribe. Archívalo o cambia el tema primero.");
      }
      // Ninguna clave de petición (request_key) que ya tenga este recuerdo puede coincidir con una
      // que el grupo destino ya use para otro recuerdo, porque el par (alcance,dueño,clave) debe ser único.
      const collision = db.query(`SELECT r.request_key FROM requests r WHERE r.memory_id=? AND EXISTS (
        SELECT 1 FROM requests x WHERE x.scope='ecosystem' AND x.groupId=? AND x.request_key=r.request_key) LIMIT 1`).get(current.id, identity);
      if (collision) throw new MemoryError("REQUEST_CONFLICT", "Una clave de petición del recuerdo ya existe en el grupo.");
      const now = new Date().toISOString(), version = current.version + 1;
      // La foto de esta nueva versión ya refleja el alcance y el grupo de destino.
      const snapshot: MemoryVersion = { id: current.id, projectId: null, scope: "ecosystem", topicKey: current.topicKey, type: current.type,
        title: current.title, content: current.content, pinned: current.pinned, version, createdAt: current.createdAt, updatedAt: now, groupId: identity };
      db.query("UPDATE memories SET scope='ecosystem',projectId=NULL,groupId=?,version=?,updated_at=? WHERE id=?").run(identity, version, now, current.id);
      // Sus peticiones existentes migran de alcance y dueño junto con el propio recuerdo.
      db.query("UPDATE requests SET scope='ecosystem',projectId=NULL,groupId=? WHERE memory_id=?").run(identity, current.id);
      db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(current.id, version, JSON.stringify(snapshot));
      db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,'save',?,?)").run(current.id, version, now);
      recordIdentityEvent(db, { action: "MEMORY_MOVED", memoryId: current.id, projectId: null, previousProjectId: from, groupId: identity });
      return { memory: { ...snapshot, state: current.state }, from: { scope: from === null ? "shared" as const : "project" as const, projectId: from } };
    }).immediate();
  }
