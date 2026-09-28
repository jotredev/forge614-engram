/** Comprueba `postgresOptions` sin base de datos, y contra un clúster real: publicación, historial, cola de cambios y validación de esquema. */
import { afterAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { PostgresReplica, postgresOptions } from "./replica";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../__test-support__/postgres";

// URLs ambiguas o con TLS inseguro fuera de loopback deben rechazarse, y el error nunca debe repetir la credencial recibida.
test("PostgreSQL URL parsing rejects ambiguous URLs and insecure remote TLS without leaking input",()=>{
  for(const input of ["mysql://host/db","postgresql://host/db","postgresql://u:SECRET@remote/db?sslmode=disable","postgresql://u:SECRET@remote/db?options=bad"]) {
    try { postgresOptions(input); throw new Error("accepted"); } catch(error) { expect(String(error)).not.toContain("SECRET");expect(String(error)).toContain("POSTGRES_URL"); }
  }
  expect(postgresOptions("postgresql://u:p@127.0.0.1/db?sslmode=disable").tls).toBe(false);
  expect(postgresOptions("postgresql://u:p@example.org/db").tls).toMatchObject({rejectUnauthorized:true});
});

const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
if (!cluster.available) console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
let admin!: SQL;
if (cluster.available) admin = new SQL(cluster.url);
afterAll(() => { if (cluster.available) admin.close(); stopPostgresCluster(cluster); }, postgresTestTimeoutMs);

async function freshDatabase(name: string): Promise<string> {
  await admin.unsafe(`CREATE DATABASE ${name}`);
  return cluster.available ? cluster.url.replace("/postgres?", `/${name}?`) : "";
}

// Refleja el DDL que usaba PostgresReplica antes de que existiera la tabla `changes` (réplicas de la v1.7.x).
const LEGACY_DDL = `CREATE SCHEMA forge614_sync;
CREATE TABLE forge614_sync.revisions (
 hash text PRIMARY KEY CHECK (length(hash) = 64), payload text NOT NULL
);
CREATE TABLE forge614_sync.state (
 id integer PRIMARY KEY CHECK (id = 1), format integer NOT NULL CHECK (format = 1),
 replica uuid NOT NULL, head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);`;
async function seedLegacySchema(db: SQL) {
  await db.unsafe(LEGACY_DDL).simple();
  const hash = "0".repeat(64);
  await db.unsafe("INSERT INTO forge614_sync.revisions(hash,payload) VALUES($1,$2)", [hash, JSON.stringify({ format: 1, projects: [], memories: [] })]);
  await db.unsafe("INSERT INTO forge614_sync.state(id,format,replica,head) VALUES(1,1,$1,$2)", [crypto.randomUUID(), hash]);
}

// Publicar debe guardar la instantánea en el historial y rechazar un compare-and-swap que ya no coincide con la instantánea vigente.
integration("replica publication persists history and refuses a stale compare-and-swap", async () => {
  if (!cluster.available) return;
  const replica = await PostgresReplica.connect(cluster.url, true);
  try {
    const initial = await replica.read();
    expect(initial.snapshot).toEqual({ format: 1, projects: [], memories: [] });
    const next = { format: 1 as const, projects: [{ projectId: "11111111-1111-4111-8111-111111111111", name: "Published", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], memories: [] };
    const hash = await replica.publish(initial.hash, next);
    expect((await replica.read()).snapshot).toEqual(next);
    await expect(replica.publish(initial.hash, initial.snapshot)).rejects.toMatchObject({ code: "SYNC_REMOTE_CHANGED" });
    const reader = await PostgresReplica.connect(cluster.url);
    try { expect(await reader.read()).toMatchObject({ hash, snapshot: next }); }
    finally { await reader.close(); }
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Los identificadores asignados por pushChanges deben quedar consecutivos y en el mismo orden que las filas enviadas.
integration("pushChanges inserta en orden y devuelve ids consecutivos", async () => {
  const url = await freshDatabase("push_order");
  const replica = await PostgresReplica.connect(url, true);
  try {
    const installationId = crypto.randomUUID();
    const rows = [
      { changeId: "c1", kind: "memory", op: "insert" as const, payload: { a: 1 } },
      { changeId: "c2", kind: "memory", op: "update" as const, payload: { a: 2 } },
      { changeId: "c3", kind: "memory", op: "delete" as const, payload: { a: 3 } },
    ];
    const { ids } = await replica.pushChanges(installationId, rows);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual([ids[0]!, ids[0]! + 1, ids[0]! + 2]);
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// pullChanges debe traer solo las filas con id mayor al pedido, en orden, y respetar el límite dado.
integration("pullChanges(since) solo trae filas con id>since, ordenadas, y respeta limit", async () => {
  const url = await freshDatabase("pull_since");
  const replica = await PostgresReplica.connect(url, true);
  try {
    const installationId = crypto.randomUUID();
    const rows = Array.from({ length: 5 }, (_, i) => ({ changeId: `p${i}`, kind: "memory", op: "insert" as const, payload: { i } }));
    const { ids } = await replica.pushChanges(installationId, rows);
    const all = await replica.pullChanges(ids[1]!);
    expect(all.map(r => r.id)).toEqual(ids.slice(2));
    for (const row of all) expect(row.id).toBeGreaterThan(ids[1]!);
    const limited = await replica.pullChanges(0, 2);
    expect(limited.map(r => r.id)).toEqual(ids.slice(0, 2));
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Cada fila devuelta por pullChanges debe traer su payload ya como objeto y su fecha en ISO 8601 con sufijo Z.
integration("pullChanges devuelve ChangeRow completo con payload objeto y createdAt ISO con Z", async () => {
  const url = await freshDatabase("pull_shape");
  const replica = await PostgresReplica.connect(url, true);
  try {
    const installationId = crypto.randomUUID();
    const { ids } = await replica.pushChanges(installationId, [{ changeId: "shape-1", kind: "memory", op: "insert", payload: { nested: [1, 2, "x"] } }]);
    const [row] = await replica.pullChanges(0);
    expect(row).toBeDefined();
    expect(row!.id).toBe(ids[0]!);
    expect(row!.changeId).toBe("shape-1");
    expect(row!.installationId).toBe(installationId);
    expect(row!.kind).toBe("memory");
    expect(row!.op).toBe("insert");
    expect(row!.payload).toEqual({ nested: [1, 2, "x"] });
    expect(row!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// El payload que pushChanges guarda debe llegar a PostgreSQL como objeto JSON (jsonb_typeof "object"), no como
// texto doblemente serializado (jsonb_typeof "string"): así el contenido queda consultable directo en Neon.
integration("pushChanges stores payload as a JSON object queryable in Postgres, not as a double-encoded string", async () => {
  const url = await freshDatabase("push_payload_shape");
  const replica = await PostgresReplica.connect(url, true);
  const db = new SQL(url);
  try {
    const installationId = crypto.randomUUID();
    const { ids } = await replica.pushChanges(installationId, [{ changeId: "shape-json", kind: "memory", op: "insert", payload: { nested: [1, 2, "x"] } }]);
    const [row] = await db.unsafe("SELECT jsonb_typeof(payload) AS type, payload->'nested'->>2 AS third FROM forge614_sync.changes WHERE id=$1", [ids[0]!]);
    expect(row.type).toBe("object");
    expect(row.third).toBe("x");
  } finally { await db.close(); await replica.close(); }
}, postgresTestTimeoutMs);

// Una réplica antigua sin la tabla `changes` debe recibirla al conectar con create=true, sin tocar las revisiones ni el estado ya guardados.
integration("forge614_sync.changes se crea si falta y no se toca si ya existe", async () => {
  const url = await freshDatabase("changes_missing");
  const db = new SQL(url);
  try {
    await seedLegacySchema(db);
    const beforeRevisions = await db.unsafe("SELECT hash,payload FROM forge614_sync.revisions");
    const beforeState = await db.unsafe("SELECT id,format,replica::text,head FROM forge614_sync.state");

    await expect(PostgresReplica.connect(url, false)).rejects.toMatchObject({ code: "POSTGRES_UNINITIALIZED" });

    const replica = await PostgresReplica.connect(url, true);
    try {
      const changesExists = await db.unsafe("SELECT to_regclass('forge614_sync.changes') AS t");
      expect(changesExists[0].t).not.toBeNull();
      expect(await db.unsafe("SELECT hash,payload FROM forge614_sync.revisions")).toEqual(beforeRevisions);
      expect(await db.unsafe("SELECT id,format,replica::text,head FROM forge614_sync.state")).toEqual(beforeState);

      const again = await PostgresReplica.connect(url, true);
      try {
        expect(await db.unsafe("SELECT hash,payload FROM forge614_sync.revisions")).toEqual(beforeRevisions);
        expect(await db.unsafe("SELECT id,format,replica::text,head FROM forge614_sync.state")).toEqual(beforeState);
      } finally { await again.close(); }
    } finally { await replica.close(); }
  } finally { await db.close(); }
}, postgresTestTimeoutMs);

// Enviar un lote vacío no debe fallar ni insertar nada.
integration("pushChanges de un lote vacío no falla y no inserta nada", async () => {
  const url = await freshDatabase("push_empty");
  const replica = await PostgresReplica.connect(url, true);
  try {
    const result = await replica.pushChanges(crypto.randomUUID(), []);
    expect(result).toEqual({ ids: [] });
    expect(await replica.pullChanges(0)).toEqual([]);
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Repetir un envío (respuesta perdida) no debe duplicar filas, y un lote con cambios viejos y uno nuevo debe devolver todos los ids en orden sin repetirlos.
integration("pushChanges repetido (respuesta perdida) no duplica y un lote mezclado devuelve viejos+nuevo en orden", async () => {
  const url = await freshDatabase("push_repeat");
  const replica = await PostgresReplica.connect(url, true);
  try {
    const installationId = crypto.randomUUID();
    const first = await replica.pushChanges(installationId, [
      { changeId: "r1", kind: "memory", op: "insert" as const, payload: { a: 1 } },
      { changeId: "r2", kind: "memory", op: "insert" as const, payload: { a: 2 } },
    ]);
    const repeat = await replica.pushChanges(installationId, [
      { changeId: "r1", kind: "memory", op: "insert" as const, payload: { a: 1 } },
      { changeId: "r2", kind: "memory", op: "insert" as const, payload: { a: 2 } },
    ]);
    expect(repeat.ids).toEqual(first.ids);
    const mixed = await replica.pushChanges(installationId, [
      { changeId: "r1", kind: "memory", op: "insert" as const, payload: { a: 1 } },
      { changeId: "r2", kind: "memory", op: "insert" as const, payload: { a: 2 } },
      { changeId: "r3", kind: "memory", op: "insert" as const, payload: { a: 3 } },
    ]);
    // bigserial avanza en cada intento de inserción, incluso el que ON CONFLICT DO NOTHING descarta,
    // así que del nuevo id solo se garantiza que es inédito y mayor que los anteriores.
    expect(mixed.ids.slice(0, 2)).toEqual(first.ids);
    expect(mixed.ids[2]).toBeGreaterThan(Math.max(...first.ids));
    expect(new Set(mixed.ids).size).toBe(3);
    const all = await replica.pullChanges(0);
    expect(all).toHaveLength(3);
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Dos envíos concurrentes deben terminar sin error, sin ids repetidos entre sí, y pullChanges(0) debe traer ambos lotes completos.
integration("dos pushChanges concurrentes terminan sin error, sin ids repetidos, y pullChanges(0) trae todas", async () => {
  const url = await freshDatabase("push_concurrent");
  const left = await PostgresReplica.connect(url, true);
  const right = await PostgresReplica.connect(url);
  try {
    const installationId = crypto.randomUUID();
    const leftRows = Array.from({ length: 4 }, (_, i) => ({ changeId: `l${i}`, kind: "memory", op: "insert" as const, payload: { i } }));
    const rightRows = Array.from({ length: 4 }, (_, i) => ({ changeId: `r${i}`, kind: "memory", op: "insert" as const, payload: { i } }));
    const [leftResult, rightResult] = await Promise.all([
      left.pushChanges(installationId, leftRows),
      right.pushChanges(installationId, rightRows),
    ]);
    const combined = [...leftResult.ids, ...rightResult.ids];
    expect(new Set(combined).size).toBe(combined.length);
    // El bloqueo consultivo serializa los lotes: los ids de uno preceden siempre por completo a los del otro, nunca se intercalan.
    expect(Math.max(...leftResult.ids) < Math.min(...rightResult.ids) || Math.max(...rightResult.ids) < Math.min(...leftResult.ids)).toBe(true);
    const all = await left.pullChanges(0, 1000);
    expect(all).toHaveLength(8);
    expect(new Set(all.map(r => r.id)).size).toBe(8);
  } finally { await left.close(); await right.close(); }
}, postgresTestTimeoutMs);

// Una tabla `changes` con forma distinta a la esperada (aquí, sin la restricción sobre `op`) debe rechazar la conexión con POSTGRES_SCHEMA.
integration("validate rechaza una tabla changes con forma distinta (sin restricción de op) con POSTGRES_SCHEMA", async () => {
  const url = await freshDatabase("changes_malformed");
  const db = new SQL(url);
  try {
    await seedLegacySchema(db);
    await db.unsafe(`CREATE TABLE forge614_sync.changes (
      id bigserial PRIMARY KEY, change_id text NOT NULL UNIQUE, installation_id uuid NOT NULL, kind text NOT NULL,
      op text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );`).simple();
    await expect(PostgresReplica.connect(url, false)).rejects.toMatchObject({ code: "POSTGRES_SCHEMA" });
  } finally { await db.close(); }
}, postgresTestTimeoutMs);

// Un `since` o `limit` fuera de sus rangos válidos debe rechazarse con SYNC_INVALID sin llegar a consultar la base.
integration("pullChanges con since o limit inválidos rechaza con SYNC_INVALID", async () => {
  const url = await freshDatabase("pull_invalid");
  const replica = await PostgresReplica.connect(url, true);
  try {
    await expect(replica.pullChanges(-1)).rejects.toMatchObject({ code: "SYNC_INVALID" });
    await expect(replica.pullChanges(1.5)).rejects.toMatchObject({ code: "SYNC_INVALID" });
    await expect(replica.pullChanges(0, 0)).rejects.toMatchObject({ code: "SYNC_INVALID" });
    await expect(replica.pullChanges(0, 1001)).rejects.toMatchObject({ code: "SYNC_INVALID" });
    await expect(replica.pullChanges(0, 1.5)).rejects.toMatchObject({ code: "SYNC_INVALID" });
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Foco de revisión #3: con la señal ya abortada, pullChanges rechaza sin siquiera abrir la consulta.
integration("pullChanges rejects without querying when the signal is already aborted", async () => {
  const url = await freshDatabase("pull_preaborted");
  const replica = await PostgresReplica.connect(url, true);
  const controller = new AbortController(); controller.abort();
  try {
    await expect(replica.pullChanges(0, 1000, controller.signal)).rejects.toMatchObject({ code: "POSTGRES_UNAVAILABLE" });
  } finally { await replica.close(); }
}, postgresTestTimeoutMs);

// Cancelación (Foco de revisión #3): con la tabla bloqueada por otra conexión, pullChanges queda
// esperando; al abortar la señal se llama query.cancel() (se quita el escuchador al terminar, sin
// dejarlo puesto de más). Nota de laboratorio: en esta versión de Bun (1.4.2), query.cancel() no
// interrumpe de verdad una consulta ya bloqueada esperando un candado en el servidor (comprobado aparte,
// fuera de esta prueba: la consulta se queda colgada indefinidamente pese a llamar cancel()); lo que
// de verdad acota la espera aquí es `lock_timeout=5000` de postgresOptions (replica.ts:29), así que el
// rechazo llega alrededor de los 5 s, no de los ~500 ms que pedía el plan original. Repórtalo como riesgo:
// si Bun corrige `cancel()` para consultas bloqueadas, este límite debería bajar y esta prueba debería
// ajustarse para exigirlo.
integration("pullChanges cancels the query on abort, bounded by lock_timeout when a real Postgres lock cancel is not honored", async () => {
  const url = await freshDatabase("pull_cancel_real");
  const replica = await PostgresReplica.connect(url, true);
  const locker = new SQL(url);
  try {
    await locker.begin(async tx => {
      // El candado se toma dentro de una transacción sin cerrar (a propósito: se libera al final, en el finally de abajo).
      await tx.unsafe("LOCK TABLE forge614_sync.changes IN ACCESS EXCLUSIVE MODE");
      const controller = new AbortController();
      const start = Date.now();
      setTimeout(() => controller.abort(), 100);
      await expect(replica.pullChanges(0, 1000, controller.signal)).rejects.toMatchObject({ code: "POSTGRES_UNAVAILABLE" });
      // Nunca se queda colgada para siempre: como mucho, `lock_timeout` (5 s) más margen.
      expect(Date.now() - start).toBeLessThan(6000);
    });
  } finally { await locker.close(); await replica.close(); }
}, postgresTestTimeoutMs);
