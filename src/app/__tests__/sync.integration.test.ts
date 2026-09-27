/**
 * Comprueba el módulo de sincronización a bajo nivel (`reconcile`, `validateSnapshot`,
 * `applySnapshot`, `checkpoint`): las reglas de cada formato (validación exacta de campos,
 * fusión de sesiones y resúmenes, rechazo de retrocesos de historial y de tamaños
 * excesivos), la migración de un punto de encuentro (checkpoint) al activar sesiones, y que
 * una importación fallida deshace la transacción completa sin perder el punto de encuentro anterior.
 */
import { expect, test } from "bun:test";
import { MemoryStore } from "../../app/memory-store";
import { assertExtension, emptySnapshot, normalizeSnapshot, reconcile, snapshotHash, validateSnapshot } from "../../modules/synchronization";
import { validateSnapshot as validateOldSnapshot } from "../../../tests/fixtures/snapshot-v1";
import { Database } from "bun:sqlite";
import { initialize, enableSynchronization, enableSessionLifecycle } from "../../infrastructure/sqlite/schema";
import { applySnapshot, checkpoint, exportSnapshot } from "../../infrastructure/sqlite/snapshots";

function sessionFixture() {
  const store=new MemoryStore(":memory:");
  store.enableSessions();
  const project=store.createProject("Sessions");
  store.startSession(project.projectId,"client/conversation:α","/local/runtime");
  store.saveWithSession({projectId:project.projectId,title:"Entry",content:"original",type:"fact",requestKey:"entry"},{sessionId:"client/conversation:α"});
  store.saveSessionSummary(project.projectId,"client/conversation:α",{goal:"goal",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]},{requestKey:"summary"});
  return {store,project};
}


// Verifica que exportar desde el esquema 6 incluye sesiones y sus orígenes en tiempo de ejecución (sin filtrar la ruta local), que el validador antiguo (formato 1) rechaza el formato 2, y que agregar una memoria compartida ligada a la sesión sigue validando bien.
test("schema6 exports sessions and immutable origins while the old validator rejects format2",()=>{
  const {store}=sessionFixture();
  try {
    const snapshot=store.syncSnapshot();
    expect(snapshot.format).toBe(2);
    const current=normalizeSnapshot(snapshot);
    expect(current.sessions).toHaveLength(1);
    expect(current.sessionEntries).toHaveLength(2);
    expect(current.sessionSummaries).toHaveLength(1);
    expect(JSON.stringify(current)).not.toContain("/local/runtime");
    expect(()=>validateSnapshot(current)).not.toThrow();
    expect(()=>validateOldSnapshot(current)).toThrow();
    expect(()=>validateOldSnapshot(emptySnapshot())).not.toThrow();
    const shared=store.saveWithSession({scope:"shared",projectId:null,title:"Shared",content:"global",type:"fact"},{projectId:current.sessions[0]!.projectId,sessionId:"client/conversation:α"});
    expect(normalizeSnapshot(store.syncSnapshot()).sessionEntries.some(e=>e.memoryId===shared.memory.id)).toBe(true);
    expect(()=>validateSnapshot(store.syncSnapshot())).not.toThrow();
  } finally {store.close();}
});


// Verifica, con una batería de mutaciones inválidas (campo extra, id opaco alterado, fecha imposible, dueño ajeno, referencia de resumen cruzada, etc.), que validateSnapshot rechaza cada una de ellas, además de un campo demasiado grande.
test("format2 validates exact fields, opaque IDs, canonical dates, owners, origins and summary references",()=>{
  const {store}=sessionFixture();
  try {
    const good=normalizeSnapshot(store.syncSnapshot());
    expect(()=>validateSnapshot(good)).not.toThrow();
    const mutations:((s:any)=>void)[]=[
      s=>s.local_manual_sessions=[], s=>s.sessions[0].directory="/private", s=>s.sessionEntries[0].registry="private",
      s=>s.sessions.push(s.sessions[0]), s=>s.sessionEntries.push(s.sessionEntries[0]), s=>s.sessionSummaries.push(s.sessionSummaries[0]),
      s=>s.sessions[0].sessionId=" bad", s=>s.sessions[0].sessionId="x".repeat(201), s=>s.sessions[0].sessionId="bad\u0001",
      s=>s.sessions[0].startedAt="2026-02-30T00:00:00.000Z", s=>s.sessions[0].projectId=crypto.randomUUID(),
      s=>s.sessions[0].kind="manual", s=>s.sessions[0].endedAt="bad",
      s=>s.sessionEntries[0].sessionId="absent", s=>s.sessionEntries[0].version=999,
      s=>s.sessionEntries[0].recordedAt="2000-01-01T00:00:00.000Z",
      s=>s.sessionSummaries[0].version=999, s=>s.sessionSummaries[0].sessionId="absent",
      s=>s.sessionSummaries[0].memoryId=s.memories.find((b:any)=>b.memory.type==="fact").memory.id,
      s=>{const p={...s.projects[0],projectId:crypto.randomUUID()};s.projects.push(p);s.sessions[0].projectId=p.projectId;},
    ];
    for(const mutate of mutations) {const bad=structuredClone(good);mutate(bad);expect(()=>validateSnapshot(bad)).toThrow();}
    const tooLarge=structuredClone(good);tooLarge.projects[0]!.name="x".repeat(8*1024*1024);
    expect(()=>validateSnapshot(tooLarge)).toThrow("SYNC_TOO_LARGE");
  } finally {store.close();}
});


// Verifica que reconcile fusiona sesiones independientes y conserva el avance de un cierre, pero rechaza un cierre divergente, perder sesiones o entradas de sesión al fusionar, y un origen (session del que depende un resumen) que desaparece.
test("format2 merges independent sessions and close advances but rejects lost origins or divergent closes",()=>{
  const {store,project}=sessionFixture();
  try {
    const base=normalizeSnapshot(store.syncSnapshot());
    const local=structuredClone(base),remote=structuredClone(base);
    local.sessions[0]!.endedAt="2026-09-17T23:00:00.000Z";
    remote.sessions.push({sessionId:"other",projectId:project.projectId,kind:"runtime",startedAt:"2026-09-17T00:00:00.000Z",endedAt:null});
    const merged=normalizeSnapshot(reconcile(base,local,remote));
    expect(merged.sessions).toHaveLength(2);
    expect(merged.sessions.find(s=>s.sessionId==="client/conversation:α")!.endedAt).toBe("2026-09-17T23:00:00.000Z");
    remote.sessions[0]!.endedAt="2026-09-18T00:00:00.000Z";
    expect(()=>reconcile(base,local,remote)).toThrow("SYNC_CONFLICT");
    for(const field of ["sessions","sessionEntries"] as const) {const bad=structuredClone(base);bad[field]=[];expect(()=>assertExtension(base,bad)).toThrow("SYNC_CONFLICT");}
    const origin=structuredClone(base);origin.sessions.push({sessionId:"other",projectId:project.projectId,kind:"runtime",startedAt:"2026-09-17T00:00:00.000Z",endedAt:null});
    origin.sessionEntries.find(e=>e.memoryId!==origin.sessionSummaries[0]!.memoryId)!.sessionId="other";
    expect(()=>reconcile(emptySnapshot(),base,origin)).toThrow("SYNC_CONFLICT");
    expect(()=>assertExtension(local,base)).toThrow("SYNC_CONFLICT");
    for(const change of [(s:any)=>s.startedAt="2000-01-01T00:00:00.000Z",(s:any)=>s.kind="manual"]){
      const changed=structuredClone(base);changed.sessionSummaries=[];change(changed.sessions[0]);
      const unpointed=structuredClone(base);unpointed.sessionSummaries=[];
      expect(()=>reconcile(emptySnapshot(),unpointed,changed)).toThrow("SYNC_CONFLICT");
    }
    expect(reconcile(emptySnapshot(),emptySnapshot(),emptySnapshot()).format).toBe(1);
  } finally {store.close();}
});


// Verifica que importar sesiones remotas conserva el registro y los vínculos de carpeta locales, sin adoptar como propias las sesiones manuales remotas (siguen resolviéndose por su origen real en tiempo de ejecución).
test("session import preserves local registry and bindings without adopting remote manual sessions",()=>{
  const {store:a,project}=sessionFixture();const b=new MemoryStore(":memory:");
  try {
    b.enableSessions();b.applySync(b.syncSnapshot(),a.syncSnapshot(),"replica");
    expect(b.getSession(project.projectId,"client/conversation:α")).toEqual(a.getSession(project.projectId,"client/conversation:α"));
    expect(normalizeSnapshot(b.syncSnapshot()).sessionSummaries).toHaveLength(1);
    b.bindProjectDirectory("/machine/b",project.projectId);
    b.startSession(project.projectId,"local","/local/b");
    const local=b.saveWithSession({projectId:project.projectId,title:"local",content:"local",type:"fact"});
    const other=a.saveWithSession({projectId:project.projectId,title:"remote",content:"remote",type:"fact"});
    const merged=reconcile(b.syncCheckpoint("replica"),b.syncSnapshot(),a.syncSnapshot());
    b.applySync(b.syncSnapshot(),merged,"replica");
    const again=b.saveWithSession({projectId:project.projectId,title:"again",content:"again",type:"fact"});
    expect(again.sessionId).toBe(local.sessionId);expect(again.sessionId).not.toBe(other.sessionId);
    expect(b.projectForDirectory("/machine/b")?.projectId).toBe(project.projectId);
    const inferred=b.saveWithSession({projectId:project.projectId,title:"inferred",content:"inferred",type:"fact"},{mode:"assistant",runtimeDirectory:"/local/b"});
    expect(inferred.sessionId).toBe("local");
    const imported=b.saveWithSession({projectId:project.projectId,title:"isolated",content:"isolated",type:"fact"},{mode:"assistant",runtimeDirectory:"/local/runtime"});
    expect(imported.sessionSource).toBe("manual");
    expect(JSON.stringify(b.syncSnapshot())).not.toContain("/local/");
  }finally{a.close();b.close();}
});


// Verifica que el puntero de versión de un resumen de sesión avanza junto con su historial, que entradas de sesión no relacionadas se unen sin conflicto, y que dos revisiones de resumen que compiten desde la misma base sí generan un conflicto.
test("summary pointers advance with history, union unrelated entries, and reject competing summary revisions",()=>{
  const {store:a,project}=sessionFixture(),b=new MemoryStore(":memory:");
  const fields={goal:"updated",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]};
  try {
    b.enableSessions();const base=a.syncSnapshot();b.applySync(b.syncSnapshot(),base,"replica");
    a.saveSessionSummary(project.projectId,"client/conversation:α",fields,{requestKey:"update-summary",expectedVersion:1});
    b.startSession(project.projectId,"independent");
    b.saveWithSession({projectId:project.projectId,title:"Other",content:"independent",type:"fact"},{sessionId:"independent"});
    const merged=normalizeSnapshot(reconcile(base,a.syncSnapshot(),b.syncSnapshot()));
    expect(merged.sessionEntries).toHaveLength(4);expect(merged.sessionSummaries[0]!.version).toBe(2);
    b.applySync(b.syncSnapshot(),merged,"replica");
    expect(normalizeSnapshot(b.syncSnapshot()).sessionSummaries[0]!.version).toBe(2);
    const rewind=structuredClone(merged);rewind.sessionSummaries[0]!.version=1;
    expect(()=>assertExtension(merged,rewind)).toThrow("SYNC_CONFLICT");
    const deleted=structuredClone(merged);deleted.sessionSummaries=[];
    expect(()=>assertExtension(merged,deleted)).toThrow("SYNC_CONFLICT");
    const agreed=b.syncSnapshot();a.applySync(a.syncSnapshot(),agreed,"replica");
    a.saveSessionSummary(project.projectId,"client/conversation:α",{...fields,goal:"left"},{requestKey:"left",expectedVersion:2});
    b.saveSessionSummary(project.projectId,"client/conversation:α",{...fields,goal:"right"},{requestKey:"right",expectedVersion:2});
    expect(()=>reconcile(agreed,a.syncSnapshot(),b.syncSnapshot())).toThrow("SYNC_CONFLICT");
  }finally{a.close();b.close();}
});


// Verifica que una base local que aún no tiene sesiones rechaza aplicar un formato 2 (SESSIONS_REQUIRED) sin tocar su punto de encuentro en formato 1, y que tras activar sesiones sí puede aplicarlo y su punto de encuentro sube de formato.
test("pre-session local schema refuses format2 apply before changing its format1 checkpoint",()=>{
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:");
  try {
    a.enableSync();b.enableSync();a.createProject("old");
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),"replica");
    const old=b.syncCheckpoint("replica"),before=b.syncSnapshot();
    a.enableSessions();a.createProject("new");
    expect(()=>b.applySync(before,a.syncSnapshot(),"replica")).toThrow("SESSIONS_REQUIRED");
    expect(b.syncSnapshot()).toEqual(before);expect(b.syncCheckpoint("replica")).toEqual(old);
    b.enableSessions();
    expect(b.syncCheckpoint("replica")).toEqual(old);
    b.applySync(b.syncSnapshot(),reconcile(old,b.syncSnapshot(),a.syncSnapshot()),"replica");
    expect(b.syncCheckpoint("replica").format).toBe(2);
  } finally {a.close();b.close();}
});


// Verifica que el punto de encuentro (checkpoint) guardado en bytes sobrevive a activar sesiones (sigue en formato 1 hasta que se aplica algo nuevo), que una importación que falla a mitad de camino deshace todo, y que un punto de encuentro demasiado grande se rechaza antes de analizarlo (parsearlo).
test("checkpoint bytes survive enabling sessions and failed transactional import; oversized checkpoints reject before parsing",()=>{
  const db=new Database(":memory:");const {store}=sessionFixture();
  try {
    initialize(db);expect(exportSnapshot(db).format).toBe(1);
    enableSynchronization(db);expect(exportSnapshot(db).format).toBe(1);
    const raw='{ "memories" : [], "projects" : [], "format" : 1 }';
    db.query("INSERT INTO sync_checkpoints(replica,snapshot) VALUES(?,?)").run("replica",raw);
    enableSessionLifecycle(db);expect(checkpoint(db,"replica").format).toBe(1);
    const before=exportSnapshot(db);
    // Un fallo después de escribir proyecto/memoria/versión debe deshacer la importación completa.
    db.exec("CREATE TEMP TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'interrupted'); END");
    expect(()=>applySnapshot(db,before,store.syncSnapshot(),"replica")).toThrow("interrupted");
    expect(exportSnapshot(db)).toEqual(before);
    expect((db.query("SELECT snapshot FROM sync_checkpoints WHERE replica='replica'").get() as {snapshot:string}).snapshot).toBe(raw);
    db.exec("DROP TRIGGER fail_session");
    applySnapshot(db,before,store.syncSnapshot(),"replica");
    expect(checkpoint(db,"replica").format).toBe(2);
    db.query("UPDATE sync_checkpoints SET snapshot=? WHERE replica='replica'").run('"'+"x".repeat(8*1024*1024)+'"');
    expect(()=>checkpoint(db,"replica")).toThrow("SYNC_TOO_LARGE");
  }finally{db.close();store.close();}
});


// Verifica que dos fotografías (snapshots) válidas por separado pueden superar el límite de tamaño al combinarse, y que reconcile lo detecta en vez de dejar pasar un resultado demasiado grande.
test("individually valid snapshots cannot merge past the size limit",()=>{
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:");
  try {
    a.save({scope:"shared",projectId:null,title:"A",content:"a".repeat(2.1*1024*1024),type:"fact"});
    b.save({scope:"shared",projectId:null,title:"B",content:"b".repeat(2.1*1024*1024),type:"fact"});
    const left=a.syncSnapshot(),right=b.syncSnapshot();
    expect(()=>reconcile(emptySnapshot(),left,right)).toThrow("SYNC_TOO_LARGE");
  }finally{a.close();b.close();}
});


// Verifica que sincronizar en el esquema 5 actualiza el historial de la memoria y la búsqueda de texto (FTS) en la instalación B, pero conserva los vínculos de carpeta de cada máquina como algo propio de esa máquina (no se copian entre instalaciones).
test('schema5 sync updates memory history and FTS while preserving only local machine bindings',()=>{
  const a=new MemoryStore(':memory:'),b=new MemoryStore(':memory:');
  try{
    a.enableProjectBindings();b.enableProjectBindings();
    const p=a.createProject('Cross machine');
    const m=a.save({projectId:p.projectId,title:'Topic',content:'firstword',type:'fact',topicKey:'topic'});
    a.bindProjectDirectory('/synthetic/machine-A/project',p.projectId);
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),'replica');
    b.bindProjectDirectory('/synthetic/machine-B/project',p.projectId);
    a.save({projectId:p.projectId,title:'Topic',content:'updatedword',type:'fact',topicKey:'topic',expectedVersion:1});
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),'replica');
    expect(b.projectForDirectory('/synthetic/machine-B/project')?.projectId).toBe(p.projectId);
    expect(b.projectForDirectory('/synthetic/machine-A/project')).toBeNull();
    expect(b.get(p.projectId,m.id)?.content).toBe('updatedword');expect(b.history(p.projectId,m.id)).toHaveLength(2);
    expect(b.search(p.projectId,'updatedword')).toHaveLength(1);expect(b.search(p.projectId,'firstword')).toHaveLength(0);
    expect(JSON.stringify(a.syncSnapshot())).not.toContain('/synthetic/');expect(JSON.stringify(b.syncSnapshot())).not.toContain('/synthetic/');
  }finally{a.close();b.close();}
});


// Verifica que sincronizar dos instalaciones con proyectos independientes los combina a ambos, y que el historial completo de una memoria remota (todas sus versiones) llega y queda buscable por texto en local.
test("sync merges independent projects and imports memory history into local FTS", () => {
  const a = new MemoryStore(":memory:"); const b = new MemoryStore(":memory:");
  try {
    a.enableSync(); b.enableSync();
    const base = b.syncSnapshot(); const p = a.createProject("A");
    const m = a.save({ projectId:p.projectId,title:"SQLite",content:"first",type:"fact",topicKey:"db",requestKey:"one" });
    a.save({ projectId:p.projectId,title:"SQLite",content:"second",type:"fact",topicKey:"db",expectedVersion:1 });
    b.createProject("B");
    const local = b.syncSnapshot(); const merged = reconcile(base,local,a.syncSnapshot());
    b.applySync(local,merged,"replica");
    expect(b.listProjects()).toHaveLength(2);
    expect(b.history(p.projectId,m.id)).toHaveLength(2);
    expect(b.search(p.projectId,"second")).toHaveLength(1);
    expect(b.syncCheckpoint("replica")).toEqual(merged);
    expect(snapshotHash(b.syncSnapshot())).toBe(snapshotHash(merged));
    b.applySync(merged,merged,"replica");
    expect(b.history(p.projectId,m.id)).toHaveLength(2);
  } finally {a.close();b.close();}
});


// Verifica que validateSnapshot rechaza un hash de petición alterado, un historial de eventos vaciado, y un estado de memoria (archivada) que no coincide con lo que dice su propio historial.
test("sync rejects corrupted request hashes and event histories",()=>{
  const store=new MemoryStore(":memory:");
  try {
    const p=store.createProject("A");store.save({projectId:p.projectId,title:"T",content:"C",type:"fact",requestKey:"req"});
    const snapshot=store.syncSnapshot();
    const badHash=structuredClone(snapshot);badHash.memories[0]!.requests[0]!.payload_hash="0".repeat(64);
    expect(()=>validateSnapshot(badHash)).toThrow();
    const badEvents=structuredClone(snapshot);badEvents.memories[0]!.events=[];
    expect(()=>validateSnapshot(badEvents)).toThrow();
    const badState=structuredClone(snapshot);badState.memories[0]!.memory.state="archived";
    expect(()=>validateSnapshot(badState)).toThrow();
  } finally {store.close();}
});


// Verifica que reconcile rechaza un remoto que retrocede en el historial de una memoria (una versión anterior a la que ya se conocía), incluso cuando lo local solo trae cambios sin relación con esa memoria.
test("reconciliation rejects a remote history rollback before publishing unrelated local changes",()=>{
  const store=new MemoryStore(":memory:");
  try {
    const p=store.createProject("A");
    store.save({projectId:p.projectId,title:"T",content:"old",type:"fact",topicKey:"t"});
    const remote=store.syncSnapshot();
    store.save({projectId:p.projectId,title:"T",content:"new",type:"fact",topicKey:"t",expectedVersion:1});
    const base=store.syncSnapshot();store.createProject("Independent");
    expect(()=>reconcile(base,store.syncSnapshot(),remote)).toThrow("SYNC_CONFLICT");
  } finally {store.close();}
});


// Verifica que dos ediciones divergentes desde la misma base generan conflicto al reconciliar, que aplicar una fotografía (snapshot) sobre un estado local ya obsoleto falla, que asignarle dueño ajeno a una memoria (projectId null) falla, y que ninguno de los dos lados pierde su propio contenido.
test("sync rejects divergent edits, foreign ownership and stale local snapshot without losing data", () => {
  const a = new MemoryStore(":memory:"); const b = new MemoryStore(":memory:");
  try {
    a.enableSync(); b.enableSync();
    const p=a.createProject("A");
    const m=a.save({projectId:p.projectId,title:"T",content:"base",type:"fact",topicKey:"t"});
    const base=a.syncSnapshot(); b.applySync(b.syncSnapshot(),base,"replica");
    a.save({projectId:p.projectId,title:"T",content:"left",type:"fact",topicKey:"t",expectedVersion:1});
    b.save({projectId:p.projectId,title:"T",content:"right",type:"fact",topicKey:"t",expectedVersion:1});
    expect(()=>reconcile(base,a.syncSnapshot(),b.syncSnapshot())).toThrow("SYNC_CONFLICT");
    expect(()=>a.applySync(base,b.syncSnapshot(),"replica")).toThrow();
    const bad=structuredClone(a.syncSnapshot()); bad.memories[0]!.memory.projectId=null;
    expect(()=>a.applySync(a.syncSnapshot(),bad,"replica")).toThrow();
    expect(a.get(p.projectId,m.id)!.content).toBe("left");
    expect(b.get(p.projectId,m.id)!.content).toBe("right");
  } finally {a.close();b.close();}
});


// Verifica que sincronizar conserva el alcance compartido (shared) de una memoria frente a una de proyecto con el mismo tema, y que archivar/restaurar en A se refleja en la búsqueda de B tras sincronizar.
test("sync preserves shared scope and archive/restore overrides", () => {
  const a=new MemoryStore(":memory:"); const b=new MemoryStore(":memory:");
  try {
    a.enableSync();b.enableSync(); const p=a.createProject("A");
    a.save({scope:"shared",projectId:null,title:"Rule",content:"general",type:"preference",topicKey:"rule"});
    const m=a.save({projectId:p.projectId,title:"Rule",content:"specific",type:"preference",topicKey:"rule"});
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),"replica");
    expect(b.search(p.projectId,"general")).toHaveLength(0);
    a.archive(p.projectId,m.id);
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),"replica");
    expect(b.search(p.projectId,"general")).toHaveLength(1);
    a.restore(p.projectId,m.id);
    b.applySync(b.syncSnapshot(),a.syncSnapshot(),"replica");
    expect(b.search(p.projectId,"specific")).toHaveLength(1);
  } finally {a.close();b.close();}
});
