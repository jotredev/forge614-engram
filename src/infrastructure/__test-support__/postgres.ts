import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Explicit disposable cluster only: never use ambient DATABASE_URL.
export async function withPostgres(run: (url: string) => Promise<void>): Promise<void> {
  const bin = process.env.FORGE614_TEST_POSTGRES_BIN;
  if (!bin) throw new Error("FORGE614_TEST_POSTGRES_BIN is required");
  const directory = mkdtempSync(join(tmpdir(), "engram-adapter-pg-"));
  let started = false;
  const command = (name: string, args: string[]) => {
    const result = Bun.spawnSync([join(bin, name), ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  try {
    command("initdb", ["-D", join(directory, "data"), "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port; listener.stop(true);
    command("pg_ctl", ["-D", join(directory, "data"), "-l", join(directory, "log"), "-o", `-h 127.0.0.1 -p ${port} -k ${directory}`, "-w", "start"]);
    started = true;
    await run(`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
  } finally {
    try { if (started) command("pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"]); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
