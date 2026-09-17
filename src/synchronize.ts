import type { MemoryStore } from "./store";
import { reconcile, snapshotHash } from "./sync-snapshot";
import { PostgresReplica } from "./sync-postgres";

export async function synchronize(store:MemoryStore,replica:PostgresReplica):Promise<{synchronized:true;projects:number;memories:number}> {
  const remote=await replica.read();
  const local=store.syncSnapshot();const base=store.syncCheckpoint(replica.id);
  const merged=reconcile(base,local,remote.snapshot);
  if(snapshotHash(merged)!==remote.hash) await replica.publish(remote.hash,merged);
  store.applySync(local,merged,replica.id);
  return {synchronized:true,projects:merged.projects.length,memories:merged.memories.length};
}
