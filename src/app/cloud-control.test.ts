/**
 * Comprueba `runCloudOn`, `runCloudOff`, `runCloudStatus` y `runCloudSync` (D9, D13, D14, Foco de
 * revisión #4) contra un PostgreSQL real y desechable (nunca una base ambiente): la conexión se
 * prueba antes de escribir el `.env`, el id de instalación se genera una sola vez, `cloud off`
 * conserva la cola y el id, y una base remota distinta reencola toda la memoria local mientras que
 * la misma base la conserva.
 */
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../infrastructure/__test-support__/postgres";
import { MemoryWorkspace } from "./workspace";
import { runCloudOff, runCloudOn, runCloudStatus, runCloudSync } from "./cloud-control";
import { connectCloudReplica } from "./cloud-settings";

// Solo un servidor de prueba (fixture) desechable y en loopback (127.0.0.1), explícito: nunca se usa una base ambiente ya existente.
const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
let admin!: SQL;
// Se captura aparte (fuera del `if`) porque TypeScript no reduce (narrow) el tipo de `cluster` dentro de una función declarada más abajo, como `freshDatabase`.
const clusterUrl = cluster.available ? cluster.url : "";
if (cluster.available) admin = new SQL(cluster.url);
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async () => {
  if (!cluster.available) return;
  try { await admin.close(); } finally { stopPostgresCluster(cluster); }
}, postgresTestTimeoutMs);

let directory = "";
let previousHome: string | undefined;
// Cada prueba usa su propio $FORGE614_HOME temporal (mismo patrón que cloud-settings.test.ts): así
// `runCloudOn`/`runCloudOff`/`runCloudStatus`/`runCloudSync`, que leen la configuración por defecto
// del disco, quedan aisladas entre sí.
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "forge614-cloud-control-"));
  previousHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(directory, ".forge614");
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousHome;
  rmSync(directory, { recursive: true, force: true });
});

/** Deja el espacio de trabajo ya inicializado (`init`), sin nube todavía. */
function initialized(): void { new MemoryWorkspace().init(); }
/** Crea una base de PostgreSQL nueva y desechable, y da su URL de conexión. */
async function freshDatabase(name: string): Promise<string> {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`); await admin.unsafe(`CREATE DATABASE ${name}`);
  return clusterUrl.replace(/\/postgres(\?|$)/, `/${name}$1`);
}

// cloud on sin init falla sin escribir nada en el disco.
test("runCloudOn without init fails without touching the filesystem", async () => {
  await expect(runCloudOn("postgresql://u@127.0.0.1:1/db?sslmode=disable")).rejects.toMatchObject({ code: "CONFIG_NOT_FOUND" });
  expect(new WorkspaceConfig().exists()).toBe(false);
});

// Una URL que no sirve para conectarse no debe dejar ni un byte escrito en el .env, y su mensaje no debe repetir la contraseña.
integration("runCloudOn tests the connection before writing; an unreachable database leaves the config untouched", async () => {
  initialized();
  const config = new WorkspaceConfig();
  const before = config.revision();
  let error: unknown;
  try { await runCloudOn("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable"); } catch (caught) { error = caught; }
  expect((error as { code?: unknown })?.code).toBe("POSTGRES_UNAVAILABLE");
  expect(String(error)).not.toContain("SECRET");
  expect(config.revision()).toBe(before);
}, postgresTestTimeoutMs);

// Una dirección inválida (con contraseña) tampoco debe repetirse en el error.
test("an invalid connection address with a password never appears in the resulting error", async () => {
  initialized();
  let error: unknown;
  try { await runCloudOn("postgresql://user:hunter2@bad host/db"); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).not.toContain("hunter2");
});

// El id de instalación se genera una sola vez; repetir cloud on con la misma base no lo cambia.
integration("runCloudOn generates the installation id once and keeps it on repeat calls", async () => {
  initialized();
  const url = await freshDatabase("cloud_control_same_id");
  const first = await runCloudOn(url);
  const second = await runCloudOn(url);
  expect(second.installationId).toBe(first.installationId);
  expect(new WorkspaceConfig().read().installationId).toBe(first.installationId);
}, postgresTestTimeoutMs);

// cloud off quita POSTGRES_URL, conserva el id de instalación y la base de nivel 12 sigue funcionando.
integration("runCloudOff removes POSTGRES_URL and keeps the installation id and the level-12 database", async () => {
  initialized();
  const url = await freshDatabase("cloud_control_off");
  const on = await runCloudOn(url);
  const off = await runCloudOff();
  expect(off.enabled).toBe(false);
  expect(new WorkspaceConfig().read()).toEqual({ storage: "sqlite", installationId: on.installationId });
  const store = new MemoryWorkspace().open(true);
  try { expect(store.cloudEnabled()).toBe(true); } finally { store.close(); }
}, postgresTestTimeoutMs);

// cloud status reporta enabled, installationId, lastAppliedId, pending y oldestPendingAt, con y sin nube.
integration("runCloudStatus reports enabled, installation id, last applied id, pending and oldest pending", async () => {
  initialized();
  expect(runCloudStatus()).toEqual({ enabled: false, installationId: null, lastAppliedId: null, pending: 0, oldestPendingAt: null });
  const url = await freshDatabase("cloud_control_status");
  const on = await runCloudOn(url);
  const status = runCloudStatus();
  expect(status).toMatchObject({ enabled: true, installationId: on.installationId, lastAppliedId: 0 });
  expect(status.pending).toBeGreaterThanOrEqual(0);
}, postgresTestTimeoutMs);

// Foco de revisión #4: cloud off con pendientes en la cola los sigue mostrando; cloud on con la MISMA base conserva cola y lastAppliedId; con OTRA base reencola todo y lastAppliedId vuelve a 0.
integration("cloud off preserves the pending queue; cloud on keeps it for the same database and re-queues everything for a different one", async () => {
  initialized();
  const workspace = new MemoryWorkspace();
  const urlA = await freshDatabase("cloud_control_queue_a");
  await runCloudOn(urlA);
  const store = workspace.open();
  try { store.createProject("Pending"); } finally { store.close(); }
  // Se simula que esta base ya bajó cambios de A (lastAppliedId > 0), como pasaría tras un sync real: así el reinicio a 0 con otra base (D14) es una afirmación real, no trivial.
  const db = new Database(new WorkspaceConfig().databasePath);
  try { db.query("UPDATE cloud_state SET last_applied_id=7 WHERE id=1").run(); } finally { db.close(); }
  const withPending = runCloudStatus();
  expect(withPending).toMatchObject({ lastAppliedId: 7 });
  expect(withPending.pending).toBeGreaterThan(0);
  await runCloudOff();
  const afterOff = runCloudStatus();
  expect(afterOff).toMatchObject({ enabled: false, pending: withPending.pending, lastAppliedId: withPending.lastAppliedId });
  await runCloudOn(urlA);
  const afterSameDb = runCloudStatus();
  expect(afterSameDb).toMatchObject({ pending: withPending.pending, lastAppliedId: withPending.lastAppliedId });
  const urlB = await freshDatabase("cloud_control_queue_b");
  await runCloudOn(urlB);
  const afterOtherDb = runCloudStatus();
  expect(afterOtherDb.lastAppliedId).toBe(0);
  expect(afterOtherDb.pending).toBeGreaterThan(0);
}, postgresTestTimeoutMs);

// sync con nube prendida sube la cola pendiente (queda vacía) y avanza lastAppliedId sin tocar las tablas revisions/state del mecanismo viejo.
integration("runCloudSync uploads the pending queue and leaves the old snapshot tables untouched", async () => {
  initialized();
  const url = await freshDatabase("cloud_control_sync");
  await runCloudOn(url);
  const store = new MemoryWorkspace().open();
  try { store.createProject("Uploaded"); } finally { store.close(); }
  const seed = new SQL(url);
  try {
    const before = await seed.unsafe("SELECT head FROM forge614_sync.state WHERE id=1");
    const revisionsBefore = await seed.unsafe("SELECT count(*)::int AS n FROM forge614_sync.revisions");
    const result = await runCloudSync();
    expect(result.uploaded).toBeGreaterThan(0);
    expect(runCloudStatus().pending).toBe(0);
    const after = await seed.unsafe("SELECT head FROM forge614_sync.state WHERE id=1");
    const revisionsAfter = await seed.unsafe("SELECT count(*)::int AS n FROM forge614_sync.revisions");
    expect(after[0].head).toBe(before[0].head);
    expect(revisionsAfter[0].n).toBe(revisionsBefore[0].n);
  } finally { await seed.close(); }
}, postgresTestTimeoutMs);

// Sin nube configurada, runCloudSync falla con SYNC_DISABLED (el mismo código que usaba syncWorkspace).
test("runCloudSync fails with SYNC_DISABLED without cloud configuration", async () => {
  initialized();
  await expect(runCloudSync()).rejects.toMatchObject({ code: "SYNC_DISABLED" });
});

// El .env puede tener dirección e id de instalación sin que la base local haya pasado por `cloud on`
// (por ejemplo, un .env copiado de otra instalación): runCloudSync debe rechazarlo con SYNC_DISABLED
// antes de tocar la base, no dejar que SQLite falle con «no such table».
test("runCloudSync fails with SYNC_DISABLED when .env has a full cloud configuration but the database was never enrolled with cloud on", async () => {
  initialized();
  const config = new WorkspaceConfig();
  config.configurePostgres("postgresql://u@127.0.0.1:1/db?sslmode=disable", config.revision(), crypto.randomUUID());
  await expect(runCloudSync()).rejects.toMatchObject({ code: "SYNC_DISABLED" });
});

// `downloaded` debe ser cuántas filas se aplicaron de verdad, no el avance de `lastAppliedId`: con solo
// guardados locales y nada de otra instalación, lo subido son exactamente las filas que había en la cola
// y lo bajado es 0 (las propias filas que vuelven al bajar no cuentan como aplicadas).
integration("runCloudSync reports uploaded as exactly the rows that were queued and downloaded as 0 when nothing came from another installation", async () => {
  initialized();
  const url = await freshDatabase("cloud_control_sync_counts");
  await runCloudOn(url);
  const store = new MemoryWorkspace().open();
  try { store.createProject("One"); store.createProject("Two"); } finally { store.close(); }
  const db = new Database(new WorkspaceConfig().databasePath);
  let queued: number;
  try { queued = (db.query("SELECT count(*) AS n FROM cloud_outbox").get() as { n: number }).n; } finally { db.close(); }
  const result = await runCloudSync();
  expect(result).toEqual({ uploaded: queued, downloaded: 0 });
}, postgresTestTimeoutMs);

// Una fila que ya está en Neon, subida por OTRA instalación, sí debe contar en `downloaded` al bajarla y aplicarla.
integration("runCloudSync reports downloaded as the rows applied from another installation", async () => {
  initialized();
  const url = await freshDatabase("cloud_control_sync_downloaded");
  await runCloudOn(url);
  const replica = await connectCloudReplica(url);
  try {
    await replica.pushChanges(crypto.randomUUID(), [{
      changeId: "other-1", kind: "projects", op: "insert",
      payload: { projectId: "p-other", name: "Other Mac", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    }]);
  } finally { await replica.close(); }
  const result = await runCloudSync();
  expect(result.downloaded).toBe(1);
}, postgresTestTimeoutMs);
