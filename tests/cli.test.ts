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
function run(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath,cli,...args], { cwd });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });

test("help describes commands and creates no database", () => {
  const dir = workspace();
  const result = run(dir,"help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("save");
  expect(result.stdout).toContain("search");
  expect(existsSync(join(dir,".forge614"))).toBe(false);
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
  }
});

test("explicit database path is respected", () => {
  const dir = workspace();
  const path = join(dir,"custom","test.sqlite");
  expect(run(dir,"save","--db",path,"--project","demo","--title","Title","--content","Hello").code).toBe(0);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(join(dir,".forge614"))).toBe(false);
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
    const process = Bun.spawn([Bun.which("bun")!,cli,"save","--project","demo","--title","parallel","--content","One operation","--request-key","same-request"], {cwd:dir,stdout:"pipe",stderr:"pipe"});
    const [code,stdout,stderr] = await Promise.all([process.exited,new Response(process.stdout).text(),new Response(process.stderr).text()]);
    return {code,stdout,stderr};
  }));
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(new Set(results.map(result => JSON.parse(result.stdout).id)).size).toBe(1);
  expect(JSON.parse(run(dir,"search","--project","demo","--query","parallel").stdout)).toHaveLength(1);
});
