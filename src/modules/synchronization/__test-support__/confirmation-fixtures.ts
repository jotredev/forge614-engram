/**
 * Datos de prueba compartidos para los tests de sincronización y confirmaciones: identidades fijas
 * (proyectos, recuerdos, confirmaciones), fechas fijas y funciones que arman instantáneas válidas de
 * cada formato, para no repetir esta construcción en cada archivo de prueba.
 */
import { createHash } from "node:crypto";
import type { Confirmation, ConfirmationRequest, MemoryVersion } from "../../memory";
import type { MemoryBundle, SyncSnapshotV1, SyncSnapshotV2, SyncSnapshotV3 } from "../snapshot";

export const projectId="11111111-1111-4111-8111-111111111111";
export const otherProjectId="22222222-2222-4222-8222-222222222222";
export const memoryId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const confirmationA="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const confirmationB="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const createdAt="2026-09-17T10:00:00.000Z";
export const confirmedAt="2026-09-17T10:01:00.000Z";
export const revisedAt="2026-09-17T10:02:00.000Z";

/**
 * Recalcula la huella de contenido de una petición de guardado, igual que `confirmations.ts`, para
 * armar peticiones de prueba con la huella correcta.
 * @param memory Versión del recuerdo.
 * @param expectedVersion Versión esperada declarada por la petición.
 * @returns La huella SHA-256 del contenido relevante.
 */
export function payloadHash(memory:MemoryVersion, expectedVersion:number|null):string {
  return createHash("sha256").update(JSON.stringify([
    memory.scope,memory.projectId,memory.title,memory.content,memory.type,memory.topicKey,memory.pinned,expectedVersion,
  ])).digest("hex");
}

/** Dos versiones sucesivas de un mismo recuerdo (versión 1 recién creada, versión 2 revisada), usadas como historial base en la mayoría de las pruebas. */
export function versions():[MemoryVersion,MemoryVersion] {
  return [
    {id:memoryId,projectId,scope:"project",topicKey:"storage",type:"decision",title:"Store",content:"SQLite",pinned:false,version:1,createdAt,updatedAt:createdAt},
    {id:memoryId,projectId,scope:"project",topicKey:"storage",type:"decision",title:"Store",content:"SQLite plus WAL",pinned:false,version:2,createdAt,updatedAt:revisedAt},
  ];
}

/**
 * Arma un `MemoryBundle` completo (recuerdo activo, historial, eventos de guardado, sin peticiones)
 * hasta la versión indicada.
 * @param currentVersion Cuántas versiones del historial incluir (1 o 2).
 * @returns El bundle con el recuerdo activo en la versión pedida.
 */
export function legacyBundle(currentVersion=2):MemoryBundle {
  const history=versions().slice(0,currentVersion);
  const current=history.at(-1)!;
  return {
    memory:{...current,state:"active"},versions:history,requests:[],
    events:history.map(memory=>({action:"save" as const,version:memory.version,created_at:memory.updatedAt})),
  };
}

/** Una instantánea formato 2 completa y válida (un proyecto, un bundle de recuerdo, una sesión runtime abierta), lista para validar o reconciliar en las pruebas. */
export function legacySnapshot(currentVersion=2):SyncSnapshotV2 {
  return {
    format:2,projects:[{projectId,name:"Primary",createdAt,updatedAt:createdAt}],memories:[legacyBundle(currentVersion)],
    sessions:[{sessionId:"runtime-a",projectId,kind:"runtime",startedAt:createdAt,endedAt:null}],sessionEntries:[],sessionSummaries:[],
  };
}

/** Una confirmación de escritura válida sobre la versión 1 del recuerdo de prueba, con la sesión runtime-a como origen. */
export function confirmation(id=confirmationA):Confirmation {
  return {confirmationId:id,memoryId,version:1,recordedAt:confirmedAt,sessionId:"runtime-a"};
}

/** Una petición de confirmación válida para la versión 1 del recuerdo de prueba, con la huella y el origen de sesión coherentes con `confirmation()`. */
export function request(id=confirmationA, requestKey="confirm-v1"):ConfirmationRequest {
  const memory=versions()[0];
  return {memoryId,requestKey,payloadHash:payloadHash(memory,1),expectedVersion:1,confirmationId:id,
    response:{memory,sessionId:"runtime-a",sessionSource:"inferred"}};
}

/** Una instantánea formato 3 completa y válida, con una confirmación y su petición ya incluidas. */
export function snapshot3(currentVersion=2):SyncSnapshotV3 {
  return {...legacySnapshot(currentVersion),format:3,confirmations:[confirmation()],confirmationRequests:[request()]};
}

/** Un mismo bundle de recuerdo (con dos peticiones de guardado idempotente ya resueltas) expresado en formato 1 y en formato 2, para comprobar que ambos siguen siendo válidos y compatibles byte a byte. */
export function compatibilitySnapshots():{one:SyncSnapshotV1;two:SyncSnapshotV2} {
  const bundle=legacyBundle(2);
  const [first,second]=bundle.versions;
  bundle.requests=[
    {request_key:"create-store",payload_hash:payloadHash(first!,null),version:1},
    {request_key:"revise-store",payload_hash:payloadHash(second!,1),version:2},
  ];
  const projects=[{projectId,name:"Primary",createdAt,updatedAt:createdAt}];
  const one:SyncSnapshotV1={format:1,projects,memories:[bundle]};
  const two:SyncSnapshotV2={format:2,projects,memories:[structuredClone(bundle)],
    sessions:[{sessionId:"runtime-a",projectId,kind:"runtime",startedAt:createdAt,endedAt:null}],
    sessionEntries:[{sessionId:"runtime-a",memoryId,version:1,recordedAt:createdAt}],sessionSummaries:[]};
  return {one,two};
}
