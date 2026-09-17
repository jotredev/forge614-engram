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
test("CLI shared memories work without a project and require explicit scope for mutations", () => {
  const dir = workspace(); expect(run(dir,"init").code).toBe(0);
  const result = run(dir,"save","--scope","shared","--title","Idioma","--content","Spanish","--type","preference","--topic","language");
  expect(result.code).toBe(0); const shared = JSON.parse(result.stdout);
  expect(shared.projectId).toBeNull(); expect(shared.scope).toBe("shared");
  expect(JSON.parse(run(dir,"project-list").stdout)).toEqual([]);
  const a = create(dir);
  expect(JSON.parse(run(dir,"search","--project-id",a,"--query","Spanish").stdout)[0].memory.id).toBe(shared.id);
  expect(JSON.parse(run(dir,"search","--project-id",a,"--query","Spanish","--scope","project").stdout)).toEqual([]);
  expect(JSON.parse(run(dir,"search","--scope","shared","--query","Spanish").stdout)[0].memory.scope).toBe("shared");
  expect(run(dir,"archive","--project-id",a,"--id",shared.id).code).toBe(1);
  expect(run(dir,"archive","--scope","shared","--id",shared.id).code).toBe(0);
  expect(JSON.parse(run(dir,"search","--scope","shared","--query","Spanish").stdout)).toEqual([]);
  expect(run(dir,"restore","--scope","shared","--id",shared.id).code).toBe(0);
  expect(JSON.parse(run(dir,"history","--scope","shared","--id",shared.id).stdout)).toHaveLength(1);
  expect(JSON.parse(run(dir,"get","--scope","shared","--id",shared.id).stdout).state).toBe("active");
});

test("invalid scope, legacy and per-project connection flags fail before any storage changes", () => {
  const dir = workspace(); const id = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["unknown"], ["save","--project","demo","--title","Title","--content","Text"],
    ["project-create","--name"," "], ["project-create","--name","Demo","--db","SECRET_MARKER"],
    ["project-connect","--project-id",id,"--db","SECRET_MARKER"], ["project-list","--db","SECRET_MARKER"],
    ["save","--id-project",id,"--title","Title","--content","Text"],
    ["save","--project-id",id,"--title","Title"],
    ["save","--project-id",id,"--title","Title","--content","SECRET_MARKER","--type","invalid"],
    ["search","--project-id",id,"--query","abc","--limit","0"],
    ["search","--project-id",id,"--project-id",id,"--query","abc"],
    ["search","--project-id","../../../tests/escape","--query","abc"],
    ["search","--scope","all","--query","abc"], ["search","--query","abc"],
    ["search","--scope","invalid","--project-id",id,"--query","abc"],
    ["save","--scope","all","--project-id",id,"--title","T","--content","C"],
    ["save","--scope","shared","--project-id",id,"--title","T","--content","C"],
    ["get","--scope","shared","--project-id",id,"--id","any"],
    ["get","--scope","all","--project-id",id,"--id","any"],
  ];
  for (const args of cases) {
    const result = run(dir,...args); expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
    expect(result.stderr).not.toContain("SECRET_MARKER"); expect(result.stdout).toBe("");
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
});

test("CLI rejects valued boolean flags, malformed summaries, unknown summary keys and watch promotion",()=>{
  const dir=workspace();
  for(const args of [
    ["search","--scope","shared","--query","x","--preview","true"],
    ["session-summary","--project-id","11111111-1111-4111-8111-111111111111","--session-id","s","--summary-json","{bad","--request-key","r"],
    ["session-summary","--project-id","11111111-1111-4111-8111-111111111111","--session-id","s","--summary-json",JSON.stringify({goal:"x",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[],extra:true}),"--request-key","r"],
    ["sync-watch","--upgrade-format"],
    ["context","--scope","shared","--project-id","11111111-1111-4111-8111-111111111111"],
    ["save","--scope","shared","--title","x","--content","y","--session-id","s"],
  ]) expect(JSON.parse(run(dir,...args).stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
});
