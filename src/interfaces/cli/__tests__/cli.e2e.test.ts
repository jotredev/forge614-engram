/** Prueba de punta a punta del CLI como proceso real: comandos retirados, init, protocolo de memoria, sincronización, nube (cloud on/off/status), identidad, sesiones y concurrencia. */
import { afterAll, afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../../infrastructure/filesystem/workspace-config";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../../infrastructure/__test-support__/postgres";
import { procSnapshot } from "../../../../tests/fixtures/proc-snapshot";

// Solo un servidor de prueba (fixture) desechable y en loopback (127.0.0.1), explícito: nunca se usa una base ambiente ya existente.
const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
let admin!: SQL;
// Se captura aparte (fuera del `if`) porque TypeScript no reduce (narrow) el tipo de `cluster` dentro de una función declarada más abajo, como `freshDatabase`.
const clusterUrl = cluster.available ? cluster.url : "";
if (cluster.available) admin = new SQL(cluster.url);
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async () => {
  if (!cluster.available) return;
  try { await admin.close(); } finally { stopPostgresCluster(cluster); }
}, postgresTestTimeoutMs);
/** Crea una base de PostgreSQL nueva y desechable, y da su URL de conexión. */
async function freshDatabase(name: string): Promise<string> {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`); await admin.unsafe(`CREATE DATABASE ${name}`);
  return clusterUrl.replace(/\/postgres(\?|$)/, `/${name}$1`);
}
/** Corre un comando del CLI con una entrada estándar (`stdin`) dada, para probar `cloud on` sin `--postgres-url` (D13). */
async function runWithStdin(cwd: string, stdin: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(cwd, "user", ".forge614") }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  child.stdin.write(stdin); await child.stdin.end();
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}
/** Cuenta las filas de `cloud_outbox` en la base SQLite de una carpeta de espacio de trabajo. */
function pendingOutboxCount(userDirectory: string): number {
  const db = new Database(join(userDirectory, ".forge614", "engram", "engram.db"), { readonly: true });
  try { return (db.query("SELECT COUNT(*) AS n FROM cloud_outbox").get() as { n: number }).n; }
  finally { db.close(); }
}

// Los bytes crudos de un archivo SQLite no son una comprobación de idempotencia segura: una compilación de
// SQLite más nueva dentro de Bun puede tocar campos de la cabecera (contador de cambios, contabilidad del
// checkpoint de WAL) en una apertura que en realidad no hizo nada, sin cambiar ningún dato real. En su lugar
// se compara el contenido lógico: el esquema más cada fila de cada tabla, en un orden determinista.
function logicalDump(path: string): unknown {
  const db = new Database(path, { readonly: true });
  try {
    const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]);
    const rows: Record<string, unknown[]> = {};
    for (const { name } of tables) {
      const columns = (db.query(`PRAGMA table_info(${JSON.stringify(name)})`).all() as { name: string }[]).map(c => c.name);
      const orderBy = columns.map(c => `"${c}"`).join(",");
      rows[name] = db.query(`SELECT * FROM ${JSON.stringify(name)} ORDER BY ${orderBy}`).all();
    }
    return { schema, rows };
  } finally { db.close(); }
}

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../../../cli.ts");
// Bun.spawnSync tiene un error confirmado y sin corregir en el proyecto (oven-sh/bun#34069, el PR
// #40078 sigue abierto) donde el bucle aislado de espera síncrona puede perder el aviso de salida
// de un hijo bajo alto volumen de procesos junto a sqlite, bloqueándose hasta que un tiempo límite
// externo lo mata. El camino asíncrono de Bun.spawn no usa ese bucle aislado, por eso todos los
// lanzadores de este archivo lo esperan (await) en su lugar.
async function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath,cli,...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614") }, stdout:"pipe", stderr:"pipe",
  });
  let killedByWatchdog = false;
  let procSnapshotResult: Record<string, unknown> | undefined;
  const timer = setTimeout(() => { killedByWatchdog = true; procSnapshotResult = procSnapshot(child.pid); child.kill(); }, 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if (killedByWatchdog) {
      let completeJson = false;
      try { JSON.parse(stdout); completeJson = true; } catch {}
      console.error(JSON.stringify({
        diag: "watchdog-killed", args, code,
        stdoutBytes: stdout.length, stderrBytes: stderr.length, completeJson,
        stdoutTail: stdout.slice(-300), stderrTail: stderr.slice(-300),
        procSnapshot: procSnapshotResult,
      }));
    }
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
async function run(cwd: string, ...args: string[]) { return (await runAs(cwd,join(cwd,"user"),...args)); }
async function create(dir: string, name = "demo"): Promise<string> {
  const result = await run(dir,"project-create","--name",name);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout).projectId;
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });

// El comando "setup" (retirado) falla y su mensaje señala a init como reemplazo, sin crear ningún archivo.
test("retired setup tells the user to use init and leaves storage absent", async () => {
  const dir = workspace();
  const result = (await run(dir, "setup"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({
    code: "COMMAND_RETIRED",
    error: expect.stringContaining("forge614-engram init"),
  });
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

// init sin --json exige una terminal interactiva real y falla sin una; init --json nunca pregunta nada.
test("init requires a terminal while init --json stays noninteractive", async () => {
  const dir = workspace();
  const interactive = (await run(dir, "init"));
  expect(interactive.code).toBe(1);
  expect(JSON.parse(interactive.stderr)).toMatchObject({
    code: "INTERACTIVE_REQUIRED",
    error: expect.stringContaining("init necesita una terminal interactiva"),
  });
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
  expect((await run(dir, "init", "--json")).code).toBe(0);
  expect(JSON.parse((await run(dir, "project-list")).stdout)).toEqual([]);
  expect((await run(dir, "search", "--scope", "shared", "--query", "anything")).code).toBe(0);
}, 40000);

// Una bandera desconocida en init falla antes de entrar en modo interactivo o crear ningún archivo, y no repite su valor en el error.
test("init rejects unknown flags without entering prompts or creating files", async () => {
  const dir = workspace();
  const result = (await run(dir, "init", "--db", "PRIVATE_VALUE"));
  expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
  expect(result.stderr).not.toContain("PRIVATE_VALUE");
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

// La ayuda deja claro que startup-context acepta cualquier carpeta legible y no exige Git, a diferencia de la vinculación de proyecto.
test("help distinguishes read-only startup-context from project binding", async () => {
  const dir = workspace();
  const result = (await run(dir, "help"));
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Acepta cualquier carpeta existente y legible");
  expect(result.stdout).toContain("startup-context no");
  expect(result.stdout).not.toContain("requiere Git disponible, incluso para carpetas sin Git");
}, 40000);

// memory-protocol exige --json, no acepta banderas fuera de --protocol-version, cada versión (1, 2, 4) tiene su propia forma, y ninguna llamada crea archivos.
test("memory-protocol is public, JSON-only, and creates no product files", async () => {
  const dir = workspace();
  const result = (await run(dir, "memory-protocol", "--json"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    id: "forge614-engram-memory",
    version: 1,
  });
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const missingJson = (await run(dir, "memory-protocol"));
  expect(missingJson.code).toBe(1);
  expect(JSON.parse(missingJson.stderr).code).toBe("INVALID_INPUT");
  expect(missingJson.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const unknownFlag = (await run(dir, "memory-protocol", "--json", "--format", "text"));
  expect(unknownFlag.code).toBe(1);
  expect(JSON.parse(unknownFlag.stderr).code).toBe("INVALID_INPUT");
  expect(unknownFlag.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const v2 = (await run(dir, "memory-protocol", "--json", "--protocol-version", "2"));
  expect(v2.code).toBe(0);
  expect(JSON.parse(v2.stdout)).toMatchObject({ id: "forge614-engram-memory", version: 2 });
  expect(JSON.parse(v2.stdout).startupContext.command).toContain("startup-context");

  const v4 = (await run(dir, "memory-protocol", "--json", "--protocol-version", "4"));
  expect(v4.code).toBe(0);
  expect(JSON.parse(v4.stdout)).toMatchObject({ id: "forge614-engram-memory", version: 4, startupContext: { format: 2 } });

  const invalidVersion = (await run(dir, "memory-protocol", "--json", "--protocol-version", "5"));
  expect(invalidVersion.code).toBe(1);
  expect(JSON.parse(invalidVersion.stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

// Sin base creada, sync falla con CONFIG_NOT_FOUND; ya con init pero sin PostgreSQL configurado, falla con SYNC_DISABLED; sync-watch con un intervalo de 0 falla por inválido.
test("sync without PostgreSQL configuration never creates storage", async () =>{
  const dir=workspace();const result=(await run(dir,"sync"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  expect((await run(dir,"init","--json")).code).toBe(0);
  expect(JSON.parse((await run(dir,"sync")).stderr).code).toBe("SYNC_DISABLED");
  expect(JSON.parse((await run(dir,"sync-watch","--interval","0")).stderr).code).toBe("INVALID_INPUT");
}, 40000);

// Todas las carpetas de trabajo comparten una única base y un único .env, sin importar desde qué directorio de proyecto se ejecute el CLI; el .env nunca contiene el UUID de un proyecto.
test("all projects and working directories share exactly one workspace configuration", async () => {
  const a = workspace(); const b = workspace(); const id = (await create(a));
  (await create(a,"Another")); const user = join(a,"user");
  const saved = (await run(a,"save","--project-id",id,"--title","Global storage","--content","Persistent SQLite"));
  expect(saved.code).toBe(0);
  const result = (await runAs(b,user,"search","--project-id",id,"--query","SQLite"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)[0].memory.id).toBe(JSON.parse(saved.stdout).id);
  expect(JSON.parse((await runAs(b,user,"project-list")).stdout)).toHaveLength(2);
  expect(existsSync(join(a,".forge614"))).toBe(false);
  expect(existsSync(join(b,".forge614"))).toBe(false);
  expect(readdirSync(join(user,".forge614")).sort()).toEqual(["engram"]);
  expect(readdirSync(join(user,".forge614","engram")).filter(n=>!n.endsWith("-wal")&&!n.endsWith("-shm")).sort()).toEqual([".env","engram.db"]);
  expect(readFileSync(join(user,".forge614","engram",".env"),"utf8")).not.toContain(id);
}, 45_000);

// Un proyecto creado desde el SDK (importando MemoryWorkspace directamente) es visible desde el CLI: comparten la misma base y la misma identidad de proyecto.
test("SDK workspace and CLI share the same identity and database", async () => {
  const dir = workspace(); const index = resolve(import.meta.dir,"../../../index.ts");
  const code = `import { MemoryWorkspace } from ${JSON.stringify(index)};
    const workspace = new MemoryWorkspace();
    const p = workspace.createProject("SDK");
    const store = workspace.open();
    try { store.save({projectId:p.projectId,title:'SDK',content:'SQLite shared',type:'fact'}); }
    finally { store.close(); }
    console.log(p.projectId);`;
  const child = Bun.spawn([process.execPath,"-e",code],{
    cwd:dir,env:{...process.env,FORGE614_HOME:join(dir,"user",".forge614")},stdout:"pipe",stderr:"pipe",
  });
  const [exitCode,stdout] = await Promise.all([child.exited,new Response(child.stdout).text()]);
  expect(exitCode).toBe(0);
  const id = stdout.trim();
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","SQLite")).stdout)).toHaveLength(1);
}, 40000);

// Un recuerdo se guarda, se revisa (nueva versión con --expected-version), aparece en la búsqueda, desaparece al archivarlo y vuelve a aparecer al restaurarlo, todo identificado por el UUID del proyecto.
test("project CLI saves, revises, searches, archives and restores with UUID identity", async () => {
  const dir = workspace(); const id = (await create(dir));
  const first = (await run(dir,"save","--project-id",id,"--title","Base","--content","SQLite","--topic","db","--request-key","first"));
  expect(first.code).toBe(0); const saved = JSON.parse(first.stdout);
  const update = (await run(dir,"save","--project-id",id,"--title","Base","--content","PostgreSQL","--topic","db","--expected-version","1"));
  expect(update.code).toBe(0); expect(JSON.parse(update.stdout).version).toBe(2);
  expect(JSON.parse((await run(dir,"history","--project-id",id,"--id",saved.id)).stdout)).toHaveLength(2);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","PostgreSQL")).stdout)[0].memory.id).toBe(saved.id);
  expect((await run(dir,"archive","--project-id",id,"--id",saved.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","PostgreSQL")).stdout)).toEqual([]);
  expect((await run(dir,"restore","--project-id",id,"--id",saved.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"get","--project-id",id,"--id",saved.id)).stdout).state).toBe("active");
}, 40000);

// reinforcement-enable se puede repetir sin error; con el reforzamiento activo, guardar el mismo recuerdo desde otro proyecto (b) no lo confunde con el de a, y repetirlo en a lo refuerza sin subir de versión.
test("explicit reinforcement enrollment is repeatable and exact CLI saves stay owner-scoped without a new version", async () => {
  const dir=workspace();
  for(let attempt=0;attempt<2;attempt++) {
    const enabled=(await run(dir,"reinforcement-enable"));
    expect(enabled.code).toBe(0);
    expect(JSON.parse(enabled.stdout)).toEqual({enabled:true,schema:7});
  }
  const a=(await create(dir,"A")),b=(await create(dir,"B"));
  const base=["--title","Runtime owner","--content","Project-local observation","--type","decision","--topic","runtime-owner"];
  const first=JSON.parse((await run(dir,"save","--project-id",a,...base,"--request-key","a-create")).stdout);
  const foreign=JSON.parse((await run(dir,"save","--project-id",b,...base,"--request-key","b-create")).stdout);
  const repeated=JSON.parse((await run(dir,"save","--project-id",a,...base,"--expected-version","1","--request-key","a-observation")).stdout);
  expect(repeated).toMatchObject({id:first.id,projectId:a,version:1});
  expect(repeated.id).not.toBe(foreign.id);
  expect(JSON.parse((await run(dir,"history","--project-id",a,"--id",first.id)).stdout)).toHaveLength(1);
  const results=JSON.parse((await run(dir,"search","--project-id",a,"--scope","project","--query","observation")).stdout);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({memory:{id:first.id,version:1},explanation:{reinforcement:{duplicateCount:1}}});
}, 40000);

// La segunda llamada a init --json no cambia ni un byte lógico de la base ni el .env; renombrar un proyecto conserva su UUID y no expone la ruta de la base en project-list.
test("init is repeatable and rename retains identity without per-project registration", async () => {
  const dir = workspace(); const id = (await create(dir)); const root = join(dir,"user",".forge614","engram");
  // La primera llamada al comando "init" (a diferencia de project-create) sí actualiza legítimamente
  // el esquema (activa los vínculos de proyecto), así que no es en sí misma un no-op. Solo una
  // *segunda* llamada, con el esquema ya en su versión estable, debe serlo.
  expect((await run(dir,"init","--json")).code).toBe(0);
  const before = logicalDump(join(root,"engram.db")); const config = readFileSync(join(root,".env"));
  expect((await run(dir,"init","--json")).code).toBe(0);
  expect(logicalDump(join(root,"engram.db"))).toEqual(before);
  expect(readFileSync(join(root,".env"))).toEqual(config);
  expect((await run(dir,"project-rename","--project-id",id,"--name","Renamed")).code).toBe(0);
  const listed = JSON.parse((await run(dir,"project-list")).stdout);
  expect(listed[0].name).toBe("Renamed"); expect(listed[0].projectId).toBe(id);
  expect((await run(dir,"project-list")).stdout).not.toContain(root);
}, 40000);

// Dos proyectos con el mismo nombre reciben UUID distintos y sus recuerdos no se mezclan entre sí.
test("two identical project names stay isolated from each other", async () => {
  const dir = workspace(); const a = (await create(dir,"Same")); const b = (await create(dir,"Same"));
  expect(a).not.toBe(b);
  expect((await run(dir,"save","--project-id",a,"--title","SQLite","--content","One")).code).toBe(0);
  expect(JSON.parse((await run(dir,"search","--project-id",b,"--query","SQLite")).stdout)).toEqual([]);
}, 40000);

// Sin configuración, cualquier comando de lectura falla con CONFIG_NOT_FOUND; si la base configurada se borra del disco, ningún comando la vuelve a crear en silencio.
test("missing configuration and configured missing database never cause silent reinitialization", async () => {
  const dir = workspace();
  expect(JSON.parse((await run(dir,"search","--scope","shared","--query","SQLite")).stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  const id = (await create(dir));
  expect(JSON.parse((await run(dir,"get","--project-id",id,"--id","missing")).stderr).code).toBe("NOT_FOUND");
  const path = join(dir,"user",".forge614","engram","engram.db"); rmSync(path);
  for (const args of [["init","--json"],["project-create","--name","No"],["search","--scope","shared","--query","SQLite"]]) {
    expect((await run(dir,...args)).code).toBe(1); expect(existsSync(path)).toBe(false);
  }
}, 40000);

/** Lanza el mismo comando del CLI cuatro veces a la vez, en la misma carpeta, para ejercitar el acceso concurrente a la base. */
async function parallel(dir: string, args: string[]) {
  return Promise.all(Array.from({length:4},async () => {
    const child = Bun.spawn([process.execPath,cli,...args], {
      cwd:dir,env:{...process.env,FORGE614_HOME:join(dir,"user",".forge614")},stdout:"pipe",stderr:"pipe",
    });
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,stdout,stderr};
  }));
}
// Según la revisión de forge614-ai: un fallo de condición de carrera concurrente con solo "Expected: 0,
// Received: 1" no da ningún sobre de error que diagnosticar. Se imprime el stdout+stderr completo de cada
// resultado no exitoso o con stderr antes de comprobar, así un fallo real en CI captura el código de error real.
function assertAllSucceeded(results: {code:number|null;stdout:string;stderr:string}[], label: string): void {
  const bad = results.filter(result => result.code !== 0 || result.stderr !== "");
  if (bad.length > 0) {
    console.error(JSON.stringify({ diag: "concurrent-child-failed", label, results }));
  }
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
}
// Cuatro procesos guardando a la vez con la misma requestKey (en project y en shared) terminan creando un único recuerdo por espacio de nombres (namespace), no cuatro.
test("concurrent project and shared request replays create one memory per namespace", async () => {
  const dir = workspace(); const id = (await create(dir));
  for (const target of [["--project-id",id],["--scope","shared"]]) {
    const results = await parallel(dir,["save",...target,"--title","parallel","--content","One operation","--request-key","same-request"]);
    assertAllSucceeded(results, "save replay");
    expect(new Set(results.map(result => JSON.parse(result.stdout).id)).size).toBe(1);
  }
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","parallel")).stdout)).toHaveLength(2);
}, 40000);

// Cuatro project-create a la vez sobre una carpeta sin inicializar terminan con cuatro proyectos distintos y una sola configuración, sin la vieja carpeta por proyecto ("projects").
test("concurrent initializers keep a single config and preserve all projects", async () => {
  const dir = workspace(); const results = await parallel(dir,["project-create","--name","parallel"]);
  assertAllSucceeded(results, "concurrent project-create");
  expect(new Set(results.map(result => JSON.parse(result.stdout).projectId)).size).toBe(4);
  expect(JSON.parse((await run(dir,"project-list")).stdout)).toHaveLength(4);
  expect(existsSync(join(dir,"user",".forge614","projects"))).toBe(false);
}, 40000);

// Cuatro init --json a la vez sobre un espacio de trabajo ya existente no tocan el .env ni pierden el recuerdo ya guardado.
test("concurrent init of existing workspace leaves existing memories and configuration intact", async () => {
  const dir = workspace(); const id = (await create(dir));
  expect((await run(dir,"save","--project-id",id,"--title","Keep","--content","SQLite")).code).toBe(0);
  const path = join(dir,"user",".forge614","engram",".env"); const before = readFileSync(path);
  const results = await parallel(dir,["init","--json"]);
  assertAllSucceeded(results, "concurrent init");
  expect(readFileSync(path)).toEqual(before);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","SQLite")).stdout)).toHaveLength(1);
}, 40000);

// El ciclo completo de una sesión explícita por CLI (arranque, guardado unido a ella, previsualización sin contenido, lectura por versión, línea de tiempo, contexto y resumen) funciona sin preguntar nada.
test("explicit session CLI lifecycle, previews, version reads, timeline and context stay noninteractive", async () =>{
  const dir=workspace();
  expect((await run(dir,"sessions-enable")).code).toBe(0);
  const started=(await run(dir,"session-start","--directory",dir,"--session-id","chat-one"));
  expect(started.code).toBe(0);const session=JSON.parse(started.stdout);
  const saved=(await run(dir,"save","--project-id",session.projectId,"--title","Decision","--content","Use WAL","--session-id","chat-one"));
  expect(saved.code).toBe(0);const memory=JSON.parse(saved.stdout);
  const preview=JSON.parse((await run(dir,"search","--project-id",session.projectId,"--query","WAL","--preview")).stdout);
  expect(preview[0].memory).not.toHaveProperty("content");
  expect(JSON.parse((await run(dir,"get","--project-id",session.projectId,"--id",memory.id,"--version","1")).stdout)).toMatchObject({memory:{id:memory.id,version:1},currentVersion:1});
  expect(JSON.parse((await run(dir,"timeline","--project-id",session.projectId,"--session-id","chat-one","--id",memory.id,"--version","1","--before","0","--after","0")).stdout)).toMatchObject({sessionId:"chat-one",before:[],after:[]});
  expect(JSON.parse((await run(dir,"context","--project-id",session.projectId,"--compact","--max-bytes","1024")).stdout).format).toBe(1);
  const summary=JSON.stringify({goal:"Ship",instructions:"",discoveries:"WAL",accomplishments:"Done",nextSteps:"None",files:[]});
  expect((await run(dir,"session-summary","--project-id",session.projectId,"--session-id","chat-one","--summary-json",summary,"--request-key","summary-1")).code).toBe(0);
  expect(JSON.parse((await run(dir,"session-end","--project-id",session.projectId,"--session-id","chat-one")).stdout).endedAt).not.toBeNull();
}, 40000);

// Iniciar una segunda sesión justo después de la primera la reporta como paralela (parallel), no como previa (previous), y no la marca de ninguna otra forma; repetir el mismo sessionId no reporta nada de eso.
test("session-start CLI reports a session opened right before as parallel, not previous, and never marks it", async () => {
  const dir=workspace();
  expect((await run(dir,"intelligence-enable")).code).toBe(0);
  const first=(await run(dir,"session-start","--directory",dir,"--session-id","chat-one"));
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).not.toHaveProperty("previous");
  expect(JSON.parse(first.stdout)).not.toHaveProperty("parallel");
  const second=(await run(dir,"session-start","--directory",dir,"--session-id","chat-two"));
  expect(second.code).toBe(0);
  const started=JSON.parse(second.stdout);
  expect(started).not.toHaveProperty("previous");
  expect(started.parallel).toMatchObject([{sessionId:"chat-one"}]);
  expect(started.sessionNotice).toBe("Another session is open now: chat-one.");
  expect(JSON.parse(first.stdout)).not.toHaveProperty("sessionNotice");
  const replay=(await run(dir,"session-start","--directory",dir,"--session-id","chat-two"));
  expect(JSON.parse(replay.stdout)).not.toHaveProperty("parallel");
  expect(JSON.parse(replay.stdout)).not.toHaveProperty("sessionNotice");
}, 40000);

// help lista los tres subcomandos de cloud y marca sync-watch y sync --upgrade-format obsoletos con su fecha exacta de retiro (D9, D10).
test("help lists cloud on/off/status and marks sync-watch and sync --upgrade-format obsolete with their sunset", async () => {
  const dir = workspace();
  const result = await run(dir, "help");
  expect(result.code).toBe(0);
  for (const line of ["cloud on [--postgres-url <URL>]", "cloud off", "cloud status [--json]"]) expect(result.stdout).toContain(line);
  expect(result.stdout).toContain("sync-watch      Obsoleto (sunset 2027-03-31)");
  expect(result.stdout).toContain("Obsoleto: sunset 2027-03-31.");
}, 40000);

// cloud on sin init falla sin escribir nada; con init, prueba la conexión ANTES de escribir el .env y una dirección inalcanzable no deja rastro ni aparece en el error.
test("cloud on requires init first, and an unreachable address leaves nothing behind without echoing it", async () => {
  const dir = workspace();
  const withoutInit = await run(dir, "cloud", "on", "--postgres-url", "postgresql://u@127.0.0.1:1/db?sslmode=disable");
  expect(withoutInit.code).toBe(1);
  expect(JSON.parse(withoutInit.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const envPath = join(dir, "user", ".forge614", "engram", ".env");
  const before = readFileSync(envPath);
  const failed = await run(dir, "cloud", "on", "--postgres-url", "postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable");
  expect(failed.code).toBe(1);
  expect(JSON.parse(failed.stderr).code).toBe("POSTGRES_UNAVAILABLE");
  expect(failed.stderr).not.toContain("SECRET");
  expect(readFileSync(envPath)).toEqual(before);
}, 40000);

// cloud on sin --postgres-url lee la dirección de la entrada estándar sin mostrarla, y nunca la escribe ni en la salida ni en los errores (D13).
integration("cloud on without --postgres-url reads the address from stdin without ever printing it", async () => {
  const dir = workspace();
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("cli_cloud_on_stdin");
  const result = await runWithStdin(dir, url + "\n", "cloud", "on");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ enabled: true });
  expect(result.stdout).not.toContain(url);
  expect(result.stderr).not.toContain(url);
}, postgresTestTimeoutMs);

// cloud on genera installationId una sola vez; correrlo de nuevo con la misma base no lo cambia. cloud off quita POSTGRES_URL conservando el id y la base de nivel 12.
integration("cloud on generates the installation id once, and cloud off keeps it while dropping POSTGRES_URL", async () => {
  const dir = workspace();
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("cli_cloud_on_off");
  const first = JSON.parse((await run(dir, "cloud", "on", "--postgres-url", url)).stdout);
  const second = JSON.parse((await run(dir, "cloud", "on", "--postgres-url", url)).stdout);
  expect(second.installationId).toBe(first.installationId);
  const off = JSON.parse((await run(dir, "cloud", "off")).stdout);
  expect(off).toEqual({ enabled: false });
  const envPath = join(dir, "user", ".forge614", "engram", ".env");
  expect(readFileSync(envPath, "utf8")).not.toContain("POSTGRES_URL");
  expect(readFileSync(envPath, "utf8")).toContain(first.installationId);
}, postgresTestTimeoutMs);

// cloud status --json reporta enabled, installationId, lastAppliedId, pending y oldestPendingAt; Foco de revisión #4: cloud off con pendientes en la cola los sigue mostrando, y cloud on con OTRA base reencola todo (lastAppliedId vuelve a 0).
integration("cloud status reports its full shape and survives cloud off; a different database re-queues everything", async () => {
  const dir = workspace();
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const urlA = await freshDatabase("cli_cloud_status_a");
  const on = JSON.parse((await run(dir, "cloud", "on", "--postgres-url", urlA)).stdout);
  expect((await run(dir, "save", "--scope", "shared", "--title", "Pending", "--content", "Queued")).code).toBe(0);
  // Se simula que esta base ya bajó cambios de A (lastAppliedId > 0), como pasaría tras un sync real: así el reinicio a 0 con otra base (D14) es una afirmación real, no trivial.
  const db = new Database(join(dir, "user", ".forge614", "engram", "engram.db"));
  try { db.query("UPDATE cloud_state SET last_applied_id=7 WHERE id=1").run(); } finally { db.close(); }
  const withPending = JSON.parse((await run(dir, "cloud", "status", "--json")).stdout);
  expect(withPending).toMatchObject({ enabled: true, installationId: on.installationId, lastAppliedId: 7 });
  expect(withPending.pending).toBeGreaterThan(0);
  expect((await run(dir, "cloud", "off")).code).toBe(0);
  const afterOff = JSON.parse((await run(dir, "cloud", "status", "--json")).stdout);
  expect(afterOff).toMatchObject({ enabled: false, pending: withPending.pending, oldestPendingAt: withPending.oldestPendingAt });
  const urlB = await freshDatabase("cli_cloud_status_b");
  expect((await run(dir, "cloud", "on", "--postgres-url", urlB)).code).toBe(0);
  const afterOtherDb = JSON.parse((await run(dir, "cloud", "status", "--json")).stdout);
  expect(afterOtherDb.lastAppliedId).toBe(0);
  expect(afterOtherDb.pending).toBeGreaterThan(0);
}, postgresTestTimeoutMs);

// sync con nube prendida sube lo pendiente (la cola local queda vacía) con el mecanismo nuevo, no el snapshot de formatos 1-3.
integration("sync uploads the pending queue through the new cloud mechanism once cloud on has run", async () => {
  const dir = workspace();
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const url = await freshDatabase("cli_sync_cloud");
  expect((await run(dir, "cloud", "on", "--postgres-url", url)).code).toBe(0);
  expect((await run(dir, "save", "--scope", "shared", "--title", "To upload", "--content", "Queued")).code).toBe(0);
  expect(pendingOutboxCount(join(dir, "user"))).toBeGreaterThan(0);
  const result = await run(dir, "sync");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ uploaded: expect.any(Number), downloaded: expect.any(Number) });
  expect(pendingOutboxCount(join(dir, "user"))).toBe(0);
}, postgresTestTimeoutMs);

// sync --upgrade-format sigue el mecanismo local anterior sin cambiar su código (sin nube configurada, sigue fallando con SYNC_DISABLED como siempre) y avisa su propia obsolescencia en stderr con la fecha exacta de retiro (D10).
test("sync --upgrade-format keeps its old behavior and reports its own obsolescence in stderr", async () => {
  const dir = workspace();
  expect((await run(dir, "init", "--json")).code).toBe(0);
  const result = await run(dir, "sync", "--upgrade-format");
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  const [notice, error] = result.stderr.trim().split("\n").map(line => JSON.parse(line));
  expect(notice).toEqual({ code: "SYNC_UPGRADE_FORMAT_DEPRECATED", error: "sync --upgrade-format es obsoleto; se retira el 2027-03-31." });
  expect(error.code).toBe("SYNC_DISABLED");
}, 40000);
