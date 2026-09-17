import { expect, test } from "bun:test";
import { MemoryStore } from "../src/store";
import { reconcile, snapshotHash, validateSnapshot } from "../src/sync-snapshot";

test('schema5 sync updates memory history and FTS while preserving only local machine bindings',()=>{
  const a=new MemoryStore(':memory:'),b=new MemoryStore(':memory:');
  try{
    a.enableAssistantIntegration();b.enableAssistantIntegration();
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
