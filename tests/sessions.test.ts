import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../src/index";
import { enableSessionLifecycle } from "../src/schema";
import { normalizeSnapshot } from "../src/sync-snapshot";

const directories: string[] = [];
function database(): string {
  const directory = mkdtempSync(join(tmpdir(),"forge614-sessions-"));
  directories.push(directory); return join(directory,"memory.sqlite");
}
afterEach(() => { setSystemTime(); for (const directory of directories.splice(0)) rmSync(directory,{recursive:true,force:true}); });

function sessionState(db: Database): Record<string,unknown[]> {
  const result: Record<string,unknown[]> = {};
  for (const table of ["memories","memory_versions","events","requests","sessions","session_entries","session_summaries","local_manual_sessions"]) {
    result[table]=db.query(`SELECT * FROM ${table} ORDER BY 1,2`).all();
  }
  return result;
}

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

test.each([3,4,5] as const)("schema %d enrolls additively without changing saved memory", version => {
  const path = database();
  const first = new MemoryStore(path); const project = first.createProject("Demo");
  const saved = first.save({projectId:project.projectId,title:"Keep",content:"History",type:"fact",requestKey:"request-1"});
  if (version >= 4) first.enableSync();
  if (version >= 5) first.enableAssistantIntegration();
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

test("schema 6 reopens exactly and older enrollment facades accept it", () => {
  const path = database(); const first = new MemoryStore(path); first.enableSessions(); first.close();
  const reopened = new MemoryStore(path);
  try {
    expect(reopened.sessionsEnabled()).toBe(true);
    reopened.enableSync(); reopened.enableAssistantIntegration(); reopened.enableSessions();
  } finally { reopened.close(); }
});

test("a malformed enrollment candidate remains byte-for-byte unchanged", () => {
  const path = database(); const store = new MemoryStore(path); store.close();
  const db = new Database(path); db.exec("DROP TRIGGER memory_update"); db.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

test("a migration failure rolls back every session table and the version bump", () => {
  const path = database(); const store = new MemoryStore(path); store.enableAssistantIntegration(); store.close();
  const db = new Database(path); const execute = db.exec.bind(db);
  Object.defineProperty(db,"exec",{value:(sql:string) => execute(sql.includes("CREATE TABLE sessions")
    ? sql.replace("CREATE INDEX sessions_project_started", "THIS IS NOT SQL; CREATE INDEX sessions_project_started") : sql)});
  expect(() => enableSessionLifecycle(db)).toThrow();
  expect(db.query("PRAGMA user_version").get()).toEqual({user_version:5});
  expect(db.query("SELECT name FROM sqlite_master WHERE name='sessions'").all()).toEqual([]);
  db.close();
});

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
