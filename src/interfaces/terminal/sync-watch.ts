/**
 * Bucle de sincronización con la nube en primer plano para `forge614 sync-watch`: reintenta a un intervalo fijo
 * mientras el proceso siga abierto. `commands.ts` lo arranca con el intervalo dado en `--interval`
 * (30 segundos por defecto, hasta 3600).
 */
import { setTimeout } from "node:timers/promises";
import { MemoryError } from "../../shared/errors";
import { syncWorkspace } from "../../app";

/** Proceso en primer plano, no un demonio instalado. Los comandos de lectura y escritura nunca esperan a que termine. */
export async function watchSync(interval:number):Promise<void> {
  const abort=new AbortController();const stop=()=>abort.abort();
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  try {
    while(!abort.signal.aborted) {
      try { console.log(JSON.stringify(await syncWorkspace())); }
      catch(error) {
        // Cualquier error se reporta y el bucle sigue esperando al siguiente intervalo, salvo que la nube esté desactivada: ahí ya no tiene sentido reintentar.
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
