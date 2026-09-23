import { appendFileSync } from "node:fs";
import { version } from "../../../package.json";
import { MemoryError } from "../../shared/errors";
import { HELP } from "./help";
import { invalid, parseArguments } from "./arguments";
import { dispatch } from "./commands";

function diagnoseHangIfRequested(args: string[], startNs: number): void {
  const diagLog = process.env.FORGE614_DIAGNOSE_HANG_LOG;
  if (!diagLog) return;
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const requests = (process as any)._getActiveRequests?.() ?? [];
  appendFileSync(diagLog, JSON.stringify({
    diag: "post-main",
    pid: process.pid,
    args,
    elapsedMs: (Bun.nanoseconds() - startNs) / 1e6,
    activeHandles: handles.map((h: object) => h?.constructor?.name ?? typeof h),
    activeRequests: requests.map((r: object) => r?.constructor?.name ?? typeof r),
  }) + "\n");
}

export async function main(args:string[]):Promise<void> {
  const __diagStart = Bun.nanoseconds();
  try {
    const command = args[0] ?? "help";
    if (command === "setup") {
      throw new MemoryError("COMMAND_RETIRED", "El comando setup fue retirado. Usa forge614-engram init.");
    }
    if (command === "--version") {
      if (args.length > 1) invalid("--version no acepta opciones.");
      console.log(`forge614-engram ${version}`); return;
    }
    if (command === "help" || command === "--help") {
      if (args.length > 1) invalid("help no acepta opciones.");
      console.log(HELP); return;
    }
    await dispatch(parseArguments(args), version);
  }
  catch (error) {
    console.error(JSON.stringify(error instanceof MemoryError
      ? { code: error.code, error: error.message }
      : { code: "STORAGE_ERROR", error: "No se pudo completar la operación. Comprueba permisos, configuración y disponibilidad de la base. No se creó una base de reemplazo." }));
    process.exitCode = 1;
  }
  finally { diagnoseHangIfRequested(args, __diagStart); }
}
