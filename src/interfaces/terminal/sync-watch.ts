/**
 * Bucle de sincronización con la nube en primer plano para `forge614 sync-watch`: reintenta a un intervalo fijo
 * mientras el proceso siga abierto. `commands.ts` lo arranca con el intervalo dado en `--interval`
 * (30 segundos por defecto, hasta 3600). Obsoleto (D10, sunset 2027-03-31): con `cloud on` ya hecho
 * corre el ciclo nuevo (`runCloudSync`) en cada vuelta; sin nube, sigue con el mecanismo anterior.
 */
import { setTimeout } from "node:timers/promises";
import { MemoryError } from "../../shared/errors";
import { cloudSettings, runCloudSync, syncWorkspace } from "../../app";

/** Texto exacto del aviso de obsolescencia de D10, impreso una sola vez al arrancar. */
const SYNC_WATCH_DEPRECATED = { code: "SYNC_WATCH_DEPRECATED", error: "sync-watch es obsoleto; se retira el 2027-03-31." };

/** Proceso en primer plano, no un demonio instalado. Los comandos de lectura y escritura nunca esperan a que termine. */
export async function watchSync(interval:number):Promise<void> {
  const abort=new AbortController();const stop=()=>abort.abort();
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  // El aviso de obsolescencia (D10) se manda una sola vez, DESPUÉS del primer intento: así nunca compite
  // por ser el primer byte de stderr con el resultado (o el error) real de ese primer ciclo.
  let noticed=false;
  try {
    while(!abort.signal.aborted) {
      try { console.log(JSON.stringify(cloudSettings() ? await runCloudSync() : await syncWorkspace())); }
      catch(error) {
        // Cualquier error se reporta y el bucle sigue esperando al siguiente intervalo, salvo que la nube esté desactivada: ahí ya no tiene sentido reintentar.
        const code=error instanceof MemoryError?error.code:"SYNC_ERROR";
        console.error(JSON.stringify({code,error:"Sincronización pendiente; los datos locales se conservan."}));
        if(code==="SYNC_DISABLED") return;
      }
      if(!noticed){noticed=true;console.error(JSON.stringify(SYNC_WATCH_DEPRECATED));}
      if(abort.signal.aborted) break;
      try {await setTimeout(interval*1000,undefined,{signal:abort.signal});}
      catch {if(!abort.signal.aborted) throw new Error("Timer failed");}
    }
    process.exitCode=130;
  } finally {process.off("SIGINT",stop);process.off("SIGTERM",stop);}
}
