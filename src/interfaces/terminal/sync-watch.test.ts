import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../../cli.ts");
// See src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync has a confirmed,
// unfixed upstream hang bug (oven-sh/bun#34069), so this uses async Bun.spawn instead.
async function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath,cli,...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614") }, stdout:"pipe", stderr:"pipe",
  });
  let killedByWatchdog = false;
  const timer = setTimeout(() => { killedByWatchdog = true; child.kill(); }, 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if (killedByWatchdog) {
      let completeJson = false;
      try { JSON.parse(stdout); completeJson = true; } catch {}
      console.error(JSON.stringify({
        diag: "watchdog-killed", args, code,
        stdoutBytes: stdout.length, stderrBytes: stderr.length, completeJson,
        stdoutTail: stdout.slice(-300), stderrTail: stderr.slice(-300),
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
