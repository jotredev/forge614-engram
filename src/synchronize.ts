import type { MemoryStore } from "./store";
import { reconcile, snapshotHash, syncError, validateSnapshot } from "./sync-snapshot";
import { PostgresReplica } from "./sync-postgres";

export async function synchronize(store:MemoryStore,replica:PostgresReplica,options:{upgradeFormat?:boolean}={}):Promise<{synchronized:true;projects:number;memories:number}> {
  const remote=await replica.read();
  const local=store.syncSnapshot();const base=store.syncCheckpoint(replica.id);
  const merged=reconcile(base,local,remote.snapshot);
  if(merged.format===2&&!store.sessionsEnabled()) syncError("SESSIONS_REQUIRED");
  if(remote.snapshot.format===1&&merged.format===2&&!options.upgradeFormat) syncError("SYNC_UPGRADE_REQUIRED");
  validateSnapshot(merged);
  if(snapshotHash(merged)!==remote.hash) await replica.publish(remote.hash,merged);
  store.applySync(local,merged,replica.id);
  return {synchronized:true,projects:merged.projects.length,memories:merged.memories.length};
}
