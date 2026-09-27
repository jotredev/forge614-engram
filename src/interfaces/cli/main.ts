/**
 * Punto de entrada del CLI (interfaz de línea de comandos): resuelve los comandos que no pasan por
 * `parseArguments`/`dispatch` (setup retirado, --version, help), y para el resto analiza los argumentos y
 * despacha. Convierte cualquier error en la salida JSON de error por stderr con código de salida 1.
 * `src/cli.ts` la llama con `process.argv.slice(2)`.
 */
import { version } from "../../../package.json";
import { MemoryError } from "../../shared/errors";
import { HELP } from "./help";
import { invalid, parseArguments } from "./arguments";
import { dispatch } from "./commands";

// Los comandos y códigos de error introducidos en 1.6.0 siguen la convención de contrato de máquina del
// ecosistema: los errores llevan schemaVersion. Todo comando y código que ya existía conserva su forma exacta.
/** Es verdadero para los comandos que siguen la convención de contrato de máquina del ecosistema (introducida en 1.6.0). */
const CONTRACT_COMMANDS = (command: string) => command.startsWith("group-") || command === "memory-move" || command === "memory-demote";
const CONTRACT_CODES = new Set(["PROJECT_FILE_INVALID","PROJECT_FILE_CONFLICT","GROUP_NAME_INVALID","GROUP_EXISTS","GROUP_NOT_FOUND",
  "GROUP_AMBIGUOUS","GROUP_REQUIRED","TOPIC_CONFLICT","MIGRATION_VERIFY_FAILED","SECRET_REJECTED","INTELLIGENCE_REQUIRED","SUPERSEDES_NOT_FOUND","ECOSYSTEM_TYPE_NOT_ALLOWED","ECOSYSTEM_AFFECTS_REQUIRED","ECOSYSTEM_AFFECTS_UNKNOWN","ECOSYSTEM_BOARD_FULL","ECOSYSTEM_STATUS_FORBIDDEN","ECOSYSTEM_STATUS_TOO_LONG"]);
/** Envuelve un código y mensaje de error en la forma de salida que le toca: con schemaVersion para los comandos y códigos del contrato de ecosistema, sin él para todo lo anterior a 1.6.0. */
function errorEnvelope(command: string, code: string, error: string): Record<string, unknown> {
  return CONTRACT_COMMANDS(command) || CONTRACT_CODES.has(code) ? { schemaVersion: 1, code, error } : { code, error };
}

/** Ejecuta un comando del CLI de principio a fin: resuelve los tres casos especiales (setup, --version, help), analiza y despacha el resto, y convierte cualquier error en salida JSON por stderr. */
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
    const command = args[0] ?? "help";
    console.error(JSON.stringify(error instanceof MemoryError
      ? errorEnvelope(command, error.code, error.message)
      : errorEnvelope(command, "STORAGE_ERROR", "No se pudo completar la operación. Comprueba permisos, configuración y disponibilidad de la base. No se creó una base de reemplazo.")));
    process.exitCode = 1;
  }
  finally {
    // Experimento (coordinador de forge614-ai, investigación del bloqueo de 1.5.3): comprueba si el
    // proceso termina su trabajo pero nunca vacía el bucle de eventos (event loop) por sí solo en Linux.
    // Solo se activa si la reproducción lo pide explícitamente; nunca cambia el comportamiento normal.
    if (process.env.FORGE614_EXPERIMENT_EXIT === "1") {
      await new Promise(resolve => process.stdout.write("", resolve));
      await new Promise(resolve => process.stderr.write("", resolve));
      process.exit(process.exitCode ?? 0);
    }
  }
}
