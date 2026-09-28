/**
 * Comprueba el ciclo de sincronización (`uploadOutbox`, `downloadChanges`) contra un PostgreSQL real y
 * desechable (nunca una base ambiente): la subida de una cola de más de 500 filas se hace en dos
 * lotes ascendentes y en orden, y la bajada de más de 1000 cambios se aplica en dos lotes también en
 * orden, sin perder ninguno.
 */
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { enableCloud, initialize } from "../../infrastructure/sqlite/schema";
import { createProject } from "../../infrastructure/sqlite/projects";
import { PostgresReplica } from "../../infrastructure/postgres/replica";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../infrastructure/__test-support__/postgres";
import { downloadChanges, uploadOutbox } from "../cloud-sync";

// Solo un servidor de prueba (fixture) desechable y en loopback (127.0.0.1), explícito: nunca se usa una base ambiente ya existente.
const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
let admin!: SQL;
if (cluster.available) admin = new SQL(cluster.url);
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async () => {
  if (!cluster.available) return;
  try { await admin.close(); } finally { stopPostgresCluster(cluster); }
}, postgresTestTimeoutMs);

/** Una base SQLite en memoria, ya en el nivel 12 (nube activada). */
function freshCloudDb(): Database {
  const db = new Database(":memory:");
  initialize(db);
  enableCloud(db);
  return db;
}

// La cola local de 501 filas se sube en dos lotes (500 + 1), en orden ascendente de id, y queda vacía al terminar.
integration("uploadOutbox sends a 501-row queue to real PostgreSQL in two ascending batches", async () => {
  const dbName = "cloud_sync_upload_batches";
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`); await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = cluster.available ? cluster.url.replace(/\/postgres(\?|$)/, `/${dbName}$1`) : "";
  const replica = await PostgresReplica.connect(url, true);
  try {
    const db = freshCloudDb();
    db.exec("DELETE FROM cloud_outbox");
    for (let i = 0; i < 501; i++) createProject(db, `project-${String(i).padStart(4, "0")}`);
    await uploadOutbox(db, replica, crypto.randomUUID());
    expect((db.query("SELECT COUNT(*) AS n FROM cloud_outbox").get() as { n: number }).n).toBe(0);
    // Se comprueba a través de pullChanges (el mismo camino que usa la bajada), no leyendo `payload` crudo:
    // así la prueba no depende de cómo el cliente de PostgreSQL serializa un jsonb por dentro.
    const uploaded = await replica.pullChanges(0, 1000);
    expect(uploaded).toHaveLength(501);
    expect(uploaded.map(row => (row.payload as { name: string }).name)).toEqual(Array.from({ length: 501 }, (_, i) => `project-${String(i).padStart(4, "0")}`));
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Una bajada de 1500 cambios ya presentes en la nube se aplica en dos lotes (1000 + 500), sin perder ninguno, y last_applied_id llega hasta el último.
integration("downloadChanges applies 1500 pending remote changes from real PostgreSQL in two batches", async () => {
  const dbName = "cloud_sync_download_batches";
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`); await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = cluster.available ? cluster.url.replace(/\/postgres(\?|$)/, `/${dbName}$1`) : "";
  const replica = await PostgresReplica.connect(url, true);
  try {
    const remoteInstallationId = crypto.randomUUID();
    const seed = new SQL(url);
    try {
      for (let i = 0; i < 1500; i++) {
        const projectId = `remote-${String(i).padStart(4, "0")}`;
        await seed.unsafe(
          "INSERT INTO forge614_sync.changes(change_id,installation_id,kind,op,payload) VALUES($1,$2,'projects','insert',$3::jsonb)",
          [`change-${i}`, remoteInstallationId, JSON.stringify({ projectId, name: projectId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })],
        );
      }
    } finally { await seed.close(); }
    const db = freshCloudDb();
    await downloadChanges(db, replica, crypto.randomUUID());
    expect((db.query("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n).toBe(1500);
    const lastApplied = (db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id;
    expect(lastApplied).toBe(1500);
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);
