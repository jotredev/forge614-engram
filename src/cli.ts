import { appendFileSync } from "node:fs";
import { main } from "./interfaces/cli/main";
const diagLog = process.env.FORGE614_DIAGNOSE_HANG_LOG;
const __diagStart = diagLog ? Bun.nanoseconds() : 0;
await main(process.argv.slice(2));
if (diagLog) {
  const elapsedMs = (Bun.nanoseconds() - __diagStart) / 1e6;
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const requests = (process as any)._getActiveRequests?.() ?? [];
  appendFileSync(diagLog, JSON.stringify({
    diag: "post-main",
    pid: process.pid,
    args: process.argv.slice(2),
    elapsedMs,
    activeHandles: handles.map((h: object) => h?.constructor?.name ?? typeof h),
    activeRequests: requests.map((r: object) => r?.constructor?.name ?? typeof r),
  }) + "\n");
}
