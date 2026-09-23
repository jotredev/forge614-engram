import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { MemoryStore } from "../../../app/memory-store";
import { bindProjectContext, resolveProjectContext, saveProjectMemory, startProjectSession } from "../../../app/project-context";
import { procSnapshot } from "../../../../tests/fixtures/proc-snapshot";

const directories: string[] = [];
const stores: MemoryStore[] = [];
function temporary(prefix = "forge614-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
function store(path = join(temporary(), "engram.db")): MemoryStore {
  const value = new MemoryStore(path); stores.push(value); return value;
}
function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-c", "commit.gpgSign=false", "-C", cwd, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
function repository(): string {
  const directory = temporary("forge614-repo-");
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "tests@example.invalid");
  git(directory, "config", "user.name", "Forge614 Tests");
  writeFileSync(join(directory, "README.md"), "fixture\n");
  git(directory, "add", "README.md");
  git(directory, "commit", "--quiet", "-m", "fixture");
  return directory;
}
const cli = resolve(import.meta.dir,"../../../cli.ts");
// See cli.e2e.test.ts: Bun.spawnSync has a confirmed, unfixed upstream hang bug
// (oven-sh/bun#34069), so the CLI launcher uses the async Bun.spawn path instead.
async function runCli(cwd:string,userDirectory:string,...args:string[]) {
  const child = Bun.spawn([process.execPath,cli,...args],{
    cwd,env:{...process.env,FORGE614_HOME:join(userDirectory,".forge614")},stdout:"pipe",stderr:"pipe",
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
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});


test("project-bind is scriptable recovery for a colliding existing project name", async () => {
  const root = temporary(); const userDirectory = join(root,"user"); const directory = temporary();
  expect((await runCli(root,userDirectory,"init","--json")).code).toBe(0);
  const created = (await runCli(root,userDirectory,"project-create","--name",basename(directory)));
  expect(created.code).toBe(0); const projectId = JSON.parse(created.stdout).projectId;
  const bound = (await runCli(root,userDirectory,"project-bind","--directory",directory,"--project-id",projectId));
  expect(bound.code).toBe(0);
  expect(JSON.parse(bound.stdout)).toMatchObject({ projectId,directory:realpathSync(directory),source:"binding" });
}, 40000);
