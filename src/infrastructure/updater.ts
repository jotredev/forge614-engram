/**
 * Descarga el instalador oficial de Forge614 Engram desde la última versión publicada y lo ejecuta para
 * reemplazar el comando ya instalado, comprobando la versión resultante; cada dependencia externa
 * (descarga, ejecución del proceso, lectura de la versión instalada) es sustituible por parámetro para
 * poder probarla sin red ni procesos reales. La usa `src/app/update.ts`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engramBinDirectory } from "./filesystem/paths";

const latestInstaller = "https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh";

/** Opciones aceptadas al lanzar el proceso del instalador. */
type SpawnOptions = { stdio: "inherit" };
/** Forma de una función que lanza un proceso, sustituible en pruebas por una que no ejecuta nada real. */
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; stderr?: string | Buffer; error?: Error };
/** Forma de una función que descarga el instalador, sustituible en pruebas por una que no usa la red. */
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;
/** Forma de una función que lee la versión ya instalada, sustituible en pruebas. */
type ReadInstalledVersion = () => string;

/**
 * Da la ruta del comando `forge614-engram` que instaló Engram, según la ubicación de binarios configurada.
 * @returns La ruta absoluta al ejecutable instalado.
 */
export function installedEngramCommand(): string {
  return join(engramBinDirectory(), "forge614-engram");
}

/**
 * Ejecuta el comando instalado con `--version` y valida que su salida tenga la forma esperada.
 * @returns La versión reportada por el comando instalado (p. ej. `1.4.0`).
 * @throws Error si el comando no reporta una versión con el formato `forge614-engram X.Y.Z[...]`.
 */
function readInstalledVersion(): string {
  const output = execFileSync(installedEngramCommand(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const match = /^forge614-engram\s+([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?)$/.exec(output);
  if (!match) throw new Error("Installed Forge614 Engram did not report a valid version.");
  return match[1]!;
}

/**
 * Descarga el script instalador desde la URL dada a un archivo temporal con permisos de ejecución.
 * @param url URL desde la que descargar el instalador.
 * @returns La ruta del instalador descargado y una función `cleanup` que borra la carpeta temporal.
 * @throws Error si la descarga responde con un estado HTTP de error.
 */
async function downloadInstaller(url: string): Promise<{ installer: string; cleanup: () => void }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the Forge614 Engram installer.");
  const directory = mkdtempSync(join(tmpdir(), "forge614-engram-update-"));
  const installer = join(directory, "install.sh");
  writeFileSync(installer, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  chmodSync(installer, 0o700);
  return { installer, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * Descarga el instalador más reciente y lo ejecuta con `--force` para reemplazar el comando ya instalado,
 * comprobando después qué versión quedó instalada; siempre limpia el archivo descargado, incluso si la
 * instalación falla.
 * @param currentVersion Versión instalada antes de intentar la actualización.
 * @param options.download Función de descarga a usar; por defecto {@link downloadInstaller} (red real).
 * @param options.spawn Función para lanzar el instalador; por defecto `spawnSync` real.
 * @param options.readInstalledVersion Función para leer la versión tras instalar; por defecto
 * {@link readInstalledVersion} (ejecuta el comando real).
 * @param options.quiet Si es `true`, no hereda la salida del instalador en la terminal.
 * @returns Si la versión instalada cambió (`updated`), la versión anterior y la nueva versión instalada.
 * @throws El error del proceso si el lanzamiento falla; `Error` con la salida de error del instalador (o un
 * mensaje genérico) si termina con un código de salida distinto de cero.
 */
export async function updateInstalledEngram(currentVersion: string, options: {
  download?: Download;
  spawn?: Spawn;
  readInstalledVersion?: ReadInstalledVersion;
  quiet?: boolean;
} = {}): Promise<{ updated: boolean; previousVersion: string; installedVersion: string }> {
  const downloaded = await (options.download ?? downloadInstaller)(latestInstaller);
  const spawn: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  try {
    const result = spawn("bash", [downloaded.installer, "--force"], options.quiet ? undefined : { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
      throw new Error(stderr || "Forge614 Engram update failed.");
    }
    const previousVersion = currentVersion;
    const installedVersion = (options.readInstalledVersion ?? readInstalledVersion)();
    return { updated: installedVersion !== previousVersion, previousVersion, installedVersion };
  } finally {
    downloaded.cleanup();
  }
}
