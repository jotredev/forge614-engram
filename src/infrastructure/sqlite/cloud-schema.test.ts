/**
 * Prueba la migración que activa la nube (enableCloud, nivel de esquema 12): que encadene los
 * niveles previos que le faltan, sea repetible sin volver a migrar, encole en la bandeja de salida
 * (cloud_outbox) cada cambio nuevo y cada fila que ya existía, y respete el apagador de aplicación (apply_guard).
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createProject } from "./projects";
import { enableEcosystem, enableSessionLifecycle, enableIntelligence, enableSearchReinforcement, enableCloud, cloudEnabled, initialize, schemaState, travelingTableColumns } from "./schema";
import { save } from "./writes";

const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const outbox = (db: Database) => db.query("SELECT kind,op,payload FROM cloud_outbox ORDER BY id").all() as { kind: string; op: string; payload: string }[];
const cloudState = (db: Database) => db.query("SELECT last_applied_id,apply_guard,remote_fingerprint FROM cloud_state WHERE id=1").get() as
  { last_applied_id: number; apply_guard: number; remote_fingerprint: string | null };

/** Una base en el nivel 7 simple (todavía sin ecosistema, memoria inteligente ni nube): enableCloud debe encadenar el resto. */
function fresh(): Database {
  const db = new Database(":memory:");
  initialize(db);
  enableSearchReinforcement(db);
  return db;
}

// Comprueba que si enableCloud no logra encadenar el nivel 11 (memoria inteligente), la base no queda
// a medias: no escribe nada y la versión del esquema se queda en 10.
test("enableCloud rechaza si no puede encadenar el nivel 11 sin escribir nada", () => {
  const db = fresh();
  enableEcosystem(db); enableSessionLifecycle(db); enableSearchReinforcement(db); // llega al nivel 10, un paso antes de la memoria inteligente
  try {
    const execute = db.exec.bind(db);
    Object.defineProperty(db, "exec", { value: (sql: string) => execute(sql.includes("CREATE TABLE ecosystem_sources")
      ? sql.replace("CREATE TABLE ecosystem_sources", "THIS IS NOT SQL; CREATE TABLE ecosystem_sources") : sql) });
    expect(() => enableCloud(db)).toThrow();
    expect(version(db)).toBe(10);
  } finally { db.close(); }
});

// Comprueba que llamar enableCloud una segunda vez no vuelve a migrar ni duplica la fila única de estado de la nube (cloud_state).
test("enableCloud es idempotente", () => {
  const db = fresh();
  try {
    expect(enableCloud(db).migrated).toBe(true);
    expect(enableCloud(db)).toEqual({ migrated: false, backup: null });
    expect(db.query("SELECT count(*) AS n FROM cloud_state").get()).toEqual({ n: 1 });
  } finally { db.close(); }
});

// Comprueba que enableCloud active primero la memoria inteligente (nivel 11) cuando falta, antes de llegar al nivel 12 de la nube.
test("enableCloud encadena enableIntelligence si falta el nivel 11", () => {
  const db = fresh();
  try {
    const result = enableCloud(db);
    expect(result.migrated).toBe(true);
    expect(version(db)).toBe(12);
    expect(schemaState(db)).toEqual({ base: 7, ecosystem: true, intelligence: true, cloud: true });
  } finally { db.close(); }
});

// Comprueba los valores iniciales de la fila única de estado de la nube (cloud_state) justo después de activarla.
test("cloud_state arranca con last_applied_id=0 y apply_guard=0 tras enableCloud", () => {
  const db = fresh();
  try {
    enableCloud(db);
    expect(cloudState(db)).toEqual({ last_applied_id: 0, apply_guard: 0, remote_fingerprint: null });
  } finally { db.close(); }
});

// Comprueba que si la conexión no puede escribir, enableCloud falla y no deja ninguna tabla de la nube a medio crear.
test("readonly connection fails without leaving cloud tables behind", () => {
  const db = fresh();
  try {
    // Simula una conexión que no puede escribir, igual que la propia prueba de enableIntelligence:
    // fuerza que la escritura de comprobación previa (PRAGMA) falle, usando una transacción que no puede volver a abrirse en modo IMMEDIATE dos veces.
    db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => enableCloud(db)).toThrow();
    } finally { db.exec("ROLLBACK"); }
    expect(version(db)).toBe(7);
    expect(db.query("SELECT name FROM sqlite_master WHERE name='cloud_outbox'").all()).toEqual([]);
  } finally { db.close(); }
});

// Comprueba que insertar una fila en cada tabla que viaja a la nube (mientras el apagador apply_guard esté en 0)
// encola exactamente una fila nueva en la bandeja de salida (cloud_outbox), tabla por tabla.
test("un INSERT en cada tabla que viaja con apply_guard=0 encola una fila en cloud_outbox", () => {
  const db = fresh();
  enableCloud(db);
  try {
    const project = createProject(db, "Alpha");
    const saved = save(db, { projectId: project.projectId, title: "T", content: "C", type: "fact", topicKey: "alpha/t" });
    const memoriesRow = outbox(db).filter(r => r.kind === "memories");
    expect(memoriesRow.length).toBe(1);
    expect(memoriesRow.at(-1)!.op).toBe("insert");

    const versionsRow = outbox(db).filter(r => r.kind === "memory_versions");
    expect(versionsRow.length).toBeGreaterThan(0);

    const countOf = (kind: string) => outbox(db).filter(r => r.kind === kind).length;

    const metaBefore = countOf("memory_meta");
    db.query("INSERT INTO memory_meta(memory_id,short,updated_at) VALUES(?,?,?)").run(saved.id, "short", "now");
    expect(countOf("memory_meta")).toBe(metaBefore + 1);

    // save() con las sesiones activadas ya abrió una sesión manual (writes.ts:264); esta es una segunda.
    const sessionsBefore = countOf("sessions");
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt) VALUES(?,?,?,?)").run("s1", project.projectId, "runtime", "now");
    expect(countOf("sessions")).toBe(sessionsBefore + 1);

    // save() con las sesiones activadas ya insertó una fila de session_entries/confirmación para
    // (saved.id, versión 1) a través de su propia sesión manual; una fila simple en memory_versions
    // para la versión 2 deja que el resto de esta prueba use una versión no tocada por ese efecto secundario.
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,2,'{}')").run(saved.id);

    const entriesBefore = countOf("session_entries");
    db.query("INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)").run("s1", saved.id, 2, "now");
    expect(countOf("session_entries")).toBe(entriesBefore + 1);

    const summariesBefore = countOf("session_summaries");
    db.query("INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)").run("s1", saved.id, 2);
    expect(countOf("session_summaries")).toBe(summariesBefore + 1);

    const confirmationsBefore = countOf("confirmations");
    db.query("INSERT INTO confirmations(confirmationId,memoryId,version,recordedAt,sessionId) VALUES(?,?,?,?,?)").run("c1", saved.id, 2, "now", "s1");
    expect(countOf("confirmations")).toBe(confirmationsBefore + 1);

    const requestsBefore = countOf("confirmation_requests");
    db.query("INSERT INTO confirmation_requests(memoryId,requestKey,payloadHash,expectedVersion,confirmationId,response) VALUES(?,?,?,?,?,?)")
      .run(saved.id, "key", "hash", null, "c1", "{}");
    expect(countOf("confirmation_requests")).toBe(requestsBefore + 1);

    expect(countOf("projects")).toBeGreaterThan(0);

    const group = "grupo-uno";
    const groupsBefore = countOf("ecosystem_groups");
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run(group, group, "now");
    expect(countOf("ecosystem_groups")).toBe(groupsBefore + 1);

    // ecosystem_memberships exige un proyecto que todavía no tenga grupo asignado; se reutiliza el mismo proyecto.
    db.exec("PRAGMA foreign_keys=OFF");
    const membershipsBefore = countOf("ecosystem_memberships");
    db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES(?,?,?,?)").run(project.projectId, group, "now", "command");
    expect(countOf("ecosystem_memberships")).toBe(membershipsBefore + 1);

    const sourcesBefore = countOf("ecosystem_sources");
    db.query("INSERT INTO ecosystem_sources(groupId,projectId,setAt) VALUES(?,?,?)").run(group, project.projectId, "now");
    expect(countOf("ecosystem_sources")).toBe(sourcesBefore + 1);
    db.exec("PRAGMA foreign_keys=ON");
  } finally { db.close(); }
});

// Comprueba que el disparador (trigger: código de la base que se ejecuta solo al escribir) de la
// bandeja de salida respeta el apagador apply_guard: con 1 no encola nada, con 0 vuelve a encolar.
test("un UPDATE con apply_guard=1 no encola nada", () => {
  const db = fresh();
  enableCloud(db);
  try {
    const project = createProject(db, "Beta");
    const before = outbox(db).length;
    db.exec("UPDATE cloud_state SET apply_guard=1 WHERE id=1");
    db.query("UPDATE projects SET name=? WHERE projectId=?").run("Beta 2", project.projectId);
    expect(outbox(db).length).toBe(before);
    db.exec("UPDATE cloud_state SET apply_guard=0 WHERE id=1");
    db.query("UPDATE projects SET name=? WHERE projectId=?").run("Beta 3", project.projectId);
    expect(outbox(db).length).toBeGreaterThan(before);
  } finally { db.close(); }
});

// Comprueba que cada fila encolada recibe un identificador de cambio (change_id) propio, de 32 caracteres, y distinto del de las demás filas.
test("un INSERT hecho por un disparador genera change_id distintos y no vacíos", () => {
  const db = fresh();
  enableCloud(db);
  try {
    createProject(db, "Gamma");
    createProject(db, "Delta");
    const ids = db.query("SELECT change_id FROM cloud_outbox WHERE kind='projects'").all() as { change_id: string }[];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const row of ids) { expect(row.change_id).toBeTruthy(); expect(row.change_id.length).toBe(32); }
    expect(new Set(ids.map(r => r.change_id)).size).toBe(ids.length);
  } finally { db.close(); }
});

// Comprueba que al activar la nube se encola cada fila que ya existía de cada tabla que viaja,
// respetando el orden de dependencias entre tablas (D14): primero proyectos y ecosistema, luego recuerdos y sesiones.
test("enableCloud encola toda la memoria local existente en orden de dependencias (D14)", () => {
  const db = fresh();
  enableIntelligence(db); // llega primero a las tablas de ecosistema y sesiones; enableCloud no debe volver a encadenar una migración
  try {
    const p1 = createProject(db, "P1");
    const p2 = createProject(db, "P2");
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run("g1", "g1", "now");
    db.exec("PRAGMA foreign_keys=OFF");
    db.query("INSERT INTO ecosystem_memberships(projectId,groupId,boundAt,source) VALUES(?,?,?,?)").run(p1.projectId, "g1", "now", "command");
    db.exec("PRAGMA foreign_keys=ON");
    // save() con las sesiones activadas abre automáticamente su propia sesión manual (writes.ts:264);
    // esa sesión, más esta otra de tipo runtime creada aquí, son ambas filas de "sessions" que viajan a la nube.
    const m1 = save(db, { projectId: p2.projectId, title: "M1", content: "C1", type: "fact", topicKey: "p2/m1" });
    save(db, { projectId: p2.projectId, title: "M1b", content: "C1b", type: "fact", topicKey: "p2/m1", expectedVersion: 1 });
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt) VALUES(?,?,?,?)").run("s1", p2.projectId, "runtime", "now");
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,3,'{}')").run(m1.id);
    db.query("INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)").run("s1", m1.id, 3);

    const sessionsBefore = (db.query("SELECT count(*) AS n FROM sessions").get() as { n: number }).n;
    const result = enableCloud(db);
    expect(result.migrated).toBe(true);
    const rows = outbox(db);
    // una fila encolada por cada fila que viaja y ya existía antes de activar la nube
    expect(rows.filter(r => r.kind === "projects").length).toBe(2);
    expect(rows.filter(r => r.kind === "ecosystem_groups").length).toBe(1);
    expect(rows.filter(r => r.kind === "ecosystem_memberships").length).toBe(1);
    expect(rows.filter(r => r.kind === "memories").length).toBe(1);
    expect(rows.filter(r => r.kind === "memory_versions").length).toBe(3);
    expect(rows.filter(r => r.kind === "sessions").length).toBe(sessionsBefore);
    expect(rows.filter(r => r.kind === "session_summaries").length).toBe(1);
    const kinds = rows.map(r => r.kind);
    expect(kinds.indexOf("projects")).toBeLessThan(kinds.indexOf("memories"));
    expect(kinds.indexOf("ecosystem_groups")).toBeLessThan(kinds.indexOf("ecosystem_memberships"));
    expect(kinds.indexOf("memories")).toBeLessThan(kinds.indexOf("memory_versions"));
    expect(kinds.indexOf("sessions")).toBeLessThan(kinds.indexOf("session_summaries"));
  } finally { db.close(); }
});

// Comprueba que una huella remota (fingerprint: identificador de con qué base remota se sincroniza)
// distinta a la guardada hace que enableCloud vuelva a encolar todo y reinicie last_applied_id, mientras que la misma huella no cambia nada.
test("enableCloud con otra huella remota vuelve a encolar todo y pone last_applied_id=0; con la misma huella no encola nada nuevo", () => {
  const db = fresh();
  try {
    createProject(db, "P1");
    enableCloud(db, "neon-host-a/db-a");
    db.exec("UPDATE cloud_state SET last_applied_id=42 WHERE id=1");
    expect(cloudState(db).remote_fingerprint).toBe("neon-host-a/db-a");

    // misma huella: no hace nada
    const before = outbox(db).length;
    const same = enableCloud(db, "neon-host-a/db-a");
    expect(same.migrated).toBe(false);
    expect(outbox(db).length).toBe(before);
    expect(cloudState(db).last_applied_id).toBe(42);

    // huella distinta: vuelve a encolar todo y reinicia last_applied_id
    const changed = enableCloud(db, "neon-host-b/db-b");
    expect(changed.migrated).toBe(true);
    expect(cloudState(db).last_applied_id).toBe(0);
    expect(cloudState(db).remote_fingerprint).toBe("neon-host-b/db-b");
    expect(outbox(db).filter(r => r.kind === "projects").length).toBeGreaterThan(0);
  } finally { db.close(); }
});

// Comprueba que cloudEnabled solo devuelve verdadero cuando la base ya llegó al nivel 12 (la nube), no antes.
test("readWorkspaceSettings-style: cloudEnabled reports the cloud level accurately", () => {
  const db = fresh();
  try {
    expect(cloudEnabled(db)).toBe(false);
    enableIntelligence(db);
    expect(cloudEnabled(db)).toBe(false);
    enableCloud(db);
    expect(cloudEnabled(db)).toBe(true);
  } finally { db.close(); }
});

// Comprueba que la lista de columnas declarada para cada tabla que viaja (travelingTableColumns) coincide
// exactamente con las columnas reales de esa tabla en la base, sin que falte ni sobre ninguna.
test("las columnas de TRAVELING_TABLES coinciden exactamente con PRAGMA table_info de cada tabla en nivel 12", () => {
  const db = fresh();
  enableCloud(db);
  try {
    for (const [table, columns] of travelingTableColumns()) {
      const info = (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map(row => row.name)
        .filter(name => !(table === "memories" && name === "rowid"));
      expect(new Set(columns)).toEqual(new Set(info));
      expect(columns.length).toBe(info.length);
    }
  } finally { db.close(); }
});

// Comprueba que un recuerdo de ámbito ecosystem conserva su groupId (identificador del grupo dueño)
// al encolarse, tanto en el encolado inicial de lo que ya existía como en el que hace el disparador para una fila nueva.
test("un recuerdo de tablero (scope ecosystem) encola su groupId, por disparador y en la primera subida", () => {
  const db = fresh();
  enableIntelligence(db);
  try {
    db.query("INSERT INTO ecosystem_groups(id,name,createdAt) VALUES(?,?,?)").run("g1", "g1", "now");
    db.query(`INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at,groupId)
      VALUES(?,NULL,'ecosystem',?,?,?,?,0,1,'active','now','now',?)`).run("m-existing", "g1/existing", "fact", "Existing", "Content", "g1");

    const result = enableCloud(db); // primera sincronización: enqueueAllExisting también debe llevar el groupId
    expect(result.migrated).toBe(true);
    const existingRow = db.query("SELECT payload FROM cloud_outbox WHERE kind='memories' AND payload LIKE '%m-existing%'").get() as { payload: string };
    expect(JSON.parse(existingRow.payload).groupId).toBe("g1");

    db.query(`INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at,groupId)
      VALUES(?,NULL,'ecosystem',?,?,?,?,0,1,'active','now','now',?)`).run("m-new", "g1/new", "fact", "New", "Content", "g1");
    const newRow = db.query("SELECT payload FROM cloud_outbox WHERE kind='memories' AND payload LIKE '%m-new%'").get() as { payload: string };
    expect(JSON.parse(newRow.payload).groupId).toBe("g1");
  } finally { db.close(); }
});

// Comprueba que mientras no se active la nube, ni crear la base ni guardar un proyecto agregan las
// tablas de la nube ni cambian el número de versión del esquema (PRAGMA user_version).
test("M5: sin nube, una base nueva no tiene ninguna tabla nueva ni cambia user_version", () => {
  const db = fresh();
  try {
    expect(version(db)).toBe(7);
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('cloud_outbox','cloud_state','cloud_notices')").all()).toEqual([]);
    createProject(db, "NoCloud");
    expect(version(db)).toBe(7);
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('cloud_outbox','cloud_state','cloud_notices')").all()).toEqual([]);
  } finally { db.close(); }
});
