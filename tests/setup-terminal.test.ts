import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemoryWorkspace } from "../src/workspace";
import { WorkspaceConfig } from "../src/workspace-config";

const directories: string[] = [];
function terminal(input: string) {
  const dir = mkdtempSync(join(tmpdir(), "forge614-terminal-"));
  directories.push(dir);
  const result = Bun.spawnSync([
    process.execPath, "--preload", resolve(import.meta.dir, "fixtures/user-directory.ts"),
    "--preload", resolve(import.meta.dir, "fixtures/interactive-terminal.ts"),
    resolve(import.meta.dir, "../src/cli.ts"), "setup",
  ], { cwd: dir, env: { ...process.env, FORGE614_TEST_USER_DIRECTORY: dir }, stdin: Buffer.from(input), timeout: 5000 });
  return { result, config: new WorkspaceConfig(join(dir, ".forge614")) };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("terminal EOF and Ctrl+C cancel without initializing storage", () => {
  for (const input of ["", "maybe\n", "\x03", "maybe\n\x03", "no\n"]) {
    const { result, config } = terminal(input);
    expect(result.exitCode).toBe(130);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("cancelada");
    expect(existsSync(config.root)).toBe(false);
  }
});

test("terminal retries pasted invalid answers then initializes without creating projects", () => {
  const { result, config } = terminal("maybe\nsi\n");
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  const projects = new MemoryWorkspace(config).listProjects();
  expect(projects).toEqual([]);
  expect(existsSync(config.databasePath)).toBe(true);
});
