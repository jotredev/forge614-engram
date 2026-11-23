import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { withDirectory } from "../__test-support__/fixtures";
import { ensureProjectIgnored } from "./project-ignore";

function git(root: string, ...args: string[]) {
  return Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
}

function initialize(root: string) {
  expect(git(root, "init", "--quiet").exitCode).toBe(0);
}

function ignoreBytes(root: string): Buffer {
  return readFileSync(join(root, ".gitignore"));
}

function expectExcluded(root: string): void {
  for (const path of [".forge614/", ".forge614/project.json", ".forge614/another-file"]) {
    expect(git(root, "check-ignore", "--no-index", "--quiet", "--", path).exitCode).toBe(0);
  }
}

test("creates a root rule that protects the entire .forge614 directory and keeps it idempotent", () => withDirectory(root => {
  initialize(root);
  expect(ensureProjectIgnored(root)).toBe("ignored");
  expect(ignoreBytes(root).toString()).toBe("/.forge614/\n");
  expectExcluded(root);
  expect(ensureProjectIgnored(root)).toBe("ignored");
  expect(ignoreBytes(root).toString()).toBe("/.forge614/\n");
}));

test("the root rule preserves existing bytes and CRLF when appending to a file without a final newline", () => withDirectory(root => {
  initialize(root);
  const before = Buffer.concat([Buffer.from("deps/\r\n# "), Buffer.from([0xe9]), Buffer.from("\r\n*.tmp")]);
  writeFileSync(join(root, ".gitignore"), before);
  expect(ensureProjectIgnored(root)).toBe("ignored");
  expect(ignoreBytes(root)).toEqual(Buffer.concat([before, Buffer.from("\r\n/.forge614/\r\n")]));
  expectExcluded(root);
}));

test("moves the single canonical rule after a later negation without duplicating the rule", () => withDirectory(root => {
  initialize(root);
  const path = join(root, ".gitignore");
  writeFileSync(path, "/.forge614/\r\n# keep this comment\r\n!/.forge614/\r\n*.tmp\r\n");
  expect(git(root, "check-ignore", "--no-index", "--quiet", "--", ".forge614/project.json").exitCode).toBe(1);
  expect(ensureProjectIgnored(root)).toBe("ignored");
  expect(ignoreBytes(root).toString()).toBe("# keep this comment\r\n!/.forge614/\r\n*.tmp\r\n/.forge614/\r\n");
  expectExcluded(root);
}));

test("a repository exclude-only rule does not replace the anchored root rule", () => withDirectory(root => {
  initialize(root);
  writeFileSync(join(root, ".git", "info", "exclude"), "/.forge614/project.json\n");
  expect(ensureProjectIgnored(root)).toBe("ignored");
  expect(ignoreBytes(root).toString()).toBe("/.forge614/\n");
  expectExcluded(root);
}));

test.skipIf(process.platform === "win32")("an ignore symlink and its target keep their bytes", () => withDirectory(root => {
  initialize(root);
  const target = join(root, "other-ignore");
  writeFileSync(target, "# original\n");
  symlinkSync(target, join(root, ".gitignore"));
  expect(ensureProjectIgnored(root)).toBe("unavailable");
  expect(readFileSync(target, "utf8")).toBe("# original\n");
}));

test.skipIf(process.platform === "win32")("an unwritable ignore file is preserved and reports unavailable", () => withDirectory(root => {
  initialize(root);
  const path = join(root, ".gitignore");
  writeFileSync(path, "# original\n");
  chmodSync(path, 0o444);
  try {
    expect(ensureProjectIgnored(root)).toBe("unavailable");
    expect(ignoreBytes(root).toString()).toBe("# original\n");
  } finally { chmodSync(path, 0o644); }
}));

test("a tracked identity is reported without attempting to change any working file", () => withDirectory(root => {
  initialize(root);
  const directory = join(root, ".forge614");
  mkdirSync(directory);
  writeFileSync(join(directory, "project.json"), "{\"tracked\": true}\n");
  expect(git(root, "add", "--", ".forge614/project.json").exitCode).toBe(0);
  expect(ensureProjectIgnored(root)).toBe("tracked");
  expect(existsSync(join(root, ".gitignore"))).toBe(false);
  expect(readFileSync(join(directory, "project.json"), "utf8")).toBe("{\"tracked\": true}\n");
}));

test("several processes attempting the same exclusion add one rule", async () => {
  const root = mkdtempSync(join(tmpdir(), "engram-ignore-race-"));
  try {
    initialize(root);
    const module = resolve(import.meta.dir, "project-ignore.ts");
    const source = `import {ensureProjectIgnored} from ${JSON.stringify(module)}; console.log(ensureProjectIgnored(${JSON.stringify(root)}));`;
    const children = Array.from({ length: 3 }, () => Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(children.map(async child => ({
      code: await child.exited, stdout: await new Response(child.stdout).text(), stderr: await new Response(child.stderr).text(),
    })));
    expect(results).toEqual(Array(3).fill({ code: 0, stdout: "ignored\n", stderr: "" }));
    expect(ignoreBytes(root).toString()).toBe("/.forge614/\n");
    expectExcluded(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
