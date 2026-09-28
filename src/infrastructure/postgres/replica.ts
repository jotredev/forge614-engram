/**
 * Réplica de sincronización en PostgreSQL: guarda el historial de instantáneas (snapshots) publicadas por
 * comparar-y-cambiar (compare-and-swap) y una cola de cambios individuales por instalación, para que varias
 * instalaciones de Engram compartan un mismo grupo (ecosistema). Crea su propio esquema `forge614_sync` si
 * falta, valida en cada conexión que su forma sea exactamente la esperada (rechaza si alguien la modificó
 * por fuera) y nunca expone la URL de conexión ni credenciales en sus errores. La usan
 * `src/app/setup.ts`, `src/app/initialization.ts`, `src/app/synchronization.ts` y
 * `src/infrastructure/filesystem/workspace-config.ts`.
 */
import { SQL } from "bun";
import { MemoryError } from "../../shared/errors";
import { canonical, emptySnapshot, snapshotHash, syncError, validateSnapshot, type SyncSnapshot } from "../../modules/synchronization";

/**
 * Valida y convierte una URL de conexión a PostgreSQL en las opciones que espera el cliente `SQL` de Bun,
 * exigiendo usuario, base de datos y un modo TLS seguro fuera de `localhost`/loopback.
 * @param input URL de conexión completa (`postgres://` o `postgresql://`).
 * @returns Las opciones de conexión (`adapter`, host, puerto, credenciales, TLS y límites de la sesión).
 * @throws MemoryError con código `POSTGRES_URL` si la URL no es una cadena válida, no usa el protocolo
 * correcto, le falta usuario, host o base de datos, tiene parámetros de consulta distintos de `sslmode` y
 * `channel_binding`, usa un `sslmode` no permitido (fuera de loopback exige `require` o `verify-full`),
 * repite `channel_binding` o le da un valor que no sea `require`, `prefer` o `disable`, el puerto no es
 * válido, o alguna parte decodificada contiene un carácter de control.
 */
export function postgresOptions(input:string): SQL.PostgresOrMySQLOptions {
  try {
    if(typeof input!=="string"||input.length>8192||/[\s\x00-\x1f\x7f]/.test(input)) throw 0;
    const url=new URL(input);
    if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||!url.username||url.pathname.length<2||url.hash) throw 0;
    const loopback=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
    const modes=url.searchParams.getAll("sslmode");
    // Neon añade channel_binding a su dirección por defecto; Engram ya exige TLS verificado
    // (rejectUnauthorized:true) fuera de loopback, así que se acepta y se ignora (Bun no lo necesita).
    const bindings=url.searchParams.getAll("channel_binding");
    if([...url.searchParams.keys()].some(k=>k!=="sslmode"&&k!=="channel_binding")||modes.length>1||bindings.length>1) throw 0;
    const binding=bindings[0];
    if(binding!==undefined&&!["require","prefer","disable"].includes(binding)) throw 0;
    const mode=modes[0];
    if(mode!==undefined&&!(["require","verify-full"].includes(mode)||(loopback&&mode==="disable"))) throw 0;
    const port=url.port?Number(url.port):5432;
    if(!Number.isInteger(port)||port<1||port>65535) throw 0;
    const username=decodeURIComponent(url.username),password=decodeURIComponent(url.password),database=decodeURIComponent(url.pathname.slice(1));
    if([username,password,database].some(s=>/[\x00-\x1f\x7f]/.test(s))||database.includes("/")) throw 0;
    return {adapter:"postgres",hostname:url.hostname.replace(/^\[|\]$/g,""),port,username,password,database,
      tls:loopback&&mode==="disable"?false:{rejectUnauthorized:true},max:2,connectionTimeout:5,idleTimeout:5,
      connection:{statement_timeout:10000,lock_timeout:5000}};
  } catch { throw new MemoryError("POSTGRES_URL","POSTGRES_URL: conexión inválida. Usa la dirección completa de PostgreSQL (postgresql://usuario:clave@servidor/base); fuera de loopback exige TLS (sslmode=require o verify-full) y solo admite los parámetros sslmode y channel_binding."); }
}

const CHANGES_DDL=`CREATE TABLE forge614_sync.changes (
 id bigserial PRIMARY KEY, change_id text NOT NULL UNIQUE, installation_id uuid NOT NULL, kind text NOT NULL,
 op text NOT NULL CHECK (op IN ('insert','update','delete')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`;
// state.format versiona este esquema de réplica, no payload.format. Promover a la instantánea 2
// solo cambia el payload vigente (head); las revisiones históricas permanecen intactas.
const DDL=`CREATE SCHEMA forge614_sync;
CREATE TABLE forge614_sync.revisions (
 hash text PRIMARY KEY CHECK (length(hash) = 64), payload text NOT NULL
);
CREATE TABLE forge614_sync.state (
 id integer PRIMARY KEY CHECK (id = 1), format integer NOT NULL CHECK (format = 1),
 replica uuid NOT NULL, head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);
${CHANGES_DDL}`;
/** Una fila de la cola de cambios `forge614_sync.changes`, ya con sus nombres de columna en formato camelCase. */
export interface ChangeRow { readonly id:number; readonly changeId:string; readonly installationId:string; readonly kind:string; readonly op:"insert"|"update"|"delete"; readonly payload:unknown; readonly createdAt:string }
/** La instantánea vigente (head) leída de la réplica junto con el hash que la identifica. */
type Head={hash:string;snapshot:SyncSnapshot};
// Las cuatro comparaciones de abajo (columnas, restricciones, objetos, extras) son la única fuente de verdad
// de "cómo debe verse" el esquema: las usa tanto `validate()` (camino de creación, con transacción) como
// `validateProbe()` (camino rápido de solo lectura, una sola consulta), para que ambos caminos rechacen
// exactamente las mismas formas inesperadas con el mismo código de error.
/** Compara cada columna (tabla, nombre, tipo, si admite NULL) contra la lista exacta esperada. */
function checkColumns(rows:[string,string,string,boolean][]):void {
  const expected:[string,string,string,boolean][]=[
    ["changes","id","bigint",true],["changes","change_id","text",true],["changes","installation_id","uuid",true],
    ["changes","kind","text",true],["changes","op","text",true],["changes","payload","jsonb",true],["changes","created_at","timestamp with time zone",true],
    ["revisions","hash","text",true],["revisions","payload","text",true],
    ["state","id","integer",true],["state","format","integer",true],["state","replica","uuid",true],["state","head","text",true],
  ];
  if(canonical(rows)!==canonical(expected)) syncError("POSTGRES_SCHEMA");
}
/**
 * Compara cada restricción (clave primaria, única, de comprobación, foránea) contra la lista exacta esperada.
 * Desde PostgreSQL 18, cada columna NOT NULL también se cataloga aquí (contype 'n'), así que quien arma
 * `rows` ya la excluye: la columna se comprueba en {@link checkColumns} con attnotnull, y su validez aparte
 * en {@link checkUnvalidatedNotNull}.
 */
function checkConstraints(rows:[string,string][]):void {
  const wanted:[string,string][]=[
    ["changes_change_id_key","UNIQUE (change_id)"],["changes_op_check","CHECK ((op = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))"],["changes_pkey","PRIMARY KEY (id)"],
    ["revisions_hash_check","CHECK ((length(hash) = 64))"],["revisions_pkey","PRIMARY KEY (hash)"],
    ["state_format_check","CHECK ((format = 1))"],["state_head_fkey","FOREIGN KEY (head) REFERENCES forge614_sync.revisions(hash)"],
    ["state_id_check","CHECK ((id = 1))"],["state_pkey","PRIMARY KEY (id)"],
  ];
  if(canonical(rows)!==canonical(wanted)) syncError("POSTGRES_SCHEMA");
}
/**
 * Una restricción NOT NULL (contype 'n') sin validar (NOT VALID) podría convivir con filas nulas aunque
 * attnotnull ya esté en true, así que se rechaza aparte: en PostgreSQL < 18 este conteo siempre da cero.
 */
function checkUnvalidatedNotNull(count:number):void { if(count!==0) syncError("POSTGRES_SCHEMA"); }
/** Compara la lista de objetos del esquema (tablas, índices, secuencias) y si alguno tiene seguridad de fila por registro (RLS) activada. */
function checkObjects(rows:[string,string,boolean][]):void {
  const expected:[string,string,boolean][]=[
    ["changes","r",false],["changes_change_id_key","i",false],["changes_id_seq","S",false],["changes_pkey","i",false],
    ["revisions","r",false],["revisions_pkey","i",false],["state","r",false],["state_pkey","i",false],
  ];
  if(canonical(rows)!==canonical(expected)) syncError("POSTGRES_SCHEMA");
}
/** Ningún disparador, función o vista debe existir en el esquema: su suma debe dar exactamente cero. */
function checkExtras(count:number):void { if(count!==0) syncError("POSTGRES_SCHEMA"); }
/**
 * Comprueba que el esquema `forge614_sync` en la base conectada tiene exactamente las columnas,
 * restricciones y objetos esperados, y ningún disparador, función o vista extra; una réplica modificada
 * por fuera de este módulo se rechaza en vez de usarse tal cual. La usa el camino de creación (con
 * transacción): el camino rápido de solo lectura usa en cambio {@link validateProbe} sobre el resultado de
 * {@link probeSchema}, contra las mismas comparaciones.
 * @param db Conexión o transacción activa contra la base de PostgreSQL.
 * @throws MemoryError con código `POSTGRES_SCHEMA` (vía `syncError`) si las columnas, restricciones,
 * objetos del esquema, o el conteo de disparadores/funciones/vistas no coinciden exactamente con lo esperado.
 */
async function validate(db:SQL|Bun.TransactionSQL):Promise<void> {
  const columns=await db.unsafe(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='forge614_sync' AND c.relkind='r'
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  checkColumns(columns.map((r:any)=>[r.relname,r.attname,r.type,r.attnotnull]));
  const constraints=await db.unsafe(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
    WHERE connamespace='forge614_sync'::regnamespace AND contype<>'n' ORDER BY conname`);
  checkConstraints(constraints.map((r:any)=>[r.conname,r.definition]));
  const unvalidatedNotNull=await db.unsafe(`SELECT count(*) AS n FROM pg_catalog.pg_constraint
    WHERE connamespace='forge614_sync'::regnamespace AND contype='n' AND NOT convalidated`);
  checkUnvalidatedNotNull(Number(unvalidatedNotNull[0].n));
  const objects=await db.unsafe(`SELECT relname,relkind,relrowsecurity FROM pg_catalog.pg_class WHERE relnamespace='forge614_sync'::regnamespace ORDER BY relname`);
  checkObjects(objects.map((r:any)=>[r.relname,r.relkind,r.relrowsecurity]));
  const extras=await db.unsafe(`SELECT
    (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='forge614_sync'::regnamespace AND NOT t.tgisinternal)
    +(SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='forge614_sync'::regnamespace)
    +(SELECT count(*) FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class WHERE c.relnamespace='forge614_sync'::regnamespace) AS n`);
  checkExtras(Number(extras[0].n));
}
/** Lo que devuelve {@link probeSchema} en una sola fila: todo lo que antes leían las cinco consultas de `validate()`, más la existencia del esquema/tabla `changes` y la fila de estado (si la hay). */
interface SchemaProbe {
  /** Si existe el esquema `forge614_sync`. */
  schemaExists:boolean;
  /** Si existe la tabla `forge614_sync.changes`. */
  changesExists:boolean;
  /** Columnas de `changes`: nombre, tipo, valor por defecto y si acepta NULL. */
  columns:[string,string,string,boolean][];
  /** Restricciones CHECK de `changes`: nombre y definición. */
  constraints:[string,string][];
  /** Cuántas restricciones NOT NULL del esquema aún no están validadas. */
  unvalidatedNotNull:number;
  /** Objetos del esquema (tablas, índices, etc.): nombre, tipo de relación y si tiene RLS activo. */
  objects:[string,string,boolean][];
  /** Cuántos triggers, funciones y vistas adicionales hay en el esquema. */
  extras:number;
  /** La fila de estado con el id de la réplica y su formato, o null si la tabla falta o no tiene la fila 1. */
  state:{replica:string;format:number}|null;
}
// Cada ida y vuelta a una réplica remota (Neon) cuesta ~60 ms, y la espera de arranque tiene un tope de
// 1000 ms (D8): con el esquema ya creado, las 11 idas y vueltas que hacía `connect()` (BEGIN, bloqueo
// consultivo, pg_namespace, to_regclass, las 5 consultas de `validate()`, SELECT de state, COMMIT) agotaban
// ese tope solas. Esta única sentencia SELECT ve una foto coherente (MVCC) de todo eso en una sola ida y
// vuelta. Las columnas/restricciones/objetos/extras se filtran por nombre de esquema (`n.nspname='forge614_sync'`
// vía join, nunca `::regnamespace`) para que la consulta no falle cuando el esquema falta: da listas vacías
// en vez de un error. La fila de `state` sí necesita nombrar la tabla de forma literal (`FROM
// forge614_sync.state`), y esa referencia SÍ haría fallar la sentencia entera si la tabla no existe (el
// análisis de Postgres resuelve los nombres de tabla al vuelo, sin importar ningún CASE que la rodee:
// comprobado a mano). Por eso esa parte se ejecuta de forma dinámica con `query_to_xml` (siempre disponible
// en el núcleo, sin extensión) dentro de un CASE guardado por `to_regclass('forge614_sync.state')`: el texto
// de la subconsulta es solo una cadena para la sentencia externa, así que su análisis se pospone hasta que
// `query_to_xml` la ejecuta en tiempo de ejecución, y el CASE ya garantizó entonces que la tabla existe;
// `xmltable` convierte esa salida XML de vuelta a JSON para no tener que analizar XML a mano en JavaScript.
const PROBE_SQL=`SELECT
  (to_regnamespace('forge614_sync') IS NOT NULL) AS schema_exists,
  (to_regclass('forge614_sync.changes') IS NOT NULL) AS changes_exists,
  COALESCE((SELECT json_agg(json_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY c.relname,a.attnum)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='forge614_sync' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped), '[]')::jsonb AS columns,
  COALESCE((SELECT json_agg(json_build_array(pc.conname,pg_get_constraintdef(pc.oid)) ORDER BY pc.conname)
    FROM pg_catalog.pg_constraint pc JOIN pg_catalog.pg_namespace n ON n.oid=pc.connamespace
    WHERE n.nspname='forge614_sync' AND pc.contype<>'n'), '[]')::jsonb AS constraints,
  (SELECT count(*) FROM pg_catalog.pg_constraint pc JOIN pg_catalog.pg_namespace n ON n.oid=pc.connamespace
    WHERE n.nspname='forge614_sync' AND pc.contype='n' AND NOT pc.convalidated) AS unvalidated_not_null,
  COALESCE((SELECT json_agg(json_build_array(c.relname,c.relkind,c.relrowsecurity) ORDER BY c.relname)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='forge614_sync'), '[]')::jsonb AS objects,
  (
    (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='forge614_sync' AND NOT t.tgisinternal)
    + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='forge614_sync')
    + (SELECT count(*) FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='forge614_sync')
  ) AS extras,
  (CASE WHEN to_regclass('forge614_sync.state') IS NOT NULL THEN
    (SELECT json_build_object('replica',x.replica,'format',x.format)
     FROM xmltable('/table/row' PASSING query_to_xml('SELECT replica::text AS replica, format FROM forge614_sync.state WHERE id=1', false, false, '')
       COLUMNS replica text PATH 'replica', format int PATH 'format') x)
  ELSE NULL END)::jsonb AS state`;
/** Convierte lo que Bun devuelve para una columna `jsonb` (a veces ya el valor, a veces su texto) al valor JS. */
function jsonColumn(value:unknown):any { return typeof value==="string"?JSON.parse(value):value; }
/**
 * Hace la única consulta de solo lectura que necesita el camino rápido de {@link PostgresReplica.connect}.
 * @param db Conexión (fuera de transacción: una sola sentencia `SELECT` ya ve una foto coherente).
 * @returns Todo lo que antes exigía cinco consultas de `validate()` más la comprobación de existencia y la
 * fila de estado, en una sola ida y vuelta a la base.
 */
async function probeSchema(db:SQL):Promise<SchemaProbe> {
  const [row]=await db.unsafe(PROBE_SQL);
  const state=jsonColumn(row.state);
  return {
    schemaExists:row.schema_exists,changesExists:row.changes_exists,
    columns:jsonColumn(row.columns)??[],constraints:jsonColumn(row.constraints)??[],
    unvalidatedNotNull:Number(row.unvalidated_not_null),objects:jsonColumn(row.objects)??[],extras:Number(row.extras),
    state:state?{replica:state.replica,format:Number(state.format)}:null,
  };
}
/** Aplica a un {@link SchemaProbe} las mismas comprobaciones que {@link validate} aplica en el camino de creación. */
function validateProbe(probe:SchemaProbe):void {
  checkColumns(probe.columns);checkConstraints(probe.constraints);
  checkUnvalidatedNotNull(probe.unvalidatedNotNull);checkObjects(probe.objects);checkExtras(probe.extras);
}
/**
 * Convierte cualquier error capturado en un `MemoryError` seguro de mostrar: si ya lo es, lo repropaga tal
 * cual; si no, lo reemplaza por un mensaje genérico que nunca incluye la causa original (que podría llevar
 * la URL de conexión o credenciales).
 * @param error Error capturado de una operación contra PostgreSQL.
 * @throws MemoryError siempre: el mismo `error` si ya era uno, o uno nuevo con código `POSTGRES_UNAVAILABLE`.
 */
function safe(error:unknown):never {
  if(error instanceof MemoryError) throw error;
  throw new MemoryError("POSTGRES_UNAVAILABLE","PostgreSQL no disponible o sin permisos. Los datos locales se conservan; comprueba conexión y TLS sin compartir credenciales.");
}
/**
 * Cliente de la réplica de sincronización sobre PostgreSQL: mantiene una conexión abierta y expone la
 * lectura y publicación de instantáneas, y el envío y consumo de la cola de cambios individuales.
 */
export class PostgresReplica {
  /** Privado: úsese {@link PostgresReplica.connect} para obtener una instancia ya conectada y validada. */
  private constructor(private readonly db:SQL,readonly id:string) {}
  /**
   * Conecta a una base de PostgreSQL y deja lista la réplica: si el esquema `forge614_sync` no existe y
   * `create` es `true`, lo crea con una instantánea vacía como punto de partida; si el esquema existe pero
   * es de una versión anterior sin la tabla `changes` (réplicas de Engram 1.7.x), la agrega sin tocar el
   * resto. Todo bajo un bloqueo consultivo (`advisory lock`) para que dos conexiones que inicializan a la
   * vez no se pisen.
   * @param url URL de conexión a PostgreSQL, validada con {@link postgresOptions}.
   * @param create Si es `true`, permite crear el esquema o la tabla `changes` cuando falten; si es `false`,
   * una réplica sin inicializar se rechaza en vez de crearse.
   * @returns Una réplica conectada, con su identificador (`id`) leído de `forge614_sync.state`.
   * @throws MemoryError con código `POSTGRES_UNINITIALIZED` si falta el esquema o la tabla `changes` y
   * `create` es `false`; con `POSTGRES_SCHEMA` si la fila de estado no tiene exactamente el formato
   * esperado o el esquema no valida (vía {@link validate}); con `POSTGRES_UNAVAILABLE` para cualquier otro
   * fallo de conexión o permisos.
   */
  static async connect(url:string,create=false):Promise<PostgresReplica> {
    const db=new SQL(postgresOptions(url));
    try {
      // Camino rápido: si el esquema ya está completo (con `changes`), una sola consulta de solo lectura
      // (ver PROBE_SQL) basta para validarlo y leer el id de la réplica, sin transacción ni bloqueo
      // consultivo (innecesarios cuando no se va a escribir nada).
      const probe=await probeSchema(db);
      if(probe.schemaExists&&probe.changesExists) {
        validateProbe(probe);
        if(!probe.state||probe.state.format!==1) syncError("POSTGRES_SCHEMA");
        return new PostgresReplica(db,probe.state.replica);
      }
      const id=await db.begin(async tx=>{
        await tx.unsafe("SELECT pg_advisory_xact_lock(1177956660,7)");
        const exists=await tx.unsafe("SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='forge614_sync'");
        if(!exists.length) {
          // Esquema completamente nuevo: se crea con una instantánea vacía como primera revisión (head).
          if(!create) syncError("POSTGRES_UNINITIALIZED");
          await tx.unsafe(DDL).simple();
          const initial=emptySnapshot();const hash=snapshotHash(initial);
          await tx.unsafe("INSERT INTO forge614_sync.revisions(hash,payload) VALUES($1,$2)",[hash,canonical(initial)]);
          await tx.unsafe("INSERT INTO forge614_sync.state(id,format,replica,head) VALUES(1,1,$1,$2)",[crypto.randomUUID(),hash]);
        } else {
          // Esquema ya existente: si le falta la tabla de cambios (réplica de una versión anterior), se agrega sin tocar lo demás.
          const changes=await tx.unsafe("SELECT to_regclass('forge614_sync.changes') AS t");
          if(!changes[0].t) {
            if(!create) syncError("POSTGRES_UNINITIALIZED");
            await tx.unsafe(CHANGES_DDL).simple();
          }
        }
        await validate(tx);
        const state=await tx.unsafe("SELECT replica::text,format FROM forge614_sync.state WHERE id=1");
        if(state.length!==1||state[0].format!==1) syncError("POSTGRES_SCHEMA");
        return state[0].replica as string;
      });
      return new PostgresReplica(db,id);
    } catch(error) { await db.close();return safe(error); }
  }
  /**
   * Lee la instantánea vigente (head) de la réplica.
   * @returns El hash y el contenido de la instantánea vigente.
   * @throws MemoryError con código `POSTGRES_SCHEMA` si no hay exactamente una fila de estado; con
   * `SYNC_TOO_LARGE` si el payload guardado supera 8 MiB; con `SYNC_INVALID` si el hash guardado no
   * corresponde al contenido leído (los datos fueron alterados por fuera); con `POSTGRES_UNAVAILABLE` para
   * cualquier otro fallo de conexión.
   */
  async read():Promise<Head> {
    try {
      const rows=await this.db.unsafe("SELECT r.hash,r.payload FROM forge614_sync.state s JOIN forge614_sync.revisions r ON r.hash=s.head WHERE s.id=1");
      if(rows.length!==1) syncError("POSTGRES_SCHEMA");
      if(Buffer.byteLength(rows[0].payload)>8*1024*1024) syncError("SYNC_TOO_LARGE");
      const snapshot:unknown=JSON.parse(rows[0].payload);validateSnapshot(snapshot);
      if(snapshotHash(snapshot)!==rows[0].hash) syncError("SYNC_INVALID");
      return {hash:rows[0].hash,snapshot};
    } catch(error) { return safe(error); }
  }
  /**
   * Publica una nueva instantánea vigente mediante comparar-y-cambiar: solo la aplica si la instantánea
   * vigente actual sigue siendo la que se esperaba (`expected`), para no perder cambios de otra instalación
   * publicados mientras tanto.
   * @param expected Hash de la instantánea vigente que se esperaba encontrar antes de publicar.
   * @param snapshot Nueva instantánea a publicar.
   * @returns El hash de la instantánea publicada (nueva, o la ya vigente si esta llamada resultó ser una
   * repetición de una publicación anterior ya aplicada).
   * @throws MemoryError con código `SYNC_REMOTE_CHANGED` si la instantánea vigente actual no coincide con
   * `expected` (y tampoco es ya la que se intenta publicar); con `POSTGRES_SCHEMA` si no hay exactamente
   * una fila de estado; con `POSTGRES_UNAVAILABLE` para cualquier otro fallo.
   */
  async publish(expected:string,snapshot:SyncSnapshot):Promise<string> {
    validateSnapshot(snapshot);const hash=snapshotHash(snapshot);
    try {
      await this.db.begin(async tx=>{
        const rows=await tx.unsafe("SELECT head FROM forge614_sync.state WHERE id=1 FOR UPDATE");
        if(rows.length!==1) syncError("POSTGRES_SCHEMA");
        if(rows[0].head===hash) return; // Confirmación perdida: repetir la publicación no tiene efecto.
        if(rows[0].head!==expected) syncError("SYNC_REMOTE_CHANGED");
        await tx.unsafe("INSERT INTO forge614_sync.revisions(hash,payload) VALUES($1,$2) ON CONFLICT(hash) DO NOTHING",[hash,canonical(snapshot)]);
        await tx.unsafe("UPDATE forge614_sync.state SET head=$1 WHERE id=1",[hash]);
      });return hash;
    } catch(error) {return safe(error);}
  }
  /**
   * Envía un lote de cambios individuales a la cola compartida, ignorando en silencio los que ya se habían
   * enviado antes (mismo `changeId`), para que reintentar un envío con respuesta perdida no duplique filas.
   * Todo el lote se serializa bajo un bloqueo consultivo, así que dos lotes concurrentes nunca intercalan
   * sus identificadores. El parámetro llega como texto (`row.payload` ya pasado por `JSON.stringify`) y el
   * SQL lo convierte a `jsonb` con `::text::jsonb`; convertirlo directo con `::jsonb` guardaría el texto
   * JSON como una cadena dentro de la columna (doble codificación), en vez del objeto, y el contenido
   * quedaría inconsultable en Neon.
   * @param installationId Identificador de la instalación que origina los cambios.
   * @param rows Cambios a enviar, en el orden en que deben quedar numerados.
   * @returns Los identificadores numéricos asignados a cada fila, en el mismo orden que `rows` (el de una
   * fila repetida es el que ya tenía).
   * @throws MemoryError con código `POSTGRES_UNAVAILABLE` si la transacción falla.
   */
  async pushChanges(installationId:string,rows:{changeId:string;kind:string;op:"insert"|"update"|"delete";payload:unknown}[]):Promise<{ids:number[]}> {
    if(!rows.length) return {ids:[]};
    try {
      const ids=await this.db.begin(async tx=>{
        await tx.unsafe("SELECT pg_advisory_xact_lock(1177956660,8)");
        const out:number[]=[];
        for(const row of rows) {
          const inserted=await tx.unsafe(
            "INSERT INTO forge614_sync.changes(change_id,installation_id,kind,op,payload) VALUES($1,$2,$3,$4,$5::text::jsonb) ON CONFLICT (change_id) DO NOTHING RETURNING id",
            [row.changeId,installationId,row.kind,row.op,JSON.stringify(row.payload)]);
          if(inserted.length) out.push(Number(inserted[0].id));
          else {
            // La fila ya existía (mismo changeId de un envío anterior): se devuelve su id ya asignado, sin insertar de nuevo.
            const existing=await tx.unsafe("SELECT id FROM forge614_sync.changes WHERE change_id=$1",[row.changeId]);
            out.push(Number(existing[0].id));
          }
        }
        return out;
      });
      return {ids};
    } catch(error) { return safe(error); }
  }
  /**
   * Consulta la cola de cambios a partir de un identificador dado, para que cada instalación siga leyendo
   * desde donde se quedó. Cancelable de verdad (Foco de revisión #3): si `signal` ya está abortada, ni
   * siquiera abre la consulta; si se aborta mientras la consulta sigue en curso, la cancela en PostgreSQL
   * (`query.cancel()`) en vez de solo ignorar su respuesta, para no dejar una consulta bloqueada compitiendo
   * por la misma conexión que la tarea en segundo plano.
   * @param since Solo se devuelven cambios con identificador mayor a este valor.
   * @param limit Cantidad máxima de filas a devolver (por defecto 1000).
   * @param signal Señal opcional de cancelación (tope de la espera de arranque, D8, o detención de la tarea de fondo).
   * @returns Los cambios con `id > since`, ordenados por `id` ascendente, hasta `limit` filas.
   * @throws MemoryError con código `SYNC_INVALID` si `since` no es un entero no negativo, o `limit` no es
   * un entero entre 1 y 1000; con `POSTGRES_UNAVAILABLE` si `signal` ya estaba abortada, si se abortó
   * mientras la consulta seguía en curso, o para cualquier otro fallo.
   */
  async pullChanges(since:number,limit=1000,signal?:AbortSignal):Promise<ChangeRow[]> {
    if(!Number.isInteger(since)||since<0||!Number.isInteger(limit)||limit<1||limit>1000) syncError("SYNC_INVALID");
    // Si el tope ya venció antes de intentarlo, ni vale la pena abrir la consulta.
    if(signal?.aborted) return safe(new Error("pullChanges aborted before querying"));
    const query=this.db.unsafe(
      `SELECT id,change_id,installation_id,kind,op,payload,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
       FROM forge614_sync.changes WHERE id>$1 ORDER BY id LIMIT $2`,[since,limit]);
    // Si la señal se aborta mientras la consulta sigue en curso, se cancela de verdad en PostgreSQL
    // (libera cualquier candado que estuviera esperando), no solo se descarta la respuesta al volver.
    const onAbort=()=>{query.cancel();};
    signal?.addEventListener("abort",onAbort,{once:true});
    try {
      const rows=await query;
      return rows.map((r:any):ChangeRow=>({id:Number(r.id),changeId:r.change_id,installationId:r.installation_id,kind:r.kind,
        op:r.op,payload:typeof r.payload==="string"?JSON.parse(r.payload):r.payload,createdAt:r.created_at}));
    } catch(error) { return safe(error); }
    finally { signal?.removeEventListener("abort",onAbort); }
  }
  /** Cierra la conexión a PostgreSQL. */
  async close():Promise<void> {await this.db.close();}
}
