import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { procSnapshot } from "../../../../tests/fixtures/proc-snapshot";

const directories: string[] = [];
function temporary(prefix = "forge614-startup-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
const cli = resolve(import.meta.dir, "../../../cli.ts");
// See cli.e2e.test.ts: Bun.spawnSync has a confirmed, unfixed upstream hang bug
// (oven-sh/bun#34069), so the CLI launcher uses the async Bun.spawn path instead.
async function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  return (await runCliWithEnvironment(cwd, userDirectory, {}, ...args));
}
async function runCliWithEnvironment(cwd: string, userDirectory: string, environment: Record<string, string | undefined>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614"), ...environment }, stdout:"pipe", stderr:"pipe",
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
afterEach(() => { for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true }); });

test("startup-context requires --json and --directory before touching storage", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const missingJson = (await runCli(root, userDirectory, "startup-context", "--directory", temporary()));
  expect(missingJson.code).toBe(1);
  expect(JSON.parse(missingJson.stderr).code).toBe("INVALID_INPUT");
  expect(missingJson.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);

  const missingDirectory = (await runCli(root, userDirectory, "startup-context", "--json"));
  expect(missingDirectory.code).toBe(1);
  expect(JSON.parse(missingDirectory.stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
}, 40000);

test("startup-context on a never-initialized workspace is a real error, not an unbound project", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(result.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
}, 40000);

test("FORGE614_HOME isolates init, save, and startup-context from the process home", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const forgeHome = join(root, "forge614");
  const environment = { FORGE614_HOME: forgeHome };
  expect((await runCliWithEnvironment(root, userDirectory, environment, "init", "--json")).code).toBe(0);
  expect((await runCliWithEnvironment(root, userDirectory, environment, "save", "--scope", "shared", "--title", "Favorite color", "--content", "black and purple", "--type", "preference", "--topic", "user/preference/favorite-color")).code).toBe(0);
  const directory = temporary();
  const context = (await runCliWithEnvironment(root, userDirectory, environment, "startup-context", "--directory", directory, "--json"));
  expect(context.code).toBe(0);
  expect(JSON.parse(context.stdout)).toMatchObject({ format: 1, project: { status: "unbound" } });
  expect(JSON.parse(context.stdout).shared.recent).toEqual(expect.arrayContaining([
    expect.objectContaining({ topicKey: "user/preference/favorite-color", title: "Favorite color" }),
  ]));
  expect(existsSync(join(forgeHome, "engram", ".env"))).toBe(true);
  expect(existsSync(join(forgeHome, "engram", "engram.db"))).toBe(true);
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
}, 40000);

test("empty or relative FORGE614_HOME fails before creating the historic home", async () => {
  for (const value of ["", "relative/forge614"]) {
    const root = temporary(); const userDirectory = join(root, "user");
    const result = (await runCliWithEnvironment(root, userDirectory, { FORGE614_HOME: value }, "init", "--json"));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_FORGE614_HOME" });
    expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
  }
}, 40000);

test("startup-context returns the bound project's context alongside shared, previews included, and creates nothing new", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const created = (await runCli(root, userDirectory, "project-create", "--name", "demo"));
  const projectId = JSON.parse(created.stdout).projectId;
  const projectDirectory = temporary();
  expect((await runCli(root, userDirectory, "project-bind", "--directory", projectDirectory, "--project-id", projectId)).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project note", "--content", "Only this repo", "--type", "fact")).code).toBe(0);

  const before = JSON.parse((await runCli(root, userDirectory, "project-list")).stdout);
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", projectDirectory, "--json"));
  expect(result.code).toBe(0);
  const body = JSON.parse(result.stdout);
  expect(body.format).toBe(1);
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(body.shared.recent[0]).toHaveProperty("preview");
  expect(body.project).toMatchObject({ status: "bound", projectId });
  expect(body.project.context.recent.map((row: { title: string }) => row.title).sort()).toEqual(["Project note", "Shared"]);
  const after = JSON.parse((await runCli(root, userDirectory, "project-list")).stdout);
  expect(after).toEqual(before);
}, 40000);

test("startup-context reports an unbound directory without an error and without binding it, and is idempotent", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact")).code).toBe(0);
  const directory = temporary();

  const first = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
  const second = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
  expect(first.code).toBe(0); expect(second.code).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const body = JSON.parse(first.stdout);
  expect(body.project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
}, 40000);

test("startup-context returns shared favorite-color for home and filesystem root without binding either", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Favorite color", "--content", "black and purple", "--type", "preference", "--topic", "user/preference/favorite-color")).code).toBe(0);

  for (const directory of [homedir(), parse(realpathSync(homedir())).root]) {
    const result = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({ format: 1, project: { status: "unbound", projectId: null, context: null } });
    expect(body.shared.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Favorite color", topicKey: "user/preference/favorite-color" }),
    ]));
  }
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
}, 40000);

test("startup-context distinguishes an unbound Git directory from a bound Git directory", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const unboundDirectory = temporary(); const boundDirectory = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect(Bun.spawnSync(["git", "init", unboundDirectory], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "init", boundDirectory], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const projectId = JSON.parse((await runCli(root, userDirectory, "project-create", "--name", "bound-git")).stdout).projectId;
  expect((await runCli(root, userDirectory, "project-bind", "--directory", boundDirectory, "--project-id", projectId)).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everywhere", "--type", "fact")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project", "--content", "Bound only", "--type", "fact")).code).toBe(0);

  const unbound = (await runCli(root, userDirectory, "startup-context", "--directory", unboundDirectory, "--json"));
  const bound = (await runCli(root, userDirectory, "startup-context", "--directory", boundDirectory, "--json"));

  expect(unbound.code).toBe(0);
  expect(JSON.parse(unbound.stdout).project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
  expect(bound.code).toBe(0);
  expect(JSON.parse(bound.stdout).project).toMatchObject({ status: "bound", projectId });
  expect(JSON.parse(bound.stdout).project.context.recent.map((row: { title: string }) => row.title).sort()).toEqual(["Project", "Shared"]);
}, 40000);

test("startup-context succeeds against a database file made read-only at the filesystem level", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Read-only safe", "--type", "fact")).code).toBe(0);
  const dbPath = join(userDirectory, ".forge614", "engram", "engram.db");
  const originalMode = statSync(dbPath).mode;
  chmodSync(dbPath, 0o400);
  try {
    const result = (await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json"));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  } finally { chmodSync(dbPath, originalMode); }
}, 40000);

test("startup-context never leaks the requested directory or other secrets on failure", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const marker = "SECRET_MARKER_STARTUP";
  const missingDirectory = join(root, `does-not-exist-${marker}`);
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", missingDirectory, "--json"));
  expect(result.code).toBe(1);
  const parsed = JSON.parse(result.stderr);
  expect(typeof parsed.code).toBe("string");
  expect(result.stderr).not.toContain(marker);
  expect(result.stdout).toBe("");
}, 40000);

test("startup-context rejects missing, regular-file, and unreadable paths with safe JSON", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const missing = join(root, "missing-STARTUP_PATH_SECRET");
  const file = join(root, "file-STARTUP_PATH_SECRET"); writeFileSync(file, "not a directory");
  const unreadable = temporary("forge614-startup-context-unreadable-"); chmodSync(unreadable, 0o000);
  try {
    for (const directory of [missing, file, unreadable]) {
      const result = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_DIRECTORY" });
      expect(result.stderr).not.toContain("STARTUP_PATH_SECRET");
    }
  } finally { chmodSync(unreadable, 0o700); }
}, 40000);

test("startup-context creates no files under the workspace root beyond what init already created", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const engramDirectory = join(userDirectory, ".forge614", "engram");
  const before = readdirSync(engramDirectory).sort();
  expect((await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json")).code).toBe(0);
  const after = readdirSync(engramDirectory).sort();
  expect(after).toEqual(before);
}, 40000);
