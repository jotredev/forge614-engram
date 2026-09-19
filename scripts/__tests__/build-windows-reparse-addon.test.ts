import { expect, test } from "bun:test";

const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json();
const builder = await Bun.file(
  new URL("../build-windows-reparse-addon.ps1", import.meta.url),
).text();
const verifyWorkflow = await Bun.file(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
).text();

test("Windows native guard build pins Visual Studio 2026-compatible tooling", () => {
  expect(packageJson.devDependencies["node-gyp"]).toBe("12.1.0");
  expect(builder).not.toMatch(/(?<!\d)2022(?!\d)/);
  expect(builder).toContain("--msvs_version=2026");
  expect(verifyWorkflow).not.toMatch(/(?<!\d)2022(?!\d)/);
  expect(verifyWorkflow).toContain("Build Windows x64 reparse addon with Visual Studio 2026");
});
