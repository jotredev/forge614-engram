import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const postgresTestTimeoutMs = 30_000;

export type PostgresCluster =
  | { available: true; directory: string; url: string; bin: string }
  | { available: false; reason: string };

function command(bin: string, name: string, args: string[]) {
  const result = Bun.spawnSync([join(bin, name), ...args], {
    stdout: "pipe", stderr: "pipe", timeout: postgresTestTimeoutMs,
  });
  if (result.success) return;
  const detail = result.exitedDueToTimeout ? `timed out after ${postgresTestTimeoutMs}ms` : result.stderr.toString().trim();
  throw new Error(`${name} ${detail || "failed"}`);
}

/** Starts only a disposable loopback cluster. A startup failure becomes a visible suite skip. */
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
      catch { /* The failed disposable fixture is removed below. */ }
    }
    rmSync(directory, { recursive: true, force: true });
    return { available: false, reason: `PostgreSQL disposable fixture unavailable: ${error instanceof Error ? error.message : "unknown failure"}` };
  }
}

export function stopPostgresCluster(cluster: PostgresCluster) {
  if (!cluster.available) return;
  try { command(cluster.bin, "pg_ctl", ["-D", join(cluster.directory, "data"), "-m", "fast", "-w", "stop"]); }
  finally { rmSync(cluster.directory, { recursive: true, force: true }); }
}

export async function withPostgres(run: (url: string) => Promise<void>): Promise<void> {
  const cluster = startPostgresCluster();
  if (!cluster.available) {
    console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
    return;
  }
  try { await run(cluster.url); }
  finally { stopPostgresCluster(cluster); }
}
