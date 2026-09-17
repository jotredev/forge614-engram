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
