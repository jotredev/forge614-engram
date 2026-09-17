import { setTimeout } from "node:timers/promises";
import { MemoryError } from "./domain";
import { WorkspaceConfig } from "./workspace-config";
import { MemoryWorkspace } from "./workspace";
import { PostgresReplica } from "./sync-postgres";
import { synchronize } from "./synchronize";

export async function syncWorkspace(config=new WorkspaceConfig(),options:{upgradeFormat?:boolean}={}) {
  const settings=config.read();
  if(!settings.postgresUrl) throw new MemoryError("SYNC_DISABLED","Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla.");
  const store=new MemoryWorkspace(config).open();
  try {
    const replica=await PostgresReplica.connect(settings.postgresUrl);
    try {return await synchronize(store,replica,options);} finally {await replica.close();}
  } finally {store.close();}
}

/** Foreground process, not an installed daemon. Read/write commands never wait on it. */
export async function watchSync(interval:number):Promise<void> {
  const abort=new AbortController();const stop=()=>abort.abort();
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  try {
    while(!abort.signal.aborted) {
      try { console.log(JSON.stringify(await syncWorkspace())); }
      catch(error) {
        const code=error instanceof MemoryError?error.code:"SYNC_ERROR";
        console.error(JSON.stringify({code,error:"Sincronización pendiente; los datos locales se conservan."}));
        if(code==="SYNC_DISABLED") return;
      }
      if(abort.signal.aborted) break;
      try {await setTimeout(interval*1000,undefined,{signal:abort.signal});}
      catch {if(!abort.signal.aborted) throw new Error("Timer failed");}
    }
    process.exitCode=130;
  } finally {process.off("SIGINT",stop);process.off("SIGTERM",stop);}
}
