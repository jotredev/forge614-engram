import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
function temporary(prefix = "forge614-startup-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
const cli = resolve(import.meta.dir, "../../../cli.ts");
const preload = resolve(import.meta.dir, "../../../../tests/fixtures/user-directory.ts");
function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, "--preload", preload, cli, ...args], {
    cwd, env: { ...process.env, FORGE614_TEST_USER_DIRECTORY: userDirectory },
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
afterEach(() => { for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true }); });

test("startup-context requires --json and --directory before touching storage", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const missingJson = runCli(root, userDirectory, "startup-context", "--directory", temporary());
  expect(missingJson.code).toBe(1);
  expect(JSON.parse(missingJson.stderr).code).toBe("INVALID_INPUT");
  expect(missingJson.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);

  const missingDirectory = runCli(root, userDirectory, "startup-context", "--json");
  expect(missingDirectory.code).toBe(1);
  expect(JSON.parse(missingDirectory.stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
});

test("startup-context on a never-initialized workspace is a real error, not an unbound project", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const result = runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(result.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
});

test("startup-context returns the bound project's context alongside shared, previews included, and creates nothing new", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  const created = runCli(root, userDirectory, "project-create", "--name", "demo");
  const projectId = JSON.parse(created.stdout).projectId;
  const projectDirectory = temporary();
  expect(runCli(root, userDirectory, "project-bind", "--directory", projectDirectory, "--project-id", projectId).code).toBe(0);
  expect(runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact").code).toBe(0);
  expect(runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project note", "--content", "Only this repo", "--type", "fact").code).toBe(0);

  const before = JSON.parse(runCli(root, userDirectory, "project-list").stdout);
  const result = runCli(root, userDirectory, "startup-context", "--directory", projectDirectory, "--json");
  expect(result.code).toBe(0);
  const body = JSON.parse(result.stdout);
  expect(body.format).toBe(1);
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(body.shared.recent[0]).toHaveProperty("preview");
  expect(body.project).toMatchObject({ status: "bound", projectId });
  expect(body.project.context.recent.map((row: { title: string }) => row.title).sort()).toEqual(["Project note", "Shared"]);
  const after = JSON.parse(runCli(root, userDirectory, "project-list").stdout);
  expect(after).toEqual(before);
});

test("startup-context reports an unbound directory without an error and without binding it, and is idempotent", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  expect(runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact").code).toBe(0);
  const directory = temporary();

  const first = runCli(root, userDirectory, "startup-context", "--directory", directory, "--json");
  const second = runCli(root, userDirectory, "startup-context", "--directory", directory, "--json");
  expect(first.code).toBe(0); expect(second.code).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const body = JSON.parse(first.stdout);
  expect(body.project).toEqual({ status: "unbound", projectId: null, context: null });
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(JSON.parse(runCli(root, userDirectory, "project-list").stdout)).toEqual([]);
});

test("startup-context succeeds against a database file made read-only at the filesystem level", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  expect(runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Read-only safe", "--type", "fact").code).toBe(0);
  const dbPath = join(userDirectory, ".forge614", "engram", "engram.db");
  const originalMode = statSync(dbPath).mode;
  chmodSync(dbPath, 0o400);
  try {
    const result = runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  } finally { chmodSync(dbPath, originalMode); }
});

test("startup-context never leaks the requested directory or other secrets on failure", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  const marker = "SECRET_MARKER_STARTUP";
  const missingDirectory = join(root, `does-not-exist-${marker}`);
  const result = runCli(root, userDirectory, "startup-context", "--directory", missingDirectory, "--json");
  expect(result.code).toBe(1);
  const parsed = JSON.parse(result.stderr);
  expect(typeof parsed.code).toBe("string");
  expect(result.stderr).not.toContain(marker);
  expect(result.stdout).toBe("");
});

test("startup-context creates no files under the workspace root beyond what init already created", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  const engramDirectory = join(userDirectory, ".forge614", "engram");
  const before = readdirSync(engramDirectory).sort();
  expect(runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json").code).toBe(0);
  const after = readdirSync(engramDirectory).sort();
  expect(after).toEqual(before);
});
