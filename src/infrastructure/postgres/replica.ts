import { SQL } from "bun";
import { MemoryError } from "../../shared/errors";
import { canonical, emptySnapshot, snapshotHash, syncError, validateSnapshot, type SyncSnapshot } from "../../modules/synchronization";

export function postgresOptions(input:string): SQL.PostgresOrMySQLOptions {
  try {
    if(typeof input!=="string"||input.length>8192||/[\s\x00-\x1f\x7f]/.test(input)) throw 0;
    const url=new URL(input);
    if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||!url.username||url.pathname.length<2||url.hash) throw 0;
    const loopback=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
    const modes=url.searchParams.getAll("sslmode");
    if([...url.searchParams.keys()].some(k=>k!=="sslmode")||modes.length>1) throw 0;
    const mode=modes[0];
    if(mode!==undefined&&!(["require","verify-full"].includes(mode)||(loopback&&mode==="disable"))) throw 0;
    const port=url.port?Number(url.port):5432;
    if(!Number.isInteger(port)||port<1||port>65535) throw 0;
    const username=decodeURIComponent(url.username),password=decodeURIComponent(url.password),database=decodeURIComponent(url.pathname.slice(1));
    if([username,password,database].some(s=>/[\x00-\x1f\x7f]/.test(s))||database.includes("/")) throw 0;
    return {adapter:"postgres",hostname:url.hostname.replace(/^\[|\]$/g,""),port,username,password,database,
      tls:loopback&&mode==="disable"?false:{rejectUnauthorized:true},max:2,connectionTimeout:5,idleTimeout:5,
      connection:{statement_timeout:10000,lock_timeout:5000}};
  } catch { throw new MemoryError("POSTGRES_URL","POSTGRES_URL: conexión inválida. Usa una URL PostgreSQL completa; TLS verificado es obligatorio fuera de loopback."); }
}

const CHANGES_DDL=`CREATE TABLE forge614_sync.changes (
 id bigserial PRIMARY KEY, change_id text NOT NULL UNIQUE, installation_id uuid NOT NULL, kind text NOT NULL,
 op text NOT NULL CHECK (op IN ('insert','update','delete')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`;
// state.format versions this replica schema, not payload.format. Snapshot 2
// promotion changes only the head payload; historical revisions remain intact.
const DDL=`CREATE SCHEMA forge614_sync;
CREATE TABLE forge614_sync.revisions (
 hash text PRIMARY KEY CHECK (length(hash) = 64), payload text NOT NULL
);
CREATE TABLE forge614_sync.state (
 id integer PRIMARY KEY CHECK (id = 1), format integer NOT NULL CHECK (format = 1),
 replica uuid NOT NULL, head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);
${CHANGES_DDL}`;
export interface ChangeRow { readonly id:number; readonly changeId:string; readonly installationId:string; readonly kind:string; readonly op:"insert"|"update"|"delete"; readonly payload:unknown; readonly createdAt:string }
type Head={hash:string;snapshot:SyncSnapshot};
async function validate(db:SQL|Bun.TransactionSQL):Promise<void> {
  const columns=await db.unsafe(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='forge614_sync' AND c.relkind='r'
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  const expected=[
    ["changes","id","bigint",true],["changes","change_id","text",true],["changes","installation_id","uuid",true],
    ["changes","kind","text",true],["changes","op","text",true],["changes","payload","jsonb",true],["changes","created_at","timestamp with time zone",true],
    ["revisions","hash","text",true],["revisions","payload","text",true],
    ["state","id","integer",true],["state","format","integer",true],["state","replica","uuid",true],["state","head","text",true],
  ];
  if(canonical(columns.map((r:any)=>[r.relname,r.attname,r.type,r.attnotnull]))!==canonical(expected)) syncError("POSTGRES_SCHEMA");
  const constraints=await db.unsafe(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
    WHERE connamespace='forge614_sync'::regnamespace ORDER BY conname`);
  const wanted=[
    ["changes_change_id_key","UNIQUE (change_id)"],["changes_op_check","CHECK ((op = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))"],["changes_pkey","PRIMARY KEY (id)"],
    ["revisions_hash_check","CHECK ((length(hash) = 64))"],["revisions_pkey","PRIMARY KEY (hash)"],
    ["state_format_check","CHECK ((format = 1))"],["state_head_fkey","FOREIGN KEY (head) REFERENCES forge614_sync.revisions(hash)"],
    ["state_id_check","CHECK ((id = 1))"],["state_pkey","PRIMARY KEY (id)"],
  ];
  if(canonical(constraints.map((r:any)=>[r.conname,r.definition]))!==canonical(wanted)) syncError("POSTGRES_SCHEMA");
  const objects=await db.unsafe(`SELECT relname,relkind,relrowsecurity FROM pg_catalog.pg_class WHERE relnamespace='forge614_sync'::regnamespace ORDER BY relname`);
  if(canonical(objects.map((r:any)=>[r.relname,r.relkind,r.relrowsecurity]))!==canonical([
    ["changes","r",false],["changes_change_id_key","i",false],["changes_id_seq","S",false],["changes_pkey","i",false],
    ["revisions","r",false],["revisions_pkey","i",false],["state","r",false],["state_pkey","i",false],
  ])) syncError("POSTGRES_SCHEMA");
  const extras=await db.unsafe(`SELECT
    (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='forge614_sync'::regnamespace AND NOT t.tgisinternal)
    +(SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='forge614_sync'::regnamespace)
    +(SELECT count(*) FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class WHERE c.relnamespace='forge614_sync'::regnamespace) AS n`);
  if(Number(extras[0].n)!==0) syncError("POSTGRES_SCHEMA");
}
function safe(error:unknown):never {
  if(error instanceof MemoryError) throw error;
  throw new MemoryError("POSTGRES_UNAVAILABLE","PostgreSQL no disponible o sin permisos. Los datos locales se conservan; comprueba conexión y TLS sin compartir credenciales.");
}
export class PostgresReplica {
  private constructor(private readonly db:SQL,readonly id:string) {}
  static async connect(url:string,create=false):Promise<PostgresReplica> {
    const db=new SQL(postgresOptions(url));
    try {
      const id=await db.begin(async tx=>{
        await tx.unsafe("SELECT pg_advisory_xact_lock(1177956660,7)");
        const exists=await tx.unsafe("SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='forge614_sync'");
        if(!exists.length) {
          if(!create) syncError("POSTGRES_UNINITIALIZED");
          await tx.unsafe(DDL).simple();
          const initial=emptySnapshot();const hash=snapshotHash(initial);
          await tx.unsafe("INSERT INTO forge614_sync.revisions(hash,payload) VALUES($1,$2)",[hash,canonical(initial)]);
          await tx.unsafe("INSERT INTO forge614_sync.state(id,format,replica,head) VALUES(1,1,$1,$2)",[crypto.randomUUID(),hash]);
        } else {
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
  async publish(expected:string,snapshot:SyncSnapshot):Promise<string> {
    validateSnapshot(snapshot);const hash=snapshotHash(snapshot);
    try {
      await this.db.begin(async tx=>{
        const rows=await tx.unsafe("SELECT head FROM forge614_sync.state WHERE id=1 FOR UPDATE");
        if(rows.length!==1) syncError("POSTGRES_SCHEMA");
        if(rows[0].head===hash) return; // Lost acknowledgment: repeat has no effect.
        if(rows[0].head!==expected) syncError("SYNC_REMOTE_CHANGED");
        await tx.unsafe("INSERT INTO forge614_sync.revisions(hash,payload) VALUES($1,$2) ON CONFLICT(hash) DO NOTHING",[hash,canonical(snapshot)]);
        await tx.unsafe("UPDATE forge614_sync.state SET head=$1 WHERE id=1",[hash]);
      });return hash;
    } catch(error) {return safe(error);}
  }
  async pushChanges(installationId:string,rows:{changeId:string;kind:string;op:"insert"|"update"|"delete";payload:unknown}[]):Promise<{ids:number[]}> {
    if(!rows.length) return {ids:[]};
    try {
      const ids=await this.db.begin(async tx=>{
        await tx.unsafe("SELECT pg_advisory_xact_lock(1177956660,8)");
        const out:number[]=[];
        for(const row of rows) {
          const inserted=await tx.unsafe(
            "INSERT INTO forge614_sync.changes(change_id,installation_id,kind,op,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT (change_id) DO NOTHING RETURNING id",
            [row.changeId,installationId,row.kind,row.op,JSON.stringify(row.payload)]);
          if(inserted.length) out.push(Number(inserted[0].id));
          else {
            const existing=await tx.unsafe("SELECT id FROM forge614_sync.changes WHERE change_id=$1",[row.changeId]);
            out.push(Number(existing[0].id));
          }
        }
        return out;
      });
      return {ids};
    } catch(error) { return safe(error); }
  }
  async pullChanges(since:number,limit=1000):Promise<ChangeRow[]> {
    if(!Number.isInteger(since)||since<0||!Number.isInteger(limit)||limit<1||limit>1000) syncError("SYNC_INVALID");
    try {
      const rows=await this.db.unsafe(
        `SELECT id,change_id,installation_id,kind,op,payload,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM forge614_sync.changes WHERE id>$1 ORDER BY id LIMIT $2`,[since,limit]);
      return rows.map((r:any):ChangeRow=>({id:Number(r.id),changeId:r.change_id,installationId:r.installation_id,kind:r.kind,
        op:r.op,payload:typeof r.payload==="string"?JSON.parse(r.payload):r.payload,createdAt:r.created_at}));
    } catch(error) { return safe(error); }
  }
  async close():Promise<void> {await this.db.close();}
}
