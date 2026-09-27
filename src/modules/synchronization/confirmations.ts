/**
 * Validación de las confirmaciones de escritura y sus peticiones dentro de una instantánea (snapshot)
 * de sincronización con la nube: comprueba que cada confirmación referencie una versión de recuerdo real
 * y una sesión válida, que cada petición coincida con la confirmación que dice haber producido, y que
 * las claves de petición no se repitan dentro del mismo dueño (proyecto o alcance compartido). Lo usa
 * `snapshot.ts` de este módulo al validar y comparar instantáneas completas (formato 3).
 */
import { createHash } from "node:crypto";
import type { Confirmation, ConfirmationRequest, Memory, MemoryScope, MemoryVersion } from "../memory";
import type { Session } from "../sessions";

/** El recuerdo y su historial de versiones, indexados por id, tal como aparecen en una instantánea. */
interface ConfirmationBundle {
  /** Estado vigente del recuerdo. */
  memory:Memory;
  /** Historial completo de versiones del recuerdo, en orden. */
  versions:MemoryVersion[];
}

/** Los datos que necesita `validateConfirmationCollections` para verificar cada confirmación y petición contra el resto de la instantánea. */
interface ValidationContext {
  /** Recuerdos de la instantánea, indexados por id. */
  memories:Map<string,ConfirmationBundle>;
  /** Sesiones de la instantánea, indexadas por id. */
  sessions:Map<string,Session>;
  /** Claves de dueño de petición ya vistas, para detectar duplicados. */
  requestKeys:Set<string>;
  /** Función que lanza el error de validación (nunca retorna). */
  invalid:()=>never;
  /** Función que valida una versión de recuerdo según las reglas de `snapshot.ts`. */
  validateVersion:(value:unknown)=>void;
  /** Función de serialización canónica para comparar por igualdad estructural. */
  canonical:(value:unknown)=>string;
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Comprueba que un objeto tenga exactamente el conjunto de claves esperado, ni más ni menos.
 * @param value Valor a comprobar.
 * @param expected Lista de nombres de clave que el objeto debe tener, sin orden ni claves extra.
 * @param invalid Función que lanza el error de validación (nunca retorna).
 */
function exactKeys(value:unknown, expected:string[], invalid:()=>never):asserts value is Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==[...expected].sort().join(",")) invalid();
}

/**
 * Comprueba que un valor sea texto no vacío tras recortar espacios y sin caracteres nulos.
 * @param value Valor a comprobar.
 * @param invalid Función que lanza el error de validación.
 */
function requiredText(value:unknown, invalid:()=>never):asserts value is string {
  if(typeof value!=="string"||!value.trim()||value.includes("\0")) invalid();
}

/**
 * Comprueba que un valor sea una fecha en formato ISO 8601 exacto (con milisegundos y "Z"), sin
 * variantes equivalentes que no coincidan carácter por carácter con lo que produce `toISOString()`.
 * @param value Valor a comprobar.
 * @param invalid Función que lanza el error de validación.
 */
function canonicalDate(value:unknown, invalid:()=>never):asserts value is string {
  requiredText(value,invalid);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) invalid();
}

/**
 * Calcula la clave de espacio de nombres de dueño de una petición de confirmación: el alcance y el
 * proyecto (o `null` para shared) determinan en qué espacio debe ser única una `requestKey`, así la
 * misma clave puede repetirse en proyectos distintos o en shared sin chocar.
 * @param scope Alcance del recuerdo al que pertenece la petición.
 * @param projectId Id del proyecto dueño, o `null` para el alcance shared.
 * @param requestKey Clave de la petición.
 * @returns Una cadena JSON que combina los tres valores, usable como clave de un Set o Map.
 */
export function requestOwnerKey(scope:MemoryScope, projectId:string|null, requestKey:string):string {
  return JSON.stringify([scope,projectId,requestKey]);
}

/**
 * Calcula la clave de espacio de nombres de dueño de una petición ya guardada, buscando el recuerdo al
 * que apunta para obtener su alcance y proyecto.
 * @param memories Mapa de recuerdos de la instantánea, indexado por id.
 * @param request Petición de confirmación cuyo dueño se quiere calcular.
 * @returns La clave de dueño, o cadena vacía si el recuerdo referenciado no existe en `memories`.
 */
export function confirmationRequestIdentity(memories:Map<string,ConfirmationBundle>, request:ConfirmationRequest):string {
  const memory=memories.get(request.memoryId)?.memory;
  if(!memory) return "";
  return requestOwnerKey(memory.scope,memory.projectId,request.requestKey);
}

/**
 * Recalcula la huella del contenido de una petición de guardado, de la misma forma que la calcula
 * `src/infrastructure/sqlite/writes.ts`, para comprobar que la petición almacenada no fue alterada.
 * @param memory Versión del recuerdo cuyo contenido se resume.
 * @param expectedVersion Versión esperada que llevaba la petición original, o `null` si el recuerdo no tiene topicKey.
 * @returns La huella SHA-256 del contenido relevante.
 */
function payloadHash(memory:MemoryVersion, expectedVersion:number|null):string {
  return createHash("sha256").update(JSON.stringify([
    memory.scope,memory.projectId,memory.title,memory.content,memory.type,memory.topicKey,memory.pinned,expectedVersion,
  ])).digest("hex");
}

/**
 * Resuelve y valida la sesión que referencia una confirmación (si tiene una): debe existir, y si el
 * recuerdo es de alcance `project` la sesión debe pertenecer a ese mismo proyecto; si es `shared`, la
 * sesión debe ser de ejecución automática (runtime), nunca manual.
 * @param memory Versión del recuerdo confirmado.
 * @param sessionId Id de la sesión referenciada, o `null` si la confirmación no vino de una sesión.
 * @param sessions Mapa de sesiones de la instantánea, indexado por id.
 * @param invalid Función que lanza el error de validación.
 * @returns La sesión resuelta, o `null` si `sessionId` era `null`.
 */
function confirmationSession(memory:MemoryVersion, sessionId:string|null, sessions:Map<string,Session>, invalid:()=>never):Session|null {
  if(sessionId===null) return null;
  requiredText(sessionId,invalid);
  const session=sessions.get(sessionId);
  if(!session||(memory.scope==="project"&&session.projectId!==memory.projectId)) invalid();
  if(memory.scope==="shared"&&session.kind!=="runtime") invalid();
  return session;
}

/**
 * Valida que la sesión y el origen (`source`: explicit, inferred o manual) declarados en la respuesta
 * de una petición sean coherentes entre sí y con el tipo de sesión: sin sesión, el origen debe ser
 * `null`; con sesión, el origen debe coincidir con el tipo de sesión (manual solo con sesión manual,
 * explicit/inferred solo con sesión runtime), y una escritura shared solo puede venir de un origen explicit.
 * @param memory Versión del recuerdo confirmado.
 * @param sessionId Id de la sesión declarada en la respuesta, o `null`.
 * @param source Origen declarado de la sesión.
 * @param sessions Mapa de sesiones de la instantánea.
 * @param invalid Función que lanza el error de validación.
 */
function selectedSession(memory:MemoryVersion, sessionId:string|null, source:ConfirmationRequest["response"]["sessionSource"], sessions:Map<string,Session>, invalid:()=>never):void {
  const session=confirmationSession(memory,sessionId,sessions,invalid);
  if(session===null) {
    if(source!==null) invalid();
    return;
  }
  if(source===null||!(["explicit","inferred","manual"] as const).includes(source)) invalid();
  if((source==="explicit"||source==="inferred")&&session.kind!=="runtime") invalid();
  if(source==="manual"&&session.kind!=="manual") invalid();
  if(memory.scope==="shared"&&source!=="explicit") invalid();
}

/**
 * Valida las colecciones completas de confirmaciones y de peticiones de una instantánea formato 3: cada
 * confirmación debe apuntar a una versión de recuerdo real y no adelantarse a su fecha de actualización;
 * cada petición debe coincidir exactamente con la confirmación que dice haber producido (misma versión,
 * mismo recuerdo, misma sesión, huella de contenido correcta), y las claves de petición no pueden repetirse
 * dentro del mismo espacio de nombres de dueño.
 * @param confirmationsValue Colección de confirmaciones tal como llega en la instantánea (sin tipar aún).
 * @param requestsValue Colección de peticiones tal como llega en la instantánea (sin tipar aún).
 * @param context Datos auxiliares: recuerdos, sesiones, claves de petición ya vistas y las funciones de error, versión y canonicalización.
 * @throws Lo que lance `context.invalid()` si cualquier confirmación o petición no es válida.
 */
export function validateConfirmationCollections(confirmationsValue:unknown, requestsValue:unknown, context:ValidationContext):void {
  const {memories,sessions,requestKeys,invalid,validateVersion,canonical}=context;
  if(!Array.isArray(confirmationsValue)||!Array.isArray(requestsValue)) return invalid();
  const confirmationValues:unknown[]=confirmationsValue;
  const requestValues:unknown[]=requestsValue;
  const confirmations=new Map<string,Confirmation>();
  for(const value of confirmationValues) {
    exactKeys(value,["confirmationId","memoryId","version","recordedAt","sessionId"],invalid);
    if(typeof value.confirmationId!=="string"||!uuid.test(value.confirmationId)||typeof value.memoryId!=="string"||!uuid.test(value.memoryId)||
      !Number.isSafeInteger(value.version)||Number(value.version)<1) invalid();
    canonicalDate(value.recordedAt,invalid);
    if(value.sessionId!==null&&typeof value.sessionId!=="string") invalid();
    const item=value as unknown as Confirmation;
    // La confirmación debe apuntar a una versión histórica real del recuerdo (no a una versión futura o inexistente).
    const historical=memories.get(item.memoryId)?.versions[item.version-1];
    if(!historical) return invalid();
    // La fecha de registro no puede ser anterior a cuando esa versión se actualizó (violaría el orden causal),
    // y dos confirmaciones no pueden compartir el mismo id.
    if(historical.version!==item.version||Date.parse(item.recordedAt)<Date.parse(historical.updatedAt)||confirmations.has(item.confirmationId)) invalid();
    confirmationSession(historical,item.sessionId,sessions,invalid);
    confirmations.set(item.confirmationId,item);
  }
  for(const value of requestValues) {
    exactKeys(value,["memoryId","requestKey","payloadHash","expectedVersion","confirmationId","response"],invalid);
    if(typeof value.memoryId!=="string"||!uuid.test(value.memoryId)||typeof value.confirmationId!=="string"||!uuid.test(value.confirmationId)) invalid();
    requiredText(value.requestKey,invalid);
    if(typeof value.payloadHash!=="string"||!/^[a-f0-9]{64}$/.test(value.payloadHash)||
      (value.expectedVersion!==null&&(!Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<1))) invalid();
    exactKeys(value.response,["memory","sessionId","sessionSource"],invalid);
    validateVersion(value.response.memory);
    if(value.response.sessionId!==null&&typeof value.response.sessionId!=="string") invalid();
    if(value.response.sessionSource!==null&&!(["explicit","inferred","manual"] as const).includes(value.response.sessionSource as never)) invalid();
    const request=value as unknown as ConfirmationRequest;
    const event=confirmations.get(request.confirmationId);
    const bundle=memories.get(request.memoryId);
    const historical=bundle?.versions[event?.version===undefined?-1:event.version-1];
    // La petición debe referenciar una confirmación que exista y que a su vez apunte a una versión real.
    if(!event||!historical) return invalid();
    // La petición debe coincidir exactamente con lo que produjo su confirmación: mismo recuerdo, misma
    // versión, mismo contenido devuelto y misma sesión.
    if(event.memoryId!==request.memoryId||historical.version!==event.version||canonical(request.response.memory)!==canonical(historical)||
      request.response.sessionId!==event.sessionId) invalid();
    // Un recuerdo sin topicKey nunca declara una versión esperada (no hay "versión anterior" que proteger).
    const expected=historical.topicKey===null?null:historical.version;
    if(request.expectedVersion!==expected||request.payloadHash!==payloadHash(historical,expected)) invalid();
    selectedSession(historical,request.response.sessionId,request.response.sessionSource,sessions,invalid);
    const identity=requestOwnerKey(historical.scope,historical.projectId,request.requestKey);
    if(requestKeys.has(identity)) invalid();
    requestKeys.add(identity);
  }
}

/**
 * Comprueba que una lista más nueva de confirmaciones conserve, sin alterar, cada confirmación de la
 * lista actual (las confirmaciones son de solo apéndice: nunca se borran ni se reescriben).
 * @param current Lista de confirmaciones del lado actual.
 * @param next Lista de confirmaciones del lado nuevo, que debe extender a `current`.
 * @param canonical Función de serialización canónica para comparar por igualdad estructural.
 * @param invalid Función que lanza el error de validación.
 */
export function assertConfirmationExtension(current:readonly Confirmation[], next:readonly Confirmation[], canonical:(value:unknown)=>string, invalid:()=>never):void {
  const records=new Map(next.map(item=>[item.confirmationId,item]));
  for(const item of current) if(canonical(records.get(item.confirmationId))!==canonical(item)) invalid();
}

/**
 * Comprueba que una lista más nueva de peticiones de confirmación conserve, sin alterar, cada petición
 * de la lista actual, comparando por su clave de espacio de nombres de dueño (no por posición).
 * @param current Lista de peticiones del lado actual.
 * @param next Lista de peticiones del lado nuevo, que debe extender a `current`.
 * @param memories Mapa de recuerdos, necesario para calcular la clave de dueño de cada petición.
 * @param canonical Función de serialización canónica para comparar por igualdad estructural.
 * @param invalid Función que lanza el error de validación.
 */
export function assertConfirmationRequestExtension(current:readonly ConfirmationRequest[], next:readonly ConfirmationRequest[], memories:Map<string,ConfirmationBundle>, canonical:(value:unknown)=>string, invalid:()=>never):void {
  const records=new Map(next.map(item=>[confirmationRequestIdentity(memories,item),item]));
  for(const item of current) if(canonical(records.get(confirmationRequestIdentity(memories,item)))!==canonical(item)) invalid();
}
