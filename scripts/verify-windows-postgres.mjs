/**
 * Comprobación previa (preflight) de PostgreSQL en Windows para la CI.
 * Verifica que el binario de PostgreSQL configurado en el entorno sea capaz
 * de inicializar y arrancar un clúster desechable en loopback (127.0.0.1)
 * usando la carpeta temporal del runner, y cerrarlo limpiamente.
 * Si falla, termina con código 1 e imprime la razón pública de error,
 * sin imprimir URLs con credenciales ni exponer secretos.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  postgresBinaryName,
  startPostgresCluster,
  stopPostgresCluster,
} from "../src/infrastructure/__test-support__/postgres.ts";

if (process.platform !== "win32") {
  console.error("Este script de verificación está diseñado exclusivamente para Windows (process.platform !== 'win32').");
  process.exit(1);
}

const bin = process.env.FORGE614_TEST_POSTGRES_BIN;
if (!bin) {
  console.error("PostgreSQL preflight failed: FORGE614_TEST_POSTGRES_BIN environment variable is not set.");
  process.exit(1);
}

console.log(`Starting disposable PostgreSQL preflight cluster using binaries in: ${bin}`);

let cluster;
try {
  cluster = startPostgresCluster();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown startup failure";
  console.error(`PostgreSQL preflight failed: ${message}`);
  process.exit(1);
}

if (!cluster.available) {
  console.error(`PostgreSQL preflight failed: ${cluster.reason}`);
  process.exit(1);
}

// Obtener versión pública del ejecutable para diagnóstico (sin credenciales ni URLs)
let versionText = "unknown";
try {
  const exePath = join(cluster.bin, postgresBinaryName("postgres"));
  const res = spawnSync(exePath, ["--version"], { encoding: "utf8" });
  if (res.status === 0 && res.stdout) {
    versionText = res.stdout.trim();
  }
} catch {
  // Mejor esfuerzo para la versión
}

console.log(`Disposable PostgreSQL cluster started and verified successfully (${versionText})`);

try {
  stopPostgresCluster(cluster);
  console.log("Disposable PostgreSQL cluster stopped successfully.");
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown stop failure";
  console.error(`Error stopping disposable PostgreSQL cluster: ${message}`);
  process.exit(1);
}

console.log("PostgreSQL preflight check PASSED.");
process.exit(0);
