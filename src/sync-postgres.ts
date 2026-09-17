import { SQL } from "bun";
import { MemoryError } from "./domain";
import { canonical, emptySnapshot, snapshotHash, syncError, validateSnapshot, type SyncSnapshot } from "./sync-snapshot";

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

const DDL=`CREATE SCHEMA forge614_sync;
CREATE TABLE forge614_sync.revisions (
 hash text PRIMARY KEY CHECK (length(hash) = 64), payload text NOT NULL
);
CREATE TABLE forge614_sync.state (
 id integer PRIMARY KEY CHECK (id = 1), format integer NOT NULL CHECK (format = 1),
 replica uuid NOT NULL, head text NOT NULL REFERENCES forge614_sync.revisions(hash)
);`;
type Head={hash:string;snapshot:SyncSnapshot};
async function validate(db:SQL|Bun.TransactionSQL):Promise<void> {
  const columns=await db.unsafe(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='forge614_sync' AND c.relkind='r'
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  const expected=[
    ["revisions","hash","text",true],["revisions","payload","text",true],
    ["state","id","integer",true],["state","format","integer",true],["state","replica","uuid",true],["state","head","text",true],
  ];
  if(canonical(columns.map((r:any)=>[r.relname,r.attname,r.type,r.attnotnull]))!==canonical(expected)) syncError("POSTGRES_SCHEMA");
  const constraints=await db.unsafe(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
    WHERE connamespace='forge614_sync'::regnamespace ORDER BY conname`);
  const wanted=[
    ["revisions_hash_check","CHECK ((length(hash) = 64))"],["revisions_pkey","PRIMARY KEY (hash)"],
    ["state_format_check","CHECK ((format = 1))"],["state_head_fkey","FOREIGN KEY (head) REFERENCES forge614_sync.revisions(hash)"],
    ["state_id_check","CHECK ((id = 1))"],["state_pkey","PRIMARY KEY (id)"],
  ];
  if(canonical(constraints.map((r:any)=>[r.conname,r.definition]))!==canonical(wanted)) syncError("POSTGRES_SCHEMA");
  const objects=await db.unsafe(`SELECT relname,relkind,relrowsecurity FROM pg_catalog.pg_class WHERE relnamespace='forge614_sync'::regnamespace ORDER BY relname`);
  if(canonical(objects.map((r:any)=>[r.relname,r.relkind,r.relrowsecurity]))!==canonical([
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
  async close():Promise<void> {await this.db.close();}
}
