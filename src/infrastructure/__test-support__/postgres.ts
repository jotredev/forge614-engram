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

/** Firma para ejecutar herramientas de PostgreSQL en el fixture de pruebas. */
export type PostgresSpawnFn = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; stdio: "pipe" | "ignore"; timeout: number },
) => {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
};

/** Opciones de configuración para {@link startPostgresCluster} y {@link stopPostgresCluster}. */
export interface PostgresClusterOptions {
  /** Plataforma objetivo (por defecto `process.platform`). */
  readonly platform?: string;
  /**
   * Si es `true`, exige que el clúster se levante con éxito o lanza un error en vez de devolver `available: false`.
   * Si se omite, se deduce de `FORGE614_REQUIRE_TEST_POSTGRES === "1"` únicamente cuando se usa la ruta de entorno.
   */
  readonly strict?: boolean;
  /** Raíz temporal opcional para el clúster (por defecto `RUNNER_TEMP` o `tmpdir()`). */
  readonly tempRoot?: string;
  /** Función inyectable para ejecutar comandos (por defecto `spawnSync`). */
  readonly spawn?: PostgresSpawnFn;
}

/** Devuelve el nombre del ejecutable adecuado para la plataforma: con `.exe` en Windows y sin extensión en Unix. */
export function postgresBinaryName(name: string, platform: string = process.platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

/**
 * Ejecuta una herramienta de PostgreSQL y lanza si falla o excede el tiempo límite; `pg_ctl` usa
 * tuberías ignoradas porque en Windows el servidor hijo las hereda y `spawnSync` queda esperando
 * su cierre (corrida 37525384707), mientras que `initdb` conserva su diagnóstico.
 * @param bin Carpeta de binarios de PostgreSQL (`FORGE614_TEST_POSTGRES_BIN`).
 * @param name Nombre base del ejecutable dentro de esa carpeta (`initdb` o `pg_ctl`).
 * @param args Argumentos de línea de comandos para el ejecutable.
 * @param stdio Destino de las tuberías del proceso; se ignoran solo para arrancar o detener el servidor.
 * @param platform Plataforma objetivo para determinar el sufijo del ejecutable.
 * @param spawnFn Ejecutor inyectable para las llamadas.
 * @throws Error con el mensaje de error estándar del proceso, o indicando que se agotó el tiempo límite.
 */
function command(
  bin: string,
  name: string,
  args: string[],
  stdio: "pipe" | "ignore" = "pipe",
  platform: string = process.platform,
  spawnFn: PostgresSpawnFn = spawnSync as unknown as PostgresSpawnFn,
) {
  const exe = postgresBinaryName(name, platform);
  const result = spawnFn(join(bin, exe), args, { encoding: "utf8", stdio, timeout: postgresTestTimeoutMs });
  if (result.status === 0) return;
  const detail = result.error?.message ?? (typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim());
  throw new Error(`${exe} ${detail || "failed"}`);
}

/**
 * Levanta un clúster de PostgreSQL desechable, solo accesible por loopback (`127.0.0.1`), en una carpeta
 * temporal: crea la base con `initdb` y la arranca con `pg_ctl` en un puerto libre elegido al vuelo.
 * En Windows ejecuta `initdb.exe` y `pg_ctl.exe` explícitamente y omite el socket Unix `-k`.
 * En modo estricto (`FORGE614_REQUIRE_TEST_POSTGRES=1` con la ruta de entorno) lanza un error si el binario falta o falla,
 * en lugar de devolver `available: false` para evitar saltos silenciosos en la CI.
 * @param bin Carpeta de binarios de PostgreSQL a usar; si no se especifica, usa `FORGE614_TEST_POSTGRES_BIN`.
 * @param options Opciones adicionales como plataforma inyectada, modo estricto o ejecutor simulado.
 * @returns Un {@link PostgresCluster} con sus datos de conexión si se levantó, o con el motivo por el que
 * no se pudo levantar cuando no se está en modo estricto.
 */
export function startPostgresCluster(bin?: string, options?: PostgresClusterOptions): PostgresCluster {
  const isDefaultBin = bin === undefined;
  const resolvedBin = bin ?? process.env.FORGE614_TEST_POSTGRES_BIN;
  const platform = options?.platform ?? process.platform;
  const isStrict = options?.strict ?? (isDefaultBin && process.env.FORGE614_REQUIRE_TEST_POSTGRES === "1");
  const spawnFn = options?.spawn ?? (spawnSync as unknown as PostgresSpawnFn);

  if (!resolvedBin) {
    if (isStrict) {
      throw new Error("FORGE614_REQUIRE_TEST_POSTGRES=1 is set, but FORGE614_TEST_POSTGRES_BIN is not configured");
    }
    return { available: false, reason: "FORGE614_TEST_POSTGRES_BIN is not configured" };
  }

  const tempBase = options?.tempRoot ?? process.env.RUNNER_TEMP ?? tmpdir();
  const directory = mkdtempSync(join(tempBase, "engram-adapter-pg-"));
  let started = false;
  try {
    command(resolvedBin, "initdb", ["-D", join(directory, "data"), "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], "pipe", platform, spawnFn);
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port; listener.stop(true);
    const socket = platform === "win32" ? "" : ` -k ${directory}`;
    command(resolvedBin, "pg_ctl", ["-D", join(directory, "data"), "-l", join(directory, "log"), "-o", `-h 127.0.0.1 -p ${port}${socket}`, "-w", "start"], "ignore", platform, spawnFn);
    started = true;
    return { available: true, directory, url: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`, bin: resolvedBin };
  } catch (error) {
    if (started) {
      try { command(resolvedBin, "pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"], "ignore", platform, spawnFn); }
      catch { /* La instalación desechable que falló se elimina más abajo de todos modos. */ }
    }
    rmSync(directory, { recursive: true, force: true });
    const reason = `PostgreSQL disposable fixture unavailable: ${error instanceof Error ? error.message : "unknown failure"}`;
    if (isStrict) {
      throw new Error(`FORGE614_REQUIRE_TEST_POSTGRES=1 is set, but disposable fixture failed: ${reason}`);
    }
    return { available: false, reason };
  }
}

/**
 * Detiene un clúster levantado por {@link startPostgresCluster} y borra su carpeta temporal; no hace nada
 * si el clúster nunca llegó a levantarse.
 * @param cluster Resultado devuelto por {@link startPostgresCluster}.
 * @param options Opciones adicionales como plataforma inyectada o ejecutor simulado.
 */
export function stopPostgresCluster(cluster: PostgresCluster, options?: PostgresClusterOptions) {
  if (!cluster.available) return;
  const platform = options?.platform ?? process.platform;
  const spawnFn = options?.spawn ?? (spawnSync as unknown as PostgresSpawnFn);
  try { command(cluster.bin, "pg_ctl", ["-D", join(cluster.directory, "data"), "-m", "fast", "-w", "stop"], "ignore", platform, spawnFn); }
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
