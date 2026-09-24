import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";
import { procSnapshot } from "../../../tests/fixtures/proc-snapshot";

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
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });
test("help, version and empty project list create no storage", async () => {
  const dir = workspace();
  for (const args of [["help"],["--version"],["project-list"]]) {
    const result = (await run(dir,...args)); expect(result.code).toBe(0);
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
  const help = (await run(dir,"help")).stdout;
  for (const syntax of [
    "sync [--upgrade-format]",
    "update [--json] Descarga, verifica y activa la última versión estable de Engram; --json devuelve el resultado estructurado.",
    "sessions-enable",
    "reinforcement-enable",
    "intelligence-enable",
    "Habilita explícitamente la memoria inteligente (esquema 11); respalda la base antes de migrar.",
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
  expect(help).not.toContain("Centro de control");
  expect(help).not.toContain("Asistentes con vista previa y confirmación");
  expect(help).toContain("~/.forge614/engram/.env");
  expect(help).toContain("~/.forge614/engram/engram.db");
  expect((await run(dir,"--version")).stdout).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  expect(JSON.parse((await run(dir,"project-list")).stdout)).toEqual([]);
}, 40000);

test("main defaults to help and serializes invalid invocations only to stderr", async () => {
  const dir=workspace();
  expect((await run(dir)).stdout).toBe((await run(dir,"--help")).stdout);
  for(const args of [["help","PRIVATE_VALUE"],["--version","PRIVATE_VALUE"],["unknown-command"]]) {
    const result=(await run(dir,...args));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({code:"INVALID_INPUT"});
    expect(result.stderr).not.toContain("PRIVATE_VALUE");
  }
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
}, 40000);
