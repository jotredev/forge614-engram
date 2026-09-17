import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { MemoryStore } from "../src/store";
import { PostgresReplica, postgresOptions } from "../src/sync-postgres";
import { synchronize } from "../src/synchronize";
import { runSetup } from "../src/setup";
import { WorkspaceConfig } from "../src/workspace-config";
import { MemoryWorkspace } from "../src/workspace";
import { syncWorkspace } from "../src/sync-runner";
import { canonical, normalizeSnapshot, snapshotHash } from "../src/sync-snapshot";

// Explicit test-only local binaries. Never use DATABASE_URL or a user's database.
const bin=process.env.FORGE614_TEST_POSTGRES_BIN;
const integration=bin?test:test.skip;
let directory="",url="",admin:SQL;
function command(name:string,args:string[]) {
  const result=Bun.spawnSync([join(bin!,name),...args],{stdout:"pipe",stderr:"pipe"});
  if(result.exitCode!==0) throw new Error(result.stderr.toString());
}
beforeAll(async()=>{
  if(!bin) return;
  directory=mkdtempSync(join(tmpdir(),"forge614-pg-test-"));
  command("initdb",["-D",join(directory,"data"),"-U","postgres","-A","trust","--no-locale","--encoding=UTF8"]);
  // Ask the OS for a free loopback port; start immediately. A collision fails safely.
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}); const port=listener.port;listener.stop(true);
  command("pg_ctl",["-D",join(directory,"data"),"-l",join(directory,"log"),"-o",`-h 127.0.0.1 -p ${port} -k ${directory}`,"-w","start"]);
  url=`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;admin=new SQL(url);
},30000);
afterAll(async()=>{
  if(!bin||!directory) return;
  if(admin) await admin.close();
  try { command("pg_ctl",["-D",join(directory,"data"),"-m","fast","-w","stop"]); }
  finally { rmSync(directory,{recursive:true,force:true}); }
},30000);

test("PostgreSQL URL parsing rejects ambiguous URLs and insecure remote TLS without leaking input",()=>{
  for(const input of ["mysql://host/db","postgresql://host/db","postgresql://u:SECRET@remote/db?sslmode=disable","postgresql://u:SECRET@remote/db?options=bad"]) {
    try { postgresOptions(input); throw new Error("accepted"); } catch(error) { expect(String(error)).not.toContain("SECRET");expect(String(error)).toContain("POSTGRES_URL"); }
  }
  expect(postgresOptions("postgresql://u:p@127.0.0.1/db?sslmode=disable").tls).toBe(false);
  expect(postgresOptions("postgresql://u:p@example.org/db").tls).toMatchObject({rejectUnauthorized:true});
});

integration("format promotion requires explicit consent, preserves historical CAS hashes and rejects incapable clients before publication",async()=>{
  await admin.unsafe("CREATE DATABASE session_promotion");
  const testUrl=url.replace("/postgres?","/session_promotion?");
  const replica=await PostgresReplica.connect(testUrl,true),inspect=new SQL(testUrl);
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:"),old=new MemoryStore(":memory:");
  try {
    a.enableSync();b.enableSync();old.enableSync();
    const project=a.createProject("Preserved");a.save({projectId:project.projectId,title:"Legacy",content:"old body",type:"fact",requestKey:"old-request"});
    await synchronize(a,replica);await synchronize(b,replica);await synchronize(old,replica);
    const initial=await replica.read();expect(initial.snapshot.format).toBe(1);
    const history=await inspect.unsafe("SELECT hash,payload FROM forge614_sync.revisions ORDER BY hash");
    const oldCheckpoint=a.syncCheckpoint(replica.id);
    a.enableSessions();a.startSession(project.projectId,"runtime","/local/private");
    const entry=a.saveWithSession({projectId:project.projectId,title:"New",content:"new body",type:"fact"},{sessionId:"runtime"});
    const before=a.syncSnapshot();
    await expect(synchronize(a,replica)).rejects.toMatchObject({code:"SYNC_UPGRADE_REQUIRED"});
    expect((await replica.read()).hash).toBe(initial.hash);
    expect(a.syncSnapshot()).toEqual(before);expect(a.syncCheckpoint(replica.id)).toEqual(oldCheckpoint);
    await synchronize(a,replica,{upgradeFormat:true});
    const promoted=await replica.read();expect(promoted.snapshot.format).toBe(2);
    expect(normalizeSnapshot(promoted.snapshot).sessionEntries).toHaveLength(1);
    expect(JSON.stringify(promoted.snapshot)).not.toContain("/local/private");
    expect((await inspect.unsafe("SELECT format FROM forge614_sync.state"))[0].format).toBe(1);
    for(const row of history) expect((await inspect.unsafe("SELECT payload FROM forge614_sync.revisions WHERE hash=$1",[row.hash]))[0].payload).toBe(row.payload);
    const oldBefore=old.syncSnapshot();old.createProject("would-publish");const oldDirty=old.syncSnapshot();
    await expect(synchronize(old,replica,{upgradeFormat:true})).rejects.toMatchObject({code:"SESSIONS_REQUIRED"});
    expect((await replica.read()).hash).toBe(promoted.hash);expect(old.syncSnapshot()).toEqual(oldDirty);
    expect(old.syncCheckpoint(replica.id)).toEqual(oldBefore);
    b.enableSessions();await synchronize(b,replica);
    expect(b.get(project.projectId,entry.memory.id)!.content).toBe("new body");expect(b.getSession(project.projectId,"runtime")).not.toBeNull();
    expect(b.syncCheckpoint(replica.id).format).toBe(2);
    // Publication committed but application/checkpoint was interrupted. Retry keeps the old checkpoint valid.
    a.saveWithSession({projectId:project.projectId,title:"Interrupted",content:"retry",type:"fact"},{sessionId:"runtime"});
    const checkpoint=a.syncCheckpoint(replica.id);const head=await replica.read();
    await replica.publish(head.hash,a.syncSnapshot());
    expect(a.syncCheckpoint(replica.id)).toEqual(checkpoint);
    await synchronize(a,replica);await synchronize(b,replica);
    expect(b.search(project.projectId,"retry")).toHaveLength(1);
  }finally{a.close();b.close();old.close();await replica.close();await inspect.close();}
});

integration("simultaneous format promotions have one CAS winner, leave loser unapplied and retain storage format1",async()=>{
  await admin.unsafe("CREATE DATABASE session_race");
  const testUrl=url.replace("/postgres?","/session_race?");
  const left=await PostgresReplica.connect(testUrl,true),right=await PostgresReplica.connect(testUrl),inspect=new SQL(testUrl);
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:");
  try {
    a.enableSessions();b.enableSessions();a.createProject("A");b.createProject("B");
    // Both readers receive the real initial head before either coordinator may publish.
    let readers=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
    for(const replica of [left,right]) {const read=replica.read.bind(replica);replica.read=async()=>{const head=await read();if(++readers===2) release();await barrier;return head;};}
    const result=await Promise.allSettled([synchronize(a,left,{upgradeFormat:true}),synchronize(b,right,{upgradeFormat:true})]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const loser=result[0]!.status==="rejected"?a:b;
    expect(result.find(r=>r.status==="rejected")).toMatchObject({reason:{code:"SYNC_REMOTE_CHANGED"}});
    expect(loser.listProjects()).toHaveLength(1);expect(loser.syncCheckpoint(left.id).format).toBe(1);
    expect((await inspect.unsafe("SELECT format FROM forge614_sync.state"))[0].format).toBe(1);
    expect((await inspect.unsafe("SELECT count(*)::int AS n FROM forge614_sync.revisions"))[0].n).toBe(2);
    await synchronize(a,left);await synchronize(b,right);await synchronize(a,left);
    expect(a.listProjects()).toHaveLength(2);expect(b.listProjects()).toHaveLength(2);
  }finally{a.close();b.close();await left.close();await right.close();await inspect.close();}
});

integration("remote snapshot size is bounded before parsing and before publishing",async()=>{
  await admin.unsafe("CREATE DATABASE snapshot_limits");
  const testUrl=url.replace("/postgres?","/snapshot_limits?");
  const replica=await PostgresReplica.connect(testUrl,true),inspect=new SQL(testUrl),local=new MemoryStore(":memory:"),remote=new MemoryStore(":memory:");
  try {
    const head=await replica.read();
    const huge=normalizeSnapshot(structuredClone(head.snapshot));
    huge.projects.push({projectId:crypto.randomUUID(),name:"x".repeat(8*1024*1024),createdAt:"2026-09-17T00:00:00.000Z",updatedAt:"2026-09-17T00:00:00.000Z"});
    await expect(replica.publish(head.hash,huge)).rejects.toMatchObject({code:"SYNC_TOO_LARGE"});
    expect((await replica.read()).hash).toBe(head.hash);
    // Invalid JSON must produce the size error first, proving it was not parsed.
    await inspect.unsafe("UPDATE forge614_sync.revisions SET payload=$1 WHERE hash=$2",["x".repeat(8*1024*1024+1),head.hash]);
    await expect(replica.read()).rejects.toMatchObject({code:"SYNC_TOO_LARGE"});
    const restored=await inspect.unsafe("UPDATE forge614_sync.revisions SET payload=$1 WHERE hash=$2 RETURNING length(payload)::int AS n",[canonical(head.snapshot),head.hash]);
    expect(restored[0].n).toBeLessThan(1024);
    expect((await replica.read()).hash).toBe(snapshotHash(head.snapshot));
    local.enableSessions();remote.enableSessions();
    local.save({scope:"shared",projectId:null,title:"local",content:"a".repeat(2.1*1024*1024),type:"fact"});
    remote.save({scope:"shared",projectId:null,title:"remote",content:"b".repeat(2.1*1024*1024),type:"fact"});
    await synchronize(remote,replica,{upgradeFormat:true});
    const published=await replica.read(),before=local.syncSnapshot();
    await expect(synchronize(local,replica)).rejects.toMatchObject({code:"SYNC_TOO_LARGE"});
    expect((await replica.read()).hash).toBe(published.hash);expect(local.syncSnapshot()).toEqual(before);
    expect(local.syncCheckpoint(replica.id).format).toBe(1);
  }finally{local.close();remote.close();await replica.close();await inspect.close();}
});

integration("two SQLite installations synchronize via real PostgreSQL, replays and conflicts preserve data",async()=>{
  const replica=await PostgresReplica.connect(url,true);
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:");
  try {
    a.enableSync();b.enableSync();const p=a.createProject("Project");
    const m=a.save({projectId:p.projectId,title:"SQLite",content:"first",type:"fact",topicKey:"db",requestKey:"same"});
    await synchronize(a,replica); await synchronize(b,replica);
    expect(b.get(p.projectId,m.id)!.content).toBe("first");
    expect(b.search(p.projectId,"SQLite")).toHaveLength(1);
    await synchronize(a,replica);await synchronize(b,replica);
    expect(b.history(p.projectId,m.id)).toHaveLength(1);
    // Simulate a committed publication whose response/local checkpoint was lost.
    a.save({scope:"shared",projectId:null,title:"Replay",content:"survives retry",type:"fact"});
    const before=await replica.read();await replica.publish(before.hash,a.syncSnapshot());
    await synchronize(a,replica);await synchronize(b,replica);
    expect(b.search(null,"survives",10,"shared")).toHaveLength(1);
    // A local writer races with a published round: do not apply its stale snapshot.
    const captured=a.syncSnapshot();const head=await replica.read();
    await replica.publish(head.hash,captured);a.createProject("Concurrent local writer");
    expect(()=>a.applySync(captured,captured,replica.id)).toThrow("SYNC_LOCAL_CHANGED");
    await synchronize(a,replica);await synchronize(b,replica);
    expect(b.listProjects()).toHaveLength(2);
    a.save({projectId:p.projectId,title:"SQLite",content:"left",type:"fact",topicKey:"db",expectedVersion:1});
    b.save({projectId:p.projectId,title:"SQLite",content:"right",type:"fact",topicKey:"db",expectedVersion:1});
    await synchronize(a,replica);
    await expect(synchronize(b,replica)).rejects.toMatchObject({code:"SYNC_CONFLICT"});
    expect(b.get(p.projectId,m.id)!.content).toBe("right");
    expect(a.get(p.projectId,m.id)!.content).toBe("left");
    const again=await PostgresReplica.connect(url,false);await again.close();
  } finally {a.close();b.close();await replica.close();}
});

integration("PostgreSQL publishes only one winner for a concurrent head and rejects altered schema",async()=>{
  const replica=await PostgresReplica.connect(url,false);
  try {
    const head=await replica.read();
    const a=structuredClone(head.snapshot),b=structuredClone(head.snapshot);
    const now=new Date().toISOString();
    a.projects.push({projectId:crypto.randomUUID(),name:"A",createdAt:now,updatedAt:now});
    b.projects.push({projectId:crypto.randomUUID(),name:"B",createdAt:now,updatedAt:now});
    a.projects.sort((x,y)=>x.projectId.localeCompare(y.projectId));b.projects.sort((x,y)=>x.projectId.localeCompare(y.projectId));
    const results=await Promise.allSettled([replica.publish(head.hash,a),replica.publish(head.hash,b)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    await admin.unsafe("ALTER TABLE forge614_sync.revisions ADD COLUMN unexpected text");
    await expect(PostgresReplica.connect(url,true)).rejects.toMatchObject({code:"POSTGRES_SCHEMA"});
    const rows=await admin.unsafe("SELECT count(*)::int AS n FROM forge614_sync.revisions");
    expect(rows[0].n).toBeGreaterThan(0);
  } finally {await replica.close();}
});

integration("setup refuses an incompatible PostgreSQL schema without publishing config or creating SQLite",async()=>{
  const config=new WorkspaceConfig(join(directory,"refused-user",".forge614"));
  const answers=["si",url,"si"];
  await expect(runSetup({write(){},ask:async()=>answers.shift()??null},config)).rejects.toMatchObject({code:"POSTGRES_SCHEMA"});
  expect(existsSync(config.root)).toBe(false);
});

integration("configured CLI stays local offline and sync failure preserves the same SQLite data",async()=>{
  // Fresh database, never a user service. Earlier tests intentionally corrupted postgres schema.
  await admin.unsafe("CREATE DATABASE setup_test");
  const testUrl=url.replace("/postgres?","/setup_test?");
  const user=join(directory,"cli-user");const config=new WorkspaceConfig(join(user,".forge614"));
  const answers=["si",testUrl,"si"];const output:string[]=[];
  await runSetup({write:t=>output.push(t),ask:async()=>answers.shift()??null},config);
  expect(config.read().postgresUrl).toBe(testUrl);
  const workspace=new MemoryWorkspace(config);expect(workspace.listProjects()).toEqual([]);
  const p=workspace.createProject("CLI");
  const store=workspace.open();let id:string;
  try {id=store.save({projectId:p.projectId,title:"offline",content:"persistent",type:"fact"}).id;}
  finally {store.close();}
  await syncWorkspace(config);
  const other=new WorkspaceConfig(join(directory,"other-user",".forge614"));
  const second=["si",testUrl,"si"];await runSetup({write(){},ask:async()=>second.shift()??null},other);
  await syncWorkspace(other);
  const received=new MemoryWorkspace(other).open(true);
  try {expect(received.get(p.projectId,id)!.content).toBe("persistent");} finally {received.close();}
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const before=readFileSync(config.databasePath);
  await expect(syncWorkspace(config)).rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
  expect(readFileSync(config.databasePath)).toEqual(before);
  const cli=resolve(import.meta.dir,"../src/cli.ts"),preload=resolve(import.meta.dir,"fixtures/user-directory.ts");
  const run=(...args:string[])=>Bun.spawnSync([process.execPath,"--preload",preload,cli,...args],{env:{...process.env,FORGE614_TEST_USER_DIRECTORY:user}});
  const read=run("search","--project-id",p.projectId,"--query","persistent");
  expect(read.exitCode).toBe(0);expect(JSON.parse(read.stdout.toString())).toHaveLength(1);
  const saved=run("save","--project-id",p.projectId,"--title","Later","--content","offline writes");
  expect(saved.exitCode).toBe(0);
  const failed=run("sync");expect(failed.exitCode).toBe(1);expect(failed.stderr.toString()).not.toContain("SECRET");
  expect(output.join("\n")).not.toContain(testUrl);
});
