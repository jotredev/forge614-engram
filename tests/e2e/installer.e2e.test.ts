/** Pruebas del instalador único contra una publicación HTTP local y dependencias Forge614 reales. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, closeDatabase } from "../../src/infrastructure/sqlite/connection";
import packageJson from "../../package.json";

const cache = process.env.FORGE614_INSTALLER_E2E_ASSET_DIR;
const root = mkdtempSync(join(tmpdir(), "engram-installer-e2e-"));
const release = join(root, "release");
const published = new Map<string, Uint8Array>();
const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = `${platform}-${arch}`;
const installerTest = test.skipIf(!cache);
const unixInstallerTest = test.skipIf(!cache || process.platform === "win32");
const windowsInstallerTest = test.skipIf(!cache || process.platform !== "win32");
let server: ReturnType<typeof Bun.serve>;
let legacyInstallerPath: string;
let activeMcp: ReturnType<typeof Bun.spawn> | undefined;

/** Retries transient Windows file locks and never hides the assertion that ended a test. */
async function removeTemporaryTree(path: string): Promise<void> {
  const attempts = process.platform === "win32" ? 6 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { rmSync(path, { recursive: true, force: true }); return; }
    catch { if (attempt + 1 < attempts) await Bun.sleep(100); }
  }
}

async function stopMcp(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  try { if (child.exitCode === null) child.kill(); } catch { /* afterAll retries cleanup if needed */ }
  try { await child.exited; } catch { /* preserve the test's original failure */ }
  if (activeMcp === child) activeMcp = undefined;
}

/** Adds a byte-identical asset under its immutable release tag. */
function publish(tag: string, name: string, path: string): void {
  published.set(`${tag}/${name}`, new Uint8Array(readFileSync(path)));
}

/** Builds and stages the current Engram executable with a complete GNU checksum manifest. */
function stageEngramRelease(): void {
  const assetName = `forge614-engram-${target}${platform === "windows" ? ".exe" : ""}`;
  const binaryPath = join(release, assetName);
  mkdirSync(release, { recursive: true });
  const built = Bun.spawnSync(["bun", "build", "./src/cli.ts", "--compile", `--target=bun-${target}`, `--outfile=${binaryPath}`], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  if (built.exitCode !== 0) throw new Error(`${built.stdout.toString()}\n${built.stderr.toString()}`);
  for (const name of ["install.mjs", "install.sh", "install.ps1", "forge614.node.json"]) publish(`v${packageJson.version}`, name, join(process.cwd(), name));
  publish(`v${packageJson.version}`, assetName, binaryPath);
  const names = ["install.mjs", "install.sh", "install.ps1", "forge614.node.json", assetName];
  const sums = names.map(name => `${createHash("sha256").update(published.get(`v${packageJson.version}/${name}`)!).digest("hex")}  ${name}`).sort().join("\n") + "\n";
  published.set(`v${packageJson.version}/SHA256SUMS`, new Uint8Array(Buffer.from(sums)));
}

/** Builds a second real Engram binary so the Windows open-MCP test exercises an actual update. */
function stageNextEngramVersion(): void {
  const version = "1.10.1";
  const sourceRoot = join(root, `source-${version}`);
  mkdirSync(sourceRoot, { recursive: true });
  cpSync(join(process.cwd(), "src"), join(sourceRoot, "src"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<string, unknown>;
  manifest.version = version;
  writeFileSync(join(sourceRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  symlinkSync(join(process.cwd(), "node_modules"), join(sourceRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const assetName = `forge614-engram-${target}${platform === "windows" ? ".exe" : ""}`;
  const binaryPath = join(release, `v${version}`, assetName);
  mkdirSync(join(release, `v${version}`), { recursive: true });
  const built = Bun.spawnSync(["bun", "build", "./src/cli.ts", "--compile", `--target=bun-${target}`, `--outfile=${binaryPath}`], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" });
  if (built.exitCode !== 0) throw new Error(`${built.stdout.toString()}\n${built.stderr.toString()}`);
  for (const name of ["install.mjs", "install.sh", "install.ps1", "forge614.node.json"]) publish(`v${version}`, name, join(process.cwd(), name));
  publish(`v${version}`, assetName, binaryPath);
  const names = ["install.mjs", "install.sh", "install.ps1", "forge614.node.json", assetName];
  const sums = names.map(name => `${createHash("sha256").update(published.get(`v${version}/${name}`)!).digest("hex")}  ${name}`).sort().join("\n") + "\n";
  published.set(`v${version}/SHA256SUMS`, new Uint8Array(Buffer.from(sums)));
}

/** Loads the unmodified Shell and Engines release assets downloaded once into the test cache. */
function stageRealDependencies(): void {
  if (!cache) throw new Error("FORGE614_INSTALLER_E2E_ASSET_DIR is required");
  const dependencies: Array<[string, string, string]> = [
    ["shell", "1.17.0", "forge614-shell-1.17.0.tar.gz"],
    ["engines", "1.18.0", `forge614-engines-1.18.0-${target}.tar.gz`],
  ];
  for (const [node, version, archive] of dependencies) {
    const folder = join(cache, node);
    for (const name of ["install.mjs", "install.sh", "install.ps1", "forge614.node.json", "SHA256SUMS", archive, `${archive}.sha256`]) {
      const path = join(folder, name);
      if (!existsSync(path)) throw new Error(`Missing cached ${node} release asset: ${path}`);
      publish(`v${version}`, name, path);
    }
  }
}

/** Stages the real 1.9.0 binary and old installer and publishes their metadata on loopback. */
function stageLegacyRelease(): void {
  if (!cache) throw new Error("FORGE614_INSTALLER_E2E_ASSET_DIR is required");
  const folder = join(cache, "legacy");
  const binary = `forge614-engram-${target}${platform === "windows" ? ".exe" : ""}`;
  const tag = "v1.9.0";
  for (const name of [binary, "SHA256SUMS"]) publish(tag, name, join(folder, name));
  const scriptName = platform === "windows" ? "scripts/install.ps1" : "scripts/install.sh";
  const script = Bun.spawnSync(["git", "show", `v1.9.0:${scriptName}`], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  if (script.exitCode !== 0) throw new Error(`${script.stdout.toString()}\n${script.stderr.toString()}`);
  legacyInstallerPath = join(root, platform === "windows" ? "legacy-install.ps1" : "legacy-install.sh");
  writeFileSync(legacyInstallerPath, script.stdout, { mode: 0o700 });
  if (platform !== "windows") chmodSync(legacyInstallerPath, 0o700);
}

/** Loads the real Workers and Atlas releases used by Atlas's guarded install test. */
function stageAtlasDependencies(): void {
  if (!cache) throw new Error("FORGE614_INSTALLER_E2E_ASSET_DIR is required");
  const workers = join(cache, "workers");
  const workersBinary = `forge614-workers-${target}${platform === "windows" ? ".exe" : ""}`;
  for (const name of ["install.mjs", "install.sh", "forge614.node.json", "SHA256SUMS", workersBinary]) publish("v1.1.0", name, join(workers, name));
  const atlas = join(cache, "atlas");
  const atlasBinary = `forge614-atlas-${target}${platform === "windows" ? ".exe" : ""}`;
  for (const name of ["install.sh", "SHA256SUMS", atlasBinary]) publish("v1.1.1", name, join(atlas, name));
}

/** Runs a subprocess with disposable HOME and FORGE614_HOME values. */
function isolatedEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const merged = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: join(home, ".forge614"), FORGE614_LOCALE: "en", ...extra };
  if (process.platform !== "win32") return merged;
  const pathEntry = Object.entries(merged).find(([key]) => key.toLowerCase() === "path");
  return Object.fromEntries(Object.entries(merged).filter(([key]) => key.toLowerCase() !== "path").concat(pathEntry ? [["Path", pathEntry[1]]] : []));
}

/** Blocks curl attempts to GitHub and records requests made by an isolated Unix installer test. */
function denyExternalGitHubWithCurl(home: string, env: NodeJS.ProcessEnv): string {
  const curlPath = Bun.spawnSync(["sh", "-c", "command -v curl"], { stdout: "pipe", stderr: "pipe" });
  if (curlPath.exitCode !== 0) throw new Error(`curl is required by the installer tests: ${curlPath.stderr.toString()}`);
  const realCurl = curlPath.stdout.toString().trim();
  const networkGuard = join(home, "network-guard");
  mkdirSync(networkGuard, { recursive: true });
  const curlLog = join(home, "installer-curl.log");
  writeFileSync(curlLog, "");
  const quoteShell = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  writeFileSync(join(networkGuard, "curl"), [
    "#!/bin/sh",
    "case \"$*\" in *github.com*|*api.github.com*) echo \"blocked external release request: $*\" >&2; exit 97;; esac",
    `printf '%s\\n' "$*" >> ${quoteShell(curlLog)}`,
    `exec ${quoteShell(realCurl)} "$@"`,
    "",
  ].join("\n"), { mode: 0o700 });
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${networkGuard}:${env[pathKey] ?? process.env.PATH ?? ""}`;
  return curlLog;
}

/** Proves the guarded installer used the loopback publication and never named a public GitHub host. */
function expectOnlyLoopbackInstallerRequests(curlLog: string, origin: string): void {
  const calls = readFileSync(curlLog, "utf8");
  expect(calls).toContain(origin);
  expect(calls).not.toMatch(/github\.com|api\.github\.com/i);
}

/** Runs the checked-in platform gatekeeper against the loopback release server. */
async function runGatekeeper(home: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const base = `http://127.0.0.1:${server.port}`;
  const env = isolatedEnv(home, { FORGE614_INSTALL_TEST_BASE_URL: base });
  const curlLog = process.platform === "win32" ? undefined : denyExternalGitHubWithCurl(home, env);
  const command = process.platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "install.ps1", "--version", `v${packageJson.version}`]
    : ["sh", "install.sh", "--version", `v${packageJson.version}`];
  const child = Bun.spawn(command, { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (curlLog) expectOnlyLoopbackInstallerRequests(curlLog, base);
  return { code, stdout, stderr };
}

/** Waits for a child process to hold the old SQLite database open. */
async function holdDatabase(path: string) {
  const child = Bun.spawn([process.execPath, "-e", `const { Database } = require("bun:sqlite"); const db = new Database(${JSON.stringify(path)}); db.query("SELECT COUNT(*) FROM memories").get(); console.log("ready"); setInterval(() => {}, 1000);`], { stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  await reader.read();
  return child;
}

beforeAll(() => {
  if (!cache) return;
  stageEngramRelease();
  stageRealDependencies();
  stageLegacyRelease();
  if (process.platform !== "win32") stageAtlasDependencies();
  if (process.platform === "win32") stageNextEngramVersion();
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const repository = path.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/latest$/)?.[1];
      if (repository === "jotredev/forge614-engram") return Response.json({ tag_name: `v${packageJson.version}` });
      if (repository === "jotredev/forge614-shell") return Response.json({ tag_name: "v1.17.0" });
      if (repository === "jotredev/forge614-engines") return Response.json({ tag_name: "v1.18.0" });
      if (repository === "jotredev/forge614-workers") return Response.json({ tag_name: "v1.1.0" });
      if (repository === "jotredev/forge614-atlas") {
        const names = [...published.keys()].filter(key => key.startsWith("v1.1.1/")).map(key => key.slice("v1.1.1/".length));
        return Response.json({ tag_name: "v1.1.1", assets: names.map(name => ({ name, browser_download_url: `${new URL(request.url).origin}/repos/jotredev/forge614-atlas/releases/download/v1.1.1/${name}` })) });
      }
      if (path === "/repos/jotredev/forge614-atlas/releases/tags/v1.1.1") {
        const names = [...published.keys()].filter(key => key.startsWith("v1.1.1/")).map(key => key.slice("v1.1.1/".length));
        return Response.json({ tag_name: "v1.1.1", assets: names.map(name => ({ name, browser_download_url: `${new URL(request.url).origin}/repos/jotredev/forge614-atlas/releases/download/v1.1.1/${name}` })) });
      }
      if (path === "/repos/jotredev/forge614-engram/releases/tags/v1.9.0") {
        const names = [...published.keys()].filter(key => key.startsWith("v1.9.0/")).map(key => key.slice("v1.9.0/".length));
        return Response.json({ tag_name: "v1.9.0", assets: names.map(name => ({ name, browser_download_url: `${new URL(request.url).origin}/repos/jotredev/forge614-engram/releases/download/v1.9.0/${name}` })) });
      }
      const marker = "/releases/download/";
      const index = path.indexOf(marker);
      if (index < 0) return new Response("not found", { status: 404 });
      const key = path.slice(index + marker.length).split("/").map(decodeURIComponent).join("/");
      const bytes = published.get(key);
      return bytes ? new Response(Buffer.from(bytes)) : new Response("not found", { status: 404 });
    },
  });
}, { timeout: 120_000 });

afterAll(async () => {
  if (activeMcp) await stopMcp(activeMcp);
  server?.stop(true);
  await removeTemporaryTree(root);
});

installerTest("installs Engram, Shell and Engines from an empty home using real release assets", async () => {
  const home = mkdtempSync(join(root, "clean-home-"));
  const result = await runGatekeeper(home);
  expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
  const forgeHome = join(home, ".forge614");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const engram = join(forgeHome, "engram", "bin", `forge614-engram${suffix}`);
  const shell = join(forgeHome, "shell", "bin", process.platform === "win32" ? "forge614-shell.cmd" : "forge614-shell");
  const engines = join(forgeHome, "engines", "bin", `forge614-engines${suffix}`);
  expect(existsSync(engram)).toBe(true);
  expect(existsSync(shell)).toBe(true);
  expect(existsSync(engines)).toBe(true);
  const installedBinaries: Array<[string, string]> = [[engram, `forge614-engram ${packageJson.version}`], [engines, "forge614-engines 1.18.0"]];
  for (const [binary, expected] of installedBinaries) {
    const result = Bun.spawnSync([binary, "--version"], { env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
    expect(result.stdout.toString().trim()).toBe(expected);
  }
}, 120_000);

installerTest("the real 1.9 installer layout migrates its saved memory on first 1.10 access", async () => {
  const home = mkdtempSync(join(root, "legacy-home-"));
  if (platform !== "windows") {
    const installed = await runGatekeeper(home);
    expect(installed.code, `${installed.stdout}\n${installed.stderr}`).toBe(0);
  }
  const forgeHome = join(home, ".forge614");
  const origin = `http://127.0.0.1:${server.port}`;
  let launcher: string;
  let userPathKey: string | undefined;
  if (platform === "windows") {
    const legacyBin = join(forgeHome, "engram", "bin");
    mkdirSync(legacyBin, { recursive: true });
    launcher = join(legacyBin, "forge614-engram.exe");
    copyFileSync(join(cache!, "legacy", `forge614-engram-${target}.exe`), launcher);
    // install.ps1 v1.9.0:138-147 resolves FORGE614_HOME and writes the executable to engram/bin;
    // :187-188 ensures Shell and Engines exist when absent; :220 publishes that bin to User Path.
    // Model that User Path value in a test-owned key instead of mutating the runner profile.
    userPathKey = join(home, "test-user-environment.json");
    writeFileSync(userPathKey, JSON.stringify({ Path: legacyBin }, null, 2));
  } else {
    const shellInstaller = pathToFileURL(join(cache!, "shell", "install.sh")).href;
    const enginesInstaller = pathToFileURL(join(cache!, "engines", "install.sh")).href;
    const legacyEnv = isolatedEnv(home, {
      FORGE614_ENGRAM_INSTALLER_TEST: "1",
      FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: origin,
      FORGE614_SHELL_INSTALLER_TEST_URL: shellInstaller,
      FORGE614_ENGINES_INSTALLER_TEST_URL: enginesInstaller,
    });
    const curlLog = denyExternalGitHubWithCurl(home, legacyEnv);
    const legacyInstall = Bun.spawn(["bash", legacyInstallerPath, "--version", "v1.9.0", "--force"], { env: legacyEnv, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(60_000) });
    const [legacyOut, legacyErr, legacyCode] = await Promise.all([new Response(legacyInstall.stdout).text(), new Response(legacyInstall.stderr).text(), legacyInstall.exited]);
    expect(legacyCode, `v1.9.0 install.sh exit=${legacyCode}\nstdout:\n${legacyOut || "(vacío)"}\nstderr:\n${legacyErr || "(vacío)"}`).toBe(0);
    expectOnlyLoopbackInstallerRequests(curlLog, origin);
    launcher = join(forgeHome, "engram", "bin", "forge614-engram");
  }
  const oldVersion = Bun.spawnSync([launcher, "--version"], { env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(oldVersion.exitCode, `${oldVersion.stdout.toString()}\\n${oldVersion.stderr.toString()}`).toBe(0);
  expect(oldVersion.stdout.toString().trim()).toBe("forge614-engram 1.9.0");

  const initialized = Bun.spawnSync([launcher, "init", "--json"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(initialized.exitCode, `${initialized.stdout.toString()}\\n${initialized.stderr.toString()}`).toBe(0);
  const created = Bun.spawnSync([launcher, "project-create", "--name", "Legacy migration"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(created.exitCode, `${created.stdout.toString()}\\n${created.stderr.toString()}`).toBe(0);
  const projectId = JSON.parse(created.stdout.toString()).projectId as string;
  const saved = Bun.spawnSync([launcher, "save", "--project-id", projectId, "--title", "legacy migration", "--content", "same memory survives 1.9 to 1.10"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(saved.exitCode, `${saved.stdout.toString()}\\n${saved.stderr.toString()}`).toBe(0);

  // The 1.9 updater hardcodes GitHub's latest installer URL (src/infrastructure/updater.ts:14-16,260)
  // and has no loopback override. Stage 1.10 as that updater would, then test its real migration.
  const currentBinary = join(release, `forge614-engram-${target}${platform === "windows" ? ".exe" : ""}`);
  copyFileSync(currentBinary, launcher);
  if (platform !== "windows") chmodSync(launcher, 0o755);
  const firstOpen = Bun.spawnSync([launcher, "search", "--project-id", projectId, "--query", "legacy migration"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(firstOpen.exitCode, `${firstOpen.stdout.toString()}\\n${firstOpen.stderr.toString()}`).toBe(0);
  expect(firstOpen.stdout.toString()).toContain("same memory survives 1.9 to 1.10");
  expect(existsSync(join(forgeHome, "memory", "engram.db"))).toBe(true);
  expect(existsSync(join(forgeHome, "engram", "engram.db"))).toBe(false);
  if (userPathKey) expect(JSON.parse(readFileSync(userPathKey, "utf8"))).toEqual({ Path: join(forgeHome, "engram", "bin") });
}, 120_000);

installerTest("install.mjs --uninstall keeps a valid copy when another process holds the 1.9 database open", async () => {
  const home = mkdtempSync(join(root, "uninstall-home-"));
  const installed = await runGatekeeper(home);
  expect(installed.code, `${installed.stdout}\n${installed.stderr}`).toBe(0);
  const forgeHome = join(home, ".forge614");
  const oldHome = join(forgeHome, "engram");
  mkdirSync(oldHome, { recursive: true });
  const oldEnv = 'POSTGRES_URL="postgresql://example.invalid/test"\nINSTALLATION_ID="held-legacy"\n';
  writeFileSync(join(oldHome, ".env"), oldEnv, { mode: 0o600 });
  const oldDbPath = join(oldHome, "engram.db");
  const oldDb = openDatabase(oldDbPath, {});
  try {
    oldDb.query("INSERT INTO projects VALUES ('p','Legacy','now','now')").run();
    oldDb.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('m','p','project',NULL,'fact','legacy','must survive',0,1,'active','now','now')").run();
  } finally { closeDatabase(oldDb); }
  const held = await holdDatabase(oldDbPath);
  try {
    const command = process.platform === "win32"
      ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "install.ps1", "--uninstall"]
      : ["sh", "install.sh", "--uninstall"];
    const child = Bun.spawn(command, { cwd: process.cwd(), env: isolatedEnv(home, { FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}` }), stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const expectedCode = process.platform === "win32" ? 65 : 0;
    expect(code, `install.ps1 --uninstall exit=${code}\nstdout:\n${stdout || "(vacío)"}\nstderr:\n${stderr || "(vacío)"}`).toBe(expectedCode);
    if (process.platform !== "win32") expect(existsSync(join(forgeHome, "engram"))).toBe(false);
    expect(existsSync(join(forgeHome, "memory", "engram.db")), `uninstall result: ${uninstallOut}`).toBe(true);
    expect(readFileSync(join(forgeHome, "memory", ".env"), "utf8")).toBe(oldEnv);
    const copy = openDatabase(join(forgeHome, "memory", "engram.db"), { readonly: true });
    try {
      expect(copy.query("SELECT content FROM memories WHERE id='m'").get()).toEqual({ content: "must survive" });
      expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    }
    finally { closeDatabase(copy); }
  } finally { held.kill(); await held.exited; }
}, 120_000);

unixInstallerTest("uninstall removes a fake Atlas, rejects purge in JSON mode, and keeps local memory", async () => {
  const home = mkdtempSync(join(root, "uninstall-atlas-home-"));
  const installed = await runGatekeeper(home);
  expect(installed.code, `${installed.stdout}\n${installed.stderr}`).toBe(0);
  const forgeHome = join(home, ".forge614");
  const engram = join(forgeHome, "engram", "bin", `forge614-engram${process.platform === "win32" ? ".exe" : ""}`);
  const store = openDatabase(join(forgeHome, "memory", "engram.db"), {});
  try {
    store.query("INSERT INTO projects VALUES ('p','Keep','now','now')").run();
    store.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('keep','p','project',NULL,'fact','kept','keep local data',0,1,'active','now','now')").run();
  } finally { closeDatabase(store); }

  const atlasBin = join(forgeHome, "atlas", "bin");
  mkdirSync(atlasBin, { recursive: true });
  const atlas = join(atlasBin, process.platform === "win32" ? "forge614-atlas.exe" : "forge614-atlas");
  if (process.platform === "win32") {
    const source = join(home, "fake-atlas.ts");
    writeFileSync(source, `import { rmSync, writeFileSync } from "node:fs"; import { join } from "node:path"; writeFileSync(join(process.env.HOME!, "atlas-args"), process.argv.slice(2).join(" ")); rmSync(join(process.env.FORGE614_HOME!, "atlas"), { recursive: true, force: true });`);
    const built = Bun.spawnSync(["bun", "build", source, "--compile", "--target=bun-windows-x64", `--outfile=${atlas}`], { stdout: "pipe", stderr: "pipe" });
    expect(built.exitCode, `${built.stdout.toString()}\n${built.stderr.toString()}`).toBe(0);
  } else {
    writeFileSync(atlas, `#!/bin/sh\nprintf '%s\\n' "$*" > "$HOME/atlas-args"\nrm -rf "$HOME/.forge614/atlas"\n`, { mode: 0o700 });
  }

  const inside = Bun.spawnSync([engram, "uninstall", "--json"], { cwd: join(forgeHome, "engram", "bin"), env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(inside.exitCode, `${inside.stdout.toString()}\n${inside.stderr.toString()}`).toBe(1);
  const refusedPurge = Bun.spawnSync([engram, "uninstall", "--purge-data", "--json"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(refusedPurge.exitCode, `${refusedPurge.stdout.toString()}\n${refusedPurge.stderr.toString()}`).toBe(2);
  expect(existsSync(join(forgeHome, "memory", "engram.db"))).toBe(true);

  const removed = Bun.spawnSync([engram, "uninstall", "--json"], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  const profiles = [".zshrc", ".bash_profile", ".bashrc", ".config/fish/conf.d/forge614-engram.fish"].map(path => `${path}: ${existsSync(join(home, path)) ? readFileSync(join(home, path), "utf8") : "<absent>"}`).join("\n");
  expect(removed.exitCode, `${removed.stdout.toString()}\n${removed.stderr.toString()}\n${profiles}`).toBe(0);
  expect(JSON.parse(removed.stdout.toString()).result).toMatchObject({ removed: true, atlasRemoved: true, memoryKept: true });
  expect(readFileSync(join(home, "atlas-args"), "utf8").trim()).toBe("uninstall --from forge614-engram --confirmed");
  expect(existsSync(join(forgeHome, "atlas"))).toBe(false);
  expect(existsSync(join(forgeHome, "engram"))).toBe(false);
  expect(existsSync(join(forgeHome, "memory", "engram.db"))).toBe(true);
}, 120_000);

unixInstallerTest("interactive --purge-data removes local memory after the exact terminal confirmation", async () => {
  const home = mkdtempSync(join(root, "purge-home-"));
  const installed = await runGatekeeper(home);
  expect(installed.code, `${installed.stdout}\n${installed.stderr}`).toBe(0);
  const forgeHome = join(home, ".forge614");
  const db = openDatabase(join(forgeHome, "memory", "engram.db"), {});
  try {
    db.query("INSERT INTO projects VALUES ('p','Purge','now','now')").run();
    db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('purge','p','project',NULL,'fact','purge','local only',0,1,'active','now','now')").run();
  } finally { closeDatabase(db); }
  const launcher = join(forgeHome, "engram", "bin", "forge614-engram");
  const python = [
    "import os, pty, select, sys, time",
    "pid, fd = pty.fork()",
    "if pid == 0: os.execv(sys.argv[1], [sys.argv[1], 'uninstall', '--purge-data'])",
    "data = b''; sent = False; deadline = time.monotonic() + 60",
    "while True:",
    "  if time.monotonic() > deadline: os.kill(pid, 9); raise SystemExit('timed out waiting for uninstall prompt')",
    "  ready, _, _ = select.select([fd], [], [], 1)",
    "  if ready:",
    "    try: chunk = os.read(fd, 4096)",
    "    except OSError: break",
    "    if not chunk: break",
    "    data += chunk",
    "    if not sent and b'> ' in data:",
    "      os.write(fd, 'BORRAR MEMORIA LOCAL Y CONFIGURACIÓN DE NUBE; DESINSTALAR ENGRAM\\n'.encode()); sent = True",
    "_, status = os.waitpid(pid, 0)",
    "sys.stdout.buffer.write(data); sys.exit(os.waitstatus_to_exitcode(status))",
  ].join("\n");
  const result = Bun.spawnSync(["python3", "-c", python, launcher], { cwd: home, env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
  expect(existsSync(join(forgeHome, "memory"))).toBe(false);
  expect(existsSync(join(forgeHome, "engram"))).toBe(false);
}, 120_000);

unixInstallerTest("uninstall --self uses real Engines and preserves foreign integration text", async () => {
  const home = mkdtempSync(join(root, "integration-home-"));
  const installed = await runGatekeeper(home);
  expect(installed.code, installed.stdout + "\n" + installed.stderr).toBe(0);
  const forgeHome = join(home, ".forge614");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const engines = join(forgeHome, "engines", "bin", "forge614-engines" + suffix);
  const engram = join(forgeHome, "engram", "bin", "forge614-engram" + suffix);
  const env = isolatedEnv(home);
  for (const agent of ["claude-code", "codex"]) {
    const plan = Bun.spawnSync([engines, "plan", "memory-install", "--agent", agent], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    expect(plan.exitCode, plan.stdout.toString() + "\n" + plan.stderr.toString()).toBe(0);
    const planId = JSON.parse(plan.stdout.toString()).plan.planId as string;
    const applied = Bun.spawnSync([engines, "apply", "--plan-id", planId], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    expect(applied.exitCode, applied.stdout.toString() + "\n" + applied.stderr.toString()).toBe(0);
  }

  const claudeMcp = join(home, ".claude.json");
  const claudeSettings = join(home, ".claude", "settings.json");
  const claudeManual = join(home, ".claude", "CLAUDE.md");
  const codexConfig = join(home, ".codex", "config.toml");
  const codexManual = join(home, ".codex", "AGENTS.md");
  const foreignClaudeFile = join(home, ".claude", "foreign-policy.md");
  const foreignCodexFile = join(home, ".codex", "foreign-policy.toml");
  const foreignMcp = { command: "foreign-command", args: ["preserve", "exactly"] };
  const claudeObject = JSON.parse(readFileSync(claudeMcp, "utf8"));
  claudeObject.mcpServers.foreign = foreignMcp;
  writeFileSync(claudeMcp, JSON.stringify(claudeObject, null, 2) + "\n");
  const settingsObject = JSON.parse(readFileSync(claudeSettings, "utf8"));
  settingsObject.foreignSentinel = { raw: "keep this JSON value" };
  writeFileSync(claudeSettings, JSON.stringify(settingsObject, null, 2) + "\n");
  writeFileSync(claudeManual, readFileSync(claudeManual, "utf8") + "\nForeign Claude instructions stay exactly.\n");
  const foreignCodex = "[mcp_servers.foreign]\ncommand = \"foreign-command\"\nargs = [\"preserve\", \"exactly\"]\n# Foreign Codex section stays exactly.";
  writeFileSync(codexConfig, readFileSync(codexConfig, "utf8") + "\n" + foreignCodex + "\n");
  writeFileSync(codexManual, readFileSync(codexManual, "utf8") + "\nForeign Codex instructions stay exactly.\n");
  const foreignClaudeBytes = "# Claude foreign policy: exact bytes.\r\nNever edit this file.\r\n";
  const foreignCodexBytes = "# Codex foreign policy: exact bytes.\r\nNever edit this file.\r\n";
  writeFileSync(foreignClaudeFile, foreignClaudeBytes);
  writeFileSync(foreignCodexFile, foreignCodexBytes);

  const removed = Bun.spawnSync([engram, "uninstall", "--self", "--json"], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
  expect(removed.exitCode, removed.stdout.toString() + "\n" + removed.stderr.toString()).toBe(0);
  expect(JSON.parse(removed.stdout.toString()).result).toMatchObject({ integrationsRemoved: true, memoryKept: true });
  expect(JSON.parse(readFileSync(claudeMcp, "utf8")).mcpServers.foreign).toEqual(foreignMcp);
  expect(JSON.parse(readFileSync(claudeSettings, "utf8")).foreignSentinel).toEqual({ raw: "keep this JSON value" });
  expect(readFileSync(claudeManual, "utf8")).toContain("Foreign Claude instructions stay exactly.\n");
  expect(readFileSync(codexConfig, "utf8")).toContain(foreignCodex);
  expect(readFileSync(codexManual, "utf8")).toContain("Foreign Codex instructions stay exactly.\n");
  expect(readFileSync(foreignClaudeFile, "utf8")).toBe(foreignClaudeBytes);
  expect(readFileSync(foreignCodexFile, "utf8")).toBe(foreignCodexBytes);
}, 120_000);

unixInstallerTest("Atlas installs from zero through its Engram and Workers test gates", async () => {
  const home = mkdtempSync(join(root, "atlas-from-zero-home-"));
  const origin = `http://127.0.0.1:${server.port}`;
  const workersInstaller = join(cache!, "workers", "install.sh");
  const env = isolatedEnv(home, {
    FORGE614_ATLAS_INSTALLER_TEST: "1",
    FORGE614_ATLAS_TEST_RELEASE_BASE_URL: origin,
    FORGE614_ATLAS_ENGRAM_INSTALLER_TEST_URL: `file://${join(process.cwd(), "install.sh")}`,
    FORGE614_ATLAS_WORKERS_INSTALLER_TEST_URL: `file://${workersInstaller}`,
    FORGE614_INSTALL_TEST_BASE_URL: origin,
  });
  const child = Bun.spawn(["bash", join(cache!, "atlas", "install.sh"), "--version", "v1.1.1"], { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const engram = join(home, ".forge614", "engram", "bin", `forge614-engram${suffix}`);
  const workers = join(home, ".forge614", "workers", "bin", `forge614-workers${suffix}`);
  const atlas = join(home, ".forge614", "atlas", "bin", `forge614-atlas${suffix}`);
  for (const binary of [engram, workers, atlas]) expect(existsSync(binary)).toBe(true);
  const version = Bun.spawnSync([atlas, "--version"], { env: isolatedEnv(home), stdout: "pipe", stderr: "pipe" });
  expect(version.exitCode, `${version.stdout.toString()}\n${version.stderr.toString()}`).toBe(0);
  expect(version.stdout.toString()).toContain("forge614-atlas 1.1.1");
}, 120_000);

windowsInstallerTest("an open MCP does not block a real update or uninstall on Windows", async () => {
  const home = mkdtempSync(join(root, "windows-open-mcp-home-"));
  const installed = await runGatekeeper(home);
  expect(installed.code, `${installed.stdout}\n${installed.stderr}`).toBe(0);
  const forgeHome = join(home, ".forge614");
  const launcher = join(forgeHome, "engram", "bin", "forge614-engram.exe");
  const env = isolatedEnv(home, { FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${server.port}` });
  const openMcp = () => Bun.spawn([launcher, "mcp"], { cwd: home, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const mcp = openMcp();
  activeMcp = mcp;
  try {
    await Bun.sleep(500);
    expect(mcp.exitCode).toBeNull();
    const update = Bun.spawn([launcher, "update", "--version", "1.10.1", "--json"], { cwd: home, env, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
    const [updateOut, updateErr, updateCode] = await Promise.all([new Response(update.stdout).text(), new Response(update.stderr).text(), update.exited]);
    expect(updateCode, `${updateOut}\n${updateErr}`).toBe(0);
    const updateJson = JSON.parse(updateOut);
    expect(updateJson, `update stdout:\n${updateOut}\nupdate stderr:\n${updateErr}`).toMatchObject({ updated: true, previousVersion: "1.10.0", installedVersion: "1.10.1" });
    expect(mcp.exitCode).toBeNull();
    const uninstall = Bun.spawn([launcher, "uninstall", "--json"], { cwd: home, env: { ...env, NODE_ENV: "test", FORGE614_TEST_RAW_ERRORS: "1" }, stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(120_000) });
    const [uninstallOut, uninstallErr, uninstallCode] = await Promise.all([new Response(uninstall.stdout).text(), new Response(uninstall.stderr).text(), uninstall.exited]);
    let uninstallDiagnostics = "";
    if (uninstallCode !== 0) {
      const listingAndProcess = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `
        $root = '${join(forgeHome, "engram").replace(/'/g, "''")}';
        $bin = Join-Path $root 'bin';
        "ENGRAM FILES:";
        if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Recurse -Force | ForEach-Object { if (-not $_.PSIsContainer) { "{0}{1}{2}" -f $_.FullName, [char]9, $_.Length } } } else { '(carpeta ausente)' };
        "MCP PROCESS:";
        Get-Process -Id ${mcp.pid} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress;
        "TRY REMOVE OLD EXECUTABLES:";
        Get-ChildItem -LiteralPath $bin -Filter '.old-*' -File -ErrorAction SilentlyContinue | ForEach-Object {
          "Remove-Item: $($_.FullName)";
          $errorCount = $Error.Count;
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Continue;
          if ($Error.Count -gt $errorCount) { $Error[0].Exception.ToString(); $Error[0] | Format-List * -Force | Out-String }
        };
      `], { stdout: "pipe", stderr: "pipe" });
      uninstallDiagnostics = `\nDIAGNÓSTICO WINDOWS:\n${listingAndProcess.stdout.toString()}\nPowerShell stderr:\n${listingAndProcess.stderr.toString()}\nERROR ORIGINAL DEL CLI:\n${uninstallErr}`;
      console.error(uninstallDiagnostics);
    }
    expect(uninstallCode, `${uninstallOut}\n${uninstallErr}${uninstallDiagnostics}`).toBe(0);
    expect(JSON.parse(uninstallOut).result).toMatchObject({ removed: false, pendingRemoval: true, memoryKept: true });
    expect(existsSync(join(forgeHome, "memory", "engram.db"))).toBe(true);
  } finally { await stopMcp(mcp); }
}, 120_000);
