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
const preload = resolve(import.meta.dir,"../../../tests/fixtures/user-directory.ts");
function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath,"--preload",preload,cli,...args], {
    cwd, env: { ...process.env, FORGE614_TEST_USER_DIRECTORY: userDirectory },
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function run(cwd: string, ...args: string[]) { return runAs(cwd,join(cwd,"user"),...args); }
function create(dir: string, name = "demo"): string {
  const result = run(dir,"project-create","--name",name);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout).projectId;
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });
test("sync-watch reports offline retry state and exits on SIGINT without blocking local writes",async()=>{
  const dir=workspace();const id=create(dir);
  const config=new WorkspaceConfig(join(dir,"user",".forge614"));
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const child=Bun.spawn([process.execPath,"--preload",preload,cli,"sync-watch","--interval","1"],{
    cwd:dir,env:{...process.env,FORGE614_TEST_USER_DIRECTORY:join(dir,"user")},stdout:"pipe",stderr:"pipe",
  });
  try {
    const reader=child.stderr.getReader();const first=await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("POSTGRES_UNAVAILABLE");
    expect(new TextDecoder().decode(first.value)).not.toContain("SECRET");
    expect(run(dir,"save","--project-id",id,"--title","Offline","--content","Still local").code).toBe(0);
    child.kill("SIGINT");expect(await child.exited).toBe(130);reader.releaseLock();
  } finally {child.kill();await child.exited;}
},10000);
