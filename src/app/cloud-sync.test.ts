/**
 * Comprueba el ciclo de sincronización (`uploadOutbox`, `downloadChanges`, `runCloudCycle`) con dobles
 * (fakes) de `CloudReplica`, rápidos y deterministas: la subida respeta el orden de `id` y borra solo
 * lo que de verdad se subió (una fila encolada durante la subida se queda para el siguiente lote); la
 * bajada aplica con `applyCloudChanges` real y no aplica nada si la señal ya está abortada cuando el
 * lote vuelve (Foco de revisión #3); `runCloudCycle` encadena las dos. La repetición real por lotes
 * grandes, contra PostgreSQL de verdad, la cubre `__tests__/cloud-sync.integration.test.ts`.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { enableCloud, initialize } from "../infrastructure/sqlite/schema";
import { createProject } from "../infrastructure/sqlite/projects";
import type { ChangeRow } from "../infrastructure/postgres/replica";
import { downloadChanges, runCloudCycle, uploadOutbox, type CloudReplica } from "./cloud-sync";

/** Una base SQLite en memoria, ya en el nivel 12 (nube activada). */
function freshCloudDb(): Database {
  const db = new Database(":memory:");
  initialize(db);
  enableCloud(db);
  return db;
}
/** Cuenta las filas que hoy tiene `cloud_outbox`. */
function outboxCount(db: Database): number {
  return (db.query("SELECT COUNT(*) AS n FROM cloud_outbox").get() as { n: number }).n;
}
/** Doble (fake) de `CloudReplica` que registra cada llamada y deja controlar sus respuestas desde la prueba. */
function fakeReplica(overrides: {
  pushChanges?: CloudReplica["pushChanges"];
  pullChanges?: CloudReplica["pullChanges"];
} = {}): CloudReplica & { pushCalls: { installationId: string; rows: { kind: string }[] }[]; pullCalls: number[] } {
  const pushCalls: { installationId: string; rows: { kind: string }[] }[] = [];
  const pullCalls: number[] = [];
  return {
    pushCalls, pullCalls,
    async pushChanges(installationId, rows) {
      pushCalls.push({ installationId, rows });
      return overrides.pushChanges ? overrides.pushChanges(installationId, rows) : { ids: rows.map((_, i) => i + 1) };
    },
    async pullChanges(since, limit, signal) {
      pullCalls.push(since);
      return overrides.pullChanges ? overrides.pullChanges(since, limit, signal) : [];
    },
    async close() {},
  };
}

// La subida debe respetar el orden ascendente de `id` de `cloud_outbox` al armar el lote que sube.
test("uploadOutbox sends the pending queue to pushChanges in ascending id order", async () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  createProject(db, "alpha"); createProject(db, "beta"); createProject(db, "gamma");
  const replica = fakeReplica();
  await uploadOutbox(db, replica, "local");
  expect(replica.pushCalls).toHaveLength(1);
  expect(replica.pushCalls[0]!.rows.map(row => row.kind)).toEqual(["projects", "projects", "projects"]);
  expect(outboxCount(db)).toBe(0);
});

// Solo se borran los ids que de verdad se subieron: una fila encolada durante la subida (aquí, simulada dentro del propio pushChanges) debe sobrevivir para el siguiente lote.
test("uploadOutbox deletes only the rows it actually uploaded, leaving a row queued mid-upload for the next batch", async () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  createProject(db, "first");
  let queuedDuringUpload = false;
  const replica = fakeReplica({
    async pushChanges(_installationId, rows) {
      if (!queuedDuringUpload) { queuedDuringUpload = true; createProject(db, "queued-mid-upload"); }
      return { ids: rows.map((_, i) => i + 1) };
    },
  });
  await uploadOutbox(db, replica, "local");
  // El lote inicial (una sola fila, un lote incompleto) se subió y se borró; como no vino lleno, uploadOutbox
  // no vuelve a consultar la cola dentro de esta misma llamada, así que la fila encolada durante el envío
  // se queda pendiente (la recogerá el siguiente ciclo, no esta misma pasada).
  expect(replica.pushCalls).toHaveLength(1);
  expect(replica.pushCalls[0]!.rows).toHaveLength(1);
  expect(outboxCount(db)).toBe(1);
  expect(db.query("SELECT payload FROM cloud_outbox").get()).not.toBeNull();
});

// Sin nada pendiente, uploadOutbox no llama a pushChanges ni una vez.
test("uploadOutbox does nothing when the queue is already empty", async () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  const replica = fakeReplica();
  await uploadOutbox(db, replica, "local");
  expect(replica.pushCalls).toHaveLength(0);
});

// La bajada aplica de verdad con applyCloudChanges: una fila nueva de `projects` termina insertada en local, y last_applied_id avanza.
test("downloadChanges applies rows with the real applyCloudChanges and advances last_applied_id", async () => {
  const db = freshCloudDb();
  const row: ChangeRow = { id: 1, changeId: "c1", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p-remote", name: "From the cloud", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const replica = fakeReplica({ async pullChanges() { return [row]; } });
  await downloadChanges(db, replica, "local");
  expect(db.query("SELECT name FROM projects WHERE projectId=?").get("p-remote")).toEqual({ name: "From the cloud" });
  expect((db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id).toBe(1);
});

// Foco de revisión #3: si la señal ya está abortada en cuanto el lote vuelve, no se aplica nada (ni siquiera se toca la base).
test("downloadChanges applies nothing when the signal is already aborted once the batch comes back", async () => {
  const db = freshCloudDb();
  const row: ChangeRow = { id: 1, changeId: "c1", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p-late", name: "Too late", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const controller = new AbortController();
  const replica = fakeReplica({ async pullChanges() { controller.abort(); return [row]; } });
  await downloadChanges(db, replica, "local", controller.signal);
  expect(db.query("SELECT * FROM projects WHERE projectId=?").get("p-late")).toBeNull();
  expect((db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id).toBe(0);
});

// Con la señal ya abortada desde antes de empezar, downloadChanges tampoco llega a pedir el primer lote a pullChanges.
test("downloadChanges does not even call pullChanges when the signal starts already aborted", async () => {
  const db = freshCloudDb();
  const controller = new AbortController(); controller.abort();
  const replica = fakeReplica();
  await downloadChanges(db, replica, "local", controller.signal);
  expect(replica.pullCalls).toHaveLength(0);
});

// Sin cambios nuevos, downloadChanges se detiene tras la primera consulta vacía, sin aplicar ni avanzar el puntero.
test("downloadChanges stops after one empty pull when there is nothing new", async () => {
  const db = freshCloudDb();
  const replica = fakeReplica();
  await downloadChanges(db, replica, "local");
  expect(replica.pullCalls).toEqual([0]);
  expect((db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id).toBe(0);
});

// runCloudCycle encadena subida y bajada: primero sube toda la cola local, luego baja y aplica lo nuevo de la nube.
test("runCloudCycle uploads the pending queue and then downloads and applies new changes", async () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  createProject(db, "local-first");
  const remoteRow: ChangeRow = { id: 5, changeId: "remote-1", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p-remote-cycle", name: "Remote via cycle", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const replica = fakeReplica({ async pullChanges() { return [remoteRow]; } });
  await runCloudCycle(db, replica, "local");
  expect(replica.pushCalls).toHaveLength(1);
  expect(outboxCount(db)).toBe(0);
  expect(db.query("SELECT projectId FROM projects WHERE projectId=?").get("p-remote-cycle")).toEqual({ projectId: "p-remote-cycle" });
});
