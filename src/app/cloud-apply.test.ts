/**
 * Comprueba applyCloudChanges: el guardia se libera incluso tras un error fuera del savepoint
 * de una fila, las filas propias no se reaplican, una fila inválida no detiene la tanda, los
 * secretos se rechazan sin frenar la sincronización, gana la fecha más reciente (con empate
 * determinista), un cierre de sesión local no se deshace, un borrado es idempotente, un
 * choque de clave temática converge en ambos sentidos, y los conflictos de versión reasignan,
 * notifican y son estables ante una repetición de la misma fila.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { enableCloud, initialize } from "../infrastructure/sqlite/schema";
import { createProject } from "../infrastructure/sqlite/projects";
import { save, saveSessionSummary, saveWithSession, startSession } from "../infrastructure/sqlite/writes";
import type { ChangeRow } from "../infrastructure/postgres/replica";
import { applyCloudChanges } from "./cloud-apply";

function freshCloudDb(): Database {
  const db = new Database(":memory:");
  initialize(db);
  enableCloud(db);
  return db;
}

function drainOutbox(db: Database, installationId: string): ChangeRow[] {
  const rows = db.query("SELECT id,kind,op,payload,created_at FROM cloud_outbox ORDER BY id").all() as
    { id: number; kind: string; op: string; payload: string; created_at: string }[];
  db.exec("DELETE FROM cloud_outbox");
  return rows.map(row => ({ id: row.id, changeId: String(row.id), installationId, kind: row.kind,
    op: row.op as "insert" | "update" | "delete", payload: JSON.parse(row.payload), createdAt: row.created_at }));
}

const notices = (db: Database) => db.query("SELECT code,payload FROM cloud_notices ORDER BY id").all() as { code: string; payload: string }[];
const memory = (db: Database, id: string) => db.query("SELECT * FROM memories WHERE id=?").get(id) as Record<string, unknown>;

// Verifica que un error lanzado fuera del savepoint de cualquier fila (aquí, al actualizar last_applied_id) deshace toda la transacción, incluido el guardia, y que un guardado local posterior vuelve a encolarse con normalidad.
test("Review Focus #1: la guardia se libera tras un rollback y un guardado local vuelve a encolar", () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  const bad: ChangeRow = { id: 1, changeId: "x", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p1", name: "ok", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const originalQuery = db.query.bind(db);
  Object.defineProperty(db, "query", { value: (sql: string) => {
    const statement = originalQuery(sql);
    if (sql === "UPDATE cloud_state SET last_applied_id=? WHERE id=1") {
      return { ...statement, run: () => { throw new Error("boom outside any row's savepoint"); } };
    }
    return statement;
  }, configurable: true });
  expect(() => applyCloudChanges(db, [bad], "local")).toThrow();
  Object.defineProperty(db, "query", { value: originalQuery, configurable: true });
  expect((db.query("SELECT apply_guard FROM cloud_state WHERE id=1").get() as { apply_guard: number }).apply_guard).toBe(0);
  db.exec("DELETE FROM cloud_outbox");
  createProject(db, "after-rollback");
  expect((db.query("SELECT count(*) AS n FROM cloud_outbox").get() as { n: number }).n).toBe(1);
});

// Verifica que una fila cuya instalación coincide con la propia no se cuenta como aplicada ni saltada, y que un guardado normal después sigue encolando en la salida (outbox) sin quedar bloqueado.
test("filas de la propia instalación solo avanzan last_applied_id", () => {
  const db = freshCloudDb();
  db.exec("DELETE FROM cloud_outbox");
  createProject(db, "mine");
  const own = drainOutbox(db, "local");
  const result = applyCloudChanges(db, own, "local");
  expect(result).toEqual({ applied: 0, skipped: 0, conflicts: 0, lastAppliedId: own[0]!.id });
  expect((db.query("SELECT count(*) AS n FROM cloud_outbox").get() as { n: number }).n).toBe(0);
  expect((db.query("SELECT apply_guard FROM cloud_state WHERE id=1").get() as { apply_guard: number }).apply_guard).toBe(0);
  createProject(db, "after-normal-run");
  expect((db.query("SELECT count(*) AS n FROM cloud_outbox").get() as { n: number }).n).toBe(1);
});

// Verifica que una fila con forma inválida en medio de una tanda no detiene las demás: se salta con un aviso INVALID_PAYLOAD y las filas válidas antes y después se aplican igual.
test("Review Focus #2: un payload inválido en medio de una tanda se salta y el resto se aplica", () => {
  const db = freshCloudDb();
  const good1: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p1", name: "one", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const bad: ChangeRow = { id: 2, changeId: "b", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p2" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const good2: ChangeRow = { id: 3, changeId: "c", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p3", name: "three", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const result = applyCloudChanges(db, [good1, bad, good2], "local");
  expect(result).toEqual({ applied: 2, skipped: 1, conflicts: 0, lastAppliedId: 3 });
  expect(db.query("SELECT projectId FROM projects ORDER BY projectId").all()).toEqual([{ projectId: "p1" }, { projectId: "p3" }]);
  expect(notices(db)[0]!.code).toBe("CLOUD_ROW_SKIPPED");
  expect(JSON.parse(notices(db)[0]!.payload)).toEqual({ id: 2, kind: "projects", op: "insert", reason: "INVALID_PAYLOAD" });
});

// Verifica que aplicar una lista vacía de filas devuelve el last_applied_id que ya había guardado, en vez de reiniciarlo a 0.
test("una tanda vacía devuelve el last_applied_id guardado, no 0", () => {
  const db = freshCloudDb();
  db.exec("UPDATE cloud_state SET last_applied_id=41 WHERE id=1");
  expect(applyCloudChanges(db, [], "local")).toEqual({ applied: 0, skipped: 0, conflicts: 0, lastAppliedId: 41 });
});

// Verifica que una fila cuyo "kind" no corresponde a ninguna tabla conocida se salta con un aviso UNKNOWN_KIND en vez de fallar.
test("kind desconocido se salta con aviso UNKNOWN_KIND", () => {
  const db = freshCloudDb();
  const row: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "not_a_table", op: "insert", payload: {}, createdAt: "2026-01-01T00:00:00.000Z" };
  const result = applyCloudChanges(db, [row], "local");
  expect(result).toEqual({ applied: 0, skipped: 1, conflicts: 0, lastAppliedId: 1 });
  expect(JSON.parse(notices(db)[0]!.payload).reason).toBe("UNKNOWN_KIND");
});

// Verifica que una fila que rompe una clave foránea (apunta a un proyecto o grupo inexistente) se salta con un aviso FOREIGN_KEY, y que la fila válida que la sigue igual se aplica.
test("fila huérfana (llave foránea) se salta con aviso y no detiene la tanda", () => {
  const db = freshCloudDb();
  const orphan: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "ecosystem_memberships", op: "insert",
    payload: { projectId: "no-such-project", groupId: "no-such-group", boundAt: "2026-01-01T00:00:00.000Z", source: "command" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const good: ChangeRow = { id: 2, changeId: "b", installationId: "remote", kind: "projects", op: "insert",
    payload: { projectId: "p1", name: "ok", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z" };
  const result = applyCloudChanges(db, [orphan, good], "local");
  expect(result).toEqual({ applied: 1, skipped: 1, conflicts: 0, lastAppliedId: 2 });
  expect(JSON.parse(notices(db)[0]!.payload).reason).toBe("FOREIGN_KEY");
});

// D5: una prueba por cada campo de texto libre, más un caso casi positivo que sí debe aplicarse.
const secretCases: { kind: string; op: "insert"; payload: Record<string, unknown> }[] = [
  { kind: "memories", op: "insert", payload: { id: "m1", projectId: "p1", scope: "project", topic_key: null, type: "fact",
    title: "password: AKIAABCDEFGHIJKLMNOP", content: "ok", pinned: 0, version: 1, state: "active",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null } },
  { kind: "memories", op: "insert", payload: { id: "m2", projectId: "p1", scope: "project", topic_key: null, type: "fact",
    title: "ok", content: "token AKIAABCDEFGHIJKLMNOP", pinned: 0, version: 1, state: "active",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null } },
  { kind: "memories", op: "insert", payload: { id: "m3", projectId: "p1", scope: "project", topic_key: "AKIAABCDEFGHIJKLMNOP", type: "fact",
    title: "ok", content: "ok", pinned: 0, version: 1, state: "active",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null } },
  { kind: "memory_meta", op: "insert", payload: { memory_id: "m1", short: "leak AKIAABCDEFGHIJKLMNOP", review_after: null,
    superseded_by: null, affects: null, updated_at: "2026-01-01T00:00:00.000Z" } },
  { kind: "memory_meta", op: "insert", payload: { memory_id: "m1", short: null, review_after: null, superseded_by: null,
    affects: JSON.stringify(["AKIAABCDEFGHIJKLMNOP"]), updated_at: "2026-01-01T00:00:00.000Z" } },
  { kind: "projects", op: "insert", payload: { projectId: "p9", name: "AKIAABCDEFGHIJKLMNOP",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
  { kind: "memory_versions", op: "insert", payload: { memory_id: "m1", version: 1,
    snapshot: JSON.stringify({ id: "m1", title: "AKIAABCDEFGHIJKLMNOP", content: "ok", version: 1, updatedAt: "2026-01-01T00:00:00.000Z" }) } },
  { kind: "memory_versions", op: "insert", payload: { memory_id: "m1", version: 1,
    snapshot: JSON.stringify({ id: "m1", title: "ok", content: "AKIAABCDEFGHIJKLMNOP", version: 1, updatedAt: "2026-01-01T00:00:00.000Z" }) } },
];
for (const [index, testCase] of secretCases.entries()) {
  // Verifica, para cada campo de texto libre de la lista de arriba, que un secreto (aquí, una clave de acceso de AWS) en ese campo hace que la fila se rechace con el patrón correcto, sin aplicarse.
  test(`D5 #${index + 1}: un secreto en ${testCase.kind} se rechaza sin detener la sincronización`, () => {
    const db = freshCloudDb();
    const project = createProject(db, "p1"); db.exec("DELETE FROM cloud_outbox");
    const payload = { ...testCase.payload };
    if ("projectId" in payload && payload.projectId !== null) payload.projectId = project.projectId;
    if (testCase.kind === "memory_meta" || testCase.kind === "memory_versions") {
      save(db, { projectId: project.projectId, type: "fact", title: "seed", content: "seed" });
      const seedId = (db.query("SELECT id FROM memories WHERE title='seed'").get() as { id: string }).id;
      db.exec("DELETE FROM cloud_outbox");
      (payload as Record<string, unknown>).memory_id = seedId;
      if (testCase.kind === "memory_versions") (payload as Record<string, unknown>).snapshot = (payload.snapshot as string).replace(/"m1"/g, `"${seedId}"`);
    }
    const row: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: testCase.kind, op: testCase.op,
      payload, createdAt: "2026-01-01T00:00:00.000Z" };
    const result = applyCloudChanges(db, [row], "local");
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(0);
    const notice = JSON.parse(notices(db)[notices(db).length - 1]!.payload);
    expect(notice.pattern).toBe("aws-access-key-id");
  });
}

// Verifica que un texto que menciona la palabra "password" pero ya está redactado (censurado) no dispara el rechazo por secreto y la fila se aplica con normalidad.
test("D5 casi positivo: 'password: <redacted>' sí se aplica", () => {
  const db = freshCloudDb();
  const row: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "memories", op: "insert",
    payload: { id: "m1", projectId: null, scope: "shared", topic_key: null, type: "fact",
      title: "password: <redacted>", content: "ok", pinned: 0, version: 1, state: "active",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null }, createdAt: "x" };
  const result = applyCloudChanges(db, [row], "local");
  expect(result).toEqual({ applied: 1, skipped: 0, conflicts: 0, lastAppliedId: 1 });
  expect(memory(db, "m1")!.title).toBe("password: <redacted>");
});

// Verifica que, en una tabla con columna de fecha (aquí, projects), una fila entrante más antigua no sobrescribe la local, pero una más nueva sí.
test("D6: tabla con fecha (projects) — gana el updatedAt más reciente", () => {
  const db = freshCloudDb();
  const project = createProject(db, "local-name"); db.exec("DELETE FROM cloud_outbox");
  const older: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "projects", op: "update",
    payload: { projectId: project.projectId, name: "older", createdAt: project.createdAt, updatedAt: "2000-01-01T00:00:00.000Z" }, createdAt: "x" };
  applyCloudChanges(db, [older], "local");
  expect((db.query("SELECT name FROM projects WHERE projectId=?").get(project.projectId) as { name: string }).name).toBe("local-name");
  const newer: ChangeRow = { id: 2, changeId: "b", installationId: "remote", kind: "projects", op: "update",
    payload: { projectId: project.projectId, name: "newer", createdAt: project.createdAt, updatedAt: "2999-01-01T00:00:00.000Z" }, createdAt: "x" };
  applyCloudChanges(db, [newer], "local");
  expect((db.query("SELECT name FROM projects WHERE projectId=?").get(project.projectId) as { name: string }).name).toBe("newer");
});

// Verifica que dos filas con la misma fecha de actualización se desempatan por JSON canónico de forma que ambas bases llegan al mismo resultado, sin importar en qué orden reciban las dos filas.
test("D6: empate de fecha converge por JSON canónico en las dos bases", () => {
  const rowA: ChangeRow = { id: 1, changeId: "a", installationId: "inst-a", kind: "projects", op: "update",
    payload: { projectId: "p1", name: "aaa", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "x" };
  const rowB: ChangeRow = { id: 1, changeId: "b", installationId: "inst-b", kind: "projects", op: "update",
    payload: { projectId: "p1", name: "zzz", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "x" };
  const dbA = freshCloudDb();
  const dbB = freshCloudDb();
  applyCloudChanges(dbA, [rowA, rowB], "inst-x");
  applyCloudChanges(dbB, [rowB, rowA], "inst-x");
  const nameA = (dbA.query("SELECT name FROM projects WHERE projectId='p1'").get() as { name: string } | null)?.name;
  const nameB = (dbB.query("SELECT name FROM projects WHERE projectId='p1'").get() as { name: string } | null)?.name;
  expect(nameA).toBe(nameB);
});

// Verifica que si la sesión local ya está cerrada y la fila entrante llega con endedAt en null, el cierre local se conserva en vez de reabrirse.
test("sessions: endedAt local no se pierde si el que llega llega en null", () => {
  const db = freshCloudDb();
  createProject(db, "p"); const projectId = (db.query("SELECT projectId FROM projects LIMIT 1").get() as { projectId: string }).projectId;
  startSession(db, projectId, "s1"); db.exec("UPDATE sessions SET endedAt='2026-01-01T00:00:00.000Z' WHERE sessionId='s1'"); db.exec("DELETE FROM cloud_outbox");
  const row: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "sessions", op: "update",
    payload: { sessionId: "s1", projectId, kind: "runtime", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null }, createdAt: "x" };
  applyCloudChanges(db, [row], "local");
  expect((db.query("SELECT endedAt FROM sessions WHERE sessionId='s1'").get() as { endedAt: string }).endedAt).toBe("2026-01-01T00:00:00.000Z");
});

// Verifica que un borrado elimina la fila por su clave natural si existe, y que repetir el mismo borrado (la fila ya no existe) no falla, solo no hace nada.
test("delete: borra por llave natural si existe; no hace nada si no existe", () => {
  const db = freshCloudDb();
  const project = createProject(db, "to-delete"); db.exec("DELETE FROM cloud_outbox");
  const row: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "projects", op: "delete",
    payload: { projectId: project.projectId, name: "to-delete", createdAt: project.createdAt, updatedAt: project.createdAt }, createdAt: "x" };
  applyCloudChanges(db, [row], "local");
  expect(db.query("SELECT * FROM projects WHERE projectId=?").get(project.projectId)).toBeNull();
  const again = applyCloudChanges(db, [{ ...row, id: 2 }], "local");
  expect(again).toEqual({ applied: 1, skipped: 0, conflicts: 0, lastAppliedId: 2 });
});

// Verifica que cuando dos memorias comparten la misma clave temática (topic_key), gana la más reciente y a la otra se le pone en NULL, sin importar en qué orden lleguen las dos filas.
test("D8: tema repetido — el más reciente conserva el tema, el otro queda en NULL (converge en ambos sentidos)", () => {
  const rowKeeper: ChangeRow = { id: 1, changeId: "a", installationId: "inst-a", kind: "memories", op: "insert",
    payload: { id: "m-old", projectId: null, scope: "shared", topic_key: "shared-topic", type: "fact", title: "old", content: "old",
      pinned: 0, version: 1, state: "active", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", groupId: null }, createdAt: "x" };
  const rowNew: ChangeRow = { id: 2, changeId: "b", installationId: "inst-b", kind: "memories", op: "insert",
    payload: { id: "m-new", projectId: null, scope: "shared", topic_key: "shared-topic", type: "fact", title: "new", content: "new",
      pinned: 0, version: 1, state: "active", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", groupId: null }, createdAt: "x" };
  const dbA = freshCloudDb();
  applyCloudChanges(dbA, [rowKeeper, rowNew], "inst-x");
  const dbB = freshCloudDb();
  applyCloudChanges(dbB, [rowNew, rowKeeper], "inst-x");
  for (const db of [dbA, dbB]) {
    expect((memory(db, "m-new") as { topic_key: string | null }).topic_key).toBe("shared-topic");
    expect((memory(db, "m-old") as { topic_key: string | null }).topic_key).toBeNull();
  }
});

// Verifica todo el ciclo de un conflicto de versión: se le asigna a la entrante un número de
// versión local nuevo, se corrige memories.version para que apunte a esa versión reasignada, se
// notifica el conflicto, una fila ligada que llega después (session_entries) usa la versión ya
// traducida, y repetir la misma fila remota no genera un segundo conflicto ni una fila duplicada.
test("D9: conflicto de versiones — reasigna, corrige memories.version, notifica y una entrada ligada llega ligada a K", () => {
  const db = freshCloudDb();
  const project = createProject(db, "p"); db.exec("DELETE FROM cloud_outbox");
  save(db, { projectId: project.projectId, type: "fact", title: "local v1", content: "local v1", topicKey: "t" });
  const memoryId = (db.query("SELECT id FROM memories WHERE topic_key='t'").get() as { id: string }).id;
  save(db, { projectId: project.projectId, type: "fact", title: "local v2", content: "local v2", topicKey: "t", expectedVersion: 1 });
  db.exec("DELETE FROM cloud_outbox");
  const remoteSnapshot = { id: memoryId, projectId: project.projectId, scope: "project", topicKey: "t", type: "fact",
    title: "remote v2", content: "remote v2", pinned: false, version: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2099-01-03T00:00:00.000Z" };
  const memoriesRow: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "memories", op: "update",
    payload: { id: memoryId, projectId: project.projectId, scope: "project", topic_key: "t", type: "fact", title: "remote v2",
      content: "remote v2", pinned: 0, version: 2, state: "active", created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2099-01-03T00:00:00.000Z", groupId: null }, createdAt: "x" };
  const versionRow: ChangeRow = { id: 2, changeId: "b", installationId: "remote", kind: "memory_versions", op: "insert",
    payload: { memory_id: memoryId, version: 2, snapshot: JSON.stringify(remoteSnapshot) }, createdAt: "x" };
  const result = applyCloudChanges(db, [memoriesRow, versionRow], "local");
  expect(result.conflicts).toBe(1);
  const conflictNotice = JSON.parse(notices(db).find(n => n.code === "CLOUD_CONFLICT")!.payload);
  expect(conflictNotice.memoryId).toBe(memoryId);
  expect(conflictNotice.remoteVersion).toBe(2);
  const localVersion = conflictNotice.localVersion as number;
  expect(localVersion).toBe(3);
  expect(memory(db, memoryId) as { version: number; title: string }).toMatchObject({ version: localVersion, title: "remote v2" });
  // Una entrada de sesión de la misma instalación, que apunta a la versión remota reasignada, aterriza en K (la versión local nueva).
  startSession(db, project.projectId, "s1"); db.exec("DELETE FROM cloud_outbox");
  const entryRow: ChangeRow = { id: 3, changeId: "c", installationId: "remote", kind: "session_entries", op: "insert",
    payload: { sessionId: "s1", memoryId, version: 2, recordedAt: "2026-01-04T00:00:00.000Z" }, createdAt: "x" };
  applyCloudChanges(db, [entryRow], "local");
  expect((db.query("SELECT version FROM session_entries WHERE sessionId=?").get("s1") as { version: number }).version).toBe(localVersion);
  // Volver a traer la misma pareja remota (memoryId, version) una segunda vez encuentra la equivalencia ya registrada: sin conflicto nuevo, sin fila de versión duplicada.
  const countBefore = (db.query("SELECT count(*) AS n FROM memory_versions WHERE memory_id=?").get(memoryId) as { n: number }).n;
  const replay = applyCloudChanges(db, [{ ...versionRow, id: 4 }], "local");
  expect(replay.conflicts).toBe(0);
  expect((db.query("SELECT count(*) AS n FROM memory_versions WHERE memory_id=?").get(memoryId) as { n: number }).n).toBe(countBefore);
});

// Verifica el conflicto de versión en el sentido contrario: cuando la fila de memories gana localmente por fecha, la versión remota entrante queda guardada en el historial (con un número nuevo) pero la versión activa sigue siendo la local.
test("D9: conflicto donde gana lo local — la versión que llega queda en el historial y la activa sigue siendo la local", () => {
  const db = freshCloudDb();
  const project = createProject(db, "p"); db.exec("DELETE FROM cloud_outbox");
  save(db, { projectId: project.projectId, type: "fact", title: "local v1", content: "local v1", topicKey: "t" });
  const memoryId = (db.query("SELECT id FROM memories WHERE topic_key='t'").get() as { id: string }).id;
  save(db, { projectId: project.projectId, type: "fact", title: "local v2", content: "local v2", topicKey: "t", expectedVersion: 1 });
  db.exec("DELETE FROM cloud_outbox");
  const remoteSnapshot = { id: memoryId, projectId: project.projectId, scope: "project", topicKey: "t", type: "fact",
    title: "remote v2", content: "remote v2", pinned: false, version: 2, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-03T00:00:00.000Z" };
  const memoriesRow: ChangeRow = { id: 1, changeId: "a", installationId: "remote", kind: "memories", op: "update",
    payload: { id: memoryId, projectId: project.projectId, scope: "project", topic_key: "t", type: "fact", title: "remote v2",
      content: "remote v2", pinned: 0, version: 2, state: "active", created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-03T00:00:00.000Z", groupId: null }, createdAt: "x" };
  const versionRow: ChangeRow = { id: 2, changeId: "b", installationId: "remote", kind: "memory_versions", op: "insert",
    payload: { memory_id: memoryId, version: 2, snapshot: JSON.stringify(remoteSnapshot) }, createdAt: "x" };
  const result = applyCloudChanges(db, [memoriesRow, versionRow], "local");
  expect(result.conflicts).toBe(1);
  const active = memory(db, memoryId) as { version: number; title: string };
  expect(active.title).toBe("local v2");
  expect(active.version).toBe(2);
  const kept = db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=3").get(memoryId) as { snapshot: string };
  expect(JSON.parse(kept.snapshot).title).toBe("remote v2");
});

// Verifica que recibir de vuelta el eco de la propia versión (contenido idéntico bajo el mismo número) no genera conflicto ni una segunda fila de versión.
test("D9: eco idéntico de la misma versión no produce conflicto", () => {
  const db = freshCloudDb();
  const project = createProject(db, "p"); db.exec("DELETE FROM cloud_outbox");
  const result0 = save(db, { projectId: project.projectId, type: "fact", title: "t", content: "c", topicKey: "t" });
  const outboxRows = drainOutbox(db, "remote");
  const result = applyCloudChanges(db, outboxRows, "installation-that-is-not-local");
  expect(result.conflicts).toBe(0);
  expect((db.query("SELECT count(*) AS n FROM memory_versions WHERE memory_id=?").get(result0.id) as { n: number }).n).toBe(1);
});

// Prueba de punta a punta: todo lo que la instalación A encola (dos memorias, una sesión y un resumen de sesión) llega idéntico a B, sin que la aplicación en B vuelva a encolar nada en su propia salida.
test("punta a punta: A guarda 2 recuerdos con sesión y resumen, B los recibe idénticos sin crecer su cola", () => {
  const a = freshCloudDb(), b = freshCloudDb();
  a.exec("DELETE FROM cloud_outbox");
  const projectA = createProject(a, "shared-name");
  startSession(a, projectA.projectId, "s1");
  save(a, { projectId: projectA.projectId, type: "fact", title: "one", content: "one", topicKey: "one" });
  saveWithSession(a, { projectId: projectA.projectId, type: "fact", title: "two", content: "two", topicKey: "two" }, { sessionId: "s1" });
  saveSessionSummary(a, projectA.projectId, "s1", { goal: "g", instructions: "i", discoveries: "d", accomplishments: "a", nextSteps: "n", files: [] }, { requestKey: "req-1" });
  const rowsFromA = drainOutbox(a, "installation-a");
  const result = applyCloudChanges(b, rowsFromA, "installation-b");
  expect(result.skipped).toBe(0);
  const memoriesInB = b.query("SELECT id,title,content,version FROM memories ORDER BY id").all();
  expect(memoriesInB.length).toBe(3);
  expect((b.query("SELECT count(*) AS n FROM sessions WHERE sessionId='s1'").get() as { n: number }).n).toBe(1);
  expect((b.query("SELECT count(*) AS n FROM session_summaries WHERE sessionId='s1'").get() as { n: number }).n).toBe(1);
  expect((b.query("SELECT count(*) AS n FROM cloud_outbox").get() as { n: number }).n).toBe(0);
});
