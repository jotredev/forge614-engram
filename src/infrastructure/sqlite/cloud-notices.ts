/**
 * Recoge los avisos de nube pendientes (D4, D5, D11) para mostrarlos una vez en
 * `memory_session_start`: conflictos de versión o de clave temática, cambios saltados por secreto o
 * forma inválida, y cola de subida vieja. Los dos primeros se marcan como mostrados en la misma
 * transacción en que se cuentan (así cada uno sale una sola vez); el tercero se recalcula cada vez,
 * porque su estado depende de la hora actual, no de si ya se avisó. La usa
 * `MemoryStore.takeCloudNotices` (`src/app/memory-store.ts`).
 */
import type { Database } from "./connection";
import { cloudEnabled } from "./schema";
import type { CloudNotice } from "../../modules/sessions";

// Más de 24 horas en milisegundos (D11: estricto, "más de", no "igual a").
const STALE_OUTBOX_MS = 24 * 60 * 60 * 1000;
// Códigos de `cloud_notices` que se agrupan bajo el aviso de conflicto (D4): versión duplicada y clave temática duplicada.
const CONFLICT_CODES = ["CLOUD_CONFLICT", "CLOUD_TOPIC_CONFLICT"];
// Códigos de `cloud_notices` que se agrupan bajo el aviso de saltados (D5): secreto rechazado y fila con forma inválida o desconocida.
const SKIPPED_CODES = ["SECRET_REJECTED", "CLOUD_ROW_SKIPPED"];

/**
 * Cuenta las filas sin mostrar (`shown=0`) de `cloud_notices` cuyo código está en `codes`.
 * @param db Base local.
 * @param codes Códigos a contar juntos, como un solo tipo de aviso.
 * @returns Cuántas filas sin mostrar hay con esos códigos.
 */
function countUnshown(db: Database, codes: readonly string[]): number {
  const placeholders = codes.map(() => "?").join(",");
  const row = db.query(`SELECT COUNT(*) AS n FROM cloud_notices WHERE shown=0 AND code IN (${placeholders})`).get(...codes) as { n: number };
  return row.n;
}
/**
 * Marca como mostradas (`shown=1`) las filas sin mostrar de `cloud_notices` cuyo código está en `codes`.
 * @param db Base local.
 * @param codes Códigos a marcar juntos.
 */
function markShown(db: Database, codes: readonly string[]): void {
  const placeholders = codes.map(() => "?").join(",");
  db.query(`UPDATE cloud_notices SET shown=1 WHERE shown=0 AND code IN (${placeholders})`).run(...codes);
}
/**
 * Da la fecha de creación del pendiente más viejo de `cloud_outbox`.
 * @param db Base local.
 * @returns La fecha del pendiente más viejo (el de menor `id`), o `null` si la cola está vacía.
 */
function oldestOutboxDate(db: Database): string | null {
  const row = db.query("SELECT created_at FROM cloud_outbox ORDER BY id LIMIT 1").get() as { created_at: string } | null;
  return row?.created_at ?? null;
}
/**
 * Cuenta cuántas filas hay hoy en `cloud_outbox`, sin importar su edad.
 * @param db Base local.
 * @returns El total de filas pendientes de subir.
 */
function outboxCount(db: Database): number {
  return (db.query("SELECT COUNT(*) AS n FROM cloud_outbox").get() as { n: number }).n;
}

/**
 * Recoge y marca como mostrados los avisos de nube pendientes de esta base.
 * @param db Base local.
 * @param now Hora actual, para decidir si la cola pendiente ya lleva más de 24 h esperando (recibida
 * como parámetro, en vez de leerla del reloj del sistema, para que las pruebas puedan fijarla).
 * @returns Un `CloudNotice` por tipo (nunca más de tres: conflicto, saltados, cola vieja), en ese
 * orden; un arreglo vacío si esta base no tiene la nube activada o no hay nada que avisar.
 */
export function takeCloudNotices(db: Database, now: Date): CloudNotice[] {
  // Sin nube (nivel de esquema menor a 12: las tablas de este archivo ni existen), no hay nada que recoger.
  if (!cloudEnabled(db)) return [];
  const notices: CloudNotice[] = [];
  db.transaction(() => {
    // Conflictos y saltados se marcan como mostrados dentro de esta misma transacción: cada uno sale una sola vez.
    const conflicts = countUnshown(db, CONFLICT_CODES);
    if (conflicts > 0) {
      markShown(db, CONFLICT_CODES);
      notices.push({ kind: "conflict", detail:
        `Cloud sync: ${conflicts} ${conflicts === 1 ? "memory" : "memories"} had a conflicting change from another Mac; the most recent version is active and the other one is in its history.` });
    }
    const skipped = countUnshown(db, SKIPPED_CODES);
    if (skipped > 0) {
      markShown(db, SKIPPED_CODES);
      notices.push({ kind: "skipped", detail:
        `Cloud sync: ${skipped} ${skipped === 1 ? "change" : "changes"} from the cloud ${skipped === 1 ? "was" : "were"} skipped (a possible secret or invalid data).` });
    }
  })();
  // La cola vieja nunca se marca: se recalcula cada vez, porque depende de la hora actual, no de si ya se avisó antes.
  const oldest = oldestOutboxDate(db);
  if (oldest !== null && now.getTime() - new Date(oldest).getTime() > STALE_OUTBOX_MS) {
    const total = outboxCount(db);
    notices.push({ kind: "stale-outbox", detail:
      `Cloud sync: ${total} local ${total === 1 ? "change has" : "changes have"} been waiting to upload for more than 24 h (oldest from ${oldest}).` });
  }
  return notices;
}
