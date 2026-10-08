/**
 * Punto de entrada de prueba para el ejecutable simulado en la verificación de Windows.
 * Se compila como `$FORGE614_HOME/engram/bin/forge614-engram.exe`.
 * Reporta la versión inicial `forge614-engram 0.0.0` y, al ejecutarse con `update`,
 * invoca el flujo real de `runUpdateCommand`, `updateEngram` y `updateInstalledEngram`
 * inyectando la lectura del asset local y comprobando las URLs oficiales de la release.
 */
import { runUpdateCommand } from "../../src/interfaces/cli/commands.ts";
import { updateEngram } from "../../src/app/update.ts";
import { updateInstalledEngram } from "../../src/infrastructure/updater.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OFFICIAL_EXE_URL = "https://github.com/jotredev/forge614-engram/releases/latest/download/forge614-engram-windows-x64.exe";
const OFFICIAL_SHASUMS_URL = "https://github.com/jotredev/forge614-engram/releases/latest/download/SHA256SUMS";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("forge614-engram 0.0.0");
  process.exit(0);
}

if (args[0] === "update") {
  const json = args.includes("--json");
  const assetPath =
    process.env.FORGE614_TEST_WINDOWS_ASSET ??
    join(process.env.RUNNER_TEMP ?? tmpdir(), "forge614-engram-self-update-asset", "forge614-engram-windows-x64.exe");

  if (!existsSync(assetPath)) {
    console.error(JSON.stringify({ code: "UPDATE_FAILED", error: "No se encontró el asset local para la actualización." }));
    process.exit(1);
  }

  const fetchBuffer = async (url) => {
    if (url !== OFFICIAL_EXE_URL) {
      throw new Error(`URL inesperada para el binario: ${url}`);
    }
    return new Uint8Array(readFileSync(assetPath));
  };

  const fetchText = async (url) => {
    if (url !== OFFICIAL_SHASUMS_URL) {
      throw new Error(`URL inesperada para el manifiesto: ${url}`);
    }
    const hash = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
    return `${hash}  forge614-engram-windows-x64.exe\n`;
  };

  try {
    await runUpdateCommand(json, "0.0.0", () =>
      updateEngram("0.0.0", {
        quiet: json,
        run: () => updateInstalledEngram("0.0.0", { quiet: json, fetchBuffer, fetchText }),
      }),
    );
    process.exit(0);
  } catch {
    console.error(JSON.stringify({ code: "UPDATE_FAILED", error: "No se pudo actualizar Forge614 Engram." }));
    process.exit(1);
  }
}

console.error(JSON.stringify({ code: "INVALID_COMMAND", error: "Comando no soportado en el ejecutable de prueba." }));
process.exit(1);
