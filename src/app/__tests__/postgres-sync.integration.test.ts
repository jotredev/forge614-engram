import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { MemoryStore } from "../../app/memory-store";
import { PostgresReplica, postgresOptions } from "../../infrastructure/postgres/replica";
import { synchronize } from "../../app/synchronization";
import { runSetup } from "../../app/setup";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "../../app/workspace";
import { syncWorkspace } from "../../app/synchronization";
import { canonical, normalizeSnapshot, snapshotHash } from "../../modules/synchronization";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../infrastructure/__test-support__/postgres";

// Explicit disposable loopback fixture only: never use an ambient database.
const cluster=startPostgresCluster();
const integration=cluster.available?test:test.skip;
let directory="",url="",admin!:SQL;
if(cluster.available) { directory=cluster.directory;url=cluster.url;admin=new SQL(url); }
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async()=>{
  if(!cluster.available) return;
  try { await admin.close(); }
  finally { stopPostgresCluster(cluster); }
},postgresTestTimeoutMs);


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
},postgresTestTimeoutMs);


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
},postgresTestTimeoutMs);


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
},postgresTestTimeoutMs);


integration("format 3 confirmations survive PostgreSQL convergence, retries, conflicts, and offline failures",async()=>{
  await admin.unsafe("CREATE DATABASE reinforcement_transport");
  const testUrl=url.replace("/postgres?","/reinforcement_transport?");
  const replica=await PostgresReplica.connect(testUrl,true),inspect=new SQL(testUrl);
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:"),legacy=new MemoryStore(":memory:");
  try {
    a.enableSearchReinforcement();b.enableSearchReinforcement();legacy.enableSessions();
    const project=a.createProject("Reinforced");
    const memory=a.save({projectId:project.projectId,title:"Queue",content:"Use jobs",type:"decision",topicKey:"queue",requestKey:"create"});
    a.save({projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"confirm-a"});

    const initial=await replica.read(),localBefore=a.syncSnapshot(),checkpointBefore=a.syncCheckpoint(replica.id);
    await expect(synchronize(a,replica)).rejects.toMatchObject({code:"SYNC_UPGRADE_REQUIRED"});
    expect((await replica.read()).hash).toBe(initial.hash);
    expect(a.syncSnapshot()).toEqual(localBefore);
    expect(a.syncCheckpoint(replica.id)).toEqual(checkpointBefore);

    await synchronize(a,replica,{upgradeFormat:true});
    expect((await replica.read()).snapshot.format).toBe(3);
    expect((await inspect.unsafe("SELECT format FROM forge614_sync.state"))[0].format).toBe(1);
    const historical=await inspect.unsafe("SELECT hash,payload FROM forge614_sync.revisions ORDER BY hash");

    await synchronize(b,replica);
    b.save({projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"confirm-b"});
    await synchronize(b,replica);await synchronize(a,replica);
    await synchronize(a,replica);await synchronize(b,replica);
    for(const snapshot of [a.syncSnapshot(),b.syncSnapshot(),(await replica.read()).snapshot]) {
      expect(snapshot.format).toBe(3);
      if(snapshot.format!==3) throw new Error("expected format 3");
      expect(snapshot.confirmations).toHaveLength(2);
      expect(snapshot.memories[0]!.versions).toHaveLength(1);
    }

    // Publication committed but its acknowledgment/checkpoint was lost.
    a.save({projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"lost-ack"});
    const lostCheckpoint=a.syncCheckpoint(replica.id),head=await replica.read();
    await replica.publish(head.hash,a.syncSnapshot());
    expect(a.syncCheckpoint(replica.id)).toEqual(lostCheckpoint);
    await synchronize(a,replica);await synchronize(b,replica);
    const converged=a.syncSnapshot();
    expect(converged.format).toBe(3);
    if(converged.format!==3) throw new Error("expected format 3");
    expect(converged.confirmations).toHaveLength(3);

    // A request cannot point at a real confirmation belonging to another owner.
    const otherProject=a.createProject("Foreign owner");
    const otherMemory=a.save({projectId:otherProject.projectId,title:"Foreign",content:"separate",type:"fact",topicKey:"foreign"});
    a.save({projectId:otherProject.projectId,title:otherMemory.title,content:otherMemory.content,type:otherMemory.type,
      topicKey:otherMemory.topicKey!,expectedVersion:1,requestKey:"foreign-confirm"});
    await synchronize(a,replica);
    const published=await replica.read(),forged=structuredClone(published.snapshot);
    if(forged.format!==3) throw new Error("expected format 3");
    const ownerRequest=forged.confirmationRequests.find(request=>request.memoryId===memory.id);
    const foreignEvent=forged.confirmations.find(confirmation=>confirmation.memoryId===otherMemory.id);
    if(!ownerRequest||!foreignEvent) throw new Error("expected both confirmation owners");
    ownerRequest.confirmationId=foreignEvent.confirmationId;
    await expect(replica.publish(published.hash,forged)).rejects.toMatchObject({code:"SYNC_INVALID"});
    expect((await replica.read()).hash).toBe(published.hash);

    // A dangling confirmation reference is independently rejected as malformed.
    const dangling=structuredClone(published.snapshot);
    if(dangling.format!==3) throw new Error("expected format 3");
    dangling.confirmations[0]!.memoryId=crypto.randomUUID();
    await expect(replica.publish(published.hash,dangling)).rejects.toMatchObject({code:"SYNC_INVALID"});
    expect((await replica.read()).hash).toBe(published.hash);

    legacy.createProject("Unsupported local writer");
    const legacyBefore=legacy.syncSnapshot();
    await expect(synchronize(legacy,replica,{upgradeFormat:true})).rejects.toMatchObject({code:"REINFORCEMENT_REQUIRED"});
    expect(legacy.syncSnapshot()).toEqual(legacyBefore);
    expect(legacy.syncCheckpoint(replica.id)).toEqual({format:1,projects:[],memories:[]});
    expect((await replica.read()).hash).toBe(published.hash);

    for(const row of historical) {
      expect((await inspect.unsafe("SELECT payload FROM forge614_sync.revisions WHERE hash=$1",[row.hash]))[0].payload).toBe(row.payload);
    }

    a.save({projectId:project.projectId,title:memory.title,content:"left",type:memory.type,topicKey:memory.topicKey!,expectedVersion:1});
    b.save({projectId:project.projectId,title:memory.title,content:"right",type:memory.type,topicKey:memory.topicKey!,expectedVersion:1});
    await synchronize(a,replica);
    const leftHead=await replica.read(),rightBefore=b.syncSnapshot();
    await expect(synchronize(b,replica)).rejects.toMatchObject({code:"SYNC_CONFLICT"});
    expect((await replica.read()).hash).toBe(leftHead.hash);
    expect(b.syncSnapshot()).toEqual(rightBefore);
    expect(b.get(project.projectId,memory.id)!.content).toBe("right");

    a.save({projectId:project.projectId,title:memory.title,content:"left",type:memory.type,topicKey:memory.topicKey!,expectedVersion:2,requestKey:"offline-confirm"});
    const offlineBefore=a.syncSnapshot(),offline=await PostgresReplica.connect(testUrl);
    await offline.close();
    await expect(synchronize(a,offline)).rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
    expect(a.syncSnapshot()).toEqual(offlineBefore);
    expect(offlineBefore.format).toBe(3);
    if(offlineBefore.format!==3) throw new Error("expected format 3");
    expect(offlineBefore.confirmations).toHaveLength(5);
  } finally {a.close();b.close();legacy.close();await replica.close();await inspect.close();}
},postgresTestTimeoutMs);


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
},postgresTestTimeoutMs);


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
},postgresTestTimeoutMs);


integration("setup refuses an incompatible PostgreSQL schema without publishing config or creating SQLite",async()=>{
  const config=new WorkspaceConfig(join(directory,"refused-user",".forge614"));
  const answers=["si",url,"si"];
  await expect(runSetup({write(){},ask:async()=>answers.shift()??null},config)).rejects.toMatchObject({code:"POSTGRES_SCHEMA"});
  expect(existsSync(config.root)).toBe(false);
},postgresTestTimeoutMs);
