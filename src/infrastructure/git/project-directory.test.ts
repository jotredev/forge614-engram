/** Comprueba que la identidad de proyecto distingue Git de no-Git, resuelve `worktrees` anidados y rechaza o degrada según corresponda cuando Git no está disponible. */
import { expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, parse } from "node:path";
import { canonicalProject, canonicalProjectForRead, runtimeProjectDirectory, assertGitProjectDirectory, bindingAvailable } from "./project-directory";
import { withDirectory } from "../__test-support__/fixtures";

// Una carpeta sin Git conserva su propia identidad, pero no debe poder exigirse como repositorio Git.
test("non-Git directories retain explicit identity but cannot imply Git context", () => withDirectory(dir => {
  const canonical = realpathSync(dir);
  const project = canonicalProject(dir);
  expect(project).toEqual({ directory: canonical, name: basename(canonical), git: false });
  expect(runtimeProjectDirectory(dir, project)).toBe(canonical);
  expect(() => assertGitProjectDirectory(dir)).toThrow(expect.objectContaining({ code: "PROJECT_DIRECTORY_REQUIRED" }));
  expect(bindingAvailable(dir)).toBe(true); expect(bindingAvailable(join(dir, "missing"))).toBe(false);
}));

// Desde una subcarpeta de un repositorio, la identidad debe resolver al `.git` común y el `worktree` en tiempo de ejecución a la raíz real.
test("nested Git directory resolves common identity and worktree runtime root", () => withDirectory(dir => {
  expect(Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const nested = join(dir, "nested"); mkdirSync(nested);
  const project = canonicalProject(nested);
  expect(project.directory).toBe(join(realpathSync(dir), ".git")); expect(project.git).toBe(true);
  expect(runtimeProjectDirectory(nested, project)).toBe(realpathSync(dir));
}));

// La resolución de lectura acepta la carpeta personal y la raíz del sistema de archivos; la de vinculación debe rechazar ambas.
test("read resolution accepts home and filesystem root while bind resolution rejects both", () => {
  const home = realpathSync(homedir());
  const root = parse(home).root;
  expect(canonicalProjectForRead(home).directory).toBe(home);
  expect(canonicalProjectForRead(root).directory).toBe(root);
  expect(() => canonicalProject(home)).toThrow(expect.objectContaining({ code: "INVALID_DIRECTORY" }));
  expect(() => canonicalProject(root)).toThrow(expect.objectContaining({ code: "INVALID_DIRECTORY" }));
});

// Sin `git` disponible en el PATH, la resolución de lectura debe degradar a una carpeta sin Git en vez de fallar, mientras que la de vinculación sí debe fallar.
test("read resolution degrades unavailable Git identity to an unbound-capable directory", () => withDirectory(dir => {
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    expect(canonicalProjectForRead(dir)).toEqual({ directory: realpathSync(dir), name: basename(realpathSync(dir)), git: false });
    expect(() => canonicalProject(dir)).toThrow(expect.objectContaining({ code: "PROJECT_IDENTITY_UNAVAILABLE" }));
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
}));
