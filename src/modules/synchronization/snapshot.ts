/**
 * El formato de instantánea (snapshot) que se sube y baja de la nube al sincronizar, en tres versiones
 * sucesivas (proyectos y recuerdos; más sesiones; más confirmaciones), su validación estricta campo por
 * campo, y la reconciliación de tres vías (base, local y remoto) que fusiona cambios independientes y
 * rechaza ediciones en conflicto. Lo usa la sincronización por instantáneas del comando `sync`
 * (`src/app/synchronization.ts`, `src/infrastructure/sqlite/snapshots.ts` y
 * `src/infrastructure/postgres/replica.ts`); la cola de la nube del nivel de esquema 12 no lo usa.
 */
import { createHash } from "node:crypto";
import { MemoryError } from "../../shared/errors";
import { memoryTypes, type Confirmation, type ConfirmationRequest, type Memory, type MemoryVersion } from "../memory";
import { projectIdentity, type Project } from "../projects";
import type { Session, SessionEntry, SessionSummary } from "../sessions";
import { sessionIdentity } from "../sessions";
import { assertConfirmationExtension,assertConfirmationRequestExtension,confirmationRequestIdentity,requestOwnerKey,validateConfirmationCollections } from "./confirmations";

/** Un recuerdo con su historial completo de versiones, sus peticiones de guardado idempotente ya resueltas (formato de fila SQL) y sus eventos de auditoría (guardar, archivar, restaurar). */
export interface MemoryBundle {
  /** Estado vigente del recuerdo. */
  memory: Memory;
  /** Historial completo de versiones del recuerdo, en orden. */
  versions: MemoryVersion[];
  /** Peticiones de guardado idempotente ya resueltas, en formato de fila SQL (nombres con guion bajo). */
  requests: { request_key: string; payload_hash: string; version: number }[];
  /** Eventos de auditoría del recuerdo: cada guardado, archivado o restauración, en orden. */
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
/** Instantánea formato 1: solo proyectos y recuerdos (la forma original, antes de que existieran sesiones). */
export interface SyncSnapshotV1 { format: 1; projects: Project[]; memories: MemoryBundle[] }
/** Instantánea formato 2: formato 1 más sesiones, sus entradas y sus resúmenes. */
export interface SyncSnapshotV2 { format: 2; projects: Project[]; memories: MemoryBundle[]; sessions: Session[]; sessionEntries: SessionEntry[]; sessionSummaries: SessionSummary[] }
/** Instantánea formato 3: formato 2 más confirmaciones de escritura y sus peticiones. */
export interface SyncSnapshotV3 { format: 3; projects: Project[]; memories: MemoryBundle[]; sessions: Session[]; sessionEntries: SessionEntry[]; sessionSummaries: SessionSummary[]; confirmations: Confirmation[]; confirmationRequests: ConfirmationRequest[] }
/** Cualquiera de las tres versiones de instantánea que puede aparecer en la nube. */
export type SyncSnapshot = SyncSnapshotV1 | SyncSnapshotV2 | SyncSnapshotV3;
/** Una instantánea formato 1 vacía: el punto de partida antes de la primera sincronización. */
export const emptySnapshot = (): SyncSnapshotV1 => ({ format:1,projects:[],memories:[] });
/**
 * Sube una instantánea al menos a formato 2, agregando listas de sesión vacías si venía en formato 1;
 * una instantánea ya en formato 2 o 3 se devuelve tal cual, sin copiarla.
 * @param value Instantánea de cualquier formato.
 * @returns La misma instantánea si ya era formato 2 o 3; si era formato 1, una copia en formato 2 con listas de sesión vacías.
 */
export function normalizeSnapshot(value: SyncSnapshot): SyncSnapshotV2|SyncSnapshotV3 {
  return value.format !== 1 ? value : { ...value, format: 2, sessions: [], sessionEntries: [], sessionSummaries: [] };
}
/**
 * Lanza el error fijo de sincronización detenida, dejando explícito que ni los datos locales ni los
 * remotos se pierden (la sincronización simplemente no avanza esta vez).
 * @param code Código del error a lanzar; por defecto "SYNC_INVALID".
 * @throws MemoryError con el código dado, siempre (la función nunca retorna).
 */
export function syncError(code = "SYNC_INVALID"): never {
  throw new MemoryError(code, `${code}: sincronización detenida; se conservan los datos locales y remotos.`);
}
/**
 * Serializa un valor a JSON de forma canónica: las claves de cada objeto se ordenan alfabéticamente
 * (los arreglos conservan su orden), así dos valores con el mismo contenido producen siempre el mismo
 * texto, sin importar en qué orden se construyeron sus objetos.
 * @param value Valor a serializar; puede ser cualquier valor serializable a JSON.
 * @returns El texto JSON canónico.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value !== null && typeof value === "object") return "{"+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value);
}
/**
 * Calcula la huella SHA-256 de una instantánea a partir de su serialización canónica; sirve para
 * comparar por contenido (compare-and-swap) sin depender del orden en que se construyó el objeto.
 * @param value Instantánea a resumir.
 * @returns La huella hexadecimal de 64 caracteres.
 */
export function snapshotHash(value: SyncSnapshot): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
/**
 * Comprueba que un valor sea texto no vacío tras recortar espacios y sin caracteres nulos; en caso
 * contrario detiene la sincronización.
 * @param v Valor a comprobar.
 * @throws Lo que lance `syncError()` si el valor no es un texto válido.
 */
function text(v: unknown): asserts v is string { if(typeof v!=="string" || !v.trim() || v.includes("\0")) syncError(); }
/**
 * Comprueba que un valor sea una fecha en formato ISO 8601 exacto, carácter por carácter igual a lo que
 * produce `toISOString()` (descarta variantes equivalentes pero escritas distinto).
 * @param v Valor a comprobar.
 * @throws Lo que lance `syncError()` si no es una fecha ISO exacta.
 */
function date(v: unknown) { text(v); if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString()!==v) syncError(); }
/**
 * Comprueba que un valor sea un objeto con exactamente el conjunto de claves esperado.
 * @param v Valor a comprobar.
 * @param expected Lista de nombres de clave separados por coma, en cualquier orden.
 * @throws Lo que lance `syncError()` si `v` no es un objeto o sus claves no coinciden exactamente con `expected`.
 */
function keys(v: unknown, expected: string): asserts v is Record<string, any> {
  if(!v || typeof v!=="object" || Array.isArray(v) || Object.keys(v).sort().join(",")!==expected.split(",").sort().join(",")) syncError();
}
/**
 * Agrega una clave a un conjunto, deteniendo la sincronización si ya estaba presente (detecta identidades duplicadas).
 * @param set Conjunto donde se registran las claves ya vistas.
 * @param key Clave a agregar.
 * @throws Lo que lance `syncError()` si `key` ya estaba en `set`.
 */
function unique(set:Set<string>, key:string) { if(set.has(key)) syncError(); set.add(key); }
/**
 * Comprueba que un valor tenga exactamente los campos de una versión de recuerdo y que cada uno sea
 * válido: identidades UUID, texto no vacío en título y contenido, fechas ISO exactas, coherencia entre
 * `scope` y `projectId` (shared solo con projectId null), tipo reconocido y número de versión entero positivo.
 * @param v Valor a comprobar.
 * @throws Lo que lance `syncError()` si algún campo falta, sobra o no es válido.
 */
function version(v: unknown): asserts v is MemoryVersion {
  keys(v,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt");
  projectIdentity(v.id); text(v.title);text(v.content);date(v.createdAt);date(v.updatedAt);
  if(v.scope==="project") projectIdentity(v.projectId);
  else if(v.scope!=="shared" || v.projectId!==null) syncError();
  if(v.topicKey!==null) text(v.topicKey);
  if(!memoryTypes.includes(v.type) || typeof v.pinned!=="boolean" || !Number.isSafeInteger(v.version) || v.version<1) syncError();
}
/**
 * Valida una instantánea completa, campo por campo, para cualquiera de los tres formatos: tamaño
 * máximo de 8 MiB, forma exacta según el formato declarado, cada proyecto y cada recuerdo (con su
 * historial de versiones consistente con la versión vigente, sus peticiones de guardado y sus eventos
 * de auditoría formando una secuencia coherente de guardar/archivar/restaurar), y —desde formato 2—
 * las sesiones, y —desde formato 3— las confirmaciones y sus peticiones.
 * @param value Valor a validar como instantánea de sincronización.
 * @throws Lo que lance `syncError()` (con "SYNC_TOO_LARGE" si supera el tamaño máximo) ante cualquier inconsistencia.
 */
export function validateSnapshot(value: unknown): asserts value is SyncSnapshot {
  if(Buffer.byteLength(JSON.stringify(value) ?? "")>8*1024*1024) syncError("SYNC_TOO_LARGE");
  const format=(value as {format?:unknown}|null)?.format;
  keys(value,format===3?"format,projects,memories,sessions,sessionEntries,sessionSummaries,confirmations,confirmationRequests":format===2?"format,projects,memories,sessions,sessionEntries,sessionSummaries":"format,projects,memories");
  if((value.format!==1&&value.format!==2&&value.format!==3) || !Array.isArray(value.projects) || !Array.isArray(value.memories)) syncError();
  const snapshot=value as SyncSnapshot;
  const projects=new Set<string>();const ids=new Set<string>();const topics=new Set<string>();const requests=new Set<string>();
  for(const p of snapshot.projects) {
    keys(p,"projectId,name,createdAt,updatedAt");projectIdentity(p.projectId);text(p.name);date(p.createdAt);date(p.updatedAt);unique(projects,p.projectId);
  }
  for(const b of snapshot.memories) {
    keys(b,"memory,versions,requests,events");keys(b.memory,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt,state");
    const {state,...v}=b.memory;version(v);if(state!=="active"&&state!=="archived") syncError();
    unique(ids,v.id);if(v.projectId!==null&&!projects.has(v.projectId)) syncError();
    // El topicKey solo debe ser único dentro de su propio proyecto (o dentro de shared), no globalmente.
    if(v.topicKey!==null) unique(topics,canonical([v.projectId,v.topicKey]));
    // El historial de versiones debe tener exactamente tantas entradas como indica el número de versión vigente.
    if(!Array.isArray(b.versions)||b.versions.length!==v.version||!Array.isArray(b.requests)||!Array.isArray(b.events)) syncError();
    b.versions.forEach((h:unknown,i:number)=>{
      // Cada entrada del historial debe estar en su posición correcta y compartir la identidad del recuerdo.
      version(h);if(h.version!==i+1||h.id!==v.id||h.projectId!==v.projectId||h.scope!==v.scope||h.topicKey!==v.topicKey||h.createdAt!==v.createdAt) syncError();
    });
    // La última entrada del historial debe ser exactamente el recuerdo vigente.
    if(canonical(b.versions.at(-1))!==canonical(v)) syncError();
    for(const r of b.requests) {
      keys(r,"request_key,payload_hash,version");text(r.request_key);
      if(typeof r.payload_hash!=="string"||!/^[a-f0-9]{64}$/.test(r.payload_hash)||!Number.isInteger(r.version)||r.version<1||r.version>v.version) syncError();
      unique(requests,requestOwnerKey(v.scope,v.projectId,r.request_key));
      // La huella guardada debe coincidir con la que se recalcula a partir del contenido de esa versión histórica.
      const saved=b.versions[r.version-1] as MemoryVersion;
      const expected=createHash("sha256").update(JSON.stringify([saved.scope,saved.projectId,saved.title,saved.content,saved.type,saved.topicKey,saved.pinned,saved.version===1?null:saved.version-1])).digest("hex");
      if(r.payload_hash!==expected) syncError();
    }
    let eventVersion=0;let eventState="active";
    for(const e of b.events) {
      keys(e,"action,version,created_at");date(e.created_at);
      if(!["save","archive","restore"].includes(e.action)||!Number.isInteger(e.version)||e.version<1||e.version>v.version) syncError();
      if(e.action==="save") {
        // Un guardado debe avanzar la versión en uno y solo puede ocurrir mientras el recuerdo está activo.
        const saved=b.versions[e.version-1];
        if(!saved||e.version!==eventVersion+1||eventState!=="active"||e.created_at!==saved.updatedAt) syncError();
        eventVersion=e.version;
      } else {
        // Archivar o restaurar no cambia la versión, pero debe alternar el estado (no archivar dos veces seguidas, etc.).
        if(eventVersion===0||e.version!==eventVersion) syncError();
        const nextState=e.action==="archive"?"archived":"active";
        if(nextState===eventState) syncError();eventState=nextState;
      }
    }
    // Al final de la secuencia de eventos, la versión y el estado alcanzados deben coincidir con los del recuerdo vigente.
    if(eventVersion!==v.version||eventState!==state) syncError();
  }
  if(snapshot.format!==1) validateSessions(snapshot,projects);
  if(snapshot.format===3) {
    validateConfirmationCollections(snapshot.confirmations,snapshot.confirmationRequests,{
      memories:new Map(snapshot.memories.map(bundle=>[bundle.memory.id,bundle])),
      sessions:new Map(snapshot.sessions.map(session=>[session.sessionId,session])),requestKeys:requests,
      invalid:syncError,validateVersion:version,canonical,
    });
  }
}

/**
 * Calcula la identidad de una entrada de sesión, combinando el recuerdo y la versión que registró, para
 * usarla como clave al fusionar o deduplicar entradas de historial.
 * @param entry Recuerdo y versión que identifican una entrada de sesión.
 * @returns Una cadena canónica que combina ambos valores.
 */
export function sessionEntryIdentity(entry: {memoryId:string;version:number}):string { return canonical([entry.memoryId,entry.version]); }
/**
 * Valida las sesiones, sus entradas de historial y sus resúmenes (desde formato 2): cada sesión
 * pertenece a un proyecto existente y es de un solo tipo (runtime o manual; una sesión manual nunca
 * trae `endedAt`, porque una sesión manual no se cierra); cada entrada apunta a una sesión y una versión de recuerdo reales, con la fecha de
 * registro igual a la de esa versión; cada resumen solo puede provenir de una sesión runtime, debe
 * corresponder a un recuerdo de tipo `procedure` con el topicKey fijo `session/<id>/summary`, y una
 * sesión solo puede tener un resumen.
 * @param snapshot Instantánea (formato 2 o 3) a validar.
 * @param projects Conjunto de ids de proyecto ya validados, para comprobar que cada sesión pertenece a uno existente.
 * @throws Lo que lance `syncError()` ante cualquier inconsistencia.
 */
function validateSessions(snapshot:SyncSnapshotV2|SyncSnapshotV3,projects:Set<string>):void {
  if(!Array.isArray(snapshot.sessions)||!Array.isArray(snapshot.sessionEntries)||!Array.isArray(snapshot.sessionSummaries)) syncError();
  const sessions=new Map<string,Session>();const entries=new Map<string,SessionEntry>();const summaries=new Set<string>();
  const memories=new Map(snapshot.memories.map(b=>[b.memory.id,b]));
  for(const s of snapshot.sessions) {
    keys(s,"sessionId,projectId,kind,startedAt,endedAt");
    try {sessionIdentity(s.sessionId);} catch {syncError();}
    projectIdentity(s.projectId);date(s.startedAt);if(s.endedAt!==null) date(s.endedAt);
    if(!projects.has(s.projectId)||sessions.has(s.sessionId)||!["runtime","manual"].includes(s.kind)||(s.kind==="manual"&&s.endedAt!==null)) syncError();
    sessions.set(s.sessionId,s);
  }
  for(const e of snapshot.sessionEntries) {
    keys(e,"sessionId,memoryId,version,recordedAt");
    const s=sessions.get(e.sessionId);const v=memories.get(e.memoryId)?.versions[e.version-1];
    date(e.recordedAt);
    if(!s||!Number.isSafeInteger(e.version)||!v||v.version!==e.version||v.updatedAt!==e.recordedAt||
      (v.scope!=="shared"&&v.projectId!==s.projectId)||entries.has(sessionEntryIdentity(e))) syncError();
    entries.set(sessionEntryIdentity(e),e);
  }
  for(const p of snapshot.sessionSummaries) {
    keys(p,"sessionId,memoryId,version");
    const s=sessions.get(p.sessionId);const v=memories.get(p.memoryId)?.versions[p.version-1];const e=entries.get(sessionEntryIdentity(p));
    if(!s||s.kind!=="runtime"||!Number.isSafeInteger(p.version)||!v||v.version!==p.version||!e||e.sessionId!==s.sessionId||
      v.scope!=="project"||v.projectId!==s.projectId||v.type!=="procedure"||v.topicKey!==`session/${s.sessionId}/summary`) syncError();
    unique(summaries,p.sessionId);
  }
}
/**
 * Fusiona tres listas (base común, local y remota) por una clave, aplicando la regla clásica de
 * tres vías: si local y remoto coinciden, se usa ese valor; si uno de los dos coincide con la base
 * (no cambió), se usa el otro (que sí cambió); si los tres difieren entre sí, es un conflicto real.
 * @param base Lista en el punto de partida común.
 * @param local Lista con los cambios locales.
 * @param remote Lista con los cambios remotos.
 * @param key Función que extrae la clave de identidad de cada elemento.
 * @returns La lista fusionada, ordenada por clave.
 * @throws Lo que lance `syncError("SYNC_CONFLICT")` si un elemento visto en la base desaparece de un lado, o si los tres valores difieren entre sí.
 */
function merge<T>(base:T[],local:T[],remote:T[],key:(v:T)=>string):T[] {
  const b=new Map(base.map(v=>[key(v),v]));const l=new Map(local.map(v=>[key(v),v]));const r=new Map(remote.map(v=>[key(v),v]));
  const out:T[]=[];
  for(const id of [...new Set([...b.keys(),...l.keys(),...r.keys()])].sort()) {
    const bv=b.get(id),lv=l.get(id),rv=r.get(id);
    // No existe un protocolo de borrado físico: un registro que ya se vio en la base no puede desaparecer.
    if(bv!==undefined&&(lv===undefined||rv===undefined)) syncError("SYNC_CONFLICT");
    const value=canonical(lv)===canonical(rv)?lv:canonical(lv)===canonical(bv)?rv:canonical(rv)===canonical(bv)?lv:syncError("SYNC_CONFLICT");
    if(value!==undefined) out.push(value);
  }
  return out;
}
/**
 * Reconcilia tres instantáneas (base, local y remota) en una sola: valida las tres, fusiona proyectos
 * y recuerdos siempre, agrega sesiones si alguna de las tres ya las tenía, y agrega confirmaciones si
 * alguna ya estaba en formato 3. El resultado se valida de nuevo y se comprueba que extienda tanto a
 * local como a remoto (nunca pierde ni reescribe algo que uno de los dos ya tenía).
 * @param base Instantánea en el punto de partida común de ambos lados.
 * @param local Instantánea con los cambios del lado local.
 * @param remote Instantánea con los cambios del lado remoto.
 * @returns La instantánea fusionada, en el formato más alto que hayan alcanzado las tres.
 * @throws MemoryError con código "SYNC_TOO_LARGE" si el resultado supera el tamaño máximo; lo que lance `syncError("SYNC_CONFLICT")` ante cualquier otro conflicto de fusión o validación.
 */
export function reconcile(base:SyncSnapshot,local:SyncSnapshot,remote:SyncSnapshot):SyncSnapshot {
  [base,local,remote].forEach(validateSnapshot);
  assertExtension(base,local);assertExtension(base,remote);
  const data={projects:merge(base.projects,local.projects,remote.projects,p=>p.projectId),memories:merge(base.memories,local.memories,remote.memories,b=>b.memory.id)};
  let result:SyncSnapshot={format:1,...data};
  if([base,local,remote].some(s=>s.format!==1)) {
    const [b,l,r]=[normalizeSnapshot(base),normalizeSnapshot(local),normalizeSnapshot(remote)] as const;
    const sessions={sessions:mergeSessions(b.sessions,l.sessions,r.sessions),
      sessionEntries:merge(b.sessionEntries,l.sessionEntries,r.sessionEntries,sessionEntryIdentity),
      sessionSummaries:merge(b.sessionSummaries,l.sessionSummaries,r.sessionSummaries,s=>s.sessionId)};
    if([base,local,remote].some(snapshot=>snapshot.format===3)) {
      const memories=new Map(data.memories.map(bundle=>[bundle.memory.id,bundle]));
      const confirmations=(snapshot:SyncSnapshot):Confirmation[]=>snapshot.format===3?snapshot.confirmations:[];
      const requests=(snapshot:SyncSnapshot):ConfirmationRequest[]=>snapshot.format===3?snapshot.confirmationRequests:[];
      result={format:3,...data,...sessions,
        confirmations:merge(confirmations(base),confirmations(local),confirmations(remote),item=>item.confirmationId),
        confirmationRequests:merge(requests(base),requests(local),requests(remote),item=>confirmationRequestIdentity(memories,item))};
    } else result={format:2,...data,...sessions};
  }
  try { validateSnapshot(result); } catch(error) {
    if(error instanceof MemoryError&&error.code==="SYNC_TOO_LARGE") throw error;
    syncError("SYNC_CONFLICT");
  }
  assertExtension(local,result);assertExtension(remote,result);
  return result;
}

/**
 * Comprueba si una sesión más nueva es una continuación válida de una anterior: misma identidad,
 * proyecto y tipo, y con el mismo `startedAt`; solo puede cambiar de `endedAt` nulo (abierta) a un
 * valor (cerrada), nunca al revés ni entre dos valores de cierre distintos.
 * @param current Versión anterior de la sesión.
 * @param next Versión candidata a ser una continuación.
 * @returns `true` si `next` extiende válidamente a `current`.
 */
function sessionExtends(current:Session,next:Session):boolean {
  return current.sessionId===next.sessionId&&current.projectId===next.projectId&&current.kind===next.kind&&current.startedAt===next.startedAt&&
    (current.endedAt===null||current.endedAt===next.endedAt);
}
/**
 * Fusiona las sesiones de tres instantáneas por su identidad: entre versiones de la misma sesión que se
 * extienden entre sí, gana la versión cerrada: una vez guardada una cerrada ya no se reemplaza, y
 * mientras la guardada siga abierta la reemplaza la siguiente en el orden base, local, remoto; dos versiones
 * que no se extienden mutuamente son un conflicto irreconciliable.
 * @param base Sesiones del punto de partida común.
 * @param local Sesiones del lado local.
 * @param remote Sesiones del lado remoto.
 * @returns Las sesiones fusionadas, ordenadas por id.
 * @throws Lo que lance `syncError("SYNC_CONFLICT")` si dos versiones de la misma sesión no se extienden entre sí.
 */
function mergeSessions(base:Session[],local:Session[],remote:Session[]):Session[] {
  // La identidad es inmutable incluso cuando dos dispositivos observan por primera vez el mismo id sin un punto de control común.
  const out=new Map<string,Session>();
  for(const s of [...base,...local,...remote]) {
    const prior=out.get(s.sessionId);
    if(prior&&!sessionExtends(prior,s)&&!sessionExtends(s,prior)) syncError("SYNC_CONFLICT");
    if(!prior||prior.endedAt===null) out.set(s.sessionId,s);
  }
  return [...out.values()].sort((a,b)=>a.sessionId<b.sessionId?-1:a.sessionId>b.sessionId?1:0);
}

/**
 * Comprueba que `next` extienda a `current`: puede agregar proyectos, recuerdos, sesiones,
 * confirmaciones y revisiones nuevas, pero nunca puede borrar ni reescribir algo que `current` ya
 * tenía (una fusión puede agregar revisiones, pero no puede borrar ni reescribir a ninguno de los dos
 * participantes).
 * @param current Instantánea que se espera esté contenida en `next`.
 * @param next Instantánea candidata a extender a `current`.
 * @throws Lo que lance `syncError("SYNC_CONFLICT")` si `next` pierde de formato, o si borra o altera cualquier proyecto, recuerdo, sesión, entrada, resumen o confirmación que `current` ya tenía.
 */
export function assertExtension(current:SyncSnapshot,next:SyncSnapshot):void {
  if((current.format===2&&next.format===1)||(current.format===3&&next.format!==3)) syncError("SYNC_CONFLICT");
  const projects=new Map(next.projects.map(p=>[p.projectId,p]));
  const bundles=new Map(next.memories.map(b=>[b.memory.id,b]));
  for(const p of current.projects) if(!projects.has(p.projectId)||projects.get(p.projectId)!.createdAt!==p.createdAt) syncError("SYNC_CONFLICT");
  for(const b of current.memories) {
    const n=bundles.get(b.memory.id);
    if(!n||n.memory.projectId!==b.memory.projectId||n.memory.scope!==b.memory.scope||n.memory.topicKey!==b.memory.topicKey||
      canonical(n.versions.slice(0,b.versions.length))!==canonical(b.versions)||
      canonical(n.events.slice(0,b.events.length))!==canonical(b.events)||
      b.requests.some(r=>!n.requests.some(s=>canonical(r)===canonical(s)))) syncError("SYNC_CONFLICT");
  }
  if(current.format!==1&&next.format!==1) {
    const sessions=new Map(next.sessions.map(s=>[s.sessionId,s]));
    const entries=new Map(next.sessionEntries.map(e=>[sessionEntryIdentity(e),e]));
    const summaries=new Map(next.sessionSummaries.map(s=>[s.sessionId,s]));
    for(const s of current.sessions) {const n=sessions.get(s.sessionId);if(!n||!sessionExtends(s,n)) syncError("SYNC_CONFLICT");}
    for(const e of current.sessionEntries) if(canonical(entries.get(sessionEntryIdentity(e)))!==canonical(e)) syncError("SYNC_CONFLICT");
    for(const s of current.sessionSummaries) {const n=summaries.get(s.sessionId);if(!n||n.memoryId!==s.memoryId||n.version<s.version) syncError("SYNC_CONFLICT");}
  }
  if(current.format===3&&next.format===3) {
    const memories=new Map(next.memories.map(bundle=>[bundle.memory.id,bundle]));
    assertConfirmationExtension(current.confirmations,next.confirmations,canonical,()=>syncError("SYNC_CONFLICT"));
    assertConfirmationRequestExtension(current.confirmationRequests,next.confirmationRequests,memories,canonical,()=>syncError("SYNC_CONFLICT"));
  }
}
