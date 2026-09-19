import type { MemoryStore } from "./memory-store";
import { reconcile, snapshotHash, syncError, validateSnapshot } from "../modules/synchronization";
import { PostgresReplica } from "../infrastructure/postgres/replica";

export async function synchronize(store:MemoryStore,replica:PostgresReplica,options:{upgradeFormat?:boolean}={}):Promise<{synchronized:true;projects:number;memories:number}> {
  const remote=await replica.read();
  const local=store.syncSnapshot();const base=store.syncCheckpoint(replica.id);
  const merged=reconcile(base,local,remote.snapshot);
  if(merged.format===3&&!store.reinforcementEnabled()) syncError("REINFORCEMENT_REQUIRED");
  if(merged.format!==1&&!store.sessionsEnabled()) syncError("SESSIONS_REQUIRED");
  if(remote.snapshot.format<merged.format&&!options.upgradeFormat) syncError("SYNC_UPGRADE_REQUIRED");
  validateSnapshot(merged);
  if(snapshotHash(merged)!==remote.hash) await replica.publish(remote.hash,merged);
  store.applySync(local,merged,replica.id);
  return {synchronized:true,projects:merged.projects.length,memories:merged.memories.length};
}

import { MemoryError } from "../shared/errors";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";

export async function syncWorkspace(config=new WorkspaceConfig(),options:{upgradeFormat?:boolean}={}) {
  const settings=config.read();
  if(!settings.postgresUrl) throw new MemoryError("SYNC_DISABLED","Sincronización PostgreSQL desactivada. Ejecuta init para configurarla.");
  const store=new MemoryWorkspace(config).open();
  try {
    const replica=await PostgresReplica.connect(settings.postgresUrl);
    try {return await synchronize(store,replica,options);} finally {await replica.close();}
  } finally {store.close();}
}
