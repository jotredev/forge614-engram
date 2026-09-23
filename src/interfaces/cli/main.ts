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
}
