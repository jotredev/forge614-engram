/**
 * Prueba de extremo a extremo de dos instalaciones ("Macs") de Engram sincronizando la misma
 * memoria a través de un PostgreSQL local de la suite (se salta si no hay uno disponible): cada
 * "Mac" es una carpeta de usuario propia con su propio FORGE614_HOME, manejada por completo a
 * través de la CLI real (proceso aparte), igual que la usaría la persona. Cubre los 7 escenarios
 * del diseño: primera sincronización, un cambio posterior, conflicto del mismo recuerdo, cola sin
 * red, identidad de proyecto por remoto de Git, que sin nube nada cambia, y un secreto llegado de
 * la nube que se descarta sin detener la sincronización.
 */
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../src/infrastructure/__test-support__/postgres";
import { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../../src/infrastructure/postgres/replica";

// Un solo servidor de prueba desechable y en loopback (127.0.0.1); nunca una base ambiente ya existente.
const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
let admin!: SQL;
const clusterUrl = cluster.available ? cluster.url : "";
if (cluster.available) admin = new SQL(cluster.url);
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async () => {
  if (!cluster.available) return;
  try { await admin.close(); } finally { stopPostgresCluster(cluster); }
}, postgresTestTimeoutMs);

/** Crea una base de PostgreSQL nueva y desechable, y da su URL de conexión (una por escenario, para que no se mezclen). */
async function freshDatabase(name: string): Promise<string> {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`); await admin.unsafe(`CREATE DATABASE ${name}`);
  return clusterUrl.replace(/\/postgres(\?|$)/, `/${name}$1`);
}

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const directories: string[] = [];

/**
 * Crea una "Mac de mentira": una carpeta de usuario propia con su propio FORGE614_HOME, aislada de
 * las demás. La usan los 7 escenarios para representar cada instalación por separado.
 */
function createMac() {
  const home = mkdtempSync(join(tmpdir(), "forge614-mac-"));
  directories.push(home);
  return { home, engramDir: join(home, "engram") };
}

/**
 * Corre un comando de la CLI real como proceso aparte contra una "Mac" dada. Usa `Bun.spawn`
 * asíncrono (no `Bun.spawnSync`), por el error confirmado y sin corregir aguas arriba
 * (oven-sh/bun#34069) documentado ya en `src/interfaces/cli/__tests__/cli.e2e.test.ts`.
 */
async function run(mac: { home: string }, cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: { ...process.env, FORGE614_HOME: mac.home }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
/** Como `run`, pero corre dentro de la propia carpeta de la "Mac" (equivalente a estar parado en su HOME). */
function runIn(mac: { home: string }, ...args: string[]) { return run(mac, mac.home, ...args); }

/** Da la huella SHA-256 del contenido de un archivo, o `null` si no existe. */
function fingerprint(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
  catch { return null; }
}
/** Nombres de las tablas de una base SQLite, para comprobar si el bloque `cloud_*` (nivel 12) existe. */
function tableNames(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try { return (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name); }
  finally { db.close(); }
}

// Escenario 1: la primera sincronización sube toda la memoria previa de A y B la baja completa (D14).
integration("first sync: Mac A uploads everything it already had, Mac B downloads it all", async () => {
  const macA = createMac(), macB = createMac();
  expect((await runIn(macA, "init", "--json")).code).toBe(0);
  const first = JSON.parse((await runIn(macA, "save", "--scope", "shared", "--title", "First memory", "--content", "Kept before enabling the cloud")).stdout);
  const second = JSON.parse((await runIn(macA, "save", "--scope", "shared", "--title", "Second memory", "--content", "Also kept before enabling the cloud")).stdout);
  const url = await freshDatabase("t6_scenario1");
  expect((await runIn(macA, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  const uploaded = JSON.parse((await runIn(macA, "sync")).stdout);
  expect(uploaded.uploaded).toBeGreaterThanOrEqual(2);
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  const downloaded = JSON.parse((await runIn(macB, "sync")).stdout);
  expect(downloaded.downloaded).toBeGreaterThanOrEqual(2);
  const gotFirst = JSON.parse((await runIn(macB, "get", "--scope", "shared", "--id", first.id)).stdout);
  expect(gotFirst).toMatchObject({ id: first.id, title: "First memory", content: "Kept before enabling the cloud" });
  const gotSecond = JSON.parse((await runIn(macB, "get", "--scope", "shared", "--id", second.id)).stdout);
  expect(gotSecond).toMatchObject({ id: second.id, title: "Second memory", content: "Also kept before enabling the cloud" });
}, postgresTestTimeoutMs);

// Escenario 2: tras la primera sincronización, un cambio nuevo de A llega a B en el siguiente ciclo.
integration("a change saved on A reaches B after one more sync cycle", async () => {
  const macA = createMac(), macB = createMac();
  expect((await runIn(macA, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("t6_scenario2");
  expect((await runIn(macA, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await runIn(macA, "sync")).code).toBe(0);
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  const later = JSON.parse((await runIn(macA, "save", "--scope", "shared", "--title", "Later memory", "--content", "Saved after the first sync")).stdout);
  expect((await runIn(macA, "sync")).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  const found = JSON.parse((await runIn(macB, "search", "--scope", "shared", "--query", "Later memory")).stdout);
  expect(found).toHaveLength(1);
  expect(found[0].memory.id).toBe(later.id);
}, postgresTestTimeoutMs);

// Escenario 3 (D4): A y B cambian el mismo recuerdo sin sincronizar entre sí; ninguna versión se pierde,
// gana la más reciente por fecha, la otra queda en el historial, y el aviso de conflicto sale una sola vez.
integration("conflicting edits on the same memory: no version is lost, and the notice shows exactly once", async () => {
  const macA = createMac(), macB = createMac();
  expect((await runIn(macA, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("t6_scenario3");
  expect((await runIn(macA, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  const original = JSON.parse((await runIn(macA, "save", "--scope", "shared", "--title", "Conflict target", "--content", "Original", "--topic", "shared/conflict")).stdout);
  expect((await runIn(macA, "sync")).code).toBe(0);
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  expect(JSON.parse((await runIn(macB, "get", "--scope", "shared", "--id", original.id)).stdout).content).toBe("Original");
  // Los dos cambian el mismo recuerdo desde la misma versión (1), sin sincronizar entre sí todavía.
  const fromA = await runIn(macA, "save", "--scope", "shared", "--topic", "shared/conflict", "--expected-version", "1", "--title", "Conflict target", "--content", "Changed by A");
  expect(fromA.code).toBe(0);
  // Espera corta para que el cambio de B quede con fecha estrictamente posterior al de A (D4: gana la más reciente).
  await new Promise(resolve => setTimeout(resolve, 20));
  const fromB = await runIn(macB, "save", "--scope", "shared", "--topic", "shared/conflict", "--expected-version", "1", "--title", "Conflict target", "--content", "Changed by B");
  expect(fromB.code).toBe(0);
  // Orden del diseño: A sync, B sync, A sync (así el conflicto se ve completo en las dos instalaciones).
  expect((await runIn(macA, "sync")).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  expect((await runIn(macA, "sync")).code).toBe(0);
  // Se comprueba en las dos Mac: gana la más reciente (D4) y ninguna versión se pierde.
  for (const mac of [macA, macB]) {
    const history = JSON.parse((await runIn(mac, "history", "--scope", "shared", "--id", original.id)).stdout) as { content: string }[];
    expect(history.map(v => v.content).sort()).toEqual(["Original", "Changed by A", "Changed by B"].sort());
    const active = JSON.parse((await runIn(mac, "get", "--scope", "shared", "--id", original.id)).stdout);
    expect(active.content).toBe("Changed by B");
  }
  // El aviso de conflicto sale una sola vez, en el primer session-start posterior; en el siguiente ya no.
  const firstStart = JSON.parse((await runIn(macB, "session-start", "--directory", macB.home, "--session-id", "watch-conflict")).stdout);
  expect(firstStart.sessionNotice).toContain("Cloud sync: 1 memory had a conflicting change");
  const secondStart = JSON.parse((await runIn(macB, "session-start", "--directory", macB.home, "--session-id", "watch-conflict-2")).stdout);
  expect(secondStart.sessionNotice ?? "").not.toContain("had a conflicting change");
}, postgresTestTimeoutMs);

// Escenario 4 (D9, Foco de revisión #4): sin red, la cola espera intacta; al restaurar la dirección, sube y queda en 0.
integration("offline: the queue waits intact and uploads once the address is restored", async () => {
  const macA = createMac();
  expect((await runIn(macA, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("t6_scenario4");
  const on = JSON.parse((await runIn(macA, "cloud", "on", "--postgres-url", url)).stdout);
  expect((await runIn(macA, "save", "--scope", "shared", "--title", "Offline save", "--content", "Queued while offline")).code).toBe(0);
  const beforeCut = JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout);
  expect(beforeCut.pending).toBeGreaterThan(0);
  // Cambiar la dirección a un puerto cerrado en 127.0.0.1 no se puede pedir por la CLI (cloud on prueba
  // la conexión antes de escribir), así que se escribe directo con la misma forma de archivo y permisos.
  const config = new WorkspaceConfig(macA.engramDir);
  const closedPortUrl = "postgresql://u@127.0.0.1:1/db?sslmode=disable";
  config.configurePostgres(closedPortUrl, config.revision(), on.installationId);
  const failed = await runIn(macA, "sync");
  expect(failed.code).toBe(1);
  expect(JSON.parse(failed.stderr).code).toBe("POSTGRES_UNAVAILABLE");
  const stillPending = JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout);
  expect(stillPending.pending).toBe(beforeCut.pending);
  // Se restaura la dirección real: el siguiente sync sube la cola y la deja en 0.
  config.configurePostgres(url, config.revision(), on.installationId);
  const restored = JSON.parse((await runIn(macA, "sync")).stdout);
  expect(restored.uploaded).toBeGreaterThanOrEqual(stillPending.pending);
  const afterRestore = JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout);
  expect(afterRestore.pending).toBe(0);
  // Refuerzo: un push que de verdad se intenta pero falla a medio camino (aquí, porque la base remota
  // quedó de solo lectura, sin romper su esquema) tampoco debe perder la fila local: solo se borra de
  // la cola lo que la réplica confirmó recibido, nunca antes de intentar subirlo.
  expect((await runIn(macA, "save", "--scope", "shared", "--title", "Read-only push", "--content", "Must survive a failed push")).code).toBe(0);
  const beforeReadOnly = JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout);
  expect(beforeReadOnly.pending).toBeGreaterThan(0);
  await admin.unsafe("ALTER DATABASE t6_scenario4 SET default_transaction_read_only = on");
  try {
    const readOnlyFailure = await runIn(macA, "sync");
    expect(readOnlyFailure.code).toBe(1);
    const stillQueued = JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout);
    expect(stillQueued.pending).toBe(beforeReadOnly.pending);
  } finally {
    await admin.unsafe("ALTER DATABASE t6_scenario4 SET default_transaction_read_only = off");
  }
  const readOnlyRestored = JSON.parse((await runIn(macA, "sync")).stdout);
  expect(readOnlyRestored.uploaded).toBeGreaterThanOrEqual(beforeReadOnly.pending);
  expect(JSON.parse((await runIn(macA, "cloud", "status", "--json")).stdout).pending).toBe(0);
  // B baja lo que A pudo subir tras restaurar la dirección.
  const macB = createMac();
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  const found = JSON.parse((await runIn(macB, "search", "--scope", "shared", "--query", "Offline save")).stdout);
  expect(found).toHaveLength(1);
}, postgresTestTimeoutMs);

// Escenario 5 (D6, T3b): una carpeta sin archivo de identidad se reconoce por su remoto de Git equivalente.
integration("a project without .forge614/project.json is recognized by its Git remote", async () => {
  const macA = createMac(), macB = createMac();
  expect((await runIn(macA, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("t6_scenario5");
  expect((await runIn(macA, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  const repoA = mkdtempSync(join(tmpdir(), "forge614-repo-a-"));
  directories.push(repoA);
  await Bun.spawn(["git", "init"], { cwd: repoA, stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "remote", "add", "origin", "https://github.com/example/repo.git"], { cwd: repoA, stdout: "ignore", stderr: "ignore" }).exited;
  // Ligar la carpeta con `init --json --directory` (D6): con la nube activa y un remoto usable, crea el
  // proyecto y anota su remoto normalizado, sin escribir `.forge614/project.json` con un vínculo distinto.
  const bound = JSON.parse((await run(macA, repoA, "init", "--json", "--directory", repoA)).stdout);
  expect(bound.project.projectId).toBeTruthy();
  expect((await run(macA, repoA, "save", "--project-id", bound.project.projectId, "--title", "From A's repo", "--content", "Bound by Git remote")).code).toBe(0);
  expect((await runIn(macA, "sync")).code).toBe(0);
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await runIn(macB, "sync")).code).toBe(0);
  const repoB = mkdtempSync(join(tmpdir(), "forge614-repo-b-"));
  directories.push(repoB);
  await Bun.spawn(["git", "init"], { cwd: repoB, stdout: "ignore", stderr: "ignore" }).exited;
  // Remoto equivalente al de A (ssh en vez de https, sin ".git" final ya presente igual): D6 lo reconoce como el mismo proyecto.
  await Bun.spawn(["git", "remote", "add", "origin", "git@github.com:example/repo.git"], { cwd: repoB, stdout: "ignore", stderr: "ignore" }).exited;
  const boundB = JSON.parse((await run(macB, repoB, "init", "--json", "--directory", repoB)).stdout);
  expect(boundB.project.projectId).toBe(bound.project.projectId);
}, postgresTestTimeoutMs);

// Escenario 6 (M5): sin `cloud on`, ni el `.env` ni el nivel de esquema cambian con el uso normal de la CLI.
test("without the cloud, nothing about the database or .env changes", async () => {
  const mac = createMac();
  expect((await runIn(mac, "init", "--json")).code).toBe(0);
  const envPath = join(mac.engramDir, ".env");
  const dbPath = join(mac.engramDir, "engram.db");
  const envBefore = fingerprint(envPath);
  expect((await runIn(mac, "session-start", "--directory", mac.home, "--session-id", "no-cloud")).code).toBe(0);
  expect((await runIn(mac, "save", "--scope", "shared", "--title", "Local only", "--content", "Never leaves this Mac")).code).toBe(0);
  expect((await runIn(mac, "startup-context", "--directory", mac.home, "--json", "--format", "2")).code).toBe(0);
  // sync sin nube debe portarse como antes de T5: SYNC_DISABLED, sin tocar nada.
  const syncResult = await runIn(mac, "sync");
  expect(syncResult.code).toBe(1);
  expect(JSON.parse(syncResult.stderr).code).toBe("SYNC_DISABLED");
  expect(fingerprint(envPath)).toBe(envBefore);
  expect(tableNames(dbPath).filter(name => name.startsWith("cloud_"))).toEqual([]);
}, 40000);

// Escenario 7 (D5): un secreto que llega de Neon se rechaza sin detener la sincronización, y el resto del lote se aplica.
integration("a secret arriving from the cloud is rejected without stopping the rest of the batch", async () => {
  const macB = createMac();
  expect((await runIn(macB, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("t6_scenario7");
  expect((await runIn(macB, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  // Se prepara el dato imposible por la CLI: otra instalación empuja directo a Neon una fila con un
  // secreto (misma prueba que src/app/cloud-apply.test.ts) y, en el mismo lote, una fila válida.
  const seed = await PostgresReplica.connect(url, true);
  try {
    await seed.pushChanges("00000000-0000-4000-8000-000000000001", [
      { changeId: crypto.randomUUID(), kind: "memories", op: "insert", payload: {
        id: crypto.randomUUID(), projectId: null, scope: "shared", topic_key: null, type: "fact",
        title: "Leaked key", content: "token AKIAABCDEFGHIJKLMNOP", pinned: 0, version: 1, state: "active",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null,
      } },
      { changeId: crypto.randomUUID(), kind: "projects", op: "insert", payload: {
        projectId: crypto.randomUUID(), name: "From the cloud batch", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      } },
    ]);
  } finally { await seed.close(); }
  expect((await runIn(macB, "sync")).code).toBe(0);
  const search = JSON.parse((await runIn(macB, "search", "--scope", "shared", "--query", "Leaked key")).stdout);
  expect(search).toHaveLength(0);
  const projects = JSON.parse((await runIn(macB, "project-list")).stdout) as { name: string }[];
  expect(projects.map(p => p.name)).toContain("From the cloud batch");
  const notice = JSON.parse((await runIn(macB, "session-start", "--directory", macB.home, "--session-id", "watch-secret")).stdout);
  expect(notice.sessionNotice).toContain("Cloud sync: 1 change from the cloud was skipped");
}, postgresTestTimeoutMs);
