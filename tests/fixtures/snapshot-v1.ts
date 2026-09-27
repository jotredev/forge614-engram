/**
 * Accesorio (fixture) de compatibilidad: copia congelada del formato de fotografía (snapshot) de
 * sincronización tal como era en `193e89a:src/sync-snapshot.ts` (versión 0.5.0), antes de que
 * existieran sesiones y refuerzo. Solo `validateSnapshot` (bajo el alias `validateOldSnapshot`) y
 * `emptySnapshot` los usa `src/app/__tests__/sync.integration.test.ts`, para comprobar que el
 * validador real actual sigue aceptando una fotografía vacía con el formato antiguo; el resto de
 * las funciones (`reconcile`, `assertExtension`, `canonical`, `snapshotHash`, `syncError`) espejan
 * a las reales de `src/modules/synchronization` para que este archivo sea una copia autocontenida
 * y utilizable por sí sola, pero nada fuera de su propia prueba las usa.
 */
import { createHash } from "node:crypto";
import { MemoryError } from "../../src/shared/errors";
import { memoryTypes, type Memory, type MemoryVersion } from "../../src/modules/memory";
import { type Project } from "../../src/modules/projects";
import { projectIdentity } from "../../src/modules/projects";

export interface MemoryBundle {
  memory: Memory;
  versions: MemoryVersion[];
  requests: { request_key: string; payload_hash: string; version: number }[];
  events: { action: "save" | "archive" | "restore"; version: number; created_at: string }[];
}
export interface SyncSnapshot { format: 1; projects: Project[]; memories: MemoryBundle[] }
/** Una fotografía (snapshot) del formato 0.5.0 sin proyectos ni memorias, el punto de partida de una fusión. */
export const emptySnapshot = (): SyncSnapshot => ({ format:1,projects:[],memories:[] });
/** Lanza el error con el que este formato antiguo señala cualquier fotografía inválida o en conflicto. */
export function syncError(code = "SYNC_INVALID"): never {
  throw new MemoryError(code, `${code}: sincronización detenida; se conservan los datos locales y remotos.`);
}
/** Serializa un valor a JSON con las claves de cada objeto ordenadas alfabéticamente, para que dos
 * valores con las mismas claves en distinto orden produzcan el mismo texto (y así se puedan comparar
 * o resumir con un hash sin que el orden de inserción importe). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value !== null && typeof value === "object") return "{"+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value);
}
/** Huella (hash) SHA-256 de una fotografía completa, calculada sobre su forma canónica. */
export function snapshotHash(value: SyncSnapshot): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
// Un texto válido: no vacío, sin espacios en blanco a los lados únicamente, y sin el carácter nulo
// (que rompería a algunos motores de almacenamiento).
function text(v: unknown): asserts v is string { if(typeof v!=="string" || !v.trim() || v.includes("\0")) syncError(); }
// Una fecha válida: el texto exacto ISO-8601 con milisegundos y zona UTC, y que además sea una
// fecha real (Date.parse no da NaN).
function date(v: unknown) { text(v); if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v))) syncError(); }
// Exige que v sea un objeto con exactamente el conjunto de claves dado (ni de más ni de menos),
// sin importar en qué orden se escriban en `expected`.
function keys(v: unknown, expected: string): asserts v is Record<string, any> {
  if(!v || typeof v!=="object" || Array.isArray(v) || Object.keys(v).sort().join(",")!==expected.split(",").sort().join(",")) syncError();
}
// Registra `key` en `set`; si ya estaba, es un duplicado no permitido (dos proyectos con el mismo
// id, dos memorias con el mismo id, etc.).
function unique(set:Set<string>, key:string) { if(set.has(key)) syncError(); set.add(key); }
// Comprueba que v tiene la forma de una versión de memoria válida: sus identificadores tienen la
// forma esperada, sus fechas son válidas, y su ámbito (scope) es consistente: "project" exige un
// projectId con forma de identificador, "shared" exige que no tenga ninguno.
function version(v: unknown): asserts v is MemoryVersion {
  keys(v,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt");
  projectIdentity(v.id); text(v.title);text(v.content);date(v.createdAt);date(v.updatedAt);
  if(v.scope==="project") projectIdentity(v.projectId);
  else if(v.scope!=="shared" || v.projectId!==null) syncError();
  if(v.topicKey!==null) text(v.topicKey);
  if(!memoryTypes.includes(v.type) || typeof v.pinned!=="boolean" || !Number.isSafeInteger(v.version) || v.version<1) syncError();
}
/**
 * Comprueba que `value` tiene la forma exacta de una fotografía (snapshot) válida del formato
 * 0.5.0: cada proyecto y cada memoria con identificadores y fechas válidas, sin duplicados; el
 * historial de versiones de cada memoria completo y consistente con su versión actual; cada
 * petición (`request`) con una huella (hash) que coincide con los datos que dice haber guardado;
 * y la secuencia de eventos (guardar/archivar/restaurar) alternando de forma coherente con el
 * estado final declarado de la memoria. Lanza si algo no cuadra.
 */
export function validateSnapshot(value: unknown): asserts value is SyncSnapshot {
  if(Buffer.byteLength(JSON.stringify(value) ?? "")>8*1024*1024) syncError("SYNC_TOO_LARGE");
  keys(value,"format,projects,memories");
  if(value.format!==1 || !Array.isArray(value.projects) || !Array.isArray(value.memories)) syncError();
  const projects=new Set<string>();const ids=new Set<string>();const topics=new Set<string>();const requests=new Set<string>();
  for(const p of value.projects) {
    keys(p,"projectId,name,createdAt,updatedAt");projectIdentity(p.projectId);text(p.name);date(p.createdAt);date(p.updatedAt);unique(projects,p.projectId);
  }
  for(const b of value.memories) {
    keys(b,"memory,versions,requests,events");keys(b.memory,"id,projectId,scope,topicKey,type,title,content,pinned,version,createdAt,updatedAt,state");
    const {state,...v}=b.memory;version(v);if(state!=="active"&&state!=="archived") syncError();
    unique(ids,v.id);if(v.projectId!==null&&!projects.has(v.projectId)) syncError();
    if(v.topicKey!==null) unique(topics,canonical([v.projectId,v.topicKey]));
    if(!Array.isArray(b.versions)||b.versions.length!==v.version||!Array.isArray(b.requests)||!Array.isArray(b.events)) syncError();
    b.versions.forEach((h:unknown,i:number)=>{
      version(h);if(h.version!==i+1||h.id!==v.id||h.projectId!==v.projectId||h.scope!==v.scope||h.topicKey!==v.topicKey||h.createdAt!==v.createdAt) syncError();
    });
    if(canonical(b.versions.at(-1))!==canonical(v)) syncError();
    for(const r of b.requests) {
      keys(r,"request_key,payload_hash,version");text(r.request_key);
      if(typeof r.payload_hash!=="string"||!/^[a-f0-9]{64}$/.test(r.payload_hash)||!Number.isInteger(r.version)||r.version<1||r.version>v.version) syncError();
      unique(requests,canonical([v.projectId,r.request_key]));
      const saved=b.versions[r.version-1] as MemoryVersion;
      const expected=createHash("sha256").update(JSON.stringify([saved.scope,saved.projectId,saved.title,saved.content,saved.type,saved.topicKey,saved.pinned,saved.version===1?null:saved.version-1])).digest("hex");
      if(r.payload_hash!==expected) syncError();
    }
    let eventVersion=0;let eventState="active";
    for(const e of b.events) {
      keys(e,"action,version,created_at");date(e.created_at);
      if(!["save","archive","restore"].includes(e.action)||!Number.isInteger(e.version)||e.version<1||e.version>v.version) syncError();
      if(e.action==="save") {
        if(e.version!==eventVersion+1||eventState!=="active"||e.created_at!==b.versions[e.version-1].updatedAt) syncError();
        eventVersion=e.version;
      } else {
        if(eventVersion===0||e.version!==eventVersion) syncError();
        const nextState=e.action==="archive"?"archived":"active";
        if(nextState===eventState) syncError();eventState=nextState;
      }
    }
    if(eventVersion!==v.version||eventState!==state) syncError();
  }
}
// Fusiona tres listas (la base común, la local y la remota) por su clave: si el local y el
// remoto coinciden, gana ese valor; si uno de los dos coincide con la base (solo cambió el
// otro), gana el que cambió; si los tres difieren entre sí, es un conflicto real.
function merge<T>(base:T[],local:T[],remote:T[],key:(v:T)=>string):T[] {
  const b=new Map(base.map(v=>[key(v),v]));const l=new Map(local.map(v=>[key(v),v]));const r=new Map(remote.map(v=>[key(v),v]));
  const out:T[]=[];
  for(const id of [...new Set([...b.keys(),...l.keys(),...r.keys()])].sort()) {
    const bv=b.get(id),lv=l.get(id),rv=r.get(id);
    // No existe un protocolo de borrado físico: un registro que ya se vio antes no puede desaparecer.
    if(bv!==undefined&&(lv===undefined||rv===undefined)) syncError("SYNC_CONFLICT");
    const value=canonical(lv)===canonical(rv)?lv:canonical(lv)===canonical(bv)?rv:canonical(rv)===canonical(bv)?lv:syncError("SYNC_CONFLICT");
    if(value!==undefined) out.push(value);
  }
  return out;
}
/**
 * Fusiona tres fotografías (la base común y las versiones local y remota que partieron de ella)
 * en una sola, proyecto por proyecto y memoria por memoria; valida las tres de entrada y el
 * resultado, y además comprueba con `assertExtension` que el resultado extiende a la local y a la
 * remota sin perder ni reescribir nada de ninguna de las dos. Lanza `SYNC_CONFLICT` si la fusión
 * no es posible sin perder información, o si el resultado combinado supera el tamaño permitido.
 */
export function reconcile(base:SyncSnapshot,local:SyncSnapshot,remote:SyncSnapshot):SyncSnapshot {
  [base,local,remote].forEach(validateSnapshot);
  const result:SyncSnapshot={format:1,projects:merge(base.projects,local.projects,remote.projects,p=>p.projectId),memories:merge(base.memories,local.memories,remote.memories,b=>b.memory.id)};
  try { validateSnapshot(result); } catch {syncError("SYNC_CONFLICT");}
  assertExtension(local,result);assertExtension(remote,result);
  return result;
}

/**
 * Comprueba que `next` extiende a `current`: puede agregar proyectos y memorias nuevas, o
 * agregar versiones y eventos al final de una memoria ya existente, pero no puede borrar ni
 * reescribir nada de lo que `current` ya tenía (ni un proyecto, ni las versiones o eventos ya
 * registrados, ni una petición ya vista). Lanza `SYNC_CONFLICT` si algo de eso se perdió o cambió.
 */
export function assertExtension(current:SyncSnapshot,next:SyncSnapshot):void {
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
}
