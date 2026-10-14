/**
 * Prueba nativa de Windows para T4: (a) instalación limpia, (b) repetición y Force,
 * (c) huella, (d) fallo de Shell, (e) entradas inseguras y (f) uninstall con User Path.
 * Existe para ejercer PowerShell 5.1, el registro del usuario y un exe real en el runner.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/** Ejecuta un instalador sin bloquear el servidor loopback y limita cada caso a 120 segundos. */
function runAsync(caseName, arguments_, options, executable = "powershell.exe") {
  console.log(`[${caseName}] inicio`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install.ps1", ...arguments_], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`[${caseName}] excedió el límite de 120 s.`)); }, 120_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => {
      clearTimeout(timeout);
      const lines = stderr.trim().split("\n");
      const first = lines.slice(0, 3).join("\n");
      const tail = lines.slice(-3).join("\n");
      console.log(`[${caseName}] fin: código ${status}${status === 0 ? "" : `; stderr inicial: ${first}; stderr final: ${tail}`}`);
      resolve({ status, stdout, stderr });
    });
  });
}

/** Ejecuta install.ps1 con fixtures locales y permite variar una condición por caso. */
function install(caseName, baseUrl, extra = {}, arguments_ = [], executable = "powershell.exe") {
  return runAsync(caseName, arguments_, { env: {
    ...process.env, FORGE614_HOME: home, FORGE614_ENGRAM_INSTALLER_TEST: "1",
    FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: baseUrl,
    FORGE614_SHELL_INSTALLER_TEST_URL: `file:///${shellInstaller.replace(/\\/g, "/")}`,
    FORGE614_ENGINES_INSTALLER_TEST_URL: `file:///${enginesInstaller.replace(/\\/g, "/")}`,
    ...extra,
  } }, executable);
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

  const clean = await install("a instalación limpia", baseUrl);
  assert(clean.status === 0, `La instalación limpia falló: ${clean.stderr}`);
  assert(existsSync(installed), "La instalación limpia no creó el ejecutable.");
  assert(run(installed, ["--version"]).status === 0, "El ejecutable instalado no respondió a --version.");
  assert(clean.stdout.includes("Installed:") && clean.stdout.includes("init --product engram"), "Falta el resultado o siguiente paso.");
  assert(countPathEntry(userPath(), bin) === 1, "La instalación limpia no publicó una sola entrada PATH.");

  const repeated = await install("b repetición sin Force", baseUrl);
  assert(repeated.status !== 0 && existsSync(installed), "La repetición sin -Force debió fallar sin alterar el destino.");
  const forced = await install("b reemplazo con Force", baseUrl, {}, ["-Force"]);
  assert(forced.status === 0 && countPathEntry(userPath(), bin) === 1, "-Force no reemplazó sin duplicar PATH.");

  rmSync(home, { recursive: true, force: true });
  checksumIsInvalid = true;
  const badChecksum = await install("c huella inválida", baseUrl);
  assert(badChecksum.status !== 0 && !existsSync(installed) && !existsSync(join(home, "shell")) && !existsSync(join(home, "engines")), "Una huella incorrecta debió fallar antes de crear Engram o dependencias.");
  checksumIsInvalid = false;
  rmSync(home, { recursive: true, force: true });
  const shellFailure = await install("d fallo de Shell", baseUrl, { FORGE614_TEST_SHELL_FAIL: "1" });
  assert(shellFailure.status !== 0 && !existsSync(installed) && !existsSync(join(home, "engines")), "Una falla de Shell debió dejar Engram y Engines sin crear.");
  const invalidFixture = await install("e URL no loopback", baseUrl, { FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: "http://example.invalid" });
  assert(invalidFixture.status !== 0 && !existsSync(installed), "Una URL de prueba no loopback debió fallar antes de crear destino.");
  const withoutSentinel = await runAsync("sin centinela", [], { env: { ...process.env, FORGE614_HOME: home, FORGE614_ENGRAM_TEST_RELEASE_BASE_URL: baseUrl } });
  assert(withoutSentinel.status !== 0 && !existsSync(installed), "La URL de fixture sin centinela debió fallar sin crear destino.");
  const relative = await install("e FORGE614_HOME relativo", baseUrl, { FORGE614_HOME: "relative-home" });
  assert(relative.status !== 0, "FORGE614_HOME relativo debió fallar.");

  const restored = await install("f preparación de uninstall", baseUrl);
  assert(restored.status === 0 && existsSync(installed), "No se pudo restaurar una instalación válida para desinstalar.");
  console.log("[h exe en uso] inicio");
  const heldExe = spawn(installed, ["mcp"], { env: { ...process.env, FORGE614_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  let heldExited = false;
  heldExe.once("exit", () => { heldExited = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 250));
    assert(heldExe.exitCode === null, "forge614-engram mcp no permaneció activo con stdin abierto.");
    const inUse = await install("h reemplazo con exe abierto", baseUrl, {}, ["-Force"]);
    assert(inUse.status === 0, "-Force no reemplazó el exe mientras mcp seguía abierto.");
    assert(heldExe.exitCode === null && !heldExited, "El proceso mcp abierto terminó durante el reemplazo.");
    assert(run(installed, ["--version"]).status === 0, "El exe reemplazado no respondió a --version.");
    assert(countPathEntry(userPath(), bin) === 1, "El reemplazo con exe abierto duplicó o alteró PATH.");
    assert(!readdirSync(bin).some(name => /^\.forge614-engram-.*\.tmp$/.test(name)), "El reemplazo con exe abierto dejó temporales en bin.");
  } finally {
    if (heldExe.exitCode === null) {
      heldExe.kill();
      await new Promise(resolve => heldExe.once("close", resolve));
    }
    console.log("[h exe en uso] fin");
  }
  console.log("[f uninstall] inicio");
  const uninstall = run(installed, ["uninstall", "--confirm", "REMOVE FORGE614-ENGRAM"], { input: "y\n", env: { ...process.env, FORGE614_HOME: home, FORGE614_TEST_UNINSTALL_TEMP_ROOT: join(runnerTemp, "forge614-engram-installer-uninstall") } });
  console.log(`[f uninstall] fin: código ${uninstall.status}`);
  assert(uninstall.status === 0, `La desinstalación falló: ${uninstall.stderr}`);
  await waitForRemoval(installed);
  assert(countPathEntry(userPath(), bin) === 0, "La desinstalación no retiró la entrada exacta de PATH.");

  if (!Bun.which("pwsh.exe")) throw new Error("pwsh.exe es obligatorio para verificar PowerShell 7 en Windows.");
  const pwshHome = join(root, "pwsh-home");
  const pwshBin = join(pwshHome, "engram", "bin");
  const pwshInstalled = join(pwshBin, "forge614-engram.exe");
  const pwshClean = await install("g instalación limpia con PowerShell 7", baseUrl, { FORGE614_HOME: pwshHome }, [], "pwsh.exe");
  assert(pwshClean.status === 0 && existsSync(pwshInstalled), "PowerShell 7 no completó la instalación limpia.");
  assert(run(pwshInstalled, ["--version"]).status === 0, "El exe instalado con PowerShell 7 no respondió a --version.");
  assert(pwshClean.stdout.includes("init --product engram") && countPathEntry(userPath(), pwshBin) === 1, "PowerShell 7 no publicó una sola entrada PATH o el siguiente paso.");
  console.log("[g uninstall PowerShell 7] inicio");
  const pwshUninstall = run(pwshInstalled, ["uninstall", "--confirm", "REMOVE FORGE614-ENGRAM"], { input: "y\n", env: { ...process.env, FORGE614_HOME: pwshHome, FORGE614_TEST_UNINSTALL_TEMP_ROOT: join(runnerTemp, "forge614-engram-installer-pwsh-uninstall") } });
  console.log(`[g uninstall PowerShell 7] fin: código ${pwshUninstall.status}`);
  assert(pwshUninstall.status === 0, `La desinstalación de PowerShell 7 falló: ${pwshUninstall.stderr}`);
  await waitForRemoval(pwshInstalled);
  assert(countPathEntry(userPath(), pwshBin) === 0, "La desinstalación de PowerShell 7 no retiró su entrada PATH.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  setUserPath(originalPath);
  rmSync(root, { recursive: true, force: true });
}
