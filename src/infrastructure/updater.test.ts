/** Comprueba que update verifica el portero, usa tags resueltos y aparta el ejecutable de Windows. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installedEngramCommand, parseChecksumManifest, updateInstalledEngram } from "./updater";

const installerBytes = new TextEncoder().encode("verified gatekeeper bytes");
const installerHash = createHash("sha256").update(installerBytes).digest("hex");
const sums = `${installerHash}  install.sh\n${installerHash}  install.ps1\n`;

async function withForge614Home(run: (home: string) => Promise<void>): Promise<void> {
  const previous = process.env.FORGE614_HOME;
  const home = mkdtempSync(join(tmpdir(), "forge614-updater-"));
  process.env.FORGE614_HOME = home;
  try { await run(home); }
  finally {
    if (previous === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

function dependencies(calls: string[], versionReads: string[] = ["1.9.0", "1.10.0"]) {
  let read = 0;
  return {
    fetchText: async (url: string) => { calls.push(`text ${url}`); return sums; },
    fetchBuffer: async (url: string) => { calls.push(`bytes ${url}`); return installerBytes; },
    readInstalledVersion: () => versionReads[Math.min(read++, versionReads.length - 1)]!,
  };
}

test("installedEngramCommand preserves the fixed MCP launcher path", async () => withForge614Home(async home => {
  expect(installedEngramCommand("darwin")).toBe(join(home, "engram", "bin", "forge614-engram"));
  expect(installedEngramCommand("win32")).toBe(join(home, "engram", "bin", "forge614-engram.exe"));
}));

test("strict GNU SHA256SUMS rejects malformed, duplicate and whitespace-variant rows", () => {
  expect(parseChecksumManifest(`${installerHash}  install.sh\n`)).toEqual(new Map([["install.sh", installerHash]]));
  for (const invalid of [
    `${installerHash} install.sh\n`, `${installerHash}  install.sh\n\n`,
    `${installerHash}  install.sh\n${installerHash}  install.sh\n`, `${installerHash.toUpperCase()}  install.sh\n`,
  ]) expect(() => parseChecksumManifest(invalid)).toThrow();
});

test("Unix update verifies the requested release portero and passes its resolved tag, never --latest", async () => withForge614Home(async () => {
  const calls: string[] = [];
  const result = await updateInstalledEngram("1.9.0", {
    platform: "darwin", version: "1.10.0", ...dependencies(calls),
    spawn: (command, args, options) => { calls.push(`${command} ${args.join(" ")} ${options?.stdio ?? "quiet"}`); return { status: 0 }; },
  });
  expect(calls).toEqual([
    "text https://github.com/jotredev/forge614-engram/releases/download/v1.10.0/SHA256SUMS",
    "bytes https://github.com/jotredev/forge614-engram/releases/download/v1.10.0/install.sh",
    expect.stringMatching(/^bash .*install\.sh --force --version v1\.10\.0 inherit$/),
  ]);
  expect(calls.join(" ")).not.toContain("--latest");
  expect(result).toEqual({ updated: true, previousVersion: "1.9.0", installedVersion: "1.10.0" });
}));

test("update resolves the published latest tag before invoking the portero", async () => withForge614Home(async () => {
  const calls: string[] = [];
  await updateInstalledEngram("1.9.0", {
    platform: "linux", latestVersion: async () => "v1.10.0", ...dependencies(calls),
    spawn: (_command, args) => { calls.push(args.join(" ")); return { status: 0 }; },
  });
  expect(calls.at(-1)).toContain("--version v1.10.0");
  expect(calls.at(-1)).not.toContain("--latest");
}));

test("checksum mismatch stops before the installer process runs", async () => withForge614Home(async () => {
  let spawned = false;
  await expect(updateInstalledEngram("1.9.0", {
    platform: "darwin", version: "1.10.0",
    fetchText: async () => `0000000000000000000000000000000000000000000000000000000000000000  install.sh\n`,
    fetchBuffer: async () => installerBytes,
    readInstalledVersion: () => "1.9.0",
    spawn: () => { spawned = true; return { status: 0 }; },
  })).rejects.toThrow("Downloaded installer checksum mismatch.");
  expect(spawned).toBe(false);
}));

test("Windows update bypasses execution policy, parks the active exe and leaves its old file for the next update", async () => withForge614Home(async home => {
  const active = installedEngramCommand("win32");
  mkdirSync(dirname(active), { recursive: true });
  writeFileSync(active, "currently running exe");
  const bin = dirname(active);
  writeFileSync(join(bin, ".old-previous"), "remove at update start");
  const calls: string[] = [];
  const result = await updateInstalledEngram("1.9.0", {
    platform: "win32", arch: "x64", version: "1.10.0", ...dependencies(calls),
    spawn: (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      expect(existsSync(active)).toBe(false);
      expect(readdirSync(bin).some(name => name.startsWith(".old-") && name !== ".old-previous")).toBe(true);
      expect(existsSync(join(bin, ".old-previous"))).toBe(false);
      writeFileSync(active, "new exe from installer");
      return { status: 0 };
    },
  });
  const invocation = calls.find(call => call.startsWith("powershell.exe"))!;
  expect(invocation).toContain("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File");
  expect(invocation).toContain("--force --version v1.10.0");
  expect(result).toEqual({ updated: true, previousVersion: "1.9.0", installedVersion: "1.10.0" });
  expect(readdirSync(bin).some(name => name.startsWith(".old-"))).toBe(true);
}));

test("Windows update restores the parked executable if the portero fails", async () => withForge614Home(async home => {
  const active = installedEngramCommand("win32");
  mkdirSync(dirname(active), { recursive: true });
  writeFileSync(active, "recoverable exe");
  await expect(updateInstalledEngram("1.9.0", {
    platform: "win32", arch: "x64", version: "1.10.0", ...dependencies([]),
    spawn: () => ({ status: 1, stderr: "installer failed" }),
  })).rejects.toThrow("installer failed");
  expect(readFileSync(active, "utf8")).toBe("recoverable exe");
  expect(readdirSync(dirname(active)).some(name => name.startsWith(".old-"))).toBe(false);
}));

test("Windows update rejects unsupported architectures before release downloads", async () => withForge614Home(async () => {
  let downloaded = false;
  await expect(updateInstalledEngram("1.9.0", {
    platform: "win32", arch: "arm64", version: "1.10.0",
    fetchText: async () => { downloaded = true; return sums; },
  })).rejects.toThrow("Forge614 Engram updater only supports x64 on Windows.");
  expect(downloaded).toBe(false);
}));
