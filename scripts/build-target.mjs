#!/usr/bin/env node
/** Build one self-contained Engram release binary for a declared platform target. */

import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const targets = new Map([
  ["darwin-arm64", ["bun-darwin-arm64", "forge614-engram-darwin-arm64"]],
  ["darwin-x64", ["bun-darwin-x64", "forge614-engram-darwin-x64"]],
  ["linux-arm64", ["bun-linux-arm64", "forge614-engram-linux-arm64"]],
  ["linux-x64", ["bun-linux-x64", "forge614-engram-linux-x64"]],
  ["windows-x64", ["bun-windows-x64", "forge614-engram-windows-x64.exe"]],
]);
const target = process.env.FORGE614_TARGET;
const selected = target === undefined ? undefined : targets.get(target);
if (!selected) {
  process.stderr.write(`FORGE614_TARGET must be one of ${[...targets.keys()].join(", ")}\n`);
  process.exit(2);
}
const output = resolve("dist/release");
await mkdir(output, { recursive: true });
const result = spawnSync("bun", ["build", "./src/cli.ts", "--compile", `--target=${selected[0]}`, `--outfile=${resolve(output, selected[1])}`], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
