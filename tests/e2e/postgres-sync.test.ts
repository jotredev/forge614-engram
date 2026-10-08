/**
 * Prueba de extremo a extremo contra un PostgreSQL real (se salta si no hay uno disponible): la
 * CLI configurada sigue funcionando sin conexión y en local, y una sincronización que falla deja
 * intactos los datos SQLite que ya tenía cada usuario, sin filtrar la URL de conexión (que puede
 * llevar contraseña) en la salida ni en los errores.
 */
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { runSetup } from "../../src/app/setup";
import { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "../../src/app/workspace";
import { syncWorkspace } from "../../src/app/synchronization";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../src/infrastructure/__test-support__/postgres";

console.log("[diag] postgres-sync.test.ts: iniciando arranque de clúster...");
const cluster=startPostgresCluster();
console.log(`[diag] postgres-sync.test.ts: clúster inicializado (available=${cluster.available}).`);
const integration=cluster.available?test:test.skip;
let directory="",url="",admin!:SQL;
let adminClosed=false;
if(cluster.available) { directory=cluster.directory;url=cluster.url;admin=new SQL(url); }
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async()=>{
  if(!cluster.available) return;
  console.log("[diag] postgres-sync.test.ts: afterAll: cerrando admin...");
  try {
    if (!adminClosed) await admin.close();
    console.log("[diag] postgres-sync.test.ts: afterAll: admin cerrado.");
  }
  finally {
    console.log("[diag] postgres-sync.test.ts: afterAll: deteniendo clúster...");
    stopPostgresCluster(cluster);
    console.log("[diag] postgres-sync.test.ts: afterAll: clúster detenido.");
  }
},postgresTestTimeoutMs);


integration("configured CLI stays local offline and sync failure preserves the same SQLite data",async()=>{
  // Base de datos nueva, nunca un servicio real de usuario. Otras pruebas ya corrompieron a
  // propósito el esquema de la base «postgres» por defecto.
  console.log("[diag] postgres-sync.test.ts: paso 1/8: iniciando CREATE DATABASE setup_test...");
  await admin.unsafe("CREATE DATABASE setup_test");
  console.log("[diag] postgres-sync.test.ts: paso 1/8: CREATE DATABASE setup_test completado.");

  const testUrl=url.replace("/postgres?","/setup_test?");
  const user=join(directory,"cli-user");const config=new WorkspaceConfig(join(user,".forge614","engram"));
  const answers=["si",testUrl,"si"];const output:string[]=[];

  console.log("[diag] postgres-sync.test.ts: paso 2/8: ejecutando primer runSetup...");
  await runSetup({write:t=>output.push(t),ask:async()=>answers.shift()??null},config);
  console.log("[diag] postgres-sync.test.ts: paso 2/8: primer runSetup completado.");

  expect(config.read().postgresUrl).toBe(testUrl);
  const workspace=new MemoryWorkspace(config);expect(workspace.listProjects()).toEqual([]);
  const p=workspace.createProject("CLI");
  const store=workspace.open();let id:string;
  try {id=store.save({projectId:p.projectId,title:"offline",content:"persistent",type:"fact"}).id;}
  finally {store.close();}

  console.log("[diag] postgres-sync.test.ts: paso 3/8: ejecutando syncWorkspace primer usuario (upgradeFormat: true)...");
  await syncWorkspace(config,{upgradeFormat:true});
  console.log("[diag] postgres-sync.test.ts: paso 3/8: syncWorkspace primer usuario completado.");

  const other=new WorkspaceConfig(join(directory,"other-user",".forge614","engram"));
  const second=["si",testUrl,"si"];

  console.log("[diag] postgres-sync.test.ts: paso 4/8: ejecutando segundo runSetup...");
  await runSetup({write(){},ask:async()=>second.shift()??null},other);
  console.log("[diag] postgres-sync.test.ts: paso 4/8: segundo runSetup completado.");

  console.log("[diag] postgres-sync.test.ts: paso 5/8: ejecutando syncWorkspace segundo usuario...");
  await syncWorkspace(other);
  console.log("[diag] postgres-sync.test.ts: paso 5/8: syncWorkspace segundo usuario completado.");

  const received=new MemoryWorkspace(other).open(true);
  try {expect(received.get(p.projectId,id)!.content).toBe("persistent");} finally {received.close();}

  console.log("[diag] postgres-sync.test.ts: paso 6/8: configurando postgres inalcanzable y verificando fallo de sync...");
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const before=readFileSync(config.databasePath);
  await expect(syncWorkspace(config)).rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
  expect(readFileSync(config.databasePath)).toEqual(before);
  console.log("[diag] postgres-sync.test.ts: paso 6/8: fallo de sync verificado correctamente.");

  // La conexión administrativa solo crea la base; los comandos CLI corren sin ella abierta.
  console.log("[diag] postgres-sync.test.ts: cerrando admin antes de lanzar CLI...");
  await admin.close();
  adminClosed=true;
  console.log("[diag] postgres-sync.test.ts: admin cerrado antes de lanzar CLI.");

  const cli=resolve(import.meta.dir,"../../src/cli.ts");
  const helper=resolve(import.meta.dir,"../../scripts/fixtures/postgres-sync-cli.mjs");
  const resultPath=join(directory,"cli-results.json");
  console.log("[diag] postgres-sync.test.ts: ejecutando secuencia CLI en ayudante Node...");
  const child=Bun.spawn(["node",helper,process.execPath,cli,join(user,".forge614"),p.projectId,resultPath],{
    stdout:"ignore",stderr:"inherit",
  });
  child.unref();
  type CliOutput={exitCode:number;stdout:string;stderr:string};
  type CliResults={search:CliOutput;save:CliOutput;sync:CliOutput}|{error:string};
  let results:CliResults|undefined;
  const deadline=Date.now()+75_000;
  while(Date.now()<deadline) {
    if(existsSync(resultPath)) {
      try {
        results=JSON.parse(readFileSync(resultPath,"utf8")) as CliResults;
        break;
      } catch { /* El ayudante puede estar terminando de escribir el JSON. */ }
    }
    await Bun.sleep(50);
  }
  if(!results) {
    console.error(`[diag] postgres-sync.test.ts: ayudante CLI (PID ${child.pid}) excedió 75s, ejecutando kill...`);
    if (process.platform === "win32") {
      try { spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", timeout: 5_000 }); } catch {}
    }
    try { child.kill("SIGKILL"); } catch {}
    throw new Error("El ayudante CLI no publicó un resultado en 75s.");
  }
  if("error" in results) throw new Error(results.error);

  console.log("[diag] postgres-sync.test.ts: paso 7/8: validando CLI 1/3 (search)...");
  expect(results.search.exitCode).toBe(0);expect(JSON.parse(results.search.stdout)).toHaveLength(1);
  console.log("[diag] postgres-sync.test.ts: paso 7/8: CLI 1/3 (search) validado.");

  console.log("[diag] postgres-sync.test.ts: paso 8/8a: validando CLI 2/3 (save)...");
  expect(results.save.exitCode).toBe(0);
  console.log("[diag] postgres-sync.test.ts: paso 8/8a: CLI 2/3 (save) validado.");

  console.log("[diag] postgres-sync.test.ts: paso 8/8b: validando CLI 3/3 (sync)...");
  expect(results.sync.exitCode).toBe(1);expect(results.sync.stderr).not.toContain("SECRET");
  console.log("[diag] postgres-sync.test.ts: paso 8/8b: CLI 3/3 (sync) validado.");

  expect(output.join("\n")).not.toContain(testUrl);
  console.log("[diag] postgres-sync.test.ts: prueba finalizada exitosamente.");
},90_000);
