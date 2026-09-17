import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalProject, runtimeProjectDirectory, assertGitProjectDirectory, bindingAvailable } from "./project-directory";
import { withDirectory } from "../__test-support__/fixtures";

test("non-Git directories retain explicit identity but cannot imply Git context", () => withDirectory(dir => {
  const canonical = realpathSync(dir);
  const project = canonicalProject(dir);
  expect(project).toEqual({ directory: canonical, name: basename(canonical), git: false });
  expect(runtimeProjectDirectory(dir, project)).toBe(canonical);
  expect(() => assertGitProjectDirectory(dir)).toThrow(expect.objectContaining({ code: "PROJECT_DIRECTORY_REQUIRED" }));
  expect(bindingAvailable(dir)).toBe(true); expect(bindingAvailable(join(dir, "missing"))).toBe(false);
}));

test("nested Git directory resolves common identity and worktree runtime root", () => withDirectory(dir => {
  expect(Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const nested = join(dir, "nested"); mkdirSync(nested);
  const project = canonicalProject(nested);
  expect(project.directory).toBe(join(realpathSync(dir), ".git")); expect(project.git).toBe(true);
  expect(runtimeProjectDirectory(nested, project)).toBe(realpathSync(dir));
}));
