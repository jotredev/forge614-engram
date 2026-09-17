import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guardedWrite, readSafeFile } from "./private-files";
import { withDirectory } from "../__test-support__/fixtures";

test("guarded replacement retains exact backup and private published bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "old");
  const backups: string[] = [], published: string[] = [];
  guardedWrite({ path, before: "old", after: "new", kind: "config" }, p => backups.push(p), p => published.push(p));
  expect(readSafeFile(path)).toBe("new"); expect(published).toEqual([path]);
  expect(backups).toHaveLength(1); expect(readFileSync(backups[0]!, "utf8")).toBe("old");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir).some(p => p.includes("-tmp-"))).toBe(false);
}));

test("stale preview and symlink reads fail without changing target bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "external");
  expect(() => guardedWrite({ path, before: "old", after: "new", kind: "config" }, () => {}, () => {})).toThrow(expect.objectContaining({ code: "CHANGED" }));
  const link = join(dir, "link"); symlinkSync(path, link);
  expect(() => readSafeFile(link)).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  expect(readFileSync(path, "utf8")).toBe("external"); expect(readdirSync(dir).sort()).toEqual(["config", "link"]);
}));
