import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemoryWorkspace } from "../../app/workspace";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";

const directories: string[] = [];
function terminal(input: string) {
  const dir = mkdtempSync(join(tmpdir(), "forge614-terminal-"));
  directories.push(dir);
  const rawMode = join(dir, "raw-terminal.ts");
  writeFileSync(rawMode, "Object.defineProperty(process.stdin, 'setRawMode', { value: () => process.stdin });");
  const result = Bun.spawnSync([
    process.execPath, "--preload", resolve(import.meta.dir, "../../../tests/fixtures/user-directory.ts"),
    "--preload", resolve(import.meta.dir, "../../../tests/fixtures/interactive-terminal.ts"),
    "--preload", rawMode,
    resolve(import.meta.dir, "../../cli.ts"), "init",
  ], { cwd: dir, env: { ...process.env, FORGE614_TEST_USER_DIRECTORY: dir }, stdin: Buffer.from(input), timeout: 5000 });
  return { result, config: new WorkspaceConfig(join(dir, ".forge614", "engram")) };
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

test("terminal completes memory setup without opening assistant selection", () => {
  const { result, config } = terminal("no\nno\nmaybe\nsi\n");
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  const projects = new MemoryWorkspace(config).listProjects();
  expect(projects).toEqual([]);
  expect(existsSync(config.databasePath)).toBe(true);
});

test("terminal never echoes a pasted PostgreSQL credential even before the secret prompt",()=>{
  const {result,config}=terminal("si\npostgresql://u:SECRET_MARKER@127.0.0.1:1/db?sslmode=disable\nno\n");
  expect(result.exitCode).toBe(130);
  expect(result.stdout.toString()+result.stderr.toString()).not.toContain("SECRET_MARKER");
  expect(existsSync(config.root)).toBe(false);
});
