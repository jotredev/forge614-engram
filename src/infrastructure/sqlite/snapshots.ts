/**
 * Sincronización (synchronization: mantener la misma información al día en varias copias de la base)
 * entre esta base SQLite local y una réplica (replica: una copia remota con la que se comparan e
 * intercambian cambios). Aquí viven las tres operaciones que usa el módulo de sincronización de más
 * alto nivel:
 * - `exportSnapshot`: arma una foto (snapshot: un volcado completo y determinista del estado actual).
 * - `checkpoint`: recupera el último snapshot que se guardó como punto de partida para una réplica.
 * - `applySnapshot`: aplica de forma atómica (todo o nada) los cambios de un snapshot remoto y
 *   actualiza ese punto de partida.
 * El formato del snapshot (1, 2 o 3) depende de qué piezas del esquema (schema: la estructura de tablas
 * de la base) están habilitadas. El ámbito (scope) "ecosystem" (reglas compartidas por varios proyectos
 * de un mismo grupo) todavía no puede describirse en ningún formato, así que su sola existencia bloquea
 * la sincronización en vez de arriesgarse a perder o corromper esas memorias.
 */
import type { Database } from "bun:sqlite";
import type { ConfirmationRequest, Memory } from "../../modules/memory";
import { ecosystemEnabled } from "./ecosystem-groups";
import { schemaState } from "./schema";
import type { Session,SessionEntry,SessionSummary } from "../../modules/sessions";
import { assertExtension,confirmationRequestIdentity,emptySnapshot,requestOwnerKey,sessionEntryIdentity,snapshotHash,syncError,validateSnapshot,type SyncSnapshot } from "../../modules/synchronization";

/**
 * Compara dos cadenas para ordenarlas de forma estable y determinista (mismo resultado siempre con las
 * mismas entradas), como comparador propio de `Array.prototype.sort`.
 * @param left primer valor a comparar.
 * @param right segundo valor a comparar.
 * @returns -1 si `left` va antes, 1 si va después, 0 si son iguales.
 */
function compare(left:string,right:string):number { return left<right?-1:left>right?1:0; }

/**
 * Construye el snapshot (foto: volcado completo y determinista) del estado actual de la base: proyectos,
 * memorias con su historial de versiones, solicitudes (requests) y eventos y, según el nivel de esquema
 * alcanzado, también sesiones y datos de confirmación. Es de solo lectura: no modifica nada, aunque corre
 * dentro de una transacción para leer un estado consistente (sin que otra escritura lo cambie a mitad).
 * @param db conexión abierta a la base SQLite.
 * @returns el snapshot en el formato (1, 2 o 3) que el esquema actual permite describir.
 * @throws MemoryError con código SYNC_ECOSYSTEM_UNSUPPORTED si existen memorias de ámbito "ecosystem",
 * porque ningún formato de snapshot sabe representarlas todavía.
 */
export function exportSnapshot(db: Database): SyncSnapshot {
  return db.transaction(() => {
    // Los formatos de réplica 1-3 no pueden describir un ámbito (scope) de grupo ("ecosystem"). Se
    // rechaza de forma visible en vez de perder o corromper esas memorias; los datos locales quedan
    // intactos.
    if (ecosystemEnabled(db) && db.query("SELECT 1 FROM memories WHERE scope='ecosystem' LIMIT 1").get()) syncError("SYNC_ECOSYSTEM_UNSUPPORTED");
    // Todos los proyectos, en orden estable por projectId, para que el snapshot sea determinista.
    const projects = db.query("SELECT * FROM projects ORDER BY projectId").all() as SyncSnapshot["projects"];
    // Cada memoria con sus campos planos; topic_key se renombra a topicKey y pinned llega como 0/1
    // (así lo guarda SQLite) y se convierte a boolean más abajo.
    const rows = db.query(`SELECT id,projectId,scope,topic_key AS topicKey,type,title,content,pinned,version,state,
      created_at AS createdAt,updated_at AS updatedAt FROM memories ORDER BY id`).all() as (Omit<Memory,"pinned"> & {pinned:number})[];
    // Para cada memoria arma un "bundle" (paquete) con todo su historial: las versiones guardadas (para
    // poder reconstruir su estado en cualquier punto), las solicitudes ya atendidas (para no repetirlas
    // al aplicar el snapshot en otra réplica) y los eventos que marcan su ciclo de vida.
    const memories = rows.map(row => ({
      memory:{...row,pinned:row.pinned===1},
      // snapshot se guardó como texto JSON en memory_versions; se reconstruye con JSON.parse.
      versions:(db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? ORDER BY version").all(row.id) as {snapshot:string}[]).map(r=>JSON.parse(r.snapshot)),
      requests:db.query("SELECT request_key,payload_hash,version FROM requests WHERE memory_id=? ORDER BY request_key").all(row.id),
      // Bitácora (log) ordenada de altas, archivados y restauraciones de esta memoria.
      events:db.query("SELECT action,version,created_at FROM events WHERE memory_id=? ORDER BY id").all(row.id),
    }));
    // Nivel base del esquema instalado: decide qué piezas existen y qué formato de snapshot se usa.
    const version=schemaState(db).base;
    // Las sesiones solo existen desde el nivel de esquema 6 (enableSessionLifecycle); en niveles
    // menores no hay tablas que leer, así que se deja en null.
    const sessions = version>=6 ? {
      sessions:db.query("SELECT sessionId,projectId,kind,startedAt,endedAt FROM sessions ORDER BY sessionId").all() as Session[],
      sessionEntries:db.query("SELECT sessionId,memoryId,version,recordedAt FROM session_entries ORDER BY memoryId,version").all() as SessionEntry[],
      sessionSummaries:db.query("SELECT sessionId,memoryId,version FROM session_summaries ORDER BY sessionId").all() as SessionSummary[],
    } : null;
    let snapshot:unknown;
    // Nivel 7 (enableSearchReinforcement) añade confirmaciones: se arma el formato 3, el más completo.
    if(version===7) {
      // Trae cada solicitud de confirmación junto con el ámbito (scope) y proyecto de su memoria dueña,
      // necesarios para calcular su clave de propietario y así poder ordenarlas de forma determinista.
      const requestRows=db.query(`SELECT cr.memoryId,cr.requestKey,cr.payloadHash,cr.expectedVersion,cr.confirmationId,cr.response,
        m.scope AS ownerScope,m.projectId AS ownerProjectId FROM confirmation_requests cr JOIN memories m ON m.id=cr.memoryId`).all() as
        (Omit<ConfirmationRequest,"response">&{response:string;ownerScope:"project"|"shared";ownerProjectId:string|null})[];
      // response se guardó como texto JSON; se reconstruye. Se ordena por la clave de propietario
      // (ámbito + proyecto + clave de solicitud) para que el orden no dependa del id interno ni del
      // orden de inserción, y luego se descarta esa clave auxiliar (solo servía para ordenar).
      const confirmationRequests=requestRows.map(({ownerScope,ownerProjectId,response,...request})=>({
        request:{...request,response:JSON.parse(response) as ConfirmationRequest["response"]},
        owner:requestOwnerKey(ownerScope,ownerProjectId,request.requestKey),
      })).sort((a,b)=>compare(a.owner,b.owner)).map(item=>item.request);
      // Las sesiones, sus entradas y sus resúmenes también se reordenan por una identidad estable (no
      // por su orden de inserción), por la misma razón: que el snapshot sea reproducible byte a byte.
      const orderedSessions={
        sessions:[...sessions!.sessions].sort((a,b)=>compare(a.sessionId,b.sessionId)),
        sessionEntries:[...sessions!.sessionEntries].sort((a,b)=>compare(sessionEntryIdentity(a),sessionEntryIdentity(b))),
        sessionSummaries:[...sessions!.sessionSummaries].sort((a,b)=>compare(a.sessionId,b.sessionId)),
      };
      // Formato 3: agrega las confirmaciones (ordenadas por su id) además de todo lo anterior.
      snapshot={format:3,projects,memories,...orderedSessions,
        confirmations:db.query("SELECT confirmationId,memoryId,version,recordedAt,sessionId FROM confirmations ORDER BY confirmationId").all(),
        confirmationRequests,
      };
    // Formato 2: agrega sesiones pero no confirmaciones (el esquema aún no las tiene).
    } else if(version===6) snapshot={format:2,projects,memories,...sessions!};
    // Formato 1: la base mínima, sin sesiones ni confirmaciones.
    else snapshot={format:1,projects,memories};
    // Verifica que el snapshot armado cumple su propio esquema de validación antes de devolverlo.
    validateSnapshot(snapshot);return snapshot;
  // .deferred() pospone tomar el candado de escritura hasta que haga falta; aquí basta con leer.
  }).deferred();
}

/**
 * Devuelve el último snapshot (foto) que quedó guardado como punto de control (checkpoint) para una
 * réplica concreta, o un snapshot vacío si nunca se guardó ninguno. Sirve de estado "conocido en común"
 * (`expected`) que luego se le pasa a `applySnapshot`.
 * @param db conexión abierta a la base SQLite.
 * @param replica identificador de la réplica remota.
 * @returns el snapshot guardado para esa réplica, o uno vacío si no existe.
 * @throws MemoryError con código SYNC_TOO_LARGE si el snapshot guardado supera los 8 MiB.
 */
export function checkpoint(db: Database, replica: string): SyncSnapshot {
  // Busca la última foto guardada para esa réplica; snapshot se guardó como texto JSON.
  const row=db.query("SELECT snapshot FROM sync_checkpoints WHERE replica=?").get(replica) as {snapshot:string}|null;
  // Límite de tamaño: un snapshot mayor a 8 MiB se rechaza en vez de intentar procesarlo.
  if(row&&Buffer.byteLength(row.snapshot)>8*1024*1024) syncError("SYNC_TOO_LARGE");
  // Sin fila previa, el punto de partida es un snapshot vacío (aún no se sincronizó nada con esta réplica).
  const value:unknown=row?JSON.parse(row.snapshot):emptySnapshot();validateSnapshot(value);return value;
}

/**
 * Aplica de forma atómica (todo o nada) los cambios de un snapshot remoto (`next`) sobre la base local, y
 * actualiza el punto de control (checkpoint) de la réplica. Antes de escribir nada comprueba que el
 * estado local no haya cambiado desde que el llamador calculó `expected` (control de concurrencia
 * optimista) y que `next` sea una extensión válida del estado actual (que no borre ni reescriba historia).
 * @param db conexión abierta a la base SQLite.
 * @param expected el snapshot que el llamador cree que es el estado local actual (para detectar cambios concurrentes).
 * @param next el snapshot remoto que se quiere aplicar.
 * @param replica identificador de la réplica de origen, para guardar su nuevo punto de control.
 * @throws MemoryError con código REINFORCEMENT_REQUIRED si `next` es formato 3 pero el esquema local no llegó al nivel que lo soporta.
 * @throws MemoryError con código SESSIONS_REQUIRED si `next` trae sesiones (formato 2) pero el esquema local no las soporta.
 * @throws MemoryError con código SYNC_LOCAL_CHANGED si el estado local ya no coincide con `expected`.
 * @throws MemoryError con código SYNC_CONFLICT si `next` no extiende de forma válida el estado actual (ver assertExtension).
 * @throws MemoryError con código SYNC_ECOSYSTEM_UNSUPPORTED si el estado local ya tiene memorias de ámbito "ecosystem".
 */
export function applySnapshot(db: Database, expected:SyncSnapshot, next:SyncSnapshot, replica:string):void {
  // Valida la forma del snapshot remoto antes de entrar a la transacción.
  validateSnapshot(next);
  db.transaction(()=>{
    // Estado local actual, recalculado dentro de la misma transacción para comparar con next de forma consistente.
    const current=exportSnapshot(db);
    // Si el remoto ya trae confirmaciones (formato 3) pero este esquema local no las soporta, no hay
    // forma de aplicarlas sin perder información: se exige reforzar el esquema primero.
    if(next.format===3&&current.format!==3) syncError("REINFORCEMENT_REQUIRED");
    // Igual con sesiones: no se puede aplicar un snapshot con sesiones sobre un esquema que no las tiene.
    if(next.format===2&&current.format===1) syncError("SESSIONS_REQUIRED");
    // Compara el hash del estado actual contra expected: si no coinciden, algo cambió localmente desde
    // que el llamador calculó expected (evita pisar cambios que el llamador no vio).
    if(snapshotHash(current)!==snapshotHash(expected)) syncError("SYNC_LOCAL_CHANGED");
    // La sincronización no puede borrar ni reescribir historia. Se rechazan los snapshots divergentes
    // incluso si el llamador se saltó la reconciliación (reconcile), antes de que cualquier sentencia
    // SQLite modifique datos.
    assertExtension(current,next);
    // Inserta proyectos nuevos o actualiza nombre/fecha si ya existían (upsert por projectId).
    for(const p of next.projects) db.query(`INSERT INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)
      ON CONFLICT(projectId) DO UPDATE SET name=excluded.name,updatedAt=excluded.updatedAt`).run(p.projectId,p.name,p.createdAt,p.updatedAt);
    // Índice del estado actual por id de memoria, para saber qué partes de cada bundle ya existían y no reinsertarlas.
    const old=new Map(current.memories.map(b=>[b.memory.id,b]));
    // Recorre cada memoria del snapshot remoto y aplica solo lo que todavía falta localmente.
    for(const b of next.memories) {
      const m=b.memory;
      // Inserta la memoria o, si ya existe, actualiza sus campos mutables (título, contenido,
      // fijada/pinned, versión, estado...).
      db.query(`INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,
        content=excluded.content,pinned=excluded.pinned,version=excluded.version,state=excluded.state,updated_at=excluded.updated_at`)
        .run(m.id,m.projectId,m.scope,m.topicKey,m.type,m.title,m.content,Number(m.pinned),m.version,m.state,m.createdAt,m.updatedAt);
      // Bundle que ya existía localmente para esta memoria, si lo había.
      const previous=old.get(m.id);
      // Solo inserta las versiones que trae el remoto y el local todavía no tenía (evita duplicar historial ya aplicado).
      for(const v of b.versions.slice(previous?.versions.length??0)) db.query("INSERT INTO memory_versions(memory_id,version,snapshot) VALUES(?,?,?)").run(m.id,v.version,JSON.stringify(v));
      // Igual con las solicitudes: solo agrega las que no estén ya registradas por su request_key.
      for(const r of b.requests) if(!previous?.requests.some(p=>p.request_key===r.request_key)) db.query("INSERT INTO requests(projectId,scope,request_key,payload_hash,memory_id,version) VALUES(?,?,?,?,?,?)").run(m.projectId,m.scope,r.request_key,r.payload_hash,m.id,r.version);
      // Y con los eventos: solo los que vienen después de los que ya se tenían.
      for(const e of b.events.slice(previous?.events.length??0)) db.query("INSERT INTO events(memory_id,action,version,created_at) VALUES(?,?,?,?)").run(m.id,e.action,e.version,e.created_at);
    }
    // Formato 2 o 3: además de memorias, sincroniza sesiones, sus entradas y sus resúmenes.
    if(next.format!==1) {
      // Inserta la sesión o, si ya existía, solo actualiza su fecha de cierre (endedAt).
      for(const s of next.sessions) db.query(`INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET endedAt=excluded.endedAt`).run(s.sessionId,s.projectId,s.kind,s.startedAt,s.endedAt);
      // Las entradas de sesión son inmutables una vez creadas: si ya existe la combinación (memoryId,version) no se toca.
      for(const e of next.sessionEntries) db.query(`INSERT INTO session_entries(sessionId,memoryId,version,recordedAt) VALUES(?,?,?,?)
        ON CONFLICT(memoryId,version) DO NOTHING`).run(e.sessionId,e.memoryId,e.version,e.recordedAt);
      // El resumen de sesión más reciente reemplaza al anterior (una sesión solo tiene un resumen vigente).
      for(const s of next.sessionSummaries) db.query(`INSERT INTO session_summaries(sessionId,memoryId,version) VALUES(?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET memoryId=excluded.memoryId,version=excluded.version`).run(s.sessionId,s.memoryId,s.version);
    }
    // Formato 3: además sincroniza confirmaciones y sus solicitudes.
    if(next.format===3) {
      // Solo agrega confirmaciones que no existían ya (se identifican por su confirmationId).
      const confirmationIds=new Set(current.format===3?current.confirmations.map(item=>item.confirmationId):[]);
      for(const item of next.confirmations) if(!confirmationIds.has(item.confirmationId)) {
        db.query("INSERT INTO confirmations(confirmationId,memoryId,version,recordedAt,sessionId) VALUES(?,?,?,?,?)")
          .run(item.confirmationId,item.memoryId,item.version,item.recordedAt,item.sessionId);
      }
      const currentMemories=new Map(current.memories.map(bundle=>[bundle.memory.id,bundle]));
      const nextMemories=new Map(next.memories.map(bundle=>[bundle.memory.id,bundle]));
      // Igual con las solicitudes de confirmación, mismo criterio: identidad estable calculada por confirmationRequestIdentity.
      const requestIds=new Set(current.format===3?current.confirmationRequests.map(item=>confirmationRequestIdentity(currentMemories,item)):[]);
      for(const item of next.confirmationRequests) if(!requestIds.has(confirmationRequestIdentity(nextMemories,item))) {
        db.query(`INSERT INTO confirmation_requests(memoryId,requestKey,payloadHash,expectedVersion,confirmationId,response)
          VALUES(?,?,?,?,?,?)`).run(item.memoryId,item.requestKey,item.payloadHash,item.expectedVersion,item.confirmationId,JSON.stringify(item.response));
      }
    }
    // Guarda (o reemplaza) el snapshot completo como el nuevo punto de control de esta réplica.
    db.query("INSERT INTO sync_checkpoints(replica,snapshot) VALUES(?,?) ON CONFLICT(replica) DO UPDATE SET snapshot=excluded.snapshot").run(replica,JSON.stringify(next));
  // .immediate() toma el candado de escritura de inmediato (a diferencia de .deferred() en
  // exportSnapshot): aquí sí se va a escribir, y conviene no dejar que otra transacción se cuele a mitad de camino.
  }).immediate();
}
