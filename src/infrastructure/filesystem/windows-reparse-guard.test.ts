import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWindowsReparsePoint, hasWindowsReparsePoint } from "./windows-reparse-guard";

test("Windows guard turns a native checker failure into an error", () => {
  expect(() => checkWindowsReparsePoint("C:\\safe", () => { throw new Error("native"); })).toThrow();
});

test("Windows guard rejects a malformed native checker result", () => {
  expect(() => checkWindowsReparsePoint("C:\\safe", () => "unsafe")).toThrow();
});

const unix = process.platform === "win32" ? test.skip : test;
unix("Windows guard never loads its addon outside Windows", () => {
  expect(() => hasWindowsReparsePoint("C:\\safe")).toThrow("Windows reparse-point checks require Windows.");
});

unix("Bun bundles the Windows guard loader without loading its addon", () => {
  const outdir = mkdtempSync(join(tmpdir(), "engram-windows-reparse-build-"));
  try {
    const result = spawnSync(process.execPath, ["build", "src/infrastructure/filesystem/windows-reparse-guard.ts", "--target=bun", "--outdir", outdir], {
      cwd: process.cwd(), encoding: "utf8",
    });
    expect(result.status).toBe(0);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});
