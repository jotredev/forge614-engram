/**
 * Punto de entrada de prueba para el ejecutable simulado en la verificación de desinstalación de Windows.
 * Se compila como `$FORGE614_HOME/engram/bin/forge614-engram.exe`.
 * Al invocarse con `uninstall`, llama a la función real `uninstallEngram` ejecutándose desde su propio
 * ejecutable (`process.execPath`), inyectando solo `removePathPublication` para no modificar el registro
 * del sistema en el entorno de CI.
 */
import { uninstallEngram } from "../../src/app/uninstall.ts";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("forge614-engram 1.9.0");
  process.exit(0);
}

if (args[0] === "uninstall") {
  const confirmIndex = args.indexOf("--confirm");
  const confirmation = confirmIndex !== -1 ? args[confirmIndex + 1] : "";

  try {
    const result = await uninstallEngram(
      { confirmation },
      {
        executable: process.execPath,
        tempRoot: process.env.FORGE614_TEST_UNINSTALL_TEMP_ROOT,
        removePathPublication: async () => ["User Path"],
      },
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    const code = error?.code ?? "UNINSTALL_FAILED";
    const message = error?.message ?? "Error durante la desinstalación.";
    console.error(JSON.stringify({ code, error: message }));
    process.exit(1);
  }
}

console.error(JSON.stringify({ code: "INVALID_COMMAND", error: "Comando no soportado en el ejecutable de prueba." }));
process.exit(1);
