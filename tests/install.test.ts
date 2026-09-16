import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const installer = resolve(import.meta.dir,"../scripts/install.sh");
const dirs: string[] = [];
const buildEnv = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` };
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-install-"));
  dirs.push(dir);
  return dir;
}
function install(cwd: string, args: string[], env = buildEnv) {
  const result = Bun.spawnSync(["/bin/bash",installer,...args],{cwd,env});
  return { code: result.exitCode, out: result.stdout.toString(), error: result.stderr.toString() };
}
afterEach(() => { for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true}); });

test("repository installer produces a standalone CLI usable outside the repo without Bun on PATH", () => {
  const dir = workspace();
  const bin = join(dir,"bin with spaces");
  const installed = install(dir,["--bin-dir",bin]);
  expect(installed.code).toBe(0);
  const target = join(bin,"forge614-engram");
  expect(existsSync(target)).toBe(true);
  // Only the installed command is discoverable: no bun, node, or source wrapper.
  const run = (...args: string[]) => Bun.spawnSync(["forge614-engram",...args],{cwd:dir,env:{PATH:bin}});
  const data = (...args: string[]) => run(...args,"--db",join(dir,"isolated.sqlite"));
  const help = run("help");
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("Uso: forge614-engram");
  expect(existsSync(join(dir,".forge614"))).toBe(false);
  expect(run("--version").stdout.toString()).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  const save = data("save","--project","demo","--title","Install test","--content","SQLite standalone");
  expect(save.exitCode).toBe(0);
  const search = data("search","--project","demo","--query","SQLite");
  expect(search.exitCode).toBe(0);
  expect(JSON.parse(search.stdout.toString())[0].memory.id).toBe(JSON.parse(save.stdout.toString()).id);
  const original = Bun.hash(readFileSync(target));
  expect(install(dir,["--bin-dir",bin]).code).not.toBe(0);
  expect(Bun.hash(readFileSync(target))).toBe(original);
  expect(install(dir,["--bin-dir",bin,"--force"]).code).toBe(0);
  expect(run("--version").exitCode).toBe(0);
  expect(JSON.parse(data("search","--project","demo","--query","SQLite").stdout.toString())).toHaveLength(1);
},30000);

test("installer help and invalid options create no destination", () => {
  const dir = workspace();
  const bin = join(dir,"bin");
  expect(install(dir,["--help"]).code).toBe(0);
  expect(install(dir,["--bin-dir",bin,"--unknown"]).code).not.toBe(0);
  expect(existsSync(bin)).toBe(false);
});

test("missing Bun reports prerequisite without creating destination", () => {
  const dir = workspace();
  const bin = join(dir,"bin");
  const result = install(dir,["--bin-dir",bin],{...process.env,PATH:"/usr/bin:/bin"});
  expect(result.code).not.toBe(0);
  expect(result.error).toContain("Bun");
  expect(existsSync(bin)).toBe(false);
});
