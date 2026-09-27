/**
 * Sincroniza la base local (SQLite) con la réplica remota en PostgreSQL: combina lo
 * nuevo de cada lado (reconciliación), publica el resultado si cambió y lo aplica
 * de vuelta a la base local.
 */
import type { MemoryStore } from "./memory-store";
import { reconcile, snapshotHash, syncError, validateSnapshot } from "../modules/synchronization";
import { PostgresReplica } from "../infrastructure/postgres/replica";

/**
 * Une la fotografía (snapshot) local con la remota a partir del último punto en común
 * (checkpoint), y sube el resultado a PostgreSQL si hace falta.
 * @param store Base local abierta desde la que se lee y a la que se aplica el resultado.
 * @param replica Conexión ya abierta a la réplica de PostgreSQL.
 * @param options `upgradeFormat` autoriza a subir de versión de formato de sincronización
 * si la réplica remota trae una versión más nueva que la local.
 * @returns Cuántos proyectos y memorias quedaron tras combinar ambos lados.
 * @throws MemoryError con código `REINFORCEMENT_REQUIRED` si el resultado combinado usa el
 * formato de refuerzo (nivel 3) pero la base local no lo tiene activado; con
 * `SESSIONS_REQUIRED` si usa sesiones (cualquier formato salvo el 1) y la base local no las
 * tiene activadas; con `SYNC_UPGRADE_REQUIRED` si la réplica trae un formato más nuevo y no
 * se pidió `upgradeFormat`.
 */
export async function synchronize(store:MemoryStore,replica:PostgresReplica,options:{upgradeFormat?:boolean}={}):Promise<{synchronized:true;projects:number;memories:number}> {
  // Trae la fotografía (snapshot) y el hash que hoy tiene la réplica remota.
  const remote=await replica.read();
  // Fotografía local actual y el último punto de encuentro conocido con esta réplica.
  const local=store.syncSnapshot();const base=store.syncCheckpoint(replica.id);
  // Combina los tres puntos (base, local, remota) en una sola fotografía consistente.
  const merged=reconcile(base,local,remote.snapshot);
  // El resultado combinado no puede exigir una capacidad (refuerzo o sesiones) que esta base no tiene activada.
  if(merged.format===3&&!store.reinforcementEnabled()) syncError("REINFORCEMENT_REQUIRED");
  if(merged.format!==1&&!store.sessionsEnabled()) syncError("SESSIONS_REQUIRED");
  // Si la réplica trae un formato más nuevo que el combinado, hace falta permiso explícito para subir de versión.
  if(remote.snapshot.format<merged.format&&!options.upgradeFormat) syncError("SYNC_UPGRADE_REQUIRED");
  // Comprueba que la fotografía combinada tiene una forma válida antes de publicarla o aplicarla.
  validateSnapshot(merged);
  // Solo se publica en PostgreSQL si el resultado combinado difiere de lo que ya había en la réplica.
  if(snapshotHash(merged)!==remote.hash) await replica.publish(remote.hash,merged);
  // Aplica el resultado combinado a la base local, usando la fotografía local previa como valor esperado.
  store.applySync(local,merged,replica.id);
  return {synchronized:true,projects:merged.projects.length,memories:merged.memories.length};
}

import { MemoryError } from "../shared/errors";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";

/**
 * Punto de entrada de la CLI para el comando de sincronización: lee la configuración del
 * espacio de trabajo (workspace), abre la base local y la conexión a PostgreSQL, sincroniza
 * y cierra ambas conexiones aunque la sincronización falle.
 * @param config Configuración del espacio de trabajo a usar (por defecto, la del disco).
 * @param options `upgradeFormat` se reenvía tal cual a {@link synchronize}.
 * @returns El mismo resultado que devuelve {@link synchronize}.
 * @throws MemoryError con código `SYNC_DISABLED` si el espacio de trabajo no tiene
 * configurada una URL de PostgreSQL.
 */
export async function syncWorkspace(config=new WorkspaceConfig(),options:{upgradeFormat?:boolean}={}) {
  const settings=config.read();
  if(!settings.postgresUrl) throw new MemoryError("SYNC_DISABLED","Sincronización PostgreSQL desactivada. Ejecuta init para configurarla.");
  const store=new MemoryWorkspace(config).open();
  try {
    // La conexión a PostgreSQL y la base local se cierran siempre, incluso si `synchronize` lanza un error.
    const replica=await PostgresReplica.connect(settings.postgresUrl);
    try {return await synchronize(store,replica,options);} finally {await replica.close();}
  } finally {store.close();}
}
