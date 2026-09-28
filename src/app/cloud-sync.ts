/**
 * Ciclo de sincronización con la nube (D7): sube la cola pendiente (`cloud_outbox`) a la réplica en
 * PostgreSQL en lotes, y baja los cambios nuevos aplicándolos a la base local con
 * `applyCloudChanges`. Lo usa `cloud-background.ts`, tanto en la tarea de fondo del servidor MCP
 * (subida y bajada) como en la espera de arranque (solo bajada, con señal de cancelación, D8).
 */
import type { Database } from "../infrastructure/sqlite/connection";
import type { ChangeRow } from "../infrastructure/postgres/replica";
import { applyCloudChanges } from "./cloud-apply";

/**
 * El subconjunto de `PostgresReplica` que el ciclo necesita: subir, bajar y cerrar la conexión.
 * Permite usar dobles (fakes) de prueba lentos o que fallan sin depender de PostgreSQL real.
 */
export interface CloudReplica {
  /** Sube un lote de cambios; ver `PostgresReplica.pushChanges`. */
  pushChanges(installationId: string, rows: { changeId: string; kind: string; op: "insert" | "update" | "delete"; payload: unknown }[]): Promise<{ ids: number[] }>;
  /** Baja cambios posteriores a `since`; ver `PostgresReplica.pullChanges`. */
  pullChanges(since: number, limit?: number, signal?: AbortSignal): Promise<ChangeRow[]>;
  /** Cierra la conexión; ver `PostgresReplica.close`. */
  close(): Promise<void>;
}

// Tamaño de lote al subir la cola pendiente (D7: "lotes de hasta 500").
const UPLOAD_BATCH_SIZE = 500;
// Tamaño de lote al bajar cambios nuevos: mismo límite que acepta `pullChanges` (1000).
const DOWNLOAD_BATCH_SIZE = 1000;

/** Una fila cruda de `cloud_outbox`, tal como la deja el disparador (trigger) SQL de `schema.ts`. */
interface OutboxRow { readonly id: number; readonly change_id: string; readonly kind: string; readonly op: "insert" | "update" | "delete"; readonly payload: string }

/**
 * Sube la cola pendiente (`cloud_outbox`) a la nube, en lotes de hasta `UPLOAD_BATCH_SIZE` y en
 * orden de `id` ascendente; solo borra de la cola local los `id` que la réplica confirmó recibidos
 * (lo que se encoló mientras tanto se queda para el siguiente lote), y repite mientras el lote venga
 * lleno (señal de que puede haber más filas después).
 * @param db Base local con la cola pendiente.
 * @param replica Réplica remota (o su doble de prueba) a la que se suben los cambios.
 * @param installationId Identificador de esta instalación, que viaja con cada cambio subido.
 * @returns Cuántas filas se subieron en total (la suma de todos los lotes).
 */
export async function uploadOutbox(db: Database, replica: CloudReplica, installationId: string): Promise<number> {
  let uploaded = 0;
  for (;;) {
    // Se relee la cola en cada vuelta: un guardado nuevo durante la subida entra en el siguiente lote, no en este.
    const rows = db.query("SELECT id, change_id, kind, op, payload FROM cloud_outbox ORDER BY id LIMIT ?").all(UPLOAD_BATCH_SIZE) as OutboxRow[];
    if (rows.length === 0) return uploaded;
    await replica.pushChanges(installationId, rows.map(row => ({
      changeId: row.change_id, kind: row.kind, op: row.op, payload: JSON.parse(row.payload),
    })));
    // Solo se borran los ids que de verdad se subieron: una fila encolada después de leer `rows` no está en esta lista.
    const ids = rows.map(row => row.id);
    db.transaction(() => {
      db.query(`DELETE FROM cloud_outbox WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    })();
    uploaded += rows.length;
    if (rows.length < UPLOAD_BATCH_SIZE) return uploaded; // Lote incompleto: no puede haber más filas esperando.
  }
}

/**
 * Baja los cambios nuevos desde `cloud_state.last_applied_id` y los aplica a la base local con
 * `applyCloudChanges`, en lotes de hasta `DOWNLOAD_BATCH_SIZE`; si la señal ya está abortada cuando
 * el lote vuelve, se detiene sin tocar la base (Foco de revisión #3: nunca aplicar algo bajado tarde),
 * y repite mientras el lote venga lleno.
 * @param db Base local a la que se aplican los cambios bajados.
 * @param replica Réplica remota (o su doble de prueba) de la que se bajan los cambios.
 * @param installationId Identificador de esta instalación, para que `applyCloudChanges` reconozca sus propias filas.
 * @param signal Señal opcional de cancelación (tope de la espera de arranque, D8, o detención de la tarea de fondo).
 * @returns Cuántas filas se aplicaron de verdad (sin contar las propias, las saltadas ni las de conflicto
 * que ya se cuentan como aplicadas en `applyCloudChanges`; ver esa función para el detalle).
 */
export async function downloadChanges(db: Database, replica: CloudReplica, installationId: string, signal?: AbortSignal): Promise<number> {
  let applied = 0;
  for (;;) {
    if (signal?.aborted) return applied;
    const since = (db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id;
    const rows = await replica.pullChanges(since, DOWNLOAD_BATCH_SIZE, signal);
    // El tope pudo vencer mientras `pullChanges` seguía en el aire: no se aplica nada bajado tarde.
    if (signal?.aborted) return applied;
    if (rows.length === 0) return applied;
    applied += applyCloudChanges(db, rows, installationId).applied;
    if (rows.length < DOWNLOAD_BATCH_SIZE) return applied;
  }
}

/**
 * Un ciclo completo de sincronización (D7): primero sube toda la cola pendiente, luego baja y aplica
 * los cambios nuevos. Lo usa la tarea de fondo del servidor MCP en cada intervalo y al guardar
 * (agrupado con un pequeño retraso, ver `cloud-background.ts`).
 * @param db Base local.
 * @param replica Réplica remota (o su doble de prueba).
 * @param installationId Identificador de esta instalación.
 * @param signal Señal opcional de cancelación, que solo afecta a la bajada.
 * @returns Cuántas filas se subieron y cuántas se bajaron y aplicaron de verdad.
 */
export async function runCloudCycle(db: Database, replica: CloudReplica, installationId: string, signal?: AbortSignal): Promise<{ uploaded: number; downloaded: number }> {
  const uploaded = await uploadOutbox(db, replica, installationId);
  const downloaded = await downloadChanges(db, replica, installationId, signal);
  return { uploaded, downloaded };
}
