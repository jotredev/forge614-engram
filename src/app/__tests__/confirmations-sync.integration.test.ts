import { expect, test } from "bun:test";
import { MemoryStore } from "../memory-store";
import { synchronize } from "../synchronization";
import { emptySnapshot,snapshotHash,type SyncSnapshot } from "../../modules/synchronization";
import type { PostgresReplica } from "../../infrastructure/postgres/replica";

class Replica {
  readonly id="confirmation-sync";
  snapshot:SyncSnapshot=emptySnapshot();
  async read(){return {snapshot:this.snapshot,hash:snapshotHash(this.snapshot)};}
  async publish(expected:string,next:SyncSnapshot){
    if(expected!==snapshotHash(this.snapshot)) throw new Error("stale test replica");
    this.snapshot=structuredClone(next);
    return snapshotHash(next);
  }
}

test("independent confirmations converge once and repeated synchronization does not multiply them",async()=>{
  const a=new MemoryStore(":memory:"),b=new MemoryStore(":memory:");
  const replica=new Replica();
  try {
    a.enableSearchReinforcement();b.enableSearchReinforcement();
    const project=a.createProject("Convergence");
    const memory=a.save({projectId:project.projectId,title:"Queue",content:"Use jobs",type:"decision",topicKey:"queue",requestKey:"create"});
    await synchronize(a,replica as unknown as PostgresReplica,{upgradeFormat:true});
    await synchronize(b,replica as unknown as PostgresReplica);

    a.save({projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"confirm-a"});
    b.save({projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"confirm-b"});
    await synchronize(a,replica as unknown as PostgresReplica);
    await synchronize(b,replica as unknown as PostgresReplica);
    await synchronize(a,replica as unknown as PostgresReplica);
    await synchronize(b,replica as unknown as PostgresReplica);

    for(const snapshot of [a.syncSnapshot(),b.syncSnapshot(),replica.snapshot]) {
      expect(snapshot.format).toBe(3);
      if(snapshot.format!==3) throw new Error("expected format 3");
      expect(snapshot.confirmations).toHaveLength(2);
      expect(snapshot.confirmationRequests.map(item=>item.requestKey).sort()).toEqual(["confirm-a","confirm-b"]);
      expect(snapshot.memories[0]!.versions).toHaveLength(1);
    }
  } finally {a.close();b.close();}
});
