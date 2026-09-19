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
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });
test("help, version and empty project list create no storage", () => {
  const dir = workspace();
  for (const args of [["help"],["--version"],["project-list"]]) {
    const result = run(dir,...args); expect(result.code).toBe(0);
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
  const help = run(dir,"help").stdout;
  for (const syntax of [
    "sync [--upgrade-format]",
    "sessions-enable",
    "reinforcement-enable",
    "session-start --directory <carpeta> --session-id <id>",
    "session-end --project-id <UUID> --session-id <id>",
    "session-summary --project-id <UUID> --session-id <id> --summary-json <json>",
    "timeline --project-id <UUID> --session-id <id> --id <recuerdo> --version <n>",
    "context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]",
    "[--session-id <id>] [--session-project-id <UUID>]",
    "search   --query <texto> [--limit <1..100>] [--preview]",
    "get      --id <recuerdo> [--version <n>]",
  ]) expect(help).toContain(syntax);
  expect(help).toContain("--upgrade-format promueve al formato local habilitado (hasta 3).");
  expect(help).toContain("todos deben entender el formato seleccionado; el refuerzo requiere formato 3.");
  expect(help).toContain("Centro de control");
  expect(help).toContain("Asistentes con vista previa y confirmación");
  expect(help).toContain("~/.forge614/engram/.env");
  expect(help).toContain("~/.forge614/engram/engram.db");
  expect(run(dir,"--version").stdout).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  expect(JSON.parse(run(dir,"project-list").stdout)).toEqual([]);
});

test("main defaults to help and serializes invalid invocations only to stderr", () => {
  const dir=workspace();
  expect(run(dir).stdout).toBe(run(dir,"--help").stdout);
  for(const args of [["help","PRIVATE_VALUE"],["--version","PRIVATE_VALUE"],["unknown-command"]]) {
    const result=run(dir,...args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({code:"INVALID_INPUT"});
    expect(result.stderr).not.toContain("PRIVATE_VALUE");
  }
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
});
