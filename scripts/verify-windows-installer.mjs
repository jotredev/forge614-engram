/**
 * Prueba nativa de Windows para T4: (a) instalación limpia, (b) repetición y Force,
 * (c) huella, (d) fallo de Shell, (e) entradas inseguras y (f) uninstall con User Path.
 * Existe para ejercer PowerShell 5.1, el registro del usuario y un exe real en el runner.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "win32") {
  throw new Error("Este script de verificación se ejecuta exclusivamente en Windows.");
}

const runnerTemp = process.env.RUNNER_TEMP ?? tmpdir();
const root = join(runnerTemp, "forge614-engram-installer");
const home = join(root, "home");
const asset = join(root, "forge614-engram-windows-x64.exe");
const checksum = join(root, "SHA256SUMS");
const shellInstaller = join(root, "shell-installer.ps1");
const enginesInstaller = join(root, "engines-installer.ps1");
let checksumIsInvalid = false;

/** Falla la prueba con una explicación cuando una condición de integración no se cumple. */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Ejecuta un proceso nativo con texto UTF-8 para conservar su salida de diagnóstico. */
function run(file, args, options = {}) {
  return spawnSync(file, args, { encoding: "utf8", ...options });
}

/** Lee User Path como UTF-16LE codificado para no perder caracteres del registro. */
function userPath() {
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$v=[Environment]::GetEnvironmentVariable('Path','User');if($null -ne $v){[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v))}"]);
  assert(result.status === 0, `No se pudo leer User Path: ${result.stderr}`);
  return result.stdout.trim() ? Buffer.from(result.stdout.trim(), "base64").toString("utf16le") : "";
}

/** Restaura User Path en finally, compatible con la sintaxis de PowerShell 5.1. */
function setUserPath(value) {
  const command = "$b=[Console]::In.ReadToEnd().Trim();if($b){$v=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b))}else{$v=''};[Environment]::SetEnvironmentVariable('Path',$v,'User')";
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { input: Buffer.from(value, "utf16le").toString("base64") });
  assert(result.status === 0, `No se pudo restaurar User Path: ${result.stderr}`);
}

/** Cuenta una entrada PATH normalizada para detectar duplicados y validar uninstall. */
function countPathEntry(value, target) {
  const normalized = target.replace(/[\\/]+$/, "").toLowerCase();
  return value.split(";").filter(entry => entry.trim().replace(/[\\/]+$/, "").toLowerCase() === normalized).length;
}

/** Compila el exe y crea instaladores falsos compatibles con PowerShell 5.1. */
function writeFixtures() {
  mkdirSync(root, { recursive: true });
  execFileSync("bun", ["build", "./src/cli.ts", "--compile", "--target=bun-windows-x64", "--outfile", asset]);
  writeFileSync(checksum, `${createHash("sha256").update(readFileSync(asset)).digest("hex")}  forge614-engram-windows-x64.exe\n`);
  const installer = "$ErrorActionPreference='Stop';$forgeHome=$env:FORGE614_HOME;$kind=$args[0];$bin=Join-Path (Join-Path $forgeHome $kind) 'bin';New-Item -ItemType Directory -Force -Path $bin|Out-Null;New-Item -ItemType File -Force -Path (Join-Path $bin ('forge614-'+$kind+$(if($kind -eq 'shell'){'.cmd'}else{'.exe'})))|Out-Null";
  writeFileSync(shellInstaller, "$ErrorActionPreference='Stop';if($env:FORGE614_TEST_SHELL_FAIL -eq '1'){exit 9};" + installer.replace("$kind=$args[0]", "$kind='shell'"));
  writeFileSync(enginesInstaller, installer.replace("$kind=$args[0]", "$kind='engines'"));
}

/** Sirve una release loopback para que el instalador nunca consulte red externa en CI. */
async function serveRelease() {
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === "/repos/jotredev/forge614-engram/releases/latest") {
      const base = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ assets: [
        { name: "forge614-engram-windows-x64.exe", browser_download_url: `${base}/forge614-engram-windows-x64.exe` },
        { name: "SHA256SUMS", browser_download_url: `${base}/SHA256SUMS` },
      ] }));
      return;
    }
    if (path === "/forge614-engram-windows-x64.exe" || path === "/SHA256SUMS") {
      const manifest = readFileSync(checksum, "utf8");
      const invalidManifest = manifest[0] === "0" ? `1${manifest.slice(1)}` : `0${manifest.slice(1)}`;
      response.end(path === "/SHA256SUMS" && checksumIsInvalid ? invalidManifest : (path === "/SHA256SUMS" ? manifest : readFileSync(asset)));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** Ejecuta install.ps1 con fixtures locales y permite variar una condición por caso. */
function install(baseUrl, extra = {}, arguments_ = []) {
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install.ps1", ...arguments_], { env: {
    ...process.env, FORGE614_HOME: home, FORGE614_ENGRAM_INSTALLER_TEST: "1",
    FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: baseUrl,
    FORGE614_SHELL_INSTALLER_TEST_URL: `file:///${shellInstaller.replace(/\\/g, "/")}`,
    FORGE614_ENGINES_INSTALLER_TEST_URL: `file:///${enginesInstaller.replace(/\\/g, "/")}`,
    ...extra,
  } });
}

/** Espera la retirada diferida del exe que programa uninstall antes de afirmar el resultado. */
async function waitForRemoval(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!existsSync(path)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`La desinstalación no retiró ${path} dentro del tiempo límite.`);
}

const originalPath = userPath();
let server;
try {
  rmSync(root, { recursive: true, force: true });
  writeFixtures();
  server = await serveRelease();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const bin = join(home, "engram", "bin");
  const installed = join(bin, "forge614-engram.exe");

  const clean = install(baseUrl);
  assert(clean.status === 0, `La instalación limpia falló: ${clean.stderr}`);
  assert(existsSync(installed), "La instalación limpia no creó el ejecutable.");
  assert(run(installed, ["--version"]).status === 0, "El ejecutable instalado no respondió a --version.");
  assert(clean.stdout.includes("Installed:") && clean.stdout.includes("init --product engram"), "Falta el resultado o siguiente paso.");
  assert(countPathEntry(userPath(), bin) === 1, "La instalación limpia no publicó una sola entrada PATH.");

  const repeated = install(baseUrl);
  assert(repeated.status !== 0 && existsSync(installed), "La repetición sin -Force debió fallar sin alterar el destino.");
  const forced = install(baseUrl, {}, ["-Force"]);
  assert(forced.status === 0 && countPathEntry(userPath(), bin) === 1, "-Force no reemplazó sin duplicar PATH.");

  rmSync(home, { recursive: true, force: true });
  checksumIsInvalid = true;
  const badChecksum = install(baseUrl);
  assert(badChecksum.status !== 0 && !existsSync(installed) && !existsSync(join(home, "shell")) && !existsSync(join(home, "engines")), "Una huella incorrecta debió fallar antes de crear Engram o dependencias.");
  checksumIsInvalid = false;
  rmSync(home, { recursive: true, force: true });
  const shellFailure = install(baseUrl, { FORGE614_TEST_SHELL_FAIL: "1" });
  assert(shellFailure.status !== 0 && !existsSync(installed) && !existsSync(join(home, "engines")), "Una falla de Shell debió dejar Engram y Engines sin crear.");
  const invalidFixture = install(baseUrl, { FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: "http://example.invalid" });
  assert(invalidFixture.status !== 0 && !existsSync(installed), "Una URL de prueba no loopback debió fallar antes de crear destino.");
  const withoutSentinel = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install.ps1"], { env: { ...process.env, FORGE614_HOME: home, FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: baseUrl } });
  assert(withoutSentinel.status !== 0 && !existsSync(installed), "La URL de fixture sin centinela debió fallar sin crear destino.");
  const relative = install(baseUrl, { FORGE614_HOME: "relative-home" });
  assert(relative.status !== 0, "FORGE614_HOME relativo debió fallar.");

  const restored = install(baseUrl);
  assert(restored.status === 0 && existsSync(installed), "No se pudo restaurar una instalación válida para desinstalar.");
  const uninstall = run(installed, ["uninstall", "--confirm", "REMOVE FORGE614-ENGRAM"], { input: "y\n", env: { ...process.env, FORGE614_HOME: home, FORGE614_TEST_UNINSTALL_TEMP_ROOT: join(runnerTemp, "forge614-engram-installer-uninstall") } });
  assert(uninstall.status === 0, `La desinstalación falló: ${uninstall.stderr}`);
  await waitForRemoval(installed);
  assert(countPathEntry(userPath(), bin) === 0, "La desinstalación no retiró la entrada exacta de PATH.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  setUserPath(originalPath);
  rmSync(root, { recursive: true, force: true });
}
