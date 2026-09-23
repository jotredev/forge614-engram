import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/**
 * Diagnostic-only (forge614-ai coordinator, v1.5.3 hang investigation, experiment 4):
 * captures exactly what a still-running child is blocked on, via /proc, right before the
 * test-harness watchdog kills it. Linux only; a no-op elsewhere. Never used outside this
 * investigation's branch.
 */
export function procSnapshot(pid: number): Record<string, unknown> {
  if (process.platform !== "linux") return { platform: process.platform, skipped: true };
  const read = (path: string): string => {
    try { return readFileSync(path, "utf8"); }
    catch (error) { return `<error: ${(error as Error).message}>`; }
  };
  const status = read(`/proc/${pid}/status`);
  const state = status.split("\n").find(line => line.startsWith("State:")) ?? "<missing>";
  const dump: Record<string, unknown> = {
    pid,
    state,
    wchan: read(`/proc/${pid}/wchan`),
    syscall: read(`/proc/${pid}/syscall`),
  };
  try {
    const entries = readdirSync(`/proc/${pid}/fd`);
    dump.fds = entries.map(fd => {
      let target = "<unreadable>";
      try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { /* fd may have closed mid-read */ }
      const isDb = /\.db(-wal|-shm|-journal)?$/.test(target);
      return { fd, target, fdinfo: isDb ? read(`/proc/${pid}/fdinfo/${fd}`) : undefined };
    });
  } catch (error) { dump.fdsError = (error as Error).message; }
  try {
    const ps = Bun.spawnSync(["ps", "-eo", "pid,ppid,stat,wchan:20,args", "--forest"], {
      stdout: "pipe", stderr: "pipe", timeout: 3000,
    });
    dump.psForest = ps.stdout.toString();
  } catch (error) { dump.psError = (error as Error).message; }
  return dump;
}
