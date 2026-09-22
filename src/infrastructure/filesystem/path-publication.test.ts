import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removePathPublication } from "./path-publication";

const start = "# >>> forge614-engram PATH >>>";
const end = "# <<< forge614-engram PATH <<<";

function unixBlock(directory: string): string {
  return `${start}\ncase ":$PATH:" in\n  *:${directory}:*) ;;\n  *) export PATH=${directory}:"$PATH" ;;\nesac\n${end}`;
}

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "engram-path-publication-"));
  try { await run(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test("removes only the exact Engram PATH block and keeps user shell settings", async () => withHome(async home => {
  const path = join(home, ".zshrc");
  const directory = join(home, ".forge614", "engram", "bin");
  writeFileSync(path, `export KEEP_THIS=1\n${unixBlock(directory)}\nexport KEEP_THAT=1\n`);
  const removed = await removePathPublication({ home, binDirectory: directory });
  expect(removed).toEqual([path]);
  expect(readFileSync(path, "utf8")).toBe("export KEEP_THIS=1\nexport KEEP_THAT=1\n");
}));

test("refuses an edited Engram PATH block without changing it", async () => withHome(async home => {
  const path = join(home, ".zshrc");
  writeFileSync(path, `${start}\nexport PATH=/somewhere-else:$PATH\n${end}\n`);
  await expect(removePathPublication({ home, binDirectory: join(home, ".forge614", "engram", "bin") })).rejects.toMatchObject({ code: "PATH_CONFLICT" });
  expect(readFileSync(path, "utf8")).toContain("/somewhere-else");
}));

test("removes the dedicated Fish publication without touching an absent shell file", async () => withHome(async home => {
  const fish = join(home, ".config", "fish", "conf.d", "forge614-engram.fish");
  const directory = join(home, ".forge614", "engram", "bin");
  mkdirSync(join(home, ".config", "fish", "conf.d"), { recursive: true });
  writeFileSync(fish, `${start}\nif not contains -- ${directory} $PATH\n  set -gx PATH ${directory} $PATH\nend\n${end}\n`);
  const removed = await removePathPublication({ home, binDirectory: directory });
  expect(removed).toEqual([fish]);
  expect(existsSync(join(home, ".zshrc"))).toBe(false);
  expect(readFileSync(fish, "utf8")).toBe("");
}));

test("removes the installer PATH block when the product path contains spaces", async () => {
  const home = mkdtempSync(join(tmpdir(), "engram path publication-"));
  try {
    const path = join(home, ".zshrc");
    const directory = join(home, ".forge614", "engram", "bin");
    const escaped = directory.replace(/ /g, "\\ ");
    writeFileSync(path, `keep=1\n${start}\ncase ":$PATH:" in\n  *:${escaped}:*) ;;\n  *) export PATH=${escaped}:"$PATH" ;;\nesac\n${end}\n`);
    await expect(removePathPublication({ home, binDirectory: directory })).resolves.toEqual([path]);
    expect(readFileSync(path, "utf8")).toBe("keep=1\n");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
