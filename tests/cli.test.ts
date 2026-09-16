import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
function workspace() {
  const directory = mkdtempSync(join(tmpdir(),"forge614-cli-"));
  directories.push(directory);
  return directory;
}
const cli = resolve(import.meta.dir,"../src/cli.ts");
const preload = resolve(import.meta.dir,"fixtures/user-directory.ts");
function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath,"--preload",preload,cli,...args], {
    cwd, env: { ...process.env, FORGE614_TEST_USER_DIRECTORY: userDirectory },
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function run(cwd: string, ...args: string[]) {
  return runAs(cwd,join(cwd,"user"),...args);
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });

test("help describes commands and creates no database", () => {
  const dir = workspace();
  const result = run(dir,"help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("save");
  expect(result.stdout).toContain("search");
  expect(result.stdout).toContain("Uso: forge614-engram");
  expect(existsSync(join(dir,".forge614"))).toBe(false);
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
});

test("version is available without opening storage", () => {
  const dir = workspace();
  const result = run(dir,"--version");
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  expect(existsSync(join(dir,".forge614"))).toBe(false);
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  expect(run(dir,"--version","--project","demo").code).toBe(1);
});

test("different working directories share the user database while projects stay isolated", () => {
  const firstDir = workspace();
  const secondDir = workspace();
  const userDirectory = join(workspace(),"user");
  const saved = runAs(firstDir,userDirectory,"save","--project","demo","--title","Global storage","--content","Persistent SQLite");
  expect(saved.code).toBe(0);
  expect(existsSync(join(userDirectory,".forge614","engram.db"))).toBe(true);
  const found = runAs(secondDir,userDirectory,"search","--project","demo","--query","SQLite");
  expect(found.code).toBe(0);
  expect(JSON.parse(found.stdout)[0].memory.id).toBe(JSON.parse(saved.stdout).id);
  expect(JSON.parse(runAs(secondDir,userDirectory,"search","--project","other","--query","SQLite").stdout)).toEqual([]);
  expect(existsSync(join(firstDir,".forge614"))).toBe(false);
  expect(existsSync(join(secondDir,".forge614"))).toBe(false);
});

test("SDK without a path uses the same user database as CLI", () => {
  const dir = workspace();
  const userDirectory = join(dir,"user");
  const index = resolve(import.meta.dir,"../src/index.ts");
  const code = `import { MemoryStore } from ${JSON.stringify(index)};
    const store = new MemoryStore();
    try { store.save({project:'demo',title:'SDK',content:'SQLite shared',type:'fact'}); }
    finally { store.close(); }`;
  const result = Bun.spawnSync([process.execPath,"--preload",preload,"-e",code],{
    cwd:dir,env:{...process.env,FORGE614_TEST_USER_DIRECTORY:userDirectory},
  });
  expect(result.exitCode).toBe(0);
  expect(existsSync(join(userDirectory,".forge614","engram.db"))).toBe(true);
  expect(JSON.parse(run(dir,"search","--project","demo","--query","SQLite").stdout)).toHaveLength(1);
});

test("separate CLI processes save, revise, search, archive and restore", () => {
  const dir = workspace();
  const first = run(dir,"save","--project","demo","--title","Base","--content","SQLite","--topic","architecture/db","--request-key","first");
  expect(first.code).toBe(0);
  const saved = JSON.parse(first.stdout);
  const update = run(dir,"save","--project","demo","--title","Base","--content","PostgreSQL","--topic","architecture/db","--expected-version","1");
  expect(update.code).toBe(0);
  expect(JSON.parse(update.stdout).version).toBe(2);
  expect(JSON.parse(run(dir,"history","--project","demo","--id",saved.id).stdout)).toHaveLength(2);
  expect(JSON.parse(run(dir,"search","--project","demo","--query","PostgreSQL").stdout)[0].memory.id).toBe(saved.id);
  expect(run(dir,"archive","--project","demo","--id",saved.id).code).toBe(0);
  expect(JSON.parse(run(dir,"search","--project","demo","--query","PostgreSQL").stdout)).toEqual([]);
  expect(run(dir,"restore","--project","demo","--id",saved.id).code).toBe(0);
  expect(JSON.parse(run(dir,"get","--project","demo","--id",saved.id).stdout).state).toBe("active");
});

test("invalid arguments fail before creating storage and do not echo content", () => {
  const dir = workspace();
  const cases = [
    ["unknown"],
    ["save","--project","demo","--title","Title"],
    ["save","--project","demo","--title","Title","--content","SECRET_MARKER","--type","invalid"],
    ["search","--project","demo","--query","abc","--limit","0"],
    ["search","--project","demo","--query","abc","--unexpected","value"],
    ["search","--project","demo","--project","other","--query","abc"],
    ["save","--project","demo","--title","Title","--content","abc","--pinned","maybe"],
  ];
  for (const args of cases) {
    const result = run(dir,...args);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
    expect(result.stderr).not.toContain("SECRET_MARKER");
    expect(result.stdout).toBe("");
    expect(existsSync(join(dir,".forge614"))).toBe(false);
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
});

test("explicit database path is respected", () => {
  const dir = workspace();
  const path = join(dir,"custom","test.sqlite");
  expect(run(dir,"save","--db",path,"--project","demo","--title","Title","--content","Hello").code).toBe(0);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(join(dir,".forge614"))).toBe(false);
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
});

test("get on unknown memory returns an actionable nonzero result", () => {
  const dir = workspace();
  const result = run(dir,"get","--project","demo","--id","missing");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("NOT_FOUND");
});

test("concurrent processes sharing a request key produce exactly one memory", async () => {
  const dir = workspace();
  // Initialize storage before the writers to focus on write contention, not installation.
  expect(run(dir,"search","--project","demo","--query","parallel").code).toBe(0);
  const results = await Promise.all(Array.from({length:4},async () => {
    const child = Bun.spawn([process.execPath,"--preload",preload,cli,"save","--project","demo","--title","parallel","--content","One operation","--request-key","same-request"], {cwd:dir,env:{...process.env,FORGE614_TEST_USER_DIRECTORY:join(dir,"user")},stdout:"pipe",stderr:"pipe"});
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,stdout,stderr};
  }));
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(new Set(results.map(result => JSON.parse(result.stdout).id)).size).toBe(1);
  expect(JSON.parse(run(dir,"search","--project","demo","--query","parallel").stdout)).toHaveLength(1);
});
