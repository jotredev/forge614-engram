/**
 * Diagnóstico acotado de tests/e2e/postgres-sync.test.ts con límite externo estricto de 120s.
 * Ejecuta el archivo de prueba de forma aislada, transmitiendo salida en tiempo real.
 * Si el proceso hijo excede el tiempo límite (120s por defecto, configurable vía FORGE614_DIAGNOSE_TIMEOUT_MS),
 * lo termina explícitamente (matando el árbol de procesos en Windows) y falla con código 1
 * para no depender exclusivamente del timeout de bun:test.
 */
import { spawn, spawnSync } from "node:child_process";

const TIMEOUT_MS = Number(process.env.FORGE614_DIAGNOSE_TIMEOUT_MS ?? 120_000);
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) {
  console.error("[diagnose-postgres-sync] FORGE614_DIAGNOSE_TIMEOUT_MS debe ser un número positivo y finito.");
  process.exit(1);
}

console.log(`[diagnose-postgres-sync] Iniciando ejecución aislada de tests/e2e/postgres-sync.test.ts (límite externo: ${TIMEOUT_MS / 1000}s)...`);

const startTime = Date.now();
const child = spawn("bun", ["test", "tests/e2e/postgres-sync.test.ts"], {
  stdio: "inherit",
  env: process.env,
});

let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`[diagnose-postgres-sync] TIEMPO LÍMITE EXCEDIDO: tests/e2e/postgres-sync.test.ts no terminó tras ${elapsed}s.`);
  console.error(`[diagnose-postgres-sync] Terminando proceso hijo (PID ${child.pid})...`);

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", timeout: 5_000 });
    } catch {
      // Mejor esfuerzo en Windows
    }
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // Proceso ya terminado
  }
}, TIMEOUT_MS);

child.on("error", (err) => {
  clearTimeout(timer);
  console.error(`[diagnose-postgres-sync] Error al lanzar el proceso hijo: ${err.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (timedOut) {
    console.error(`[diagnose-postgres-sync] FALLO: tests/e2e/postgres-sync.test.ts cancelado por tiempo límite tras ${elapsed}s.`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`[diagnose-postgres-sync] FALLO: tests/e2e/postgres-sync.test.ts terminó con código ${code} (${signal ?? "sin señal"}) tras ${elapsed}s.`);
    process.exit(code ?? 1);
  }
  console.log(`[diagnose-postgres-sync] ÉXITO: tests/e2e/postgres-sync.test.ts completado limpiamente con código 0 en ${elapsed}s.`);
  process.exit(0);
});
