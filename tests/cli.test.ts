import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../src/cli.ts");
const preload = resolve(import.meta.dir,"fixtures/user-directory.ts");
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

test("help, version and empty project list create no storage", () => {
  const dir = workspace();
  for (const args of [["help"],["--version"],["project-list"]]) {
    const result = run(dir,...args); expect(result.code).toBe(0);
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
  expect(run(dir,"help").stdout).toContain("--scope");
  expect(run(dir,"--version").stdout).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  expect(JSON.parse(run(dir,"project-list").stdout)).toEqual([]);
});

test("setup requires a terminal and leaves automation commands noninteractive", () => {
  const dir = workspace();
  const result = run(dir, "setup");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("INTERACTIVE_REQUIRED");
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
  expect(run(dir, "init").code).toBe(0);
  expect(JSON.parse(run(dir, "project-list").stdout)).toEqual([]);
  expect(run(dir, "search", "--scope", "shared", "--query", "anything").code).toBe(0);
});

test("setup rejects unknown flags without entering prompts or creating files", () => {
  const dir = workspace();
  const result = run(dir, "setup", "--db", "PRIVATE_VALUE");
  expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
  expect(result.stderr).not.toContain("PRIVATE_VALUE");
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
});

test("all projects and working directories share exactly one workspace configuration", () => {
  const a = workspace(); const b = workspace(); const id = create(a);
  create(a,"Another"); const user = join(a,"user");
  const saved = run(a,"save","--project-id",id,"--title","Global storage","--content","Persistent SQLite");
  expect(saved.code).toBe(0);
  const result = runAs(b,user,"search","--project-id",id,"--query","SQLite");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)[0].memory.id).toBe(JSON.parse(saved.stdout).id);
  expect(JSON.parse(runAs(b,user,"project-list").stdout)).toHaveLength(2);
  expect(existsSync(join(a,".forge614"))).toBe(false);
  expect(existsSync(join(b,".forge614"))).toBe(false);
  expect(readdirSync(join(user,".forge614")).filter(n=>!n.endsWith("-wal")&&!n.endsWith("-shm")).sort()).toEqual([".env","engram.db"]);
  expect(readFileSync(join(user,".forge614",".env"),"utf8")).not.toContain(id);
});

test("SDK workspace and CLI share the same identity and database", () => {
  const dir = workspace(); const index = resolve(import.meta.dir,"../src/index.ts");
  const code = `import { MemoryWorkspace } from ${JSON.stringify(index)};
    const workspace = new MemoryWorkspace();
    const p = workspace.createProject("SDK");
    const store = workspace.open();
    try { store.save({projectId:p.projectId,title:'SDK',content:'SQLite shared',type:'fact'}); }
    finally { store.close(); }
    console.log(p.projectId);`;
  const result = Bun.spawnSync([process.execPath,"--preload",preload,"-e",code],{
    cwd:dir,env:{...process.env,FORGE614_TEST_USER_DIRECTORY:join(dir,"user")},
  });
  expect(result.exitCode).toBe(0);
  const id = result.stdout.toString().trim();
  expect(JSON.parse(run(dir,"search","--project-id",id,"--query","SQLite").stdout)).toHaveLength(1);
});

test("project CLI saves, revises, searches, archives and restores with UUID identity", () => {
  const dir = workspace(); const id = create(dir);
  const first = run(dir,"save","--project-id",id,"--title","Base","--content","SQLite","--topic","db","--request-key","first");
  expect(first.code).toBe(0); const saved = JSON.parse(first.stdout);
  const update = run(dir,"save","--project-id",id,"--title","Base","--content","PostgreSQL","--topic","db","--expected-version","1");
  expect(update.code).toBe(0); expect(JSON.parse(update.stdout).version).toBe(2);
  expect(JSON.parse(run(dir,"history","--project-id",id,"--id",saved.id).stdout)).toHaveLength(2);
  expect(JSON.parse(run(dir,"search","--project-id",id,"--query","PostgreSQL").stdout)[0].memory.id).toBe(saved.id);
  expect(run(dir,"archive","--project-id",id,"--id",saved.id).code).toBe(0);
  expect(JSON.parse(run(dir,"search","--project-id",id,"--query","PostgreSQL").stdout)).toEqual([]);
  expect(run(dir,"restore","--project-id",id,"--id",saved.id).code).toBe(0);
  expect(JSON.parse(run(dir,"get","--project-id",id,"--id",saved.id).stdout).state).toBe("active");
});

test("init is repeatable and rename retains identity without per-project registration", () => {
  const dir = workspace(); const id = create(dir); const root = join(dir,"user",".forge614");
  const before = readFileSync(join(root,"engram.db")); const config = readFileSync(join(root,".env"));
  expect(run(dir,"init").code).toBe(0);
  expect(readFileSync(join(root,"engram.db"))).toEqual(before);
  expect(readFileSync(join(root,".env"))).toEqual(config);
  expect(run(dir,"project-rename","--project-id",id,"--name","Renamed").code).toBe(0);
  const listed = JSON.parse(run(dir,"project-list").stdout);
  expect(listed[0].name).toBe("Renamed"); expect(listed[0].projectId).toBe(id);
  expect(run(dir,"project-list").stdout).not.toContain(root);
});

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

test("two identical project names stay isolated from each other", () => {
  const dir = workspace(); const a = create(dir,"Same"); const b = create(dir,"Same");
  expect(a).not.toBe(b);
  expect(run(dir,"save","--project-id",a,"--title","SQLite","--content","One").code).toBe(0);
  expect(JSON.parse(run(dir,"search","--project-id",b,"--query","SQLite").stdout)).toEqual([]);
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
    ["search","--project-id","../escape","--query","abc"],
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

test("missing configuration and configured missing database never cause silent reinitialization", () => {
  const dir = workspace();
  expect(JSON.parse(run(dir,"search","--scope","shared","--query","SQLite").stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  const id = create(dir);
  expect(JSON.parse(run(dir,"get","--project-id",id,"--id","missing").stderr).code).toBe("NOT_FOUND");
  const path = join(dir,"user",".forge614","engram.db"); rmSync(path);
  for (const args of [["init"],["project-create","--name","No"],["search","--scope","shared","--query","SQLite"]]) {
    expect(run(dir,...args).code).toBe(1); expect(existsSync(path)).toBe(false);
  }
});

async function parallel(dir: string, args: string[]) {
  return Promise.all(Array.from({length:4},async () => {
    const child = Bun.spawn([process.execPath,"--preload",preload,cli,...args], {
      cwd:dir,env:{...process.env,FORGE614_TEST_USER_DIRECTORY:join(dir,"user")},stdout:"pipe",stderr:"pipe",
    });
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,stdout,stderr};
  }));
}
test("concurrent project and shared request replays create one memory per namespace", async () => {
  const dir = workspace(); const id = create(dir);
  for (const target of [["--project-id",id],["--scope","shared"]]) {
    const results = await parallel(dir,["save",...target,"--title","parallel","--content","One operation","--request-key","same-request"]);
    for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
    expect(new Set(results.map(result => JSON.parse(result.stdout).id)).size).toBe(1);
  }
  expect(JSON.parse(run(dir,"search","--project-id",id,"--query","parallel").stdout)).toHaveLength(2);
});

test("concurrent initializers keep a single config and preserve all projects", async () => {
  const dir = workspace(); const results = await parallel(dir,["project-create","--name","parallel"]);
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(new Set(results.map(result => JSON.parse(result.stdout).projectId)).size).toBe(4);
  expect(JSON.parse(run(dir,"project-list").stdout)).toHaveLength(4);
  expect(existsSync(join(dir,"user",".forge614","projects"))).toBe(false);
});

test("concurrent init of existing workspace leaves existing memories and configuration intact", async () => {
  const dir = workspace(); const id = create(dir);
  expect(run(dir,"save","--project-id",id,"--title","Keep","--content","SQLite").code).toBe(0);
  const path = join(dir,"user",".forge614",".env"); const before = readFileSync(path);
  const results = await parallel(dir,["init"]);
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(readFileSync(path)).toEqual(before);
  expect(JSON.parse(run(dir,"search","--project-id",id,"--query","SQLite").stdout)).toHaveLength(1);
});
