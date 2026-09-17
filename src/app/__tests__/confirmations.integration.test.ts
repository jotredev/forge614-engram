import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory-store";

const directories:string[]=[];
function fixture():string {const dir=mkdtempSync(join(tmpdir(),"engram-confirmations-"));directories.push(dir);return join(dir,"engram.db");}
afterEach(()=>{setSystemTime();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

test("enrollment turns an exact save into one immutable confirmation", () => {
  const path=fixture();const store=new MemoryStore(path);
  try {
    const projectId=store.createProject("Owner").projectId;
    store.enableSearchReinforcement();
    const first=store.save({projectId,title:" Queue ",content:" Use jobs ",type:"decision",requestKey:"first"});
    expect(store.save({projectId,title:"Queue",content:"Use jobs",type:"decision",requestKey:"first"})).toEqual(first);
    const again=store.save({projectId,title:"Queue",content:"Use jobs",type:"decision",requestKey:"again"});
    expect(again).toEqual(first);
    expect(store.history(projectId,first.id)).toHaveLength(1);
    expect(store.listProjects()).toHaveLength(1);
    const db=new Database(path,{readonly:true});
    try {
      const rows=db.query("SELECT memoryId,version,sessionId FROM confirmations").all() as {memoryId:string;version:number;sessionId:string|null}[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.memoryId).toBe(first.id);
      expect(rows[0]?.version).toBe(1);
      expect(rows[0]?.sessionId).not.toBeNull();
      expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({n:1});
      expect(db.query("SELECT count(*) AS n FROM session_entries").get()).toEqual({n:1});
    } finally {db.close();}
  } finally {store.close();}
});

test("legacy schemas keep duplicate saves as independent records", () => {
  const store=new MemoryStore(":memory:");
  try {
    const projectId=store.createProject("Legacy").projectId;
    const input={projectId,title:"Queue",content:"Use jobs",type:"decision" as const};
    const first=store.save(input),again=store.save(input);
    expect(again.id).not.toBe(first.id);
    expect(store.history(projectId,first.id)).toHaveLength(1);
    expect(store.history(projectId,again.id)).toHaveLength(1);
  } finally {store.close();}
});

test("confirmation replay precedes later revision and archive checks", () => {
  const path=fixture(),store=new MemoryStore(path);
  try {
    const projectId=store.createProject("Replay").projectId;store.enableSearchReinforcement();
    const input={projectId,title:"Queue",content:"Use jobs",type:"decision" as const,topicKey:"queue"};
    const first=store.save({...input,requestKey:"create"});
    const confirmed=store.save({...input,expectedVersion:1,requestKey:"confirm"});
    expect(confirmed).toEqual(first);
    expect(store.save({...input,content:"Use durable jobs",expectedVersion:1,requestKey:"update"}).version).toBe(2);
    store.archive(projectId,first.id);
    expect(store.save({...input,expectedVersion:1,requestKey:"confirm"})).toEqual(first);
    expect(()=>store.save({...input,content:"Changed",expectedVersion:1,requestKey:"confirm"})).toThrow(expect.objectContaining({code:"REQUEST_CONFLICT"}));
    const db=new Database(path,{readonly:true});
    try {
      expect(db.query("SELECT count(*) AS n FROM confirmations").get()).toEqual({n:1});
      const request=db.query("SELECT expectedVersion,response FROM confirmation_requests WHERE requestKey='confirm'").get() as {expectedVersion:number|null;response:string};
      expect(request.expectedVersion).toBe(1);
      expect(JSON.parse(request.response).memory).toEqual(first);
    } finally {db.close();}
  } finally {store.close();}
});

test("topic confirmation requires the current version and never revives archives", () => {
  const store=new MemoryStore(":memory:");
  try {
    const projectId=store.createProject("Topics").projectId;store.enableSearchReinforcement();
    const input={projectId,title:"Queue",content:"Use jobs",type:"decision" as const,topicKey:"queue"};
    const first=store.save(input);
    expect(()=>store.save(input)).toThrow(expect.objectContaining({code:"VERSION_CONFLICT"}));
    expect(store.save({...input,expectedVersion:1})).toEqual(first);
    const second=store.save({...input,content:"Use durable jobs",expectedVersion:1});
    expect(()=>store.save({...input,content:"Use durable jobs",expectedVersion:1})).toThrow(expect.objectContaining({code:"VERSION_CONFLICT"}));
    store.archive(projectId,second.id);
    expect(()=>store.save({...input,content:"Use durable jobs",expectedVersion:2})).toThrow(expect.objectContaining({code:"ARCHIVED"}));
  } finally {store.close();}
});

test("topic confirmation rejects a clock older than the confirmed version without writes", () => {
  setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
  const path=fixture(),store=new MemoryStore(path);
  try {
    const projectId=store.createProject("Clock skew").projectId;store.enableSearchReinforcement();
    const input={projectId,title:"Queue",content:"Use jobs",type:"decision" as const,topicKey:"queue"};
    store.save(input);
    setSystemTime(new Date("2026-09-17T11:59:59.999Z"));
    expect(()=>store.save({...input,expectedVersion:1,requestKey:"confirm"})).toThrow(expect.objectContaining({code:"CLOCK_SKEW"}));
    const db=new Database(path,{readonly:true});
    try {
      expect(db.query("SELECT count(*) AS n FROM confirmations").get()).toEqual({n:0});
      expect(db.query("SELECT count(*) AS n FROM confirmation_requests").get()).toEqual({n:0});
      expect(db.query("SELECT count(*) AS n FROM memory_versions").get()).toEqual({n:1});
    } finally {db.close();}
  } finally {store.close();}
});

test("request keys are unique across save branches but remain isolated by owner", () => {
  const path=fixture(),store=new MemoryStore(path);
  try {
    const one=store.createProject("One"),two=store.createProject("Two");store.enableSearchReinforcement();
    const base={title:"Queue",content:"Use jobs",type:"decision" as const};
    store.save({projectId:one.projectId,...base});
    store.save({projectId:one.projectId,...base,requestKey:"cross"});
    expect(()=>store.save({projectId:one.projectId,...base,content:"Changed",requestKey:"cross"})).toThrow(expect.objectContaining({code:"REQUEST_CONFLICT"}));
    expect(store.save({projectId:two.projectId,...base,requestKey:"cross"}).projectId).toBe(two.projectId);
    expect(store.save({scope:"shared",projectId:null,...base,requestKey:"cross"}).scope).toBe("shared");
    expect(store.history(one.projectId,store.search(one.projectId,"Use jobs",10,"project")[0]!.memory.id)).toHaveLength(1);
  } finally {store.close();}
});

test("confirmation window includes exactly 900000 ms and excludes older or future candidates", () => {
  setSystemTime(new Date("2026-09-17T11:45:00.000Z"));
  const store=new MemoryStore(":memory:");
  try {
    const projectId=store.createProject("Clock").projectId;store.enableSearchReinforcement();
    const boundary=store.save({projectId,title:"Boundary",content:"Body",type:"fact"});
    setSystemTime(new Date("2026-09-17T11:44:59.999Z"));
    const old=store.save({projectId,title:"Old",content:"Body",type:"fact"});
    setSystemTime(new Date("2026-09-17T12:00:00.001Z"));
    const future=store.save({projectId,title:"Future",content:"Body",type:"fact"});
    setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
    expect(store.save({projectId,title:"Boundary",content:"Body",type:"fact"}).id).toBe(boundary.id);
    expect(store.save({projectId,title:"Old",content:"Body",type:"fact"}).id).not.toBe(old.id);
    expect(store.save({projectId,title:"Future",content:"Body",type:"fact"}).id).not.toBe(future.id);
  } finally {store.close();}
});

test("confirmation sessions validate ownership and closure without adding timeline entries", () => {
  const path=fixture(),store=new MemoryStore(path);
  try {
    const one=store.createProject("One"),two=store.createProject("Two");store.enableSearchReinforcement();
    store.startSession(one.projectId,"one");store.startSession(two.projectId,"two");
    const input={projectId:one.projectId,title:"Queue",content:"Use jobs",type:"decision" as const,topicKey:"queue"};
    const first=store.saveWithSession({...input,requestKey:"create"},{sessionId:"one"});
    const confirmed=store.saveWithSession({...input,expectedVersion:1,requestKey:"confirm"},{sessionId:"one"});
    expect(confirmed).toEqual(first);
    expect(()=>store.saveWithSession({...input,expectedVersion:1,requestKey:"wrong"},{sessionId:"two"})).toThrow(expect.objectContaining({code:"SESSION_NOT_FOUND"}));
    store.endSession(one.projectId,"one");
    expect(store.saveWithSession({...input,expectedVersion:1,requestKey:"confirm"},{sessionId:"one"})).toEqual(first);
    expect(()=>store.saveWithSession({...input,expectedVersion:1,requestKey:"closed"},{sessionId:"one"})).toThrow(expect.objectContaining({code:"SESSION_CLOSED"}));
    const db=new Database(path,{readonly:true});
    try {
      expect(db.query("SELECT count(*) AS n FROM session_entries").get()).toEqual({n:1});
      expect(db.query("SELECT sessionId FROM confirmations").get()).toEqual({sessionId:"one"});
    } finally {db.close();}
  } finally {store.close();}
});

test("shared confirmations work without a session and do not expose project ownership", () => {
  const path=fixture(),store=new MemoryStore(path);
  try {
    store.enableSearchReinforcement();
    const input={scope:"shared" as const,projectId:null,title:"Shared",content:"Public",type:"fact" as const};
    const first=store.saveWithSession(input),confirmed=store.saveWithSession({...input,requestKey:"confirm"});
    expect(confirmed).toEqual({memory:first.memory,sessionId:null,sessionSource:null});
    const db=new Database(path,{readonly:true});
    try {expect(db.query("SELECT sessionId FROM confirmations").get()).toEqual({sessionId:null});} finally {db.close();}
  } finally {store.close();}
});

test("shared confirmation replay reveals its session only to the associated project", () => {
  const store=new MemoryStore(":memory:");
  try {
    const projectId=store.createProject("Owner").projectId;store.enableSearchReinforcement();store.startSession(projectId,"chat");
    const input={scope:"shared" as const,projectId:null,title:"Shared session",content:"Public",type:"fact" as const};
    const first=store.saveWithSession(input,{sessionId:"chat",projectId});
    const confirmed=store.saveWithSession({...input,requestKey:"confirm"},{sessionId:"chat",projectId});
    expect(confirmed).toEqual(first);
    expect(store.saveWithSession({...input,requestKey:"confirm"})).toEqual({memory:first.memory,sessionId:null,sessionSource:null});
    expect(store.saveWithSession({...input,requestKey:"confirm"},{projectId})).toEqual(first);
  } finally {store.close();}
});

test("repeated session summaries confirm without moving their version pointer", () => {
  const path=fixture(),store=new MemoryStore(path);
  try {
    const projectId=store.createProject("Summary").projectId;store.enableSearchReinforcement();store.startSession(projectId,"chat");
    const fields={goal:"Goal",instructions:"Do it",discoveries:"Found",accomplishments:"Done",nextSteps:"Next",files:["a.ts"]};
    const first=store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-1"});
    const confirmed=store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-2",expectedVersion:1});
    expect(confirmed).toEqual(first);
    expect(store.history(projectId,first.memory.id)).toHaveLength(1);
    const changed={...fields,goal:"Changed"};
    const revised=store.saveSessionSummary(projectId,"chat",changed,{requestKey:"summary-3",expectedVersion:1});
    expect(revised.memory.version).toBe(2);
    expect(store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-2",expectedVersion:1})).toEqual(first);
    store.endSession(projectId,"chat");
    expect(store.saveSessionSummary(projectId,"chat",fields,{requestKey:"summary-2",expectedVersion:1})).toEqual(first);
    const db=new Database(path,{readonly:true});
    try {expect(db.query("SELECT memoryId,version FROM session_summaries").get()).toEqual({memoryId:first.memory.id,version:2});} finally {db.close();}
  } finally {store.close();}
});

test("reinforcement remains enabled after reopening", () => {
  const path=fixture();let store=new MemoryStore(path);const projectId=store.createProject("Reopen").projectId;
  store.enableSearchReinforcement();const first=store.save({projectId,title:"Queue",content:"Use jobs",type:"decision"});store.close();
  store=new MemoryStore(path,{create:false});
  try {expect(store.reinforcementEnabled()).toBe(true);expect(store.save({projectId,title:"Queue",content:"Use jobs",type:"decision"})).toEqual(first);} finally {store.close();}
});

test("simultaneous same-key requests across connections create one confirmation", async () => {
  const path=fixture(),setup=new MemoryStore(path);const projectId=setup.createProject("Race").projectId;setup.enableSearchReinforcement();
  setup.save({projectId,title:"Queue",content:"Use jobs",type:"decision"});setup.close();
  const input={projectId,title:"Queue",content:"Use jobs",type:"decision",requestKey:"same"};
  const script=`import {MemoryStore} from './src/app/memory-store.ts';const s=new MemoryStore(process.argv[1],{create:false});try{console.log(JSON.stringify(s.save(JSON.parse(process.argv[2]))));}finally{s.close();}`;
  const children=[1,2].map(()=>Bun.spawn({cmd:["bun","-e",script,path,JSON.stringify(input)],cwd:process.cwd(),stdout:"pipe",stderr:"pipe"}));
  const codes=await Promise.all(children.map(child=>child.exited));
  expect(codes).toEqual([0,0]);
  const outputs=await Promise.all(children.map(child=>new Response(child.stdout).text()));
  expect(JSON.parse(outputs[0]!)).toEqual(JSON.parse(outputs[1]!));
  const db=new Database(path,{readonly:true});
  try {expect(db.query("SELECT count(*) AS n FROM confirmations").get()).toEqual({n:1});} finally {db.close();}
});
