import { expect, test } from "bun:test";
import { realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInstalledEngram } from "./installation";
import { withDirectory } from "../__test-support__/fixtures";

test("installation discovery rejects runtimes and nonexecutables, resolves executable links", () => withDirectory(home => {
  const executable = join(home, "forge614-engram"); writeFileSync(executable, "binary", { mode: 0o700 });
  const link = join(home, "link"); symlinkSync(executable, link);
  expect(resolveInstalledEngram({ home, path: "", executable: link })).toBe(realpathSync(executable));
  const plain = join(home, "plain"); writeFileSync(plain, "text", { mode: 0o600 });
  expect(resolveInstalledEngram({ home, executable: plain })).toBeNull();
  expect(resolveInstalledEngram({ home, executable: process.execPath })).toBeNull();
}));
