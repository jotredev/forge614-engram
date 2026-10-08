/**
 * Prueba de integración para la desinstalación nativa en Windows.
 * Verifica que `forge614-engram.exe uninstall --confirm ...`, ejecutado desde el propio
 * ejecutable instalado, devuelva `pendingRemoval: true` y programe el ayudante PowerShell
 * mediante WMI para borrar la carpeta `engram/` tras salir el proceso, preservando la carpeta hermana `shell/`.
 * También verifica la lectura y escritura real de User Path sin inyecciones sobre el runner.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removePathPublication } from "../src/infrastructure/filesystem/path-publication.ts";

if (process.platform !== "win32") {
  console.error("Este script de verificación está diseñado exclusivamente para Windows (process.platform !== 'win32').");
  process.exit(1);
}

const runnerTemp = process.env.RUNNER_TEMP ?? tmpdir();
const diagLogPath = join(runnerTemp, "forge614-engram-uninstall-diag.log");

try {
  writeFileSync(diagLogPath, "", "utf8");
} catch {
  // Ignorar si la ruta no está disponible todavía
}

function diag(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(diagLogPath, `${line}\n`, "utf8");
  } catch {
    // Registro de diagnóstico en modo mejor esfuerzo
  }
}

diag("Iniciando scripts/verify-windows-uninstall.mjs...");

/**
 * Verifica la lectura y escritura real en User Path sin inyectar dependencias,
 * garantizando la restauración del valor original en el bloque finally.
 */
async function verifyNativeWindowsUserPath() {
  diag("Iniciando comprobación nativa de ida y vuelta de User Path en Windows...");
  const tempPathDir = join(runnerTemp, "forge614-engram-test-userpath");
  const testTargetDir = join(tempPathDir, "engram", "bin");
  const testSimilarDir = join(tempPathDir, "engram", "bin-extra");

  rmSync(tempPathDir, { recursive: true, force: true });
  mkdirSync(testTargetDir, { recursive: true });
  mkdirSync(testSimilarDir, { recursive: true });

  // 1. Guardar valor original de User Path mediante PowerShell estático en base64
  let originalPath = "";
  try {
    const raw = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$v = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($null -ne $v) { [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($v)) }",
    ], { encoding: "utf8" }).trim();
    originalPath = raw ? Buffer.from(raw, "base64").toString("utf16le") : "";
  } catch (err) {
    diag(`Error al leer User Path original: ${err.message}`);
    throw err;
  }

  try {
    // 2. Establecer User Path temporal agregando ruta objetivo y prefijo similar
    const modifiedPath = originalPath ? `${originalPath};${testTargetDir};${testSimilarDir}` : `${testTargetDir};${testSimilarDir}`;
    const modifiedB64 = Buffer.from(modifiedPath, "utf16le").toString("base64");
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$b = [Console]::In.ReadToEnd().Trim(); $bytes = [Convert]::FromBase64String($b); $val = [System.Text.Encoding]::Unicode.GetString($bytes); [Environment]::SetEnvironmentVariable('Path', $val, 'User')",
    ], { input: modifiedB64, encoding: "utf8" });

    diag("User Path temporal establecido con ruta objetivo y prefijo similar.");

    // 3. Ejecutar removePathPublication de producción sin inyectar lectura ni escritura
    const removedResult = await removePathPublication({
      home: tempPathDir,
      binDirectory: testTargetDir,
      platform: "win32",
    });

    if (removedResult.length !== 1 || removedResult[0] !== "User Path") {
      throw new Error(`removePathPublication no reportó ["User Path"]: ${JSON.stringify(removedResult)}`);
    }

    // 4. Leer User Path resultante y verificar que solo desapareció la ruta exacta
    const updatedRaw = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$v = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($null -ne $v) { [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($v)) }",
    ], { encoding: "utf8" }).trim();
    const updatedPath = updatedRaw ? Buffer.from(updatedRaw, "base64").toString("utf16le") : "";

    const elements = updatedPath.split(";").map(e => e.trim().toLowerCase());
    const targetNorm = testTargetDir.toLowerCase();
    const similarNorm = testSimilarDir.toLowerCase();

    if (elements.includes(targetNorm)) {
      throw new Error("Fallo: la ruta objetivo sigue presente en User Path después de removePathPublication.");
    }
    if (!elements.includes(similarNorm)) {
      throw new Error("Fallo: la ruta similar bin-extra fue erróneamente eliminada de User Path.");
    }

    diag("Comprobación nativa de User Path completada exitosamente: solo se eliminó la ruta exacta.");
  } finally {
    // 5. Garantizar restauración del User Path original
    diag("Restaurando User Path original...");
    let restoreFailure;
    try {
      const restoreB64 = Buffer.from(originalPath, "utf16le").toString("base64");
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$b = [Console]::In.ReadToEnd().Trim(); if ($b) { $bytes = [Convert]::FromBase64String($b); $val = [System.Text.Encoding]::Unicode.GetString($bytes); [Environment]::SetEnvironmentVariable('Path', $val, 'User') } else { [Environment]::SetEnvironmentVariable('Path', '', 'User') }",
      ], { input: restoreB64, encoding: "utf8" });
      diag("User Path original restaurado con éxito.");
    } catch (restoreErr) {
      diag(`Error crítico al restaurar User Path original: ${restoreErr.message}`);
      restoreFailure = restoreErr;
    }
    rmSync(tempPathDir, { recursive: true, force: true });
    if (restoreFailure) throw restoreFailure;
  }
}

await verifyNativeWindowsUserPath();

const forgeHome = join(runnerTemp, "forge614-engram-uninstall-home");
const engramDir = join(forgeHome, "engram");
const binDir = join(engramDir, "bin");
const launcherPath = join(binDir, "forge614-engram.exe");
const shellDir = join(forgeHome, "shell");
const shellMarker = join(shellDir, "keep.txt");
const uninstallTempDir = join(runnerTemp, "forge614-engram-uninstall-temp");

rmSync(forgeHome, { recursive: true, force: true });
rmSync(uninstallTempDir, { recursive: true, force: true });

mkdirSync(forgeHome, { recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(shellDir, { recursive: true });
mkdirSync(uninstallTempDir, { recursive: true });
writeFileSync(shellMarker, "keep shell intact", "utf8");

diag(`Compilando ejecutable de prueba en ${launcherPath}...`);
execFileSync(
  "bun",
  [
    "build",
    "./scripts/fixtures/windows-uninstall-entry.mjs",
    "--compile",
    "--target=bun-windows-x64",
    `--outfile=${launcherPath}`,
  ],
  { stdio: "inherit" },
);
diag("Compilación completada.");

if (!existsSync(launcherPath)) {
  diag("Error crítico: el ejecutable compilado no existe.");
  process.exit(1);
}

diag("Lanzando proceso hijo real: forge614-engram.exe uninstall --confirm...");
let child;
try {
  child = spawn(
    launcherPath,
    ["uninstall", "--confirm", "REMOVE FORGE614-ENGRAM"],
    {
      env: {
        ...process.env,
        FORGE614_HOME: forgeHome,
        FORGE614_TEST_UNINSTALL_TEMP_ROOT: uninstallTempDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (err) {
  diag(`Fallo al lanzar el proceso hijo: ${err.message}`);
  process.exit(1);
}

diag(`Proceso hijo lanzado con PID ${child.pid}`);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

let timeoutId;
const exitResult = await new Promise((resolve) => {
  timeoutId = setTimeout(() => {
    diag("El proceso hijo no terminó dentro del tiempo límite de 60s; terminando.");
    try {
      child.kill();
    } catch {
      // Proceso ya terminado
    }
    resolve({ type: "timeout", code: 1 });
  }, 60_000);

  child.on("error", (err) => {
    clearTimeout(timeoutId);
    diag(`Error en proceso hijo: ${err.message}`);
    resolve({ type: "error", code: 1 });
  });

  child.on("close", (code) => {
    clearTimeout(timeoutId);
    resolve({ type: "exit", code });
  });
});

diag(`Proceso hijo terminado con código ${exitResult.code}`);
diag(`STDOUT:\n${stdout}`);
if (stderr) {
  diag(`STDERR:\n${stderr}`);
}

if (exitResult.code !== 0) {
  diag(`Error: el proceso hijo salió con código ${exitResult.code}`);
  process.exit(1);
}

let parsedResult;
try {
  parsedResult = JSON.parse(stdout);
} catch (err) {
  diag(`Error al analizar la salida JSON: ${err.message}`);
  process.exit(1);
}

if (parsedResult.removed !== false) {
  diag(`Error: se esperaba removed=false pero se obtuvo ${parsedResult.removed}`);
  process.exit(1);
}

if (parsedResult.pendingRemoval !== true) {
  diag(`Error: se esperaba pendingRemoval=true pero se obtuvo ${parsedResult.pendingRemoval}`);
  process.exit(1);
}

diag("Contrato JSON de desinstalación diferida verificado correctamente.");

diag("Esperando que el ayudante PowerShell complete el borrado diferido de engram/...");
const pollDeadline = Date.now() + 60_000;
let engramRemoved = false;

while (Date.now() < pollDeadline) {
  if (!existsSync(engramDir)) {
    engramRemoved = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!engramRemoved) {
  diag("Error: la carpeta engram/ no fue eliminada tras 60s.");
  process.exit(1);
}

diag("Confirmado: la carpeta engram/ fue eliminada.");

if (!existsSync(shellMarker)) {
  diag("Error: la carpeta hermana shell/ o su archivo marcador no se preservaron.");
  process.exit(1);
}

const markerContent = readFileSync(shellMarker, "utf8");
if (markerContent !== "keep shell intact") {
  diag(`Error: el contenido del marcador de shell fue alterado: '${markerContent}'`);
  process.exit(1);
}

diag("Confirmado: la carpeta hermana shell/ se conservó intacta.");

// Verificar logs aislados en uninstallTempDir
let foundWmiSuccess = false;
let foundHelperSuccess = false;

try {
  const files = readdirSync(uninstallTempDir);
  for (const file of files) {
    if (file.startsWith("forge614-engram-uninstall-") && file.endsWith(".spawn.log")) {
      const content = readFileSync(join(uninstallTempDir, file), "utf8");
      if (content.includes("Win32_Process.Create succeeded")) {
        foundWmiSuccess = true;
        diag(`Log WMI verificado en ${file}: Win32_Process.Create succeeded`);
      }
    }
    if (file.startsWith("forge614-engram-uninstall-") && file.endsWith(".log") && !file.endsWith(".spawn.log")) {
      const content = readFileSync(join(uninstallTempDir, file), "utf8");
      if (content.includes("uninstall succeeded")) {
        foundHelperSuccess = true;
        diag(`Log del ayudante verificado en ${file}: uninstall succeeded`);
      }
    }
  }
} catch (e) {
  diag(`Error al leer logs en ${uninstallTempDir}: ${e.message}`);
}

if (!foundWmiSuccess) {
  diag("Error: no se encontró registro exitoso de Win32_Process.Create en los logs de spawn.");
  process.exit(1);
}

if (!foundHelperSuccess) {
  diag("Error: no se encontró registro exitoso de 'uninstall succeeded' en los logs del ayudante.");
  process.exit(1);
}

diag("Verificación nativa de desinstalación en Windows completada exitosamente.");
process.exit(0);
