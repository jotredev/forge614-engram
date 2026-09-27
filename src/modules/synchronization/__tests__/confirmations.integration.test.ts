/** Comprueba las confirmaciones dentro del ciclo completo de validación y reconciliación de instantáneas: fechas anteriores a la edición, fusión de tres vías, extensión de solo apéndice y campos forjados. */
import { expect, test } from "bun:test";
import type { Confirmation, MemoryVersion } from "../../memory";
import {
  confirmation,confirmationA,confirmationB,confirmedAt,createdAt,legacySnapshot,memoryId,otherProjectId,payloadHash,request,snapshot3,
} from "../__test-support__/confirmation-fixtures";
import { assertExtension,reconcile,validateSnapshot,type SyncSnapshotV3 } from "../snapshot";

// Una confirmación puede registrarse sobre una versión anterior a la más reciente sin que se confunda
// con la edición posterior (la fecha de la confirmación es anterior a la última actualización del recuerdo).
test("format 3 validates an old-version confirmation without confusing it with the later edit",()=>{
  const snapshot=snapshot3();
  expect(snapshot.confirmations[0]!.recordedAt < snapshot.memories[0]!.memory.updatedAt).toBe(true);
  expect(()=>validateSnapshot(snapshot)).not.toThrow();
});

// Dos confirmaciones distintas agregadas cada una en un lado se unen sin conflicto, y reconciliar el
// resultado consigo mismo tres veces produce siempre la misma instantánea (idempotencia).
test("reconciliation unions confirmation identities and remains idempotent",()=>{
  const base={...legacySnapshot(1),format:3 as const,confirmations:[],confirmationRequests:[]};
  const local={...base,confirmations:[confirmation(confirmationB)]};
  const remote={...base,confirmations:[confirmation(confirmationA)]};
  const merged=reconcile(base,local,remote);
  expect(merged.format).toBe(3);
  expect(merged.format===3 && merged.confirmations.map(item=>item.confirmationId)).toEqual([confirmationA,confirmationB]);
  expect(reconcile(merged,merged,merged)).toEqual(merged);
});

// La misma identidad de confirmación con datos distintos en cada lado (sin que la base la tuviera para
// arbitrar) es un conflicto irreconciliable, no una fusión automática.
test("reconciliation rejects the same confirmation identity with changed data even without a checkpoint",()=>{
  const base={...legacySnapshot(1),format:3 as const,confirmations:[],confirmationRequests:[]};
  const local={...base,confirmations:[confirmation()]};
  const remote={...base,confirmations:[{...confirmation(),recordedAt:"2026-09-17T10:01:01.000Z"}]};
  expect(()=>reconcile(base,local,remote)).toThrow(expect.objectContaining({code:"SYNC_CONFLICT"}));
});

// Una confirmación agregada en un lado sobrevive a la fusión aunque el otro lado haya avanzado el
// recuerdo a una versión posterior; ambos cambios son independientes y se conservan los dos.
test("reconciliation retains a confirmation concurrent with a later memory revision",()=>{
  const base={...legacySnapshot(1),format:3 as const,confirmations:[],confirmationRequests:[]};
  const local={...base,confirmations:[confirmation()]};
  const remote={...legacySnapshot(2),format:3 as const,confirmations:[],confirmationRequests:[]};
  const merged=reconcile(base,local,remote);
  expect(merged.format===3 && merged.confirmations).toEqual([confirmation()]);
  expect(merged.memories[0]!.memory.version).toBe(2);
});

// Dos peticiones con la misma confirmationId pero distinta requestKey, una por cada lado, se unen
// ambas: una confirmación puede tener más de una petición asociada.
test("requests are unioned by owner namespace while one confirmation remains one event",()=>{
  const base={...legacySnapshot(1),format:3 as const,confirmations:[],confirmationRequests:[]};
  const event=confirmation();
  const local={...base,confirmations:[event],confirmationRequests:[request(confirmationA,"left")]};
  const remote={...base,confirmations:[event],confirmationRequests:[request(confirmationA,"right")]};
  const merged=reconcile(base,local,remote);
  expect(merged.format===3 && merged.confirmations).toEqual([event]);
  expect(merged.format===3 && merged.confirmationRequests.map(item=>item.requestKey)).toEqual(["left","right"]);
});

// La misma requestKey del mismo dueño no puede quedar atada a dos confirmationId distintas a la vez:
// eso es un conflicto real, no dos peticiones independientes.
test("reconciliation rejects one owner request key attached to different confirmation events",()=>{
  const base={...legacySnapshot(1),format:3 as const,confirmations:[],confirmationRequests:[]};
  const local={...base,confirmations:[confirmation(confirmationA)],confirmationRequests:[request(confirmationA,"same")]};
  const remote={...base,confirmations:[confirmation(confirmationB)],confirmationRequests:[request(confirmationB,"same")]};
  expect(()=>reconcile(base,local,remote)).toThrow(expect.objectContaining({code:"SYNC_CONFLICT"}));
});

// assertExtension debe rechazar cualquier intento de vaciar confirmaciones, peticiones o eventos que
// la instantánea actual ya tenía; el chequeo de solo apéndice cubre las tres colecciones por igual.
test("append-only checks reject removed confirmations, requests, and legacy events",()=>{
  const current=snapshot3();
  for(const mutate of [
    (next:SyncSnapshotV3)=>next.confirmations.splice(0),
    (next:SyncSnapshotV3)=>next.confirmationRequests.splice(0),
    (next:SyncSnapshotV3)=>next.memories[0]!.events.splice(0,1),
  ]) {
    const next=structuredClone(current);mutate(next);
    expect(()=>assertExtension(current,next)).toThrow(expect.objectContaining({code:"SYNC_CONFLICT"}));
  }
});

// Cada mutación de esta lista corrompe un campo distinto de una confirmación o su petición (campo
// extra, formato de UUID, fecha, referencia a otro recuerdo, sesión inexistente, huella o versión
// esperada incorrectas); todas deben ser detectadas por la validación estricta.
test("strict validation rejects forged confirmation and response fields",()=>{
  const mutations:Array<(snapshot:SyncSnapshotV3)=>void>=[
    snapshot=>Object.assign(snapshot.confirmations[0]!,{extra:true}),
    snapshot=>{snapshot.confirmations[0]!.confirmationId="not-a-uuid";},
    snapshot=>{snapshot.confirmations[0]!.version=0;},
    snapshot=>{snapshot.confirmations[0]!.recordedAt="2026-09-17T10:01:00Z";},
    snapshot=>{snapshot.confirmations[0]!.memoryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";},
    snapshot=>{snapshot.confirmations[0]!.recordedAt="2026-09-17T09:59:59.999Z";},
    snapshot=>{snapshot.confirmations[0]!.sessionId="absent";snapshot.confirmationRequests[0]!.response.sessionId="absent";},
    snapshot=>{snapshot.projects.push({projectId:otherProjectId,name:"Other",createdAt,updatedAt:createdAt});snapshot.sessions[0]!.projectId=otherProjectId;},
    snapshot=>{snapshot.confirmationRequests[0]!.response.sessionSource="manual";},
    snapshot=>Object.assign(snapshot.confirmationRequests[0]!,{extra:true}),
    snapshot=>Object.assign(snapshot.confirmationRequests[0]!.response,{extra:true}),
    snapshot=>{snapshot.confirmationRequests[0]!.memoryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";},
    snapshot=>{snapshot.confirmationRequests[0]!.confirmationId=confirmationB;},
    snapshot=>{snapshot.confirmationRequests[0]!.response.memory.content="forged";},
    snapshot=>{snapshot.confirmationRequests[0]!.response.sessionId=null;snapshot.confirmationRequests[0]!.response.sessionSource=null;},
    snapshot=>{snapshot.confirmationRequests[0]!.payloadHash="0".repeat(64);},
    snapshot=>{snapshot.confirmationRequests[0]!.expectedVersion=2;},
  ];
  for(const mutate of mutations) {
    const malformed=snapshot3();mutate(malformed);
    expect(()=>validateSnapshot(malformed)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
  }
});

// Un recuerdo sin topicKey nunca declara una versión esperada: forzar expectedVersion a un número
// para ese caso debe rechazarse aunque el resto de la petición sea coherente.
test("no-topic requests require null expectedVersion",()=>{
  const snapshot=snapshot3(1);const historical=snapshot.memories[0]!.versions[0]!;
  historical.topicKey=null;snapshot.memories[0]!.memory.topicKey=null;snapshot.confirmations[0]!.sessionId=null;
  const wire=snapshot.confirmationRequests[0]!;
  wire.expectedVersion=null;wire.payloadHash=payloadHash(historical,null);
  wire.response={memory:structuredClone(historical),sessionId:null,sessionSource:null};
  expect(()=>validateSnapshot(snapshot)).not.toThrow();
  wire.expectedVersion=1;wire.payloadHash=payloadHash(historical,1);
  expect(()=>validateSnapshot(snapshot)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
});

// La misma clave de petición no puede repetirse ni entre una petición heredada (formato de fila SQL) y
// una nueva, ni entre dos peticiones de confirmación, dentro del mismo espacio de nombres de dueño.
test("request keys are unique across old and confirmation collections in the resolved owner namespace",()=>{
  const duplicate=snapshot3();const oldMemory=duplicate.memories[0]!.versions[0]!;
  duplicate.memories[0]!.requests.push({request_key:"confirm-v1",payload_hash:payloadHash(oldMemory,null),version:1});
  expect(()=>validateSnapshot(duplicate)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
  const repeated=snapshot3();repeated.confirmations.push(confirmation(confirmationB));
  repeated.confirmationRequests.push(request(confirmationB,"confirm-v1"));
  expect(()=>validateSnapshot(repeated)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
});

// La misma clave de petición sí es válida cuando pertenece a espacios de nombres de dueño distintos
// (otro proyecto, u otro alcance como shared): la unicidad es por dueño, no global.
test("the same request key is valid for different project and shared owner namespaces",()=>{
  const snapshot=snapshot3();const otherMemoryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const otherVersion:MemoryVersion={id:otherMemoryId,projectId:null,scope:"shared",topicKey:null,type:"fact",title:"Shared",content:"Body",pinned:false,version:1,createdAt,updatedAt:createdAt};
  const otherEvent:Confirmation={confirmationId:confirmationB,memoryId:otherMemoryId,version:1,recordedAt:confirmedAt,sessionId:null};
  snapshot.memories.push({memory:{...otherVersion,state:"active"},versions:[otherVersion],requests:[],events:[{action:"save",version:1,created_at:createdAt}]});
  snapshot.confirmations.push(otherEvent);
  snapshot.confirmationRequests.push({memoryId:otherMemoryId,requestKey:"confirm-v1",payloadHash:payloadHash(otherVersion,null),expectedVersion:null,
    confirmationId:confirmationB,response:{memory:otherVersion,sessionId:null,sessionSource:null}});
  expect(()=>validateSnapshot(snapshot)).not.toThrow();
});

// Una confirmación de un recuerdo shared solo puede referenciar una sesión runtime existente cuando el
// origen declarado es "explicit"; "inferred" no basta para justificar una escritura shared.
test("a shared confirmation may reference an existing runtime session only through an explicit response",()=>{
  const snapshot=snapshot3(1);const historical=snapshot.memories[0]!.versions[0]!;
  historical.scope="shared";historical.projectId=null;snapshot.memories[0]!.memory.scope="shared";snapshot.memories[0]!.memory.projectId=null;
  const wire=snapshot.confirmationRequests[0]!;wire.payloadHash=payloadHash(historical,1);
  wire.response={memory:structuredClone(historical),sessionId:"runtime-a",sessionSource:"explicit"};
  expect(()=>validateSnapshot(snapshot)).not.toThrow();
  wire.response.sessionSource="inferred";
  expect(()=>validateSnapshot(snapshot)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
});

// Una respuesta de confirmación puede elegir una sesión válida sin que esa sesión tenga ninguna entrada
// de historial propia; pero si la sesión es manual, una respuesta con `sessionSource` «explicit» se
// rechaza, porque ese origen exige una sesión runtime.
test("a confirmation response may select a valid session without owning a session entry",()=>{
  const snapshot=snapshot3();expect(snapshot.sessionEntries).toEqual([]);expect(()=>validateSnapshot(snapshot)).not.toThrow();
  snapshot.sessions[0]!.kind="manual";snapshot.sessions[0]!.endedAt=null;snapshot.confirmationRequests[0]!.response.sessionSource="explicit";
  expect(()=>validateSnapshot(snapshot)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
  snapshot.sessions[0]!.kind="runtime";snapshot.sessions[0]!.endedAt="2026-09-17T10:03:00.000Z";
  expect(()=>validateSnapshot(snapshot)).not.toThrow();
});
