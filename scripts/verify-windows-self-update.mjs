/**
 * Prueba de integración para el relevo y actualización en Windows.
 * Verifica que `forge614-engram.exe update --json`, ejecutado desde el mismo
 * archivo que debe reemplazarse, programe el ayudante PowerShell vía WMI y que
 * este complete el reemplazo del ejecutable tras finalizar el proceso padre.
 */
import { createHash } from "node:crypto";
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

if (process.platform !== "win32") {
  console.error("Este script de verificación está diseñado exclusivamente para Windows (process.platform !== 'win32').");
  process.exit(1);
}

const runnerTemp = process.env.RUNNER_TEMP ?? tmpdir();
const diagLogPath = join(runnerTemp, "forge614-engram-self-update-diag.log");

// Vaciar archivo de diagnóstico al arrancar antes de escribir la primera línea
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
    // Registro de diagnóstico en modo mejor esfuerzo.
  }
}

diag("Iniciando scripts/verify-windows-self-update.mjs...");

const forgeHome = join(runnerTemp, "forge614-engram-self-update-home");
const tempRepo = join(runnerTemp, "forge614-engram-self-update-repo");
const launcherDir = join(forgeHome, "engram", "bin");
const launcherPath = join(launcherDir, "forge614-engram.exe");

// Limpiar restos previos si existieran
rmSync(forgeHome, { recursive: true, force: true });
rmSync(tempRepo, { recursive: true, force: true });

mkdirSync(forgeHome, { recursive: true });
mkdirSync(launcherDir, { recursive: true });

diag("Clonando repositorio localmente para aislar únicamente archivos versionados...");
execFileSync("git", ["clone", "--local", process.cwd(), tempRepo], {
  stdio: "inherit",
});
// Eliminar tempRepo/.git antes de instalar
rmSync(join(tempRepo, ".git"), { recursive: true, force: true });
diag("Copia aislada creada y .git eliminado.");

diag("Ejecutando bun install en la copia temporal...");
execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: tempRepo,
  stdio: "inherit",
});
diag("bun install finalizado.");

const pkgPath = join(tempRepo, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = "0.0.0";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
diag("package.json actualizado con versión 0.0.0 en el fixture.");

diag(`Compilando binario inicial en ${launcherPath}...`);
execFileSync(
  "bun",
  [
    "build",
    "./src/cli.ts",
    "--compile",
    "--target=bun-windows-x64",
    `--outfile=${launcherPath}`,
  ],
  {
    cwd: tempRepo,
    stdio: "inherit",
  },
);
diag("Compilación finalizada.");

if (!existsSync(launcherPath)) {
  diag("Error crítico: el ejecutable compilado no existe en destino.");
  process.exit(1);
}

const initialVersion = execFileSync(launcherPath, ["--version"], {
  encoding: "utf8",
  env: { ...process.env, FORGE614_HOME: forgeHome },
}).trim();
diag(`Versión reportada por el binario recién compilado: ${initialVersion}`);
if (initialVersion !== "forge614-engram 0.0.0") {
  diag(`Error: se esperaba 'forge614-engram 0.0.0' pero se obtuvo '${initialVersion}'.`);
  process.exit(1);
}

const initialHash = createHash("sha256").update(readFileSync(launcherPath)).digest("hex");
diag(`Huella SHA-256 inicial: ${initialHash}`);

diag("Lanzando proceso hijo real: forge614-engram.exe update --json...");
let child;
try {
  child = spawn(launcherPath, ["update", "--json"], {
    env: { ...process.env, FORGE614_HOME: forgeHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
      // Proceso ya terminado o no alcanzable
    }
    resolve({ type: "timeout", code: 1 });
  }, 60_000);

  child.on("error", (err) => {
    clearTimeout(timeoutId);
    diag(`Error en proceso hijo: ${err.message}`);
    resolve({ type: "error", error: err });
  });

  child.on("exit", (code) => {
    clearTimeout(timeoutId);
    resolve({ type: "exit", code: code ?? 1 });
  });
});

if (exitResult.type === "error") {
  diag(`Fallo de lanzamiento del proceso hijo: ${exitResult.error.message}`);
  process.exit(1);
}

if (exitResult.type === "timeout") {
  diag("Fallo: el proceso hijo agotó el tiempo límite de 60s (timeout).");
  if (stderr.trim()) diag(`Salida de error capturada antes del timeout: ${stderr.trim()}`);
  process.exit(1);
}

const exitCode = exitResult.code;
diag(`Proceso hijo finalizó con código: ${exitCode}`);
if (stderr.trim()) {
  diag(`Salida de error del hijo: ${stderr.trim()}`);
}
if (exitCode !== 0) {
  diag(`Fallo al ejecutar update --json (código no cero ${exitCode}). Salida estándar: ${stdout.trim()}`);
  process.exit(1);
}

let updateResult;
try {
  updateResult = JSON.parse(stdout.trim());
} catch (err) {
  diag(`Error al parsear salida JSON del hijo: ${err.message}`);
  diag(`Salida estándar recibida: ${stdout.trim()}`);
  process.exit(1);
}

diag(`Resultado estructurado recibido: ${JSON.stringify(updateResult)}`);

if (
  updateResult.updated !== false ||
  updateResult.previousVersion !== "0.0.0" ||
  updateResult.installedVersion !== "0.0.0" ||
  typeof updateResult.pendingVersion !== "string" ||
  updateResult.pendingVersion === "0.0.0" ||
  !updateResult.pendingVersion
) {
  diag(`Contrato de actualización inválido en la respuesta: ${JSON.stringify(updateResult)}`);
  process.exit(1);
}

const pendingVersion = updateResult.pendingVersion;
diag(`Versión pendiente programada para el relevo: ${pendingVersion}`);

diag("Esperando señal de relevo en el log del ayudante PowerShell (hasta 60s)...");
const engramHome = join(forgeHome, "engram");
const deadline = Date.now() + 60_000;
let swapCompleted = false;

while (Date.now() < deadline) {
  try {
    if (existsSync(engramHome)) {
      const entries = readdirSync(engramHome);
      const helperLogs = entries.filter((e) => e.startsWith("swap-helper-") && e.endsWith(".log") && !e.endsWith(".spawn.log"));
      if (helperLogs.length > 0) {
        const content = readFileSync(join(engramHome, helperLogs[0]), "utf8");
        if (content.includes("swap succeeded")) {
          swapCompleted = true;
          diag(`Señal 'swap succeeded' observada en ${helperLogs[0]}`);
          break;
        }
      }
    }
  } catch {
    // Reintentar si el archivo de log está momentáneamente ocupado
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!swapCompleted) {
  diag("Tiempo de espera agotado (60s) sin observar 'swap succeeded' en el log del ayudante.");
  try {
    if (existsSync(engramHome)) {
      const entries = readdirSync(engramHome);
      diag(`Archivos encontrados en engram/: ${entries.join(", ") || "(vacío)"}`);
      for (const entry of entries) {
        if (entry.endsWith(".log")) {
          const logContent = readFileSync(join(engramHome, entry), "utf8");
          const lastLines = logContent.trim().split(/\r?\n/).slice(-10).join("\n");
          diag(`Últimas líneas de ${entry}:\n${lastLines}`);
        }
      }
    } else {
      diag(`El directorio ${engramHome} no existe.`);
    }
  } catch (err) {
    diag(`Error al volcar diagnóstico de logs: ${err.message}`);
  }
  process.exit(1);
}

// Ahora que el ayudante confirmó el swap, verificar el ejecutable una sola vez
diag("Comprobando huella SHA-256 del ejecutable activo tras la señal del ayudante...");
if (!existsSync(launcherPath)) {
  diag(`Error: el ejecutable ${launcherPath} no existe tras el relevo.`);
  process.exit(1);
}

const currentHash = createHash("sha256").update(readFileSync(launcherPath)).digest("hex");
diag(`Huella SHA-256 post-reemplazo: ${currentHash}`);
if (currentHash === initialHash) {
  diag("Error: la huella SHA-256 del ejecutable activo no cambió respecto a la inicial.");
  process.exit(1);
}

diag("Comprobando --version del ejecutable tras el relevo (una sola ejecución)...");
let finalVersionOutput;
try {
  finalVersionOutput = execFileSync(launcherPath, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, FORGE614_HOME: forgeHome },
  }).trim();
} catch (err) {
  diag(`Error al ejecutar --version del binario reemplazado: ${err.message}`);
  process.exit(1);
}

diag(`Salida de --version post-reemplazo: ${finalVersionOutput}`);
const expectedVersionOutput = `forge614-engram ${pendingVersion}`;
if (finalVersionOutput !== expectedVersionOutput) {
  diag(`Discrepancia en versión: se esperaba '${expectedVersionOutput}' pero se obtuvo '${finalVersionOutput}'.`);
  process.exit(1);
}

diag("Comprobando limpieza de carpetas de paso engram/update-*...");
const entries = readdirSync(engramHome);
const stagingDirs = entries.filter((e) => e.startsWith("update-"));
if (stagingDirs.length > 0) {
  diag(`Error: carpetas temporales de paso pendientes en ${engramHome}: ${stagingDirs.join(", ")}`);
  process.exit(1);
}
diag("Limpieza de carpetas de paso confirmada.");

diag("Verificando registros generados en engram/...");
const helperLogs = entries.filter((e) => e.startsWith("swap-helper-") && e.endsWith(".log") && !e.endsWith(".spawn.log"));
const spawnLogs = entries.filter((e) => e.startsWith("swap-helper-") && e.endsWith(".spawn.log"));

if (helperLogs.length === 0) {
  diag("Error: no se encontró archivo de registro del ayudante (swap-helper-*.log).");
  process.exit(1);
}
if (spawnLogs.length === 0) {
  diag("Error: no se encontró archivo de registro de WMI (swap-helper-*.spawn.log).");
  process.exit(1);
}

const helperLogContent = readFileSync(join(engramHome, helperLogs[0]), "utf8");
const spawnLogContent = readFileSync(join(engramHome, spawnLogs[0]), "utf8");

if (!spawnLogContent.includes("Win32_Process.Create succeeded")) {
  diag("Error: el log WMI no indica 'Win32_Process.Create succeeded'.");
  diag(`Contenido del log WMI:\n${spawnLogContent}`);
  process.exit(1);
}
diag("Log WMI confirmado con 'Win32_Process.Create succeeded'.");

if (!helperLogContent.includes("swap succeeded")) {
  diag("Error: el log del ayudante no indica 'swap succeeded'.");
  diag(`Contenido del log del ayudante:\n${helperLogContent}`);
  process.exit(1);
}
diag("Log del ayudante confirmado con 'swap succeeded'.");

diag("Relevo nativo de Windows verificado exitosamente.");
process.exit(0);
