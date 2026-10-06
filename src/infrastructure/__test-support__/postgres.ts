/**
 * Levanta y detiene un clúster de PostgreSQL desechable en `localhost`, solo para las pruebas de
 * integración que necesitan una base real (no simulada); si el binario configurado en
 * `FORGE614_TEST_POSTGRES_BIN` no está disponible, informa que el clúster no se pudo levantar en vez de
 * fallar la suite entera. La usan `src/app/__tests__/postgres-sync.integration.test.ts` y
 * `src/infrastructure/postgres/replica.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const postgresTestTimeoutMs = 30_000;

/** Resultado de intentar levantar el clúster de pruebas: sus datos de conexión, o por qué no se pudo levantar. */
export type PostgresCluster =
  | { available: true; directory: string; url: string; bin: string }
  | { available: false; reason: string };

/**
 * Ejecuta una herramienta de PostgreSQL (`initdb` o `pg_ctl`) y lanza si falla o excede el tiempo límite.
 * @param bin Carpeta de binarios de PostgreSQL (`FORGE614_TEST_POSTGRES_BIN`).
 * @param name Nombre del ejecutable dentro de esa carpeta.
 * @param args Argumentos de línea de comandos para el ejecutable.
 * @throws Error con el mensaje de error estándar del proceso, o indicando que se agotó el tiempo límite.
 */
function command(bin: string, name: string, args: string[]) {
  const result = spawnSync(join(bin, name), args, { encoding: "utf8", timeout: postgresTestTimeoutMs });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr?.trim();
  throw new Error(`${name} ${detail || "failed"}`);
}

/**
 * Levanta un clúster de PostgreSQL desechable, solo accesible por loopback (`127.0.0.1`), en una carpeta
 * temporal: crea la base con `initdb` y la arranca con `pg_ctl` en un puerto libre elegido al vuelo.
 * @param bin Carpeta de binarios de PostgreSQL a usar; por defecto, `FORGE614_TEST_POSTGRES_BIN`.
 * @returns Un {@link PostgresCluster} con sus datos de conexión si se levantó, o con el motivo por el que
 * no se pudo levantar (binario no configurado, o cualquier fallo al inicializar o arrancar), sin lanzar en
 * ese caso: un fallo al levantar el clúster se convierte en una razón visible para omitir la suite, no en
 * un error de la suite.
 */
export function startPostgresCluster(bin = process.env.FORGE614_TEST_POSTGRES_BIN): PostgresCluster {
  if (!bin) return { available: false, reason: "FORGE614_TEST_POSTGRES_BIN is not configured" };
  const directory = mkdtempSync(join(tmpdir(), "engram-adapter-pg-"));
  let started = false;
  try {
    command(bin, "initdb", ["-D", join(directory, "data"), "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port; listener.stop(true);
    command(bin, "pg_ctl", ["-D", join(directory, "data"), "-l", join(directory, "log"), "-o", `-h 127.0.0.1 -p ${port} -k ${directory}`, "-w", "start"]);
    started = true;
    return { available: true, directory, url: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`, bin };
  } catch (error) {
    if (started) {
      try { command(bin, "pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"]); }
      catch { /* La instalación desechable que falló se elimina más abajo de todos modos. */ }
    }
    rmSync(directory, { recursive: true, force: true });
    return { available: false, reason: `PostgreSQL disposable fixture unavailable: ${error instanceof Error ? error.message : "unknown failure"}` };
  }
}

/**
 * Detiene un clúster levantado por {@link startPostgresCluster} y borra su carpeta temporal; no hace nada
 * si el clúster nunca llegó a levantarse.
 * @param cluster Resultado devuelto por {@link startPostgresCluster}.
 */
export function stopPostgresCluster(cluster: PostgresCluster) {
  if (!cluster.available) return;
  try { command(cluster.bin, "pg_ctl", ["-D", join(cluster.directory, "data"), "-m", "fast", "-w", "stop"]); }
  finally { rmSync(cluster.directory, { recursive: true, force: true }); }
}

/**
 * Levanta un clúster desechable, ejecuta la función dada con su URL de conexión y lo detiene al terminar;
 * si el clúster no está disponible, avisa por consola y omite la ejecución en vez de fallar. No la usa
 * ningún módulo del proyecto ni su propia prueba; las pruebas de integración llaman directamente a
 * {@link startPostgresCluster} y {@link stopPostgresCluster}.
 * @param run Función de prueba que recibe la URL de conexión al clúster.
 */
export async function withPostgres(run: (url: string) => Promise<void>): Promise<void> {
  const cluster = startPostgresCluster();
  if (!cluster.available) {
    console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
    return;
  }
  try { await run(cluster.url); }
  finally { stopPostgresCluster(cluster); }
}
