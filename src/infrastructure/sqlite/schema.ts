/**
 * Define y aplica el esquema (la estructura de tablas, índices y disparadores) de la base SQLite
 * de Engram, y las migraciones aditivas que la llevan de un nivel de funciones a otro sin perder datos.
 * Cada nivel agrega tablas nuevas o amplía una restricción existente; nunca borra ni reescribe filas,
 * salvo para copiarlas a una tabla ampliada dentro de la misma migración. Lo usa `connection.ts` al
 * abrir la base, y los módulos que activan una función opcional (sincronización, vínculos de proyecto,
 * sesiones, ecosistema, memoria inteligente, la nube).
 * Piezas principales: las cadenas SQL de cada nivel; `decode`/`encode`, que traducen el número de
 * versión de SQLite (`PRAGMA user_version`) a las funciones activas; `validate`, que compara la
 * estructura real contra la esperada; y las funciones `enable*`, que migran de forma explícita,
 * respaldada y verificada.
 */
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { MemoryError } from "../../shared/errors";

const APPLICATION_ID = 1177956660;
const SCHEMA_VERSION = 3;
const SYNC_SCHEMA = `CREATE TABLE sync_checkpoints (
  replica TEXT PRIMARY KEY NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);`;
const BINDING_SCHEMA = `CREATE TABLE project_bindings (
  directory TEXT PRIMARY KEY NOT NULL CHECK(length(trim(directory)) > 0),
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  createdAt TEXT NOT NULL
);
CREATE INDEX project_bindings_project ON project_bindings(projectId);
`;
const SESSION_SCHEMA = `CREATE TABLE sessions (
  sessionId TEXT PRIMARY KEY NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  kind TEXT NOT NULL CHECK(kind IN ('runtime','manual')),
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  CHECK(kind != 'manual' OR endedAt IS NULL)
);
CREATE INDEX sessions_project_started ON sessions(projectId,startedAt,sessionId);
CREATE TABLE session_entries (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  recordedAt TEXT NOT NULL,
  PRIMARY KEY(memoryId,version),
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX session_entries_timeline ON session_entries(sessionId,recordedAt,memoryId,version);
CREATE TABLE session_summaries (
  sessionId TEXT PRIMARY KEY NOT NULL REFERENCES sessions(sessionId),
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE TABLE local_session_bindings (
  sessionId TEXT NOT NULL REFERENCES sessions(sessionId),
  directory TEXT NOT NULL,
  PRIMARY KEY(sessionId,directory)
);
CREATE INDEX local_session_directory ON local_session_bindings(directory,sessionId);
CREATE TABLE local_manual_sessions (
  projectId TEXT PRIMARY KEY NOT NULL REFERENCES projects(projectId),
  sessionId TEXT UNIQUE NOT NULL REFERENCES sessions(sessionId)
);
`;
const CONFIRMATION_SCHEMA = `CREATE TABLE confirmations (
  confirmationId TEXT PRIMARY KEY NOT NULL,
  memoryId TEXT NOT NULL,
  version INTEGER NOT NULL,
  recordedAt TEXT NOT NULL,
  sessionId TEXT REFERENCES sessions(sessionId),
  FOREIGN KEY(memoryId,version) REFERENCES memory_versions(memory_id,version)
);
CREATE INDEX confirmations_memory_time ON confirmations(memoryId,recordedAt,confirmationId);
CREATE TABLE confirmation_requests (
  memoryId TEXT NOT NULL REFERENCES memories(id),
  requestKey TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  expectedVersion INTEGER,
  confirmationId TEXT NOT NULL REFERENCES confirmations(confirmationId),
  response TEXT NOT NULL CHECK(json_valid(response)),
  PRIMARY KEY(memoryId,requestKey)
);
`;
const SCHEMA = `
CREATE TABLE projects (
  projectId TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE memories (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared')),
  topic_key TEXT,
  type TEXT NOT NULL CHECK(type IN ('fact','decision','procedure','warning','preference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL))
);
CREATE UNIQUE INDEX memories_project_topic ON memories(projectId,topic_key) WHERE scope='project';
CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
CREATE INDEX memories_project_state ON memories(projectId,state);
CREATE TABLE memory_versions (
  memory_id TEXT NOT NULL REFERENCES memories(id),
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  PRIMARY KEY(memory_id,version)
);
CREATE TABLE requests (
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared')),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  CHECK((scope='project' AND projectId IS NOT NULL) OR (scope='shared' AND projectId IS NULL)),
  FOREIGN KEY(memory_id,version) REFERENCES memory_versions(memory_id,version)
);
CREATE UNIQUE INDEX requests_project_key ON requests(projectId,request_key) WHERE scope='project';
CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  action TEXT NOT NULL CHECK(action IN ('save','archive','restore')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, topic_key, content='memories', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
`;

// Grupos de ecosistema (los niveles de esquema 8-10 son los niveles 5-7 más esta estructura).
// Solo agrega tablas nuevas; las dos tablas que llevan la propiedad (dueño) se recrean más abajo
// para ampliar su restricción CHECK de ámbito (scope).
const ECOSYSTEM_SCHEMA = `CREATE TABLE ecosystem_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64 AND name NOT GLOB '*[^a-z0-9-]*'
    AND name NOT GLOB '-*' AND name NOT GLOB '*-' AND name NOT GLOB '*--*'),
  createdAt TEXT NOT NULL
);
CREATE INDEX ecosystem_groups_name ON ecosystem_groups(name,id);
CREATE TABLE ecosystem_memberships (
  projectId TEXT PRIMARY KEY NOT NULL REFERENCES projects(projectId),
  groupId TEXT NOT NULL REFERENCES ecosystem_groups(id),
  boundAt TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('command','node-file','project-file'))
);
CREATE INDEX ecosystem_memberships_group ON ecosystem_memberships(groupId,projectId);
CREATE TABLE identity_events (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK(length(trim(action)) > 0),
  projectId TEXT,
  groupId TEXT,
  previousGroupId TEXT,
  previousProjectId TEXT,
  memoryId TEXT,
  directory TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX identity_events_project ON identity_events(projectId,id);
`;
const OWNERSHIP_CHECK = `CHECK((scope='project' AND projectId IS NOT NULL AND groupId IS NULL)
    OR (scope='shared' AND projectId IS NULL AND groupId IS NULL)
    OR (scope='ecosystem' AND projectId IS NULL AND groupId IS NOT NULL))`;
const MEMORY_COLUMNS = "rowid,id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at";
const REQUEST_COLUMNS = "projectId,scope,request_key,payload_hash,memory_id,version";
const ECOSYSTEM_MEMORIES = `CREATE TABLE memories_new (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared','ecosystem')),
  topic_key TEXT,
  type TEXT NOT NULL CHECK(type IN ('fact','decision','procedure','warning','preference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
  version INTEGER NOT NULL CHECK(version >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  groupId TEXT REFERENCES ecosystem_groups(id),
  ${OWNERSHIP_CHECK}
);`;
const ECOSYSTEM_REQUESTS = `CREATE TABLE requests_new (
  projectId TEXT REFERENCES projects(projectId),
  scope TEXT NOT NULL CHECK(scope IN ('project','shared','ecosystem')),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  groupId TEXT REFERENCES ecosystem_groups(id),
  ${OWNERSHIP_CHECK},
  FOREIGN KEY(memory_id,version) REFERENCES memory_versions(memory_id,version)
);`;
const ECOSYSTEM_INDEXES = `CREATE UNIQUE INDEX memories_project_topic ON memories(projectId,topic_key) WHERE scope='project';
CREATE UNIQUE INDEX memories_shared_topic ON memories(topic_key) WHERE scope='shared';
CREATE UNIQUE INDEX memories_ecosystem_topic ON memories(groupId,topic_key) WHERE scope='ecosystem';
CREATE INDEX memories_project_state ON memories(projectId,state);
CREATE UNIQUE INDEX requests_project_key ON requests(projectId,request_key) WHERE scope='project';
CREATE UNIQUE INDEX requests_shared_key ON requests(request_key) WHERE scope='shared';
CREATE UNIQUE INDEX requests_ecosystem_key ON requests(groupId,request_key) WHERE scope='ecosystem';
CREATE TRIGGER memory_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_fts(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;`;

// Memoria inteligente (el nivel de esquema 11 = base 7 + ecosistema + esta estructura). Solo agrega:
// las tablas auxiliares guardan datos nuevos fuera de memory_versions, cuyas claves de foto (snapshot)
// la réplica (sincronización con la nube) valida de forma exacta.
const INTELLIGENCE_SCHEMA = `CREATE TABLE memory_meta (
  memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id),
  short TEXT CHECK(short IS NULL OR length(short) BETWEEN 1 AND 300),
  review_after TEXT,
  superseded_by TEXT REFERENCES memories(id),
  affects TEXT CHECK(affects IS NULL OR json_valid(affects)),
  updated_at TEXT NOT NULL
);
CREATE INDEX memory_meta_superseded ON memory_meta(superseded_by);
CREATE TABLE session_activity (
  sessionId TEXT PRIMARY KEY NOT NULL REFERENCES sessions(sessionId),
  lastActivityAt TEXT NOT NULL,
  interruptedAt TEXT
);
CREATE TABLE ecosystem_sources (
  groupId TEXT PRIMARY KEY NOT NULL REFERENCES ecosystem_groups(id),
  projectId TEXT NOT NULL REFERENCES projects(projectId),
  setAt TEXT NOT NULL
);
CREATE VIRTUAL TABLE memories_words USING fts5(
  title, content, topic_key, content='memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER memory_words_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_words(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
CREATE TRIGGER memory_words_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_words(memories_words,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
END;
CREATE TRIGGER memory_words_update AFTER UPDATE OF title,content,topic_key ON memories BEGIN
  INSERT INTO memories_words(memories_words,rowid,title,content,topic_key)
  VALUES('delete',old.rowid,old.title,old.content,old.topic_key);
  INSERT INTO memories_words(rowid,title,content,topic_key) VALUES(new.rowid,new.title,new.content,new.topic_key);
END;
`;

/** Nivel base del esquema (la cadena lineal 3-7, antes de sumar ecosistema, inteligencia o nube). */
type Base = 3 | 4 | 5 | 6 | 7;
/**
 * Qué funciones opcionales tiene activas la base, traducidas desde el número de `PRAGMA user_version`.
 * `base`: nivel de la cadena lineal (3 a 7) que ya tiene aplicado, sin importar las funciones opcionales.
 * `ecosystem`: si tiene la estructura de grupos de ecosistema (ámbito compartido entre varios proyectos).
 * `intelligence`: si tiene la memoria inteligente (nivel 11: metadatos de recuerdo y búsqueda por palabra).
 * `cloud`: si tiene la cola de la nube (nivel 12: bandeja de cambios pendientes de subir).
 */
export interface SchemaState { readonly base: Base; readonly ecosystem: boolean; readonly intelligence: boolean; readonly cloud: boolean }
// Los niveles 3-7 son la cadena lineal de funciones. Los niveles 8-10 son los niveles 5-7 con la
// estructura de ecosistema, así que activar ecosistema nunca activa en silencio sesiones ni el
// refuerzo de búsqueda. El 11 es el nivel de memoria inteligente (exige base 7 y la estructura de
// ecosistema); el 12 además activa la cola de la nube (nivel 12, D1): solo se llega a él por
// `enableCloud`, nunca al simplemente abrir la base.
/**
 * Traduce el número de `PRAGMA user_version` a las funciones opcionales activas.
 * @param version número guardado en `PRAGMA user_version` de la base.
 * @returns el estado correspondiente, o `null` si esta versión de Engram no conoce ese número.
 */
function decode(version: number): SchemaState | null {
  if (version >= 3 && version <= 7) return { base: version as Base, ecosystem: false, intelligence: false, cloud: false };
  if (version >= 8 && version <= 10) return { base: (version - 3) as Base, ecosystem: true, intelligence: false, cloud: false };
  if (version === 11) return { base: 7, ecosystem: true, intelligence: true, cloud: false };
  if (version === 12) return { base: 7, ecosystem: true, intelligence: true, cloud: true };
  return null;
}
/**
 * Traduce un estado de funciones activas al número que se debe guardar en `PRAGMA user_version`.
 * @param state funciones activas que se quieren codificar.
 * @returns el número de versión correspondiente.
 */
function encode(state: SchemaState): number {
  if (state.cloud) return 12;
  if (state.intelligence) return 11;
  return state.base + (state.ecosystem ? 3 : 0);
}
/**
 * Lee el número de versión del esquema que la base tiene guardado ahora mismo.
 * @param db conexión abierta a la base.
 * @returns el valor actual de `PRAGMA user_version`.
 */
function currentVersion(db: Database): number { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; }
/** Nivel de funciones de la base, o `null` para una versión que esta compilación no conoce. Las funciones que solo leen (gates) usan esto. */
export function schemaFeatures(db: Database): SchemaState | null { return decode(currentVersion(db)); }
/**
 * Igual que `schemaFeatures`, pero exige que la versión sea reconocida.
 * @param db conexión abierta a la base.
 * @returns el estado de funciones activas.
 * @throws MemoryError con código `DATABASE_VERSION` si la versión guardada no es una que esta compilación conozca.
 */
export function schemaState(db: Database): SchemaState {
  const state = schemaFeatures(db);
  if (!state) throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
  return state;
}

// Compara el esquema canónico (la forma exacta) de SQLite, incluyendo restricciones, disparadores
// e índices. Los objetos desconocidos se rechazan, nunca se reparan: esto no es una auditoría de
// integridad, es una comparación de estructura contra lo que este nivel debería tener.
/**
 * Toma una foto textual de toda la estructura de la base (tablas, índices, disparadores y su SQL),
 * para poder compararla contra la estructura que se espera en un nivel dado.
 * @param db conexión abierta a la base.
 * @returns la estructura completa, en JSON, ordenada por tipo y nombre.
 */
function definition(db: Database): string {
  return JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all());
}
const expectedDefinitions = new Map<number,string>();
const FEATURE_SQL: Record<5 | 6 | 7 | 4, string> = { 4: SYNC_SCHEMA, 5: BINDING_SCHEMA, 6: SESSION_SCHEMA, 7: CONFIRMATION_SCHEMA };
/**
 * Junta el SQL de cada nivel de la cadena lineal que falta por aplicar entre dos niveles base.
 * @param from nivel base del que se parte (ya aplicado).
 * @param to nivel base al que se quiere llegar.
 * @returns el SQL de los niveles entre `from` (sin incluir) y `to` (incluido), en orden.
 */
function featureSql(from: number, to: number): string {
  let sql = "";
  for (const level of [4, 5, 6, 7] as const) if (level > from && level <= to) sql += FEATURE_SQL[level];
  return sql;
}
/**
 * Arma el SQL completo de la cadena lineal hasta un nivel base dado, partiendo del nivel 3.
 * @param base nivel base al que se quiere llegar.
 * @returns el SQL de creación de todas las tablas de los niveles 3 hasta `base`.
 */
function schemaFor(base: Base): string { return SCHEMA + featureSql(3, base); }
/**
 * Comprueba que la estructura real de la base sea exactamente la esperada para su versión, construyendo
 * (y guardando en caché por versión) una base de referencia en memoria con el mismo SQL que debería
 * tener la base real.
 * @param db conexión abierta a la base que se quiere comprobar.
 * @param version número de `PRAGMA user_version` contra el que se compara.
 * @throws MemoryError con código `DATABASE_SCHEMA` si la estructura real no coincide con la esperada.
 */
function validate(db: Database, version: number): void {
  if (!expectedDefinitions.has(version)) {
    const state = decode(version)!;
    const reference = new Database(":memory:");
    try {
      reference.exec(schemaFor(state.base));
      if (state.ecosystem) applyEcosystemStructure(reference);
      if (state.intelligence) reference.exec(INTELLIGENCE_SCHEMA);
      if (state.cloud) reference.exec(CLOUD_SCHEMA);
      expectedDefinitions.set(version,definition(reference));
    } finally { reference.close(); }
  }
  if (definition(db) !== expectedDefinitions.get(version)) {
    throw new MemoryError("DATABASE_SCHEMA", "La estructura no es compatible. No se modificó ni reparó la base.");
  }
}

/**
 * Avanza la cadena lineal de funciones hasta `target`; no hace nada (tras validar) si ya está allí.
 * @param db conexión abierta a la base.
 * @param target nivel base al que se quiere llegar.
 * @param unsupported mensaje para el error si la versión actual no se puede migrar.
 * @throws MemoryError con código `MIGRATION_REQUIRED` si la versión actual no es una que se pueda migrar.
 */
function upgradeTo(db: Database, target: 4 | 5 | 6 | 7, unsupported: string): void {
  db.transaction(() => {
    const version = currentVersion(db);
    const state = decode(version);
    if (!state) throw new MemoryError("MIGRATION_REQUIRED", unsupported);
    validate(db, version);
    if (state.base >= target) return;
    db.exec(featureSql(state.base, target));
    db.exec(`PRAGMA user_version=${encode({ base: target, ecosystem: state.ecosystem, intelligence: state.intelligence, cloud: false })}`);
  }).immediate();
}

/** Activación explícita y aditiva; al simplemente abrir la base nunca se migra una base local. */
export function enableSynchronization(db: Database): void {
  upgradeTo(db, 4, "No se puede habilitar sincronización en este formato.");
}

/** Activa los vínculos de proyecto locales a esta máquina que necesitan el MCP y el contexto de proyecto. */
export function enableProjectBindings(db: Database): void {
  upgradeTo(db, 5, "No se pueden habilitar vínculos de proyecto en este formato.");
}

/** Activación explícita para el esquema aditivo del ciclo de vida de sesiones. */
export function enableSessionLifecycle(db: Database): void {
  upgradeTo(db, 6, "No se puede habilitar sesiones en este formato.");
}

/** Activación explícita para las confirmaciones inmutables de refuerzo de búsqueda. */
export function enableSearchReinforcement(db: Database): void {
  upgradeTo(db, 7, "No se puede habilitar el refuerzo de búsqueda en este formato.");
}

// Procedimiento documentado por SQLite para cambiar una restricción CHECK: crear la tabla de
// reemplazo, copiar cada fila, borrar la original, renombrar y luego recrear índices, disparadores
// e índice de texto completo (FTS). Quien llama esta función es dueño de la transacción y de la
// pragma foreign_keys (debe desactivarla antes, porque las tablas viejas y nuevas coexisten un instante).
/**
 * Amplía `memories` y `requests` para aceptar el ámbito `ecosystem`, siguiendo el procedimiento de
 * SQLite para ampliar una restricción CHECK (ver comentario de arriba). No toca ningún dato: copia
 * cada fila tal cual a la tabla nueva.
 * @param db conexión abierta a la base, dentro de una transacción con `foreign_keys` desactivada.
 */
function applyEcosystemStructure(db: Database): void {
  db.exec(ECOSYSTEM_SCHEMA);
  db.exec(ECOSYSTEM_MEMORIES);
  db.exec(`INSERT INTO memories_new(${MEMORY_COLUMNS}) SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY rowid`);
  db.exec(ECOSYSTEM_REQUESTS);
  db.exec(`INSERT INTO requests_new(${REQUEST_COLUMNS}) SELECT ${REQUEST_COLUMNS} FROM requests ORDER BY rowid`);
  db.exec("DROP TABLE requests; DROP TABLE memories;");
  db.exec("ALTER TABLE memories_new RENAME TO memories; ALTER TABLE requests_new RENAME TO requests;");
  db.exec(ECOSYSTEM_INDEXES);
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
}

/**
 * Calcula una huella (hash) del contenido de una tabla, para poder comprobar después de una
 * migración que ninguna fila cambió ni se perdió.
 * @param db conexión abierta a la base.
 * @param table tabla cuyo contenido se resume.
 * @returns cuántas filas tiene y su huella SHA-256, calculada leyendo las filas en un orden fijo.
 */
function contentDigest(db: Database, table: "memories" | "requests"): { count: number; digest: string } {
  const columns = table === "memories" ? MEMORY_COLUMNS : REQUEST_COLUMNS;
  const statement = db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${table === "memories" ? "rowid" : "scope,projectId,request_key"}`);
  const hash = createHash("sha256"); let count = 0;
  try {
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) { hash.update(JSON.stringify(Object.values(row))); count++; }
  } finally { statement.finalize(); }
  return { count, digest: hash.digest("hex") };
}

/**
 * Cuenta cuántas filas violan alguna llave foránea (foreign key) ahora mismo.
 * @param db conexión abierta a la base.
 * @returns el número de violaciones que reporta `PRAGMA foreign_key_check`.
 */
function foreignKeyViolations(db: Database): number { return db.query("PRAGMA foreign_key_check").all().length; }

/**
 * Corta una migración a medio hacer porque la comprobación de contenido no coincidió.
 * @throws MemoryError con código `MIGRATION_VERIFY_FAILED`, siempre: esta función nunca regresa.
 */
function verificationFailed(): never {
  throw new MemoryError("MIGRATION_VERIFY_FAILED", "La verificación de la migración falló: el contenido copiado no coincide con el original. No se modificó la base; el respaldo automático se conserva.");
}

// VACUUM INTO escribe una copia completa y consistente incluso mientras la base está en modo WAL
// (el modo de journal que permite lecturas mientras se escribe).
/**
 * Guarda una copia completa de la base antes de una migración, para poder recuperarla si algo sale mal.
 * @param db conexión abierta a la base.
 * @param version versión actual, usada en el nombre del archivo de respaldo.
 * @param label qué migración lo produce, usada en el nombre del archivo de respaldo.
 * @returns la ruta del archivo de respaldo, o `null` si la base es solo en memoria o aún no tiene datos que perder.
 */
function backupBeforeMigration(db: Database, version: number, label: "ecosystem" | "intelligence" | "cloud"): string | null {
  const main = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(entry => entry.name === "main");
  if (!main?.file) return null;
  // No hay nada que perder en una base que todavía no tiene ni proyectos ni recuerdos.
  const held = db.query("SELECT (SELECT count(*) FROM projects)+(SELECT count(*) FROM memories) AS n").get() as { n: number };
  if (held.n === 0) return null;
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const target = `${main.file}.v${version}-pre-${label}-${stamp}-${randomUUID().slice(0, 8)}.bak`;
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  chmodSync(target, 0o600);
  return target;
}

/**
 * Resultado de intentar activar el ámbito de ecosistema.
 * `migrated`: si esta llamada aplicó la migración (falso si la base ya estaba en ese nivel).
 * `backup`: ruta del respaldo tomado antes de migrar, o `null` si no hizo falta uno.
 */
export interface EcosystemEnrolment { readonly migrated: boolean; readonly backup: string | null }

/**
 * Activación explícita y aditiva del ámbito de ecosistema: agrega las tablas de grupo y amplía la
 * restricción de ámbito (scope) de `memories` y `requests`. Respalda primero, verifica dentro de la
 * misma transacción que el número de filas y su huella de contenido no cambiaron, y deshace todo
 * (rollback) si encuentra alguna diferencia.
 * @param db conexión abierta a la base.
 * @returns si migró y, si tomó uno, dónde quedó el respaldo.
 * @throws MemoryError con código `MIGRATION_REQUIRED` si la versión actual no se puede migrar, o
 * `MIGRATION_VERIFY_FAILED` si la comprobación posterior no coincide.
 */
export function enableEcosystem(db: Database): EcosystemEnrolment {
  // La versión y la estructura se leen en una sola foto (snapshot): otro proceso podría terminar la
  // migración en cualquier momento, y leerlas por separado podría emparejar la versión vieja con la
  // estructura nueva.
  const seen = db.transaction(() => {
    const current = currentVersion(db), decoded = decode(current);
    if (!decoded) throw new MemoryError("MIGRATION_REQUIRED", "No se puede habilitar el ámbito ecosystem en este formato.");
    validate(db, current);
    return { current, decoded };
  }).deferred();
  let version = seen.current;
  let state = seen.decoded;
  if (state.ecosystem) return { migrated: false, backup: null };
  if (state.base < 5) { enableProjectBindings(db); version = currentVersion(db); state = decode(version)!; }
  // Una conexión que no puede escribir debe fallar antes de dejar un respaldo inútil a medias.
  // Son sentencias separadas a propósito: un exec de varias sentencias no deja ver un error de solo lectura.
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(`PRAGMA user_version=${version + 100}`); } finally { db.exec("ROLLBACK"); }
  const backup = backupBeforeMigration(db, version, "ecosystem");
  let migrated = false;
  const foreignKeys = (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    db.transaction(() => {
      const inside = currentVersion(db);
      const insideState = decode(inside)!;
      if (insideState.ecosystem) { validate(db, inside); return; }
      validate(db, inside);
      const violationsBefore = foreignKeyViolations(db);
      const memoriesBefore = contentDigest(db, "memories");
      const requestsBefore = contentDigest(db, "requests");
      applyEcosystemStructure(db);
      const memoriesAfter = contentDigest(db, "memories");
      const requestsAfter = contentDigest(db, "requests");
      if (memoriesAfter.count !== memoriesBefore.count || memoriesAfter.digest !== memoriesBefore.digest
        || requestsAfter.count !== requestsBefore.count || requestsAfter.digest !== requestsBefore.digest
        || foreignKeyViolations(db) > violationsBefore) verificationFailed();
      try { db.exec("INSERT INTO memories_fts(memories_fts) VALUES('integrity-check')"); } catch { verificationFailed(); }
      db.exec(`PRAGMA user_version=${encode({ base: insideState.base, ecosystem: true, intelligence: false, cloud: false })}`);
      migrated = true;
    }).immediate();
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
  return { migrated, backup: migrated ? backup : null };
}

/**
 * Resultado de intentar activar la memoria inteligente.
 * `migrated`: si esta llamada aplicó la migración (falso si la base ya estaba en ese nivel).
 * `backup`: ruta del respaldo tomado antes de migrar, o `null` si no hizo falta uno.
 */
export interface IntelligenceEnrolment { readonly migrated: boolean; readonly backup: string | null }

/**
 * Comprueba que un índice de texto completo (FTS) esté sano, pidiéndole a SQLite que se audite
 * a sí mismo.
 * @param db conexión abierta a la base.
 * @param table índice FTS a comprobar.
 * @throws MemoryError con código `MIGRATION_VERIFY_FAILED` (vía `verificationFailed`) si SQLite reporta corrupción.
 */
function ftsIntegrity(db: Database, table: "memories_fts" | "memories_words"): void {
  try { db.exec(`INSERT INTO ${table}(${table}) VALUES('integrity-check')`); } catch { verificationFailed(); }
}

/**
 * Activación explícita y aditiva de la memoria inteligente (nivel 11). Encadena los requisitos
 * previos (estructura de ecosistema, sesiones, refuerzo de búsqueda), y luego agrega las tablas
 * auxiliares y el índice por palabra en una sola transacción, comprobando que ninguna fila existente
 * cambió. El servidor MCP nunca llama esto directamente.
 * @param db conexión abierta a la base.
 * @returns si migró y, si tomó uno, dónde quedó el respaldo.
 * @throws MemoryError con código `MIGRATION_REQUIRED` si la versión actual no se puede migrar, o
 * `MIGRATION_VERIFY_FAILED` si la comprobación posterior no coincide.
 */
export function enableIntelligence(db: Database): IntelligenceEnrolment {
  const seen = db.transaction(() => {
    const current = currentVersion(db), decoded = decode(current);
    if (!decoded) throw new MemoryError("MIGRATION_REQUIRED", "No se puede habilitar la memoria inteligente en este formato.");
    validate(db, current);
    return decoded;
  }).deferred();
  if (seen.intelligence) return { migrated: false, backup: null };
  if (!seen.ecosystem) enableEcosystem(db);
  enableSessionLifecycle(db);
  enableSearchReinforcement(db);
  const version = currentVersion(db);
  // Una conexión que no puede escribir debe fallar antes de dejar un respaldo inútil a medias.
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(`PRAGMA user_version=${version + 100}`); } finally { db.exec("ROLLBACK"); }
  const backup = backupBeforeMigration(db, version, "intelligence");
  let migrated = false;
  db.transaction(() => {
    const inside = currentVersion(db);
    const insideState = decode(inside)!;
    validate(db, inside);
    if (insideState.intelligence) return;
    const memoriesBefore = contentDigest(db, "memories");
    const requestsBefore = contentDigest(db, "requests");
    db.exec(INTELLIGENCE_SCHEMA);
    db.exec("INSERT INTO memories_words(memories_words) VALUES('rebuild')");
    const memoriesAfter = contentDigest(db, "memories");
    const requestsAfter = contentDigest(db, "requests");
    if (memoriesAfter.count !== memoriesBefore.count || memoriesAfter.digest !== memoriesBefore.digest
      || requestsAfter.count !== requestsBefore.count || requestsAfter.digest !== requestsBefore.digest) verificationFailed();
    ftsIntegrity(db, "memories_fts");
    ftsIntegrity(db, "memories_words");
    db.exec(`PRAGMA user_version=${encode({ base: 7, ecosystem: true, intelligence: true, cloud: false })}`);
    migrated = true;
  }).immediate();
  return { migrated, backup: migrated ? backup : null };
}

// Activación de la nube (nivel de esquema 12, D1). Solo agrega: una bandeja de salida (outbox) de
// cambios pendientes, alimentada por disparadores AFTER INSERT/UPDATE/DELETE en cada tabla que viaja
// (sección 5 del diseño); un estado de aplicación de una sola fila (el apply_guard de D2,
// last_applied_id y la huella del remoto de D14); y una tabla de avisos. Nunca se llega aquí al
// simplemente abrir la base; solo `enableCloud` la escribe.
const CLOUD_TABLES_SCHEMA = `CREATE TABLE cloud_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  kind TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE cloud_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_applied_id INTEGER NOT NULL DEFAULT 0,
  apply_guard INTEGER NOT NULL DEFAULT 0,
  remote_fingerprint TEXT
);
CREATE TABLE cloud_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  shown INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE cloud_version_map (
  memory_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  remote_version INTEGER NOT NULL,
  local_version INTEGER NOT NULL,
  PRIMARY KEY (memory_id, installation_id, remote_version)
);
`;
// Cada tabla que viaja (sección 5 del diseño), en orden de dependencia (D14): primero projects y la
// estructura de ecosistema, luego memories y sus tablas auxiliares, luego sessions, luego confirmations.
// Las listas de columnas coinciden exactamente con este archivo (se verificaron contra el SQL real de
// arriba, no contra los números de línea del plan).
const TRAVELING_TABLES: readonly (readonly [string, readonly string[]])[] = [
  ["projects", ["projectId", "name", "createdAt", "updatedAt"]],
  ["ecosystem_groups", ["id", "name", "createdAt"]],
  ["ecosystem_memberships", ["projectId", "groupId", "boundAt", "source"]],
  ["ecosystem_sources", ["groupId", "projectId", "setAt"]],
  ["memories", ["id", "projectId", "scope", "topic_key", "type", "title", "content", "pinned", "version", "state", "created_at", "updated_at", "groupId"]],
  ["memory_versions", ["memory_id", "version", "snapshot"]],
  ["memory_meta", ["memory_id", "short", "review_after", "superseded_by", "affects", "updated_at"]],
  ["sessions", ["sessionId", "projectId", "kind", "startedAt", "endedAt"]],
  ["session_entries", ["sessionId", "memoryId", "version", "recordedAt"]],
  ["session_summaries", ["sessionId", "memoryId", "version"]],
  ["confirmations", ["confirmationId", "memoryId", "version", "recordedAt", "sessionId"]],
  ["confirmation_requests", ["memoryId", "requestKey", "payloadHash", "expectedVersion", "confirmationId", "response"]],
];
/**
 * Arma la expresión SQL `json_object(...)` que empaqueta las columnas de una tabla en un JSON,
 * leyendo la fila nueva o la vieja de un disparador.
 * @param columns columnas a empaquetar.
 * @param row si se lee de `new` (fila insertada o actualizada) o de `old` (fila borrada o anterior).
 * @returns la expresión SQL lista para usarse dentro de un disparador.
 */
function jsonObject(columns: readonly string[], row: "new" | "old"): string {
  return `json_object(${columns.map(column => `'${column}',${row}.${column}`).join(",")})`;
}
/**
 * Genera el SQL de los tres disparadores (insertar, actualizar, borrar) de cada tabla que viaja a la
 * nube, cada uno guardando el cambio en `cloud_outbox` mientras `apply_guard` esté en 0 (para no
 * volver a encolar los cambios que la propia aplicación de cambios bajados produce).
 * @returns el SQL de creación de todos los disparadores, concatenado.
 */
function cloudTriggersSql(): string {
  let sql = "";
  for (const [table, columns] of TRAVELING_TABLES) {
    sql += `CREATE TRIGGER cloud_outbox_${table}_insert AFTER INSERT ON ${table}
WHEN (SELECT apply_guard FROM cloud_state) = 0
BEGIN
  INSERT INTO cloud_outbox(kind,op,payload) VALUES('${table}','insert',${jsonObject(columns, "new")});
END;
CREATE TRIGGER cloud_outbox_${table}_update AFTER UPDATE ON ${table}
WHEN (SELECT apply_guard FROM cloud_state) = 0
BEGIN
  INSERT INTO cloud_outbox(kind,op,payload) VALUES('${table}','update',${jsonObject(columns, "new")});
END;
CREATE TRIGGER cloud_outbox_${table}_delete AFTER DELETE ON ${table}
WHEN (SELECT apply_guard FROM cloud_state) = 0
BEGIN
  INSERT INTO cloud_outbox(kind,op,payload) VALUES('${table}','delete',${jsonObject(columns, "old")});
END;
`;
  }
  return sql;
}
const CLOUD_SCHEMA = CLOUD_TABLES_SCHEMA + cloudTriggersSql();

/** Vista de solo lectura de qué columnas viajan por tabla, para que las pruebas la comparen contra `PRAGMA table_info`. */
export function travelingTableColumns(): ReadonlyMap<string, readonly string[]> {
  return new Map(TRAVELING_TABLES);
}

/**
 * Igual que `jsonObject`, pero para leer las columnas directamente de la tabla (sin `new.`/`old.`),
 * como hace falta para encolar filas que ya existían antes de activar la nube.
 * @param columns columnas a empaquetar.
 * @returns la expresión SQL `json_object(...)` correspondiente.
 */
function jsonObjectFromColumns(columns: readonly string[]): string {
  return `json_object(${columns.map(column => `'${column}',${column}`).join(",")})`;
}
/** Encola cada fila que ya existe de cada tabla que viaja, en orden de dependencia (D14, primera sincronización). */
function enqueueAllExisting(db: Database): void {
  for (const [table, columns] of TRAVELING_TABLES) {
    db.exec(`INSERT INTO cloud_outbox(kind,op,payload) SELECT '${table}','insert',${jsonObjectFromColumns(columns)} FROM ${table}`);
  }
}

/**
 * Resultado de intentar activar la cola de la nube.
 * `migrated`: si esta llamada aplicó la migración o volvió a encolar todo (falso si no hizo falta nada).
 * `backup`: ruta del respaldo tomado antes de migrar, o `null` si no hizo falta uno o no era una migración nueva.
 */
export interface CloudEnrolment { readonly migrated: boolean; readonly backup: string | null }

/**
 * Guarda la huella (fingerprint) del remoto con el que esta base está sincronizada.
 * @param db conexión abierta a la base.
 * @param fingerprint huella a guardar, o `null` si no se conoce.
 */
function setFingerprint(db: Database, fingerprint: string | null): void {
  db.query("UPDATE cloud_state SET remote_fingerprint=? WHERE id=1").run(fingerprint);
}

/**
 * Activación explícita y aditiva de la cola de la nube (nivel 12, D1). Encadena el requisito previo
 * (memoria inteligente), y luego agrega las tablas de bandeja de salida, estado y avisos, y sus
 * disparadores, en una sola transacción, encolando cada fila que ya existe de cada tabla que viaja
 * en orden de dependencia (D14). Llamarla de nuevo con la misma huella remota (o sin huella) no hace
 * nada; una huella distinta y no nula significa una base remota distinta (D14): la cola se reconstruye
 * desde las filas locales actuales y `last_applied_id` vuelve a 0, exactamente como en una primera
 * sincronización.
 *
 * Desviación del plan: `enableCloud(db)` en la interfaz del plan no recibe huella, pero una prueba
 * exigida ("con otra huella remota vuelve a encolar todo") necesita una para comparar. La firma mínima
 * que lo permite es este segundo parámetro opcional.
 * @param db conexión abierta a la base.
 * @param remoteFingerprint huella del remoto con el que se sincroniza, si se conoce.
 * @returns si migró (o volvió a encolar) y, si tomó uno, dónde quedó el respaldo.
 * @throws MemoryError con código `MIGRATION_REQUIRED` si la versión actual no se puede migrar.
 */
export function enableCloud(db: Database, remoteFingerprint?: string | null): CloudEnrolment {
  const fingerprint = remoteFingerprint ?? null;
  const seen = db.transaction(() => {
    const current = currentVersion(db), decoded = decode(current);
    if (!decoded) throw new MemoryError("MIGRATION_REQUIRED", "No se puede habilitar la nube en este formato.");
    validate(db, current);
    return decoded;
  }).deferred();
  if (!seen.intelligence) enableIntelligence(db);
  if (seen.cloud) {
    if (fingerprint === null) return { migrated: false, backup: null };
    const stored = (db.query("SELECT remote_fingerprint FROM cloud_state WHERE id=1").get() as { remote_fingerprint: string | null }).remote_fingerprint;
    if (fingerprint === stored) return { migrated: false, backup: null };
    let migrated = false;
    db.transaction(() => {
      db.exec("DELETE FROM cloud_outbox");
      db.query("UPDATE cloud_state SET last_applied_id=0, apply_guard=0 WHERE id=1").run();
      setFingerprint(db, fingerprint);
      enqueueAllExisting(db);
      migrated = true;
    }).immediate();
    return { migrated, backup: null };
  }
  const version = currentVersion(db);
  // Una conexión que no puede escribir debe fallar antes de dejar un respaldo inútil a medias.
  db.exec("BEGIN IMMEDIATE");
  try { db.exec(`PRAGMA user_version=${version + 100}`); } finally { db.exec("ROLLBACK"); }
  const backup = backupBeforeMigration(db, version, "cloud");
  let migrated = false;
  db.transaction(() => {
    const inside = currentVersion(db);
    const insideState = decode(inside)!;
    validate(db, inside);
    if (insideState.cloud) return;
    db.exec(CLOUD_SCHEMA);
    db.query("INSERT INTO cloud_state(id,last_applied_id,apply_guard,remote_fingerprint) VALUES (1,0,0,?)").run(fingerprint);
    enqueueAllExisting(db);
    db.exec(`PRAGMA user_version=${encode({ base: insideState.base, ecosystem: true, intelligence: true, cloud: true })}`);
    migrated = true;
  }).immediate();
  return { migrated, backup: migrated ? backup : null };
}

/** Verdadero cuando la base está en el nivel de la nube (12): la bandeja de salida y sus disparadores están activos. */
export function cloudEnabled(db: Database): boolean { return schemaFeatures(db)?.cloud === true; }

/**
 * Abre (o crea, la primera vez) la base y deja la conexión lista para usarse: pragmas básicas,
 * detección de un formato anterior sin migración disponible, validación de estructura si ya existe,
 * y creación del esquema base si la base está realmente vacía.
 * @param db conexión recién abierta a la base.
 * @param allowCreate si se permite crear el esquema cuando la base está vacía (por defecto sí).
 * @param readonly si la conexión es de solo lectura: entonces nunca se crea el esquema ni se escribe nada.
 * @throws MemoryError con código `MIGRATION_REQUIRED` si detecta un formato anterior sin migración
 * disponible; `DATABASE_VERSION` si la versión no es reconocida; `DATABASE_OWNER` si la base ya
 * contiene una estructura ajena; `DATABASE_UNINITIALIZED` si está vacía pero no se permite crearla.
 */
export function initialize(db: Database, allowCreate = true, readonly = false): void {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  let created = false;
  const check = db.transaction(() => {
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const app = (db.query("PRAGMA application_id").get() as { application_id: number }).application_id;
    if ((version === 1 || version === 2) && app === APPLICATION_ID) {
      throw new MemoryError("MIGRATION_REQUIRED", "Formato anterior detectado. Conserva el archivo: no se modificó la base y se necesita una migración explícita, aún no disponible.");
    }
    if (decode(version) && app === APPLICATION_ID) { validate(db, version); return; }
    if (version !== 0 || app !== 0) throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
    const objects = db.query("SELECT count(*) AS n FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").get() as { n: number };
    if (objects.n !== 0) throw new MemoryError("DATABASE_OWNER", "La base contiene una estructura ajena; usa una base vacía y dedicada.");
    if (!allowCreate || readonly) throw new MemoryError("DATABASE_UNINITIALIZED", "La base no está inicializada. Conectar no crea tablas.");
    db.exec(SCHEMA);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};`);
    created = true;
  });
  if (readonly) check.deferred(); else check.immediate();
  // Deja constancia del modo WAL en la conexión que inicializa y puede escribir. En macOS, el SQLite
  // de Bun no puede abrir en solo lectura una base WAL que nunca se usó, si no se hace esto primero.
  if (created) db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; COMMIT;");
}
