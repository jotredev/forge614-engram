import { afterAll, expect, test } from "bun:test";
import { PostgresReplica, postgresOptions } from "./replica";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../__test-support__/postgres";

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
afterAll(() => { stopPostgresCluster(cluster); }, postgresTestTimeoutMs);

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
