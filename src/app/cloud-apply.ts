/**
 * Aplica a la base SQLite local los cambios (filas) traídos desde la tabla `changes` de la
 * nube (Neon/PostgreSQL): decide, tabla por tabla, si la fila que llega gana o pierde frente
 * a la que ya hay en local, resuelve los conflictos de versión y de clave temática (topic
 * key), y descarta cualquier fila que contenga un secreto en vez de guardarla.
 */
import type { Database } from "../infrastructure/sqlite/connection";
import type { ChangeRow } from "../infrastructure/postgres/replica";
import { travelingTableColumns } from "../infrastructure/sqlite/schema";
import { findSecret } from "../modules/memory";

/** Resumen de una tanda de cambios aplicados: cuántas filas se aplicaron, se saltaron o generaron un conflicto de versión, y hasta qué id de la tabla `changes` se llegó. */
export interface ApplyResult { readonly applied: number; readonly skipped: number; readonly conflicts: number; readonly lastAppliedId: number }

/** Una fila cualquiera de una tabla viajera, en forma de objeto columna-valor. */
type Row = Record<string, unknown>;
/** Qué pasó al intentar aplicar una fila: se aplicó, se saltó, generó un conflicto de versión, o era propia de esta misma instalación. */
type Outcome = "applied" | "skipped" | "conflict" | "own";

// Clave natural de cada tabla viajera (D6-D9): la columna (o columnas) que identifica una fila entre instalaciones distintas, sin depender de un id autonumérico local.
const NATURAL_KEY: Record<string, readonly string[]> = {
  projects: ["projectId"],
  project_remotes: ["project_id"],
  ecosystem_groups: ["id"],
  ecosystem_memberships: ["projectId"],
  ecosystem_sources: ["groupId"],
  memories: ["id"],
  memory_versions: ["memory_id", "version"],
  memory_meta: ["memory_id"],
  sessions: ["sessionId"],
  session_entries: ["memoryId", "version"],
  session_summaries: ["sessionId"],
  confirmations: ["confirmationId"],
  confirmation_requests: ["memoryId", "requestKey"],
};
// Tablas donde gana la fila más reciente según esta columna de fecha (el empate se rompe con el JSON canónico, D6).
const DATED_COLUMN: Record<string, string> = {
  projects: "updatedAt",
  project_remotes: "updated_at",
  ecosystem_memberships: "boundAt",
  ecosystem_sources: "setAt",
  memory_meta: "updated_at",
  session_entries: "recordedAt",
  confirmations: "recordedAt",
};
// Tablas cuya columna entrante apunta a una fila de memory_versions y debe traducirse a
// través de cloud_version_map antes de escribirse en local (D9): la versión que trae la
// instalación remota puede no ser la misma versión local si hubo que reasignarla.
const VERSION_COLUMN: Record<string, string> = {
  memories: "version",
  session_entries: "version",
  session_summaries: "version",
  confirmations: "version",
};
// Columna de cada tabla anterior que identifica a qué memoria pertenece esa versión, necesaria para buscar la equivalencia en cloud_version_map.
const MEMORY_ID_COLUMN: Record<string, string> = {
  memories: "id",
  session_entries: "memoryId",
  session_summaries: "memoryId",
  confirmations: "memoryId",
};

/**
 * Convierte un valor a JSON con las claves de cada objeto siempre en el mismo orden
 * (alfabético), para poder comparar dos versiones de la misma fila por texto y así
 * desempatar entre dos filas con la misma fecha de forma determinista.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Row).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Row)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** `true` cuando `a` (con fecha `aDate`) debe ganar sobre `b` (con fecha `bDate`): gana la fecha más nueva; en empate, gana el JSON canónico mayor en orden de texto. */
function laterWins(aDate: string, aCanon: string, bDate: string, bCanon: string): boolean {
  if (aDate !== bDate) return aDate > bDate;
  return aCanon > bCanon;
}

/** Comprueba que `payload` es un objeto plano cuyas claves son exactamente las columnas esperadas, ni más ni menos, antes de confiar en él para armar una consulta SQL. */
function validPayload(payload: unknown, columns: readonly string[]): payload is Row {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload as Row);
  if (keys.length !== columns.length) return false;
  const set = new Set(columns);
  return keys.every(key => set.has(key));
}

/** Arma el texto de la clave natural de una fila (sus columnas de NATURAL_KEY unidas con "|"), para identificarla en un aviso sin exponer el resto de sus datos. */
function naturalKeyOf(kind: string, payload: Row): string {
  return (NATURAL_KEY[kind] ?? []).map(column => String(payload[column])).join("|");
}

/** Registra un aviso (notice) en la tabla local `cloud_notices`, para que la persona pueda ver qué pasó durante una aplicación de cambios. */
function notice(db: Database, code: string, payload: unknown): void {
  db.query("INSERT INTO cloud_notices(code,payload) VALUES(?,?)").run(code, JSON.stringify(payload));
}

/** Campo con nombre para un rechazo por secreto: la clave natural de la fila infractora, según D5. */
function secretPatternOf(kind: string, payload: Row): string | null {
  // Cada tipo de fila revisa los campos donde una persona podría haber pegado texto libre; el resto de columnas (fechas, ids) nunca contienen secretos.
  const check = (text: unknown): string | null => (typeof text === "string" ? findSecret(text) : null);
  if (kind === "memories") return check(payload.title) ?? check(payload.content) ?? check(payload.topic_key);
  if (kind === "projects") return check(payload.name);
  if (kind === "project_remotes") return check(payload.origin);
  if (kind === "memory_meta") {
    const short = check(payload.short);
    if (short) return short;
    if (typeof payload.affects === "string") {
      try {
        const list = JSON.parse(payload.affects);
        if (Array.isArray(list)) for (const entry of list) { const hit = check(entry); if (hit) return hit; }
      } catch { /* no es JSON: "affects" se valida en otro lugar, aquí no hay nada que revisar */ }
    }
    return null;
  }
  if (kind === "memory_versions") {
    // El contenido real de una versión va dentro de un snapshot en JSON, no en columnas sueltas.
    try {
      const snapshot = JSON.parse(String(payload.snapshot));
      return check(snapshot.title) ?? check(snapshot.content) ?? check(snapshot.topicKey);
    } catch { return null; }
  }
  return null;
}

/** Traduce una versión remota de una memoria a su versión local equivalente, usando la tabla de correspondencias `cloud_version_map`; si no hay ninguna registrada, asume que remota y local coinciden. */
function mappedVersion(db: Database, memoryId: string, installationId: string, remoteVersion: number): number {
  const row = db.query("SELECT local_version FROM cloud_version_map WHERE memory_id=? AND installation_id=? AND remote_version=?")
    .get(memoryId, installationId, remoteVersion) as { local_version: number } | null;
  return row ? row.local_version : remoteVersion;
}

/** Inserta una fila nueva en `table` con los valores de `payload` para cada columna en `columns`, en el mismo orden. */
function insertRow(db: Database, table: string, columns: readonly string[], payload: Row): void {
  const placeholders = columns.map(() => "?").join(",");
  db.query(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`).run(...columns.map(column => payload[column] as never));
}

/** Actualiza una fila existente en `table` (localizada por `keyColumns`), escribiendo solo las columnas que no forman parte de la clave; no hace nada si no queda ninguna columna que actualizar. */
function updateRow(db: Database, table: string, columns: readonly string[], keyColumns: readonly string[], payload: Row): void {
  const setColumns = columns.filter(column => !keyColumns.includes(column));
  if (setColumns.length === 0) return;
  const set = setColumns.map(column => `${column}=?`).join(",");
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  db.query(`UPDATE ${table} SET ${set} WHERE ${where}`)
    .run(...setColumns.map(column => payload[column] as never), ...keyColumns.map(column => payload[column] as never));
}

/** Lee la fila de `table` que coincide con `keyColumns` en `payload`, o `null` si no existe ninguna. */
function existingRow(db: Database, table: string, keyColumns: readonly string[], payload: Row): Row | null {
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  return db.query(`SELECT * FROM ${table} WHERE ${where}`).get(...keyColumns.map(column => payload[column] as never)) as Row | null;
}

/** Upsert genérico para tablas donde gana la fila más reciente según una columna de fecha (D6): sin fila previa, inserta; con fila previa, actualiza solo si la entrante gana la comparación de fechas. */
function upsertDated(db: Database, kind: string, columns: readonly string[], payload: Row): void {
  const keyColumns = NATURAL_KEY[kind]!, dateColumn = DATED_COLUMN[kind]!;
  const current = existingRow(db, kind, keyColumns, payload);
  if (!current) { insertRow(db, kind, columns, payload); return; }
  const localCanon = canonicalJson(pick(current, columns)), remoteCanon = canonicalJson(payload);
  if (laterWins(String(payload[dateColumn]), remoteCanon, String(current[dateColumn]), localCanon)) {
    updateRow(db, kind, columns, keyColumns, payload);
  }
}

/** Upsert genérico para tablas sin columna de fecha: la fila entrante siempre sobrescribe a la que hubiera (D6). */
function upsertOverwrite(db: Database, kind: string, columns: readonly string[], payload: Row): void {
  const keyColumns = NATURAL_KEY[kind]!;
  const current = existingRow(db, kind, keyColumns, payload);
  if (!current) insertRow(db, kind, columns, payload); else updateRow(db, kind, columns, keyColumns, payload);
}

/** Copia de `row` solo las columnas dadas, para comparar (con `canonicalJson`) sin que columnas ajenas a `columns` afecten la comparación. */
function pick(row: Row, columns: readonly string[]): Row {
  const out: Row = {};
  for (const column of columns) out[column] = row[column];
  return out;
}

/**
 * Aplica una fila de `sessions`: si la sesión local ya estaba cerrada (`endedAt` no nulo) y la
 * entrante llega abierta (`endedAt` nulo), conserva el cierre local en vez de reabrirla, para
 * que una fila remota desactualizada no deshaga un cierre que ya ocurrió en esta instalación.
 */
function applySessions(db: Database, columns: readonly string[], payload: Row): void {
  const current = existingRow(db, "sessions", ["sessionId"], payload);
  const merged: Row = { ...payload };
  if (current && current.endedAt !== null && payload.endedAt === null) merged.endedAt = current.endedAt;
  if (!current) insertRow(db, "sessions", columns, merged); else updateRow(db, "sessions", columns, ["sessionId"], merged);
}

/**
 * D9: traduce una fila entrante de `memory_versions` a través de `cloud_version_map`,
 * insertándola o reasignándole un número de versión local nuevo según haga falta.
 * @returns `"applied"` si se insertó sin conflicto (o ya se sabía que era equivalente a una
 * versión local); `"conflict"` si hubo que asignarle una versión local nueva porque el número
 * de versión ya estaba ocupado por contenido distinto.
 */
function applyMemoryVersion(db: Database, row: ChangeRow, payload: Row): Outcome {
  const memoryId = String(payload.memory_id), remoteVersion = Number(payload.version);
  // Si ya existe una correspondencia registrada para esta versión remota, no hay nada más que hacer: ya se aplicó antes.
  const known = db.query("SELECT local_version FROM cloud_version_map WHERE memory_id=? AND installation_id=? AND remote_version=?")
    .get(memoryId, row.installationId, remoteVersion) as { local_version: number } | null;
  if (known) return "applied";
  const local = db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=?").get(memoryId, remoteVersion) as { snapshot: string } | null;
  const recordEquivalence = (localVersion: number) =>
    db.query("INSERT INTO cloud_version_map(memory_id,installation_id,remote_version,local_version) VALUES(?,?,?,?)")
      .run(memoryId, row.installationId, remoteVersion, localVersion);
  // Ningún número de versión ocupa ese hueco todavía en local: se inserta tal cual, con el mismo número que trae la remota.
  if (!local) {
    db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(memoryId, remoteVersion, String(payload.snapshot));
    recordEquivalence(remoteVersion);
    return "applied";
  }
  const withoutVersion = (snapshot: string): string => { const parsed = JSON.parse(snapshot); delete parsed.version; return canonicalJson(parsed); };
  // Si el contenido es el mismo salvo el número de versión, es la misma versión vista desde dos instalaciones: no hace falta duplicarla, solo registrar la equivalencia.
  if (withoutVersion(local.snapshot) === withoutVersion(String(payload.snapshot))) {
    recordEquivalence(remoteVersion);
    return "applied";
  }
  // Contenido distinto bajo el mismo número de versión: es un conflicto real. Se le asigna a la entrante el siguiente número libre en vez de sobrescribir la que ya había.
  const max = db.query("SELECT MAX(version) AS v FROM memory_versions WHERE memory_id=?").get(memoryId) as { v: number };
  const localVersion = max.v + 1;
  const snapshot = JSON.parse(String(payload.snapshot));
  snapshot.version = localVersion;
  db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(memoryId, localVersion, JSON.stringify(snapshot));
  recordEquivalence(localVersion);
  // La fila de `memories` de este guardado puede haber llegado ya (D9: `memories` se encola antes que su
  // versión, por `saveCore`) apuntando al número de versión remoto en bruto; se corrige solo cuando esa fila
  // es la entrante (ganó por fecha), nunca cuando la versión local se quedó activa.
  db.query("UPDATE memories SET version=? WHERE id=? AND version=? AND title=? AND content=? AND updated_at=?")
    .run(localVersion, memoryId, remoteVersion, String(snapshot.title), String(snapshot.content), String(snapshot.updatedAt));
  notice(db, "CLOUD_CONFLICT", { memoryId, remoteVersion, localVersion });
  return "conflict";
}

/**
 * D8: antes de escribir el `topic_key` de `candidate`, resuelve el choque con la otra memoria
 * (si la hay) que ya tiene esa misma clave temática (el índice único de `topic_key` es
 * inmediato, así que la que pierde debe vaciarse primero, antes de insertar o actualizar).
 * @returns El `topic_key` con el que `candidate` puede escribirse de verdad (puede ser `null` si perdió el choque).
 */
function resolveTopicConflict(db: Database, candidate: Row, scope: string, ownerColumn: string, ownerId: string | null): string | null {
  const topicKey = candidate.topic_key as string | null;
  if (topicKey === null) return null;
  const other = db.query(`SELECT * FROM memories WHERE scope=? AND ${ownerColumn} IS ? AND topic_key=? AND id<>?`)
    .get(scope, ownerId, topicKey, candidate.id as string) as Row | null;
  if (!other) return topicKey;
  // Gana quien tenga la fecha de actualización más reciente (empate por JSON canónico), igual que en cualquier otro conflicto de esta tabla.
  const candidateWins = laterWins(String(candidate.updated_at), canonicalJson(candidate), String(other.updated_at), canonicalJson(other));
  if (candidateWins) {
    db.query("UPDATE memories SET topic_key=NULL WHERE id=?").run(other.id as string);
    notice(db, "CLOUD_TOPIC_CONFLICT", { keptMemoryId: candidate.id, clearedMemoryId: other.id });
    return topicKey;
  }
  notice(db, "CLOUD_TOPIC_CONFLICT", { keptMemoryId: other.id, clearedMemoryId: candidate.id });
  return null;
}

/** Aplica una fila entrante de `memories`: traduce su versión, resuelve el choque de `topic_key` si aplica, e inserta o actualiza según quién gane la comparación de fechas. */
function applyMemories(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const id = String(payload.id);
  const version = mappedVersion(db, id, row.installationId, Number(payload.version));
  const remote: Row = { ...payload, version };
  const scope = String(payload.scope);
  const ownerColumn = scope === "ecosystem" ? "groupId" : "projectId";
  const ownerId = (remote[ownerColumn] as string | null) ?? null;
  const current = existingRow(db, "memories", ["id"], remote);
  if (!current) {
    remote.topic_key = resolveTopicConflict(db, remote, scope, ownerColumn, ownerId);
    insertRow(db, "memories", columns, remote);
    return "applied";
  }
  const localCanon = canonicalJson(pick(current, columns)), remoteCanon = canonicalJson(remote);
  if (laterWins(String(remote.updated_at), remoteCanon, String(current.updated_at), localCanon)) {
    remote.topic_key = resolveTopicConflict(db, remote, scope, ownerColumn, ownerId);
    updateRow(db, "memories", columns, ["id"], remote);
  }
  return "applied";
}

/** Aplica una fila entrante que no es un borrado, eligiendo la estrategia según el tipo (`memories` y `memory_versions` tienen su propia lógica; el resto usa fecha u sobrescritura simple, tras traducir su columna de versión si la tiene). */
function applyUpsert(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const kind = row.kind;
  if (kind === "memories") return applyMemories(db, row, columns, payload);
  if (kind === "memory_versions") return applyMemoryVersion(db, row, payload);
  const remapped: Row = VERSION_COLUMN[kind]
    ? { ...payload, [VERSION_COLUMN[kind]!]: mappedVersion(db, String(payload[MEMORY_ID_COLUMN[kind]!]), row.installationId, Number(payload[VERSION_COLUMN[kind]!])) }
    : payload;
  if (kind === "sessions") { applySessions(db, columns, remapped); return "applied"; }
  if (DATED_COLUMN[kind]) { upsertDated(db, kind, columns, remapped); return "applied"; }
  upsertOverwrite(db, kind, columns, remapped);
  return "applied";
}

/** Aplica una fila entrante que borra un registro, traduciendo antes su versión (salvo en `memories`, que ya no guarda su propia versión al borrarse) y su clave de borrado si es una versión de memoria. */
function applyDelete(db: Database, row: ChangeRow, columns: readonly string[], payload: Row): Outcome {
  const kind = row.kind;
  const remapped: Row = VERSION_COLUMN[kind] && kind !== "memories"
    ? { ...payload, [VERSION_COLUMN[kind]!]: mappedVersion(db, String(payload[MEMORY_ID_COLUMN[kind]!]), row.installationId, Number(payload[VERSION_COLUMN[kind]!])) }
    : payload;
  const keyColumns = kind === "memory_versions" ? ["memory_id", "version"] : NATURAL_KEY[kind]!;
  const keyPayload = kind === "memory_versions"
    ? { memory_id: payload.memory_id, version: mappedVersion(db, String(payload.memory_id), row.installationId, Number(payload.version)) }
    : remapped;
  const where = keyColumns.map(column => `${column}=?`).join(" AND ");
  db.query(`DELETE FROM ${kind} WHERE ${where}`).run(...keyColumns.map(column => keyPayload[column] as never));
  return "applied";
}

/**
 * Decide qué hacer con una fila de cambios: se salta si es propia de esta instalación (ya
 * está aplicada localmente por definición), si su tipo no se reconoce, si su forma no es la
 * esperada o si contiene un secreto; en cualquier otro caso, se aplica como borrado o como
 * upsert según `row.op`.
 */
function applyRow(db: Database, row: ChangeRow, installationId: string, columnsByKind: ReadonlyMap<string, readonly string[]>): Outcome {
  const columns = columnsByKind.get(row.kind);
  if (row.installationId === installationId) return "own";
  if (!columns) { notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason: "UNKNOWN_KIND" }); return "skipped"; }
  if (!validPayload(row.payload, columns)) { notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason: "INVALID_PAYLOAD" }); return "skipped"; }
  const payload = row.payload;
  const pattern = secretPatternOf(row.kind, payload);
  if (pattern) { notice(db, "SECRET_REJECTED", { id: row.id, kind: row.kind, key: naturalKeyOf(row.kind, payload), pattern }); return "skipped"; }
  if (row.op === "delete") return applyDelete(db, row, columns, payload);
  return applyUpsert(db, row, columns, payload);
}

/**
 * Aplica las filas traídas de Neon dentro de una sola transacción (D2): el guardia de
 * aplicación (`apply_guard`) se levanta antes de la primera fila y se baja en un `finally`
 * dentro de esa misma transacción, así que un error no atrapado deshace todo (guardia
 * incluido) y los disparadores (triggers) locales retoman el encolado en el siguiente
 * guardado (Foco de revisión #1). Cada fila corre en su propio SAVEPOINT (D2): una fila que
 * falla la validación, la revisión de secretos o una clave foránea se salta con un aviso
 * `CLOUD_ROW_SKIPPED` y el resto de la tanda se sigue aplicando (Foco de revisión #2). Las
 * filas que pertenecen a esta misma instalación solo hacen avanzar `last_applied_id`.
 * @param db Base local a la que se aplican los cambios.
 * @param rows Filas traídas de la tabla `changes` de la nube, en orden.
 * @param installationId Identificador de esta instalación, para reconocer y saltar sus propias filas.
 * @returns Cuántas filas se aplicaron, se saltaron o generaron un conflicto de versión, y el último id aplicado.
 */
export function applyCloudChanges(db: Database, rows: readonly ChangeRow[], installationId: string): ApplyResult {
  const columnsByKind = travelingTableColumns();
  let applied = 0, skipped = 0, conflicts = 0;
  let lastAppliedId = (db.query("SELECT last_applied_id FROM cloud_state WHERE id=1").get() as { last_applied_id: number }).last_applied_id;
  db.transaction(() => {
    // Se levanta el guardia antes de tocar ninguna fila, para que los disparadores locales sepan que hay una aplicación de cambios remotos en curso y no la confundan con un guardado propio.
    db.query("UPDATE cloud_state SET apply_guard=1 WHERE id=1").run();
    try {
      for (const row of rows) {
        // Cada fila tiene su propio punto de recuperación (savepoint): si falla, se deshace solo esa fila, no la tanda completa.
        db.exec("SAVEPOINT cloud_apply_row");
        try {
          const outcome = applyRow(db, row, installationId, columnsByKind);
          if (outcome === "applied") applied++;
          else if (outcome === "conflict") { applied++; conflicts++; }
          else if (outcome === "skipped") skipped++;
          db.exec("RELEASE cloud_apply_row");
        } catch (error) {
          // Un error inesperado (por ejemplo, una clave foránea rota) solo deshace esta fila; se registra como salteada y se sigue con las demás.
          db.exec("ROLLBACK TO cloud_apply_row");
          db.exec("RELEASE cloud_apply_row");
          const message = error instanceof Error ? error.message : String(error);
          const reason = message.includes("FOREIGN KEY") ? "FOREIGN_KEY" : "APPLY_ERROR";
          notice(db, "CLOUD_ROW_SKIPPED", { id: row.id, kind: row.kind, op: row.op, reason });
          skipped++;
        }
        // El puntero avanza incluso para una fila salteada o propia: ya se procesó (o se descartó a propósito) y no debe volver a pedirse.
        lastAppliedId = row.id;
        db.query("UPDATE cloud_state SET last_applied_id=? WHERE id=1").run(lastAppliedId);
      }
    } finally {
      // Se baja el guardia pase lo que pase, incluso si una fila lanzó un error no atrapado más arriba.
      db.query("UPDATE cloud_state SET apply_guard=0 WHERE id=1").run();
    }
  }).immediate();
  return { applied, skipped, conflicts, lastAppliedId };
}
