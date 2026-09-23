import { version } from "../../../package.json";
import { MemoryError } from "../../shared/errors";
import { HELP } from "./help";
import { invalid, parseArguments } from "./arguments";
import { dispatch } from "./commands";

export async function main(args:string[]):Promise<void> {
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
  finally {
    // Experiment (forge614-ai coordinator, v1.5.3 hang investigation): test whether the
    // process finishes its work but never drains the event loop on its own on Linux.
    // Gated so it never changes behavior unless explicitly requested by the reproduction.
    if (process.env.FORGE614_EXPERIMENT_EXIT === "1") {
      await new Promise(resolve => process.stdout.write("", resolve));
      await new Promise(resolve => process.stderr.write("", resolve));
      process.exit(process.exitCode ?? 0);
    }
  }
}
