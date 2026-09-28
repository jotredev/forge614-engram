/** Comprueba `forge614 sync-watch` como proceso real: reporta el reintento sin conexión, no bloquea guardados locales, corre el ciclo nuevo con la nube prendida y sale limpio con SIGINT. */
import { afterAll, afterEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../infrastructure/__test-support__/postgres";
import { runCloudOn } from "../../app";
import { procSnapshot } from "../../../tests/fixtures/proc-snapshot";

// Solo un servidor de prueba (fixture) desechable y en loopback (127.0.0.1), explícito: nunca se usa una base ambiente ya existente.
const cluster = startPostgresCluster();
const integration = cluster.available ? test : test.skip;
let admin!: SQL;
// Se captura aparte (fuera del `if`) porque TypeScript no reduce (narrow) el tipo de `cluster` dentro del cuerpo de una prueba `integration(...)`, que ya no ve la comprobación de `cluster.available`.
const clusterUrl = cluster.available ? cluster.url : "";
if (cluster.available) admin = new SQL(cluster.url);
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async () => {
  if (!cluster.available) return;
  try { await admin.close(); } finally { stopPostgresCluster(cluster); }
}, postgresTestTimeoutMs);

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../../cli.ts");
// Ver src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync tiene un error de bloqueo confirmado
// y sin corregir en Bun (oven-sh/bun#34069), por eso aquí se usa el Bun.spawn asíncrono en su lugar.
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
// Con PostgreSQL configurado pero inalcanzable, sync-watch reporta POSTGRES_UNAVAILABLE sin filtrar la credencial, deja seguir guardando en local y sale con 130 al recibir SIGINT.
test("sync-watch reports offline retry state and exits on SIGINT without blocking local writes",async()=>{
  const dir=workspace();const id=(await create(dir));
  const config=new WorkspaceConfig(join(dir,"user",".forge614","engram"));
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const child=Bun.spawn([process.execPath,cli,"sync-watch","--interval","1"],{
    cwd:dir,env:{...process.env,FORGE614_HOME:join(dir,"user",".forge614")},stdout:"pipe",stderr:"pipe",
  });
  try {
    const reader=child.stderr.getReader();const first=await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("POSTGRES_UNAVAILABLE");
    expect(new TextDecoder().decode(first.value)).not.toContain("SECRET");
    expect((await run(dir,"save","--project-id",id,"--title","Offline","--content","Still local")).code).toBe(0);
    child.kill("SIGINT");expect(await child.exited).toBe(130);reader.releaseLock();
  } finally {child.kill();await child.exited;}
},30000);

// Con la nube ya prendida (cloud on), sync-watch corre el ciclo nuevo (no el snapshot de formatos 1-3) y avisa la obsolescencia en stderr, después del primer resultado (D10).
integration("sync-watch runs the new cloud cycle and reports its own obsolescence in stderr",async()=>{
  const dir=workspace();
  const userHome=join(dir,"user",".forge614");
  await admin.unsafe("DROP DATABASE IF EXISTS sync_watch_cloud");await admin.unsafe("CREATE DATABASE sync_watch_cloud");
  const url=clusterUrl.replace(/\/postgres(\?|$)/,"/sync_watch_cloud$1");
  const previousHome=process.env.FORGE614_HOME;process.env.FORGE614_HOME=userHome;
  try {const {MemoryWorkspace}=await import("../../app");new MemoryWorkspace().init();await runCloudOn(url);}
  finally {if(previousHome===undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME=previousHome;}
  const child=Bun.spawn([process.execPath,cli,"sync-watch","--interval","1"],{
    cwd:dir,env:{...process.env,FORGE614_HOME:userHome},stdout:"pipe",stderr:"pipe",
  });
  try {
    const stdoutReader=child.stdout.getReader();
    const firstCycle=await stdoutReader.read();
    expect(JSON.parse(new TextDecoder().decode(firstCycle.value))).toMatchObject({uploaded:expect.any(Number),downloaded:expect.any(Number)});
    const stderrReader=child.stderr.getReader();
    const notice=await stderrReader.read();
    expect(JSON.parse(new TextDecoder().decode(notice.value))).toEqual({code:"SYNC_WATCH_DEPRECATED",error:"sync-watch es obsoleto; se retira el 2027-03-31."});
    child.kill("SIGINT");expect(await child.exited).toBe(130);
    stdoutReader.releaseLock();stderrReader.releaseLock();
  } finally {child.kill();await child.exited;}
},postgresTestTimeoutMs);
