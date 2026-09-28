/**
 * Comprueba `takeCloudNotices`: sin nada que avisar da un arreglo vacío, un conflicto o un saltado se
 * agrupan en un solo aviso con conteo y se marcan como mostrados (no vuelven a salir en la segunda
 * llamada), la cola vieja se recalcula cada vez según la hora dada, con el umbral estricto de 24 h, y
 * sin nube activada da `[]` sin lanzar.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { enableCloud, initialize } from "./schema";
import { takeCloudNotices } from "./cloud-notices";

/** Una base SQLite en memoria, ya en el nivel 12 (nube activada), con la cola y los avisos vacíos. */
function freshCloudDb(): Database {
  const db = new Database(":memory:");
  initialize(db);
  enableCloud(db);
  db.exec("DELETE FROM cloud_outbox");
  return db;
}
/** Inserta un aviso crudo en `cloud_notices`, como lo dejaría `cloud-apply.ts`. */
function insertNotice(db: Database, code: string): void {
  db.query("INSERT INTO cloud_notices(code,payload) VALUES(?,?)").run(code, "{}");
}
/** Inserta una fila pendiente en `cloud_outbox` con la fecha de creación dada. */
function insertOutbox(db: Database, createdAt: string): void {
  db.query("INSERT INTO cloud_outbox(kind,op,payload,created_at) VALUES('projects','insert','{}',?)").run(createdAt);
}
const NOW = new Date("2026-01-02T00:00:00.000Z");

// Sin ningún aviso pendiente ni cola vieja, takeCloudNotices no tiene nada que decir.
test("takeCloudNotices is empty when there is nothing to report", () => {
  const db = freshCloudDb();
  expect(takeCloudNotices(db, NOW)).toEqual([]);
});

// Un conflicto de versión y uno de clave temática se agrupan en un solo aviso "conflict" con el conteo total.
test("takeCloudNotices groups CLOUD_CONFLICT and CLOUD_TOPIC_CONFLICT into one conflict notice with a count", () => {
  const db = freshCloudDb();
  insertNotice(db, "CLOUD_CONFLICT"); insertNotice(db, "CLOUD_TOPIC_CONFLICT");
  const notices = takeCloudNotices(db, NOW);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toEqual({ kind: "conflict", detail:
    "Cloud sync: 2 memories had a conflicting change from another Mac; the most recent version is active and the other one is in its history." });
});

// SECRET_REJECTED y CLOUD_ROW_SKIPPED se agrupan en un solo aviso "skipped"; con exactamente uno, el texto usa el singular.
test("takeCloudNotices groups SECRET_REJECTED and CLOUD_ROW_SKIPPED into one skipped notice, singular with exactly one", () => {
  const db = freshCloudDb();
  insertNotice(db, "SECRET_REJECTED");
  const notices = takeCloudNotices(db, NOW);
  expect(notices).toEqual([{ kind: "skipped", detail:
    "Cloud sync: 1 change from the cloud was skipped (a possible secret or invalid data)." }]);
});

// Un pendiente de más de 24 h en la cola produce el aviso "stale-outbox" con el total pendiente y la fecha del más viejo.
test("takeCloudNotices reports a stale outbox with the total pending count and the oldest date", () => {
  const db = freshCloudDb();
  // El id ascendente sigue el mismo orden que created_at (así encolan de verdad los disparadores): la primera fila insertada es la más vieja.
  insertOutbox(db, "2025-12-31T23:00:00.000Z"); // Más viejo: 25 h antes de NOW.
  insertOutbox(db, "2026-01-01T00:00:00.000Z"); // Más nuevo: exactamente 24 h antes de NOW.
  const notices = takeCloudNotices(db, NOW);
  expect(notices).toEqual([{ kind: "stale-outbox", detail:
    "Cloud sync: 2 local changes have been waiting to upload for more than 24 h (oldest from 2025-12-31T23:00:00.000Z)." }]);
});

// Los tres avisos pueden salir juntos, siempre en el mismo orden: conflicto, saltados, cola vieja.
test("takeCloudNotices returns all three notices together, in a fixed order", () => {
  const db = freshCloudDb();
  insertNotice(db, "CLOUD_CONFLICT"); insertNotice(db, "SECRET_REJECTED");
  insertOutbox(db, "2025-12-01T00:00:00.000Z");
  const notices = takeCloudNotices(db, NOW);
  expect(notices.map(notice => notice.kind)).toEqual(["conflict", "skipped", "stale-outbox"]);
});

// Los conflictos y los saltados se marcan como mostrados: una segunda llamada ya no los trae, aunque la cola vieja (que nunca se marca) siga saliendo igual.
test("a second call no longer brings conflicts or skipped notices, but a stale outbox keeps showing", () => {
  const db = freshCloudDb();
  insertNotice(db, "CLOUD_CONFLICT"); insertNotice(db, "CLOUD_ROW_SKIPPED");
  insertOutbox(db, "2025-12-01T00:00:00.000Z");
  const first = takeCloudNotices(db, NOW);
  expect(first.map(notice => notice.kind)).toEqual(["conflict", "skipped", "stale-outbox"]);
  const second = takeCloudNotices(db, NOW);
  expect(second).toEqual([{ kind: "stale-outbox", detail:
    "Cloud sync: 1 local change has been waiting to upload for more than 24 h (oldest from 2025-12-01T00:00:00.000Z)." }]);
});

// El umbral es estricto ("más de 24 h", no "24 h o más"): exactamente 24 h no avisa.
test("the stale outbox threshold is strict: exactly 24h00m00s does not warn", () => {
  const db = freshCloudDb();
  insertOutbox(db, new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());
  expect(takeCloudNotices(db, NOW)).toEqual([]);
});

// El umbral es estricto: 23 h 59 min no avisa, 24 h 1 min sí.
test("the stale outbox threshold is strict: 23h59m does not warn, 24h1m does", () => {
  const db = freshCloudDb();
  insertOutbox(db, new Date(NOW.getTime() - (23 * 60 + 59) * 60 * 1000).toISOString());
  expect(takeCloudNotices(db, NOW)).toEqual([]);
  db.exec("DELETE FROM cloud_outbox");
  insertOutbox(db, new Date(NOW.getTime() - (24 * 60 + 1) * 60 * 1000).toISOString());
  const notices = takeCloudNotices(db, NOW);
  expect(notices).toHaveLength(1);
  expect(notices[0]!.kind).toBe("stale-outbox");
});

// Sin la nube activada (nivel de esquema menor a 12), takeCloudNotices da [] sin lanzar, aunque se le pida sobre una base común.
test("takeCloudNotices is [] without throwing when cloud is not enabled", () => {
  const db = new Database(":memory:");
  initialize(db);
  expect(takeCloudNotices(db, NOW)).toEqual([]);
});
