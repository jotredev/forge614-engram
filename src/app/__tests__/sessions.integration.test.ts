/**
 * Comprueba el ciclo de vida de sesiones sobre SQLite real: activación explícita, ids
 * opacos, propiedad privada e inmutable, migración aditiva del nivel de esquema sin tocar
 * memorias existentes, inferencia de la sesión de un asistente (assistant) por carpeta de
 * ejecución, ventana de actividad de siete días, resúmenes con puntero de versión atómico,
 * y que cualquier escritura fallida a mitad de camino deshace todas las tablas relacionadas.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../index";
import { enableSessionLifecycle } from "../../infrastructure/sqlite/schema";
import { normalizeSnapshot } from "../../modules/synchronization";

const directories: string[] = [];
function database(): string {
  const directory = mkdtempSync(join(tmpdir(),"forge614-sessions-"));
  directories.push(directory); return join(directory,"memory.sqlite");
}
afterEach(() => { setSystemTime(); for (const directory of directories.splice(0)) rmSync(directory,{recursive:true,force:true}); });

function sessionState(db: Database): Record<string,unknown[]> {
  const result: Record<string,unknown[]> = {};
  for (const table of ["projects","project_bindings","memories","memory_versions","events","requests","sessions","session_entries","session_summaries","local_session_bindings","local_manual_sessions"]) {
    result[table]=db.query(`SELECT * FROM ${table} ORDER BY 1,2`).all();
  }
  return result;
}

// Verifica, para ambas tablas relacionadas con sesión, que rechazar una inserción a mitad de un guardado de resumen deshace todo (ninguna tabla cambia) y que el historial existente sigue intacto tras cerrar y reabrir la base.
test.each(["session_entries", "session_summaries"])("facade persists complete rollback after rejected %s insertion", table => {
  const path = database(); let store = new MemoryStore(path);
  store.enableSessions(); const {projectId} = store.createProject("Persisted rollback");
  store.startSession(projectId,"persisted-chat");
  const kept = store.save({projectId,title:"Keep",content:"Existing history",type:"fact"});
  const db = new Database(path);
  try {
    const before = sessionState(db);
    db.exec(`CREATE TRIGGER reject_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'write rejected'); END;`);
    expect(() => store.saveSessionSummary(projectId,"persisted-chat",{goal:"Goal",instructions:"",discoveries:"Found",accomplishments:"Done",nextSteps:"Next",files:[]},{requestKey:"failed-summary"})).toThrow("write rejected");
    expect(sessionState(db)).toEqual(before);
    db.exec("DROP TRIGGER reject_write");
    store.close(); store = new MemoryStore(path,{create:false});
    expect(sessionState(db)).toEqual(before);
    expect(store.get(projectId,kept.id)?.content).toBe("Existing history");
    expect(store.history(projectId,kept.id)).toEqual([kept]);
    expect(store.getSession(projectId,"persisted-chat")?.endedAt).toBeNull();
  } finally { store.close(); db.close(); }
});

// Verifica que iniciar una sesión falla sin activar sesiones antes, que activarlas dos veces no falla, que iniciar la misma sesión dos veces devuelve la misma, y que cerrarla dos veces no falla pero volver a iniciarla sí.
test("session enrollment is explicit and closing is idempotent", () => {
  const store = new MemoryStore(":memory:");
  try {
    const { projectId } = store.createProject("Demo");
    expect(() => store.startSession(projectId, "conversation-1")).toThrow();
    store.enableSessions();
    store.enableSessions();
    const started = store.startSession(projectId, "conversation-1");
    expect(store.startSession(projectId, "conversation-1")).toEqual(started);
    const ended = store.endSession(projectId, "conversation-1");
    expect(ended.endedAt).not.toBeNull();
    expect(store.endSession(projectId, "conversation-1")).toEqual(ended);
    expect(() => store.startSession(projectId, "conversation-1")).toThrow();
  } finally { store.close(); }
});

// Verifica que los ids de sesión rechazan formas peligrosas (vacío, con espacios en los bordes, con salto de línea, con caracteres invisibles, o demasiado largos), pero aceptan Unicode largo dentro del límite.
test("session identifiers enforce the opaque integration boundary", () => {
  const store = new MemoryStore(":memory:");
  try {
    const project = store.createProject("Demo"); store.enableSessions();
    for (const id of ["", " spaced", "spaced ", "line\nbreak", "\u200bhidden", "x".repeat(201)]) {
      expect(() => store.startSession(project.projectId,id)).toThrow();
    }
    const unicode = "🙂".repeat(200);
    expect(store.startSession(project.projectId,unicode).sessionId).toBe(unicode);
  } finally { store.close(); }
});

// Verifica que un id de sesión que parece compartido en realidad es privado por proyecto: otro proyecto no la ve, no puede iniciar una con el mismo id, y no puede cerrarla.
test("session ownership is private and immutable", () => {
  const store = new MemoryStore(":memory:");
  try {
    const one = store.createProject("One"), two = store.createProject("Two"); store.enableSessions();
    store.startSession(one.projectId,"shared-looking-id");
    expect(store.getSession(two.projectId,"shared-looking-id")).toBeNull();
    expect(() => store.startSession(two.projectId,"shared-looking-id")).toThrow("no está disponible");
    expect(() => store.endSession(two.projectId,"shared-looking-id")).toThrow("no encontrada");
    expect(store.getSession(one.projectId,"shared-looking-id")?.endedAt).toBeNull();
  } finally { store.close(); }
});

// Verifica, desde los niveles de esquema 3, 4 y 5, que activar sesiones sube al nivel 6 de forma aditiva: la fotografía de sincronización previa (proyectos, memorias) queda igual, las tablas de sesión nacen vacías, y la memoria ya guardada se puede repetir con su misma requestKey.
test.each([3,4,5] as const)("schema %d enrolls additively without changing saved memory", version => {
  const path = database();
  const first = new MemoryStore(path); const project = first.createProject("Demo");
  const saved = first.save({projectId:project.projectId,title:"Keep",content:"History",type:"fact",requestKey:"request-1"});
  if (version >= 4) first.enableSync();
  if (version >= 5) first.enableProjectBindings();
  const before = first.syncSnapshot();
  first.close();

  const enrolled = new MemoryStore(path); enrolled.enableSessions();
  const after=normalizeSnapshot(enrolled.syncSnapshot());
  expect(after).toEqual(normalizeSnapshot(before));
  expect(after.sessions).toEqual([]);expect(after.sessionEntries).toEqual([]);expect(after.sessionSummaries).toEqual([]);
  expect(enrolled.get(project.projectId,saved.id)?.content).toBe("History");
  expect(enrolled.history(project.projectId,saved.id)).toEqual([saved]);
  expect(enrolled.save({projectId:project.projectId,title:"Keep",content:"History",type:"fact",requestKey:"request-1"})).toEqual(saved);
  enrolled.close();

  const db = new Database(path,{readonly:true});
  expect(db.query("PRAGMA user_version").get()).toEqual({user_version:6});
  for (const table of ["sessions","session_entries","session_summaries","local_session_bindings","local_manual_sessions"]) {
    expect(db.query(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({count:0});
  }
  db.close();
});

// Verifica que una base ya en el nivel de esquema 6 se reabre exactamente igual, y que volver a llamar a los métodos de activación de niveles anteriores (sync, vínculos de proyecto, sesiones) no falla.
test("schema 6 reopens exactly and older enrollment facades accept it", () => {
  const path = database(); const first = new MemoryStore(path); first.enableSessions(); first.close();
  const reopened = new MemoryStore(path);
  try {
    expect(reopened.sessionsEnabled()).toBe(true);
    reopened.enableSync(); reopened.enableProjectBindings(); reopened.enableSessions();
  } finally { reopened.close(); }
});

// Verifica que una base a la que le falta un disparador (trigger) esperado se rechaza al abrirla, sin cambiar ni un byte del archivo.
test("a malformed enrollment candidate remains byte-for-byte unchanged", () => {
  const path = database(); const store = new MemoryStore(path); store.close();
  const db = new Database(path); db.exec("DROP TRIGGER memory_update"); db.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

// Verifica que si la migración a sesiones falla a mitad de camino (SQL forzado a fallar), se deshacen todas las tablas de sesión creadas y el número de versión del esquema no avanza.
test("a migration failure rolls back every session table and the version bump", () => {
  const path = database(); const store = new MemoryStore(path); store.enableProjectBindings(); store.close();
  const db = new Database(path); const execute = db.exec.bind(db);
  Object.defineProperty(db,"exec",{value:(sql:string) => execute(sql.includes("CREATE TABLE sessions")
    ? sql.replace("CREATE INDEX sessions_project_started", "THIS IS NOT SQL; CREATE INDEX sessions_project_started") : sql)});
  expect(() => enableSessionLifecycle(db)).toThrow();
  expect(db.query("PRAGMA user_version").get()).toEqual({user_version:5});
  expect(db.query("SELECT name FROM sqlite_master WHERE name='sessions'").all()).toEqual([]);
  db.close();
});

// Verifica que repetir una petición sin dar un id de sesión explícito no se reasigna a una sesión distinta aunque ahora existan varias candidatas; y que con varias candidatas ambiguas, una petición nueva sí falla (AMBIGUOUS_SESSION).
test("an omitted-ID replay is not reattached after candidates change", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions();
    const { projectId } = store.createProject("Replay");
    const input = { projectId, title: "Choice", content: "SQLite",
      type: "decision" as const, requestKey: "once" };
    const first = store.saveWithSession(input);
    store.startSession(projectId, "chat-a", "/tmp/replay-project");
    store.startSession(projectId, "chat-b", "/tmp/replay-project");
    const replay = store.saveWithSession(input, {
      mode: "assistant", runtimeDirectory: "/tmp/replay-project",
    });
    expect(replay.memory).toEqual(first.memory);
    expect(replay.sessionId).toBe(first.sessionId);
    expect(() => store.saveWithSession({ ...input, requestKey: "new" }, {
      mode: "assistant", runtimeDirectory: "/tmp/replay-project",
    })).toThrow("AMBIGUOUS_SESSION");
  } finally { store.close(); }
});

// Verifica que una sesión creada automáticamente como "manual" (sin sesión explícita ni inferida) no se puede cerrar directamente con endSession.
test("manual sessions cannot be ended directly", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions();
    const { projectId } = store.createProject("Manual");
    const result = store.saveWithSession({ projectId, title:"Note", content:"Body", type:"fact" });
    expect(result.sessionSource).toBe("manual");
    expect(() => store.endSession(projectId,result.sessionId!)).toThrow("manual");
  } finally { store.close(); }
});

// Verifica que en modo asistente, con una única sesión ligada a la carpeta de ejecución, se infiere esa sesión y se registra una sola marca de tiempo de petición, igual a la de actualización de la memoria.
test("assistant inference selects one bound runtime session and records one request clock", () => {
  const path=database(); const store=new MemoryStore(path);
  try {
    store.enableSessions(); const {projectId}=store.createProject("Infer");
    store.startSession(projectId,"chat","/tmp/infer");
    const result=store.saveWithSession({projectId,title:"Finding",content:"Found",type:"fact"},
      {mode:"assistant",runtimeDirectory:"/tmp/infer"});
    expect(result.sessionId).toBe("chat"); expect(result.sessionSource).toBe("inferred");
    const db=new Database(path,{readonly:true});
    const entry=db.query("SELECT recordedAt FROM session_entries WHERE memoryId=? AND version=1").get(result.memory.id) as {recordedAt:string};
    expect(entry.recordedAt).toBe(result.memory.updatedAt); db.close();
  } finally { store.close(); }
});

// Verifica que dar un sessionId explícito exige que exista y pertenezca al proyecto correcto, y que repetir una petición sobre una sesión ya cerrada funciona pero una petición nueva sobre ella falla.
test("explicit sessions enforce existence, ownership and closed replay ordering", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const one=store.createProject("One"),two=store.createProject("Two");
    store.startSession(one.projectId,"chat");
    expect(()=>store.saveWithSession({projectId:one.projectId,title:"X",content:"Y",type:"fact"},{sessionId:"missing"})).toThrow("Sesión no encontrada");
    expect(()=>store.saveWithSession({projectId:two.projectId,title:"X",content:"Y",type:"fact"},{sessionId:"chat"})).toThrow("este proyecto");
    const input={projectId:one.projectId,title:"X",content:"Y",type:"fact" as const,requestKey:"same"};
    const saved=store.saveWithSession(input,{sessionId:"chat"}); store.endSession(one.projectId,"chat");
    expect(store.saveWithSession(input,{sessionId:"chat"})).toEqual(saved);
    expect(()=>store.saveWithSession({...input,requestKey:"new"},{sessionId:"chat"})).toThrow("cerrada");
  } finally {store.close();}
});

// Verifica que actualizar el mismo tema desde una sesión distinta a la que lo creó conserva de qué sesión viene cada versión.
test("updating a topic in another session preserves each version origin", () => {
  const path=database(); const store=new MemoryStore(path);
  try {
    store.enableSessions(); const {projectId}=store.createProject("Versions");
    store.startSession(projectId,"first"); store.startSession(projectId,"second");
    const v1=store.saveWithSession({projectId,title:"A",content:"one",type:"fact",topicKey:"topic"},{sessionId:"first"});
    const v2=store.saveWithSession({projectId,title:"A",content:"two",type:"fact",topicKey:"topic",expectedVersion:1},{sessionId:"second"});
    const db=new Database(path,{readonly:true});
    expect(db.query("SELECT sessionId,version FROM session_entries WHERE memoryId=? ORDER BY version").all(v1.memory.id))
      .toEqual([{sessionId:"first",version:1},{sessionId:"second",version:2}]);
    expect(v2.memory.version).toBe(2); db.close();
  } finally {store.close();}
});

// Verifica que un resumen de sesión se renderiza con secciones fijas en un orden determinado, que su clave temática es fija (session/<id>/summary), y que una versión esperada equivocada se rechaza sin crear una versión nueva.
test("session summaries render fixed sections and update the pointer atomically", () => {
  const path=database(); const store=new MemoryStore(path);
  try {
    store.enableSessions(); const {projectId}=store.createProject("Summary"); store.startSession(projectId,"chat");
    const fields={goal:"Ship",instructions:"Keep tests",discoveries:"SQLite",accomplishments:"Built it",nextSteps:"Review",files:["a.ts","b.ts"]};
    const first=store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-1"});
    expect(first.memory.content).toBe("Goal:\nShip\n\nInstructions:\nKeep tests\n\nDiscoveries:\nSQLite\n\nAccomplishments:\nBuilt it\n\nNext steps:\nReview\n\nFiles:\na.ts\nb.ts");
    expect(first.memory.topicKey).toBe("session/chat/summary");
    expect(()=>store.saveSessionSummary(projectId,"chat",{...fields,goal:"Changed"},{requestKey:"stale",expectedVersion:2})).toThrow("versión esperada");
    const db=new Database(path,{readonly:true});
    expect(db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId='chat'").get()).toEqual({memoryId:first.memory.id,version:1});
    expect(db.query("SELECT count(*) AS n FROM memory_versions WHERE memory_id=?").get(first.memory.id)).toEqual({n:1}); db.close();
  } finally {store.close();}
});

// Verifica que repetir la petición de una versión antigua de un resumen (tras cerrar la sesión) nunca retrocede el puntero actual ni escribe ninguna tabla, aunque devuelva el resultado original.
test("replaying an older summary after close never rewinds its current pointer or writes any table", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const {projectId}=store.createProject("Replay summary"); store.startSession(projectId,"chat");
    const fields={goal:"One",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]};
    const first=store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-v1"});
    const second=store.saveSessionSummary(projectId,"chat",{...fields,goal:"Two"},{requestKey:"summary-v2",expectedVersion:1});
    store.endSession(projectId,"chat");
    const db=(store as unknown as {db:Database}).db; const before=sessionState(db);
    expect(store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-v1"})).toEqual(first);
    expect(sessionState(db)).toEqual(before);
    expect(db.query("SELECT memoryId,version FROM session_summaries WHERE sessionId='chat'").get())
      .toEqual({memoryId:second.memory.id,version:2});
  } finally {store.close();}
});

// Verifica que la clave temática reservada de un resumen (session/<id>/summary) no puede usarse para una memoria normal, ni antes de que exista la sesión ni ligada a ella, y que una memoria histórica que ya la usaba no se ve afectada.
test("summary topics are reserved without adopting or changing historical content", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const {projectId}=store.createProject("Reserved");
    const historical=store.saveWithSession({projectId,title:"Historical",content:"Keep",type:"fact",topicKey:"session/chat/summary"});
    store.startSession(projectId,"chat"); const db=(store as unknown as {db:Database}).db; const before=sessionState(db);
    const fields={goal:"Goal",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]};
    expect(()=>store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary"})).toThrow("reservado");
    expect(sessionState(db)).toEqual(before);
    expect(store.get(projectId,historical.memory.id)?.content).toBe("Keep");
    store.startSession(projectId,"other");
    expect(()=>store.saveWithSession({projectId,title:"General",content:"No",type:"fact",topicKey:"session/other/summary"},{sessionId:"other"})).toThrow("reservado");
  } finally {store.close();}
});

// Verifica que si falla insertar el puntero de resumen (session_summaries), se deshace también la memoria y todo lo demás que se hubiera escrito para ese guardado.
test("summary pointer insertion failure rolls back the memory, entry and every related write", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const {projectId}=store.createProject("Pointer failure"); store.startSession(projectId,"chat");
    const db=(store as unknown as {db:Database}).db; const before=sessionState(db);
    db.exec(`CREATE TEMP TRIGGER reject_summary BEFORE INSERT ON session_summaries BEGIN SELECT RAISE(ABORT,'pointer rejected'); END;`);
    expect(()=>store.saveSessionSummary(projectId,"chat",{goal:"Goal",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]},{requestKey:"summary"})).toThrow("pointer rejected");
    expect(sessionState(db)).toEqual(before);
  } finally {store.close();}
});

// Verifica que una sesión con fecha de inicio en el futuro sigue siendo elegible para la inferencia, mientras que una sesión sin carpeta de ejecución ligada no lo es (cae a manual).
test("future activity stays eligible while unbound runtime sessions do not", () => {
  const path=database(); let store=new MemoryStore(path);
  store.enableSessions(); const {projectId}=store.createProject("Clock");
  store.startSession(projectId,"future","/tmp/clock"); store.startSession(projectId,"imported"); store.close();
  const db=new Database(path); db.query("UPDATE sessions SET startedAt=? WHERE sessionId='future'").run("2099-01-01T00:00:00.000Z"); db.close();
  store=new MemoryStore(path);
  try {
    const inferred=store.saveWithSession({projectId,title:"Future",content:"Eligible",type:"fact"},{mode:"assistant",runtimeDirectory:"/tmp/clock"});
    expect(inferred.sessionId).toBe("future");
    const manual=store.saveWithSession({projectId,title:"Unbound",content:"Manual",type:"fact"},{mode:"assistant",runtimeDirectory:"/tmp/other"});
    expect(manual.sessionSource).toBe("manual"); expect(manual.sessionId).not.toBe("imported");
  } finally {store.close();}
});

// Verifica el borde exacto de la ventana de siete días de actividad: justo en el borde y un milisegundo después se infiere la sesión, un milisegundo antes del borde no (cae a manual).
test("public saves include seven-day exact and plus-one activity but exclude minus one millisecond", () => {
  const store=new MemoryStore(":memory:");
  try {
    setSystemTime(new Date("2026-09-17T12:00:00.000Z")); store.enableSessions();
    const old=store.createProject("Old"),edge=store.createProject("Edge"),fresh=store.createProject("Fresh");
    store.startSession(old.projectId,"old","/tmp/old"); store.startSession(edge.projectId,"edge","/tmp/edge"); store.startSession(fresh.projectId,"fresh","/tmp/fresh");
    const db=(store as unknown as {db:Database}).db;
    db.query("UPDATE sessions SET startedAt=? WHERE sessionId='edge'").run("2026-09-10T12:00:00.000Z");
    db.query("UPDATE sessions SET startedAt=? WHERE sessionId='old'").run("2026-09-10T11:59:59.999Z");
    db.query("UPDATE sessions SET startedAt=? WHERE sessionId='fresh'").run("2026-09-10T12:00:00.001Z");
    expect(store.saveWithSession({projectId:old.projectId,title:"Old",content:"Old",type:"fact"},{mode:"assistant",runtimeDirectory:"/tmp/old"}).sessionSource).toBe("manual");
    expect(store.saveWithSession({projectId:edge.projectId,title:"Edge",content:"Edge",type:"fact"},{mode:"assistant",runtimeDirectory:"/tmp/edge"}).sessionId).toBe("edge");
    expect(store.saveWithSession({projectId:fresh.projectId,title:"Fresh",content:"Fresh",type:"fact"},{mode:"assistant",runtimeDirectory:"/tmp/fresh"}).sessionId).toBe("fresh");
  } finally {store.close();}
});

// Verifica que una memoria guardada sin sesión (heredada) sigue sin sesión al repetirla, que no se le puede asociar una sesión después, y que asociar la misma petición a una sesión distinta de la que ya tenía también falla.
test("explicit replay cannot move an association and legacy unassociated replay stays unassociated", () => {
  const store=new MemoryStore(":memory:");
  try {
    const {projectId}=store.createProject("Origins");
    const legacyInput={projectId,title:"Legacy",content:"Body",type:"fact" as const,requestKey:"legacy"};
    const legacy=store.save(legacyInput); store.enableSessions(); store.startSession(projectId,"one"); store.startSession(projectId,"two");
    const db=(store as unknown as {db:Database}).db; const beforeLegacy=sessionState(db);
    expect(store.saveWithSession(legacyInput)).toEqual({memory:legacy,sessionId:null,sessionSource:null});
    expect(sessionState(db)).toEqual(beforeLegacy);
    expect(()=>store.saveWithSession(legacyInput,{sessionId:"one"})).toThrow("asociación");
    const input={projectId,title:"New",content:"Body",type:"fact" as const,requestKey:"new"};
    store.saveWithSession(input,{sessionId:"one"}); const beforeConflict=sessionState(db);
    expect(()=>store.saveWithSession(input,{sessionId:"two"})).toThrow("asociación");
    expect(sessionState(db)).toEqual(beforeConflict);
  } finally {store.close();}
});

// Verifica que repetir la petición de una memoria compartida ligada a una sesión oculta esa sesión si no se pasa el proyecto dueño correcto (o se pasa uno distinto).
test("shared replay hides its private origin without matching owner context", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const one=store.createProject("One"),other=store.createProject("Other"); store.startSession(one.projectId,"chat");
    const input={scope:"shared" as const,projectId:null,title:"Shared",content:"Public body",type:"fact" as const,requestKey:"shared-once"};
    const saved=store.saveWithSession(input,{sessionId:"chat",projectId:one.projectId}); expect(saved.sessionId).toBe("chat");
    expect(store.saveWithSession(input).sessionId).toBeNull();
    expect(store.saveWithSession(input,{projectId:other.projectId}).sessionId).toBeNull();
  } finally {store.close();}
});

// Verifica que dos procesos separados que guardan al mismo tiempo, sin sesión explícita, convergen en una sola sesión manual registrada, no en dos.
test("competing process writers converge on one manual registry session", async () => {
  const path=database(); const setup=new MemoryStore(path); setup.enableSessions(); const {projectId}=setup.createProject("Race"); setup.close();
  const script=`import {MemoryStore} from './src/index.ts';
    const [path,projectId,title]=process.argv.slice(-3); const store=new MemoryStore(path);
    try { const saved=store.saveWithSession({projectId,title,content:title,type:'fact'}); console.log(saved.sessionId); }
    finally { store.close(); }`;
  const processes=["A","B"].map(title=>Bun.spawn([process.execPath,"-e",script,path,projectId,title],{cwd:process.cwd(),stdout:"pipe",stderr:"pipe"}));
  const results=await Promise.all(processes.map(async child=>({code:await child.exited,out:(await new Response(child.stdout).text()).trim(),err:(await new Response(child.stderr).text()).trim()})));
  expect(results.map(result=>result.code)).toEqual([0,0]);
  expect(results[0]!.err+results[1]!.err).toBe(""); expect(results[0]!.out).toBe(results[1]!.out);
  const db=new Database(path,{readonly:true});
  expect(db.query("SELECT count(*) AS n FROM local_manual_sessions").get()).toEqual({n:1});
  expect(db.query("SELECT count(*) AS n FROM sessions WHERE kind='manual'").get()).toEqual({n:1}); db.close();
});

// Verifica que si falla escribir la entrada de sesión (session_entries), se deshacen también la memoria, su historial, el evento y la petición asociados.
test("an association SQL failure rolls back memory, history, event and request writes", () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSessions(); const {projectId}=store.createProject("Rollback"); store.startSession(projectId,"chat");
    const db=(store as unknown as {db:Database}).db;
    db.exec(`CREATE TEMP TRIGGER reject_entry BEFORE INSERT ON session_entries BEGIN SELECT RAISE(ABORT,'entry rejected'); END;`);
    expect(()=>store.saveWithSession({projectId,title:"No",content:"Writes",type:"fact",requestKey:"rollback"},{sessionId:"chat"})).toThrow("entry rejected");
    for (const table of ["memories","memory_versions","events","requests","session_entries"]) {
      expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({n:0});
    }
  } finally {store.close();}
});
