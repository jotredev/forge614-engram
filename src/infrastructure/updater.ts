/**
 * Descarga el instalador oficial de Forge614 Engram desde la última versión publicada y lo ejecuta para
 * reemplazar el comando ya instalado, comprobando la versión resultante; cada dependencia externa
 * (descarga, ejecución del proceso, lectura de la versión instalada) es sustituible por parámetro para
 * poder probarla sin red ni procesos reales. La usa `src/app/update.ts`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as crypto from "node:crypto";
import { engramBinDirectory } from "./filesystem/paths";

const latestInstaller = "https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh";
const latestWindowsExe = "https://github.com/jotredev/forge614-engram/releases/latest/download/forge614-engram-windows-x64.exe";
const latestShaSum = "https://github.com/jotredev/forge614-engram/releases/latest/download/SHA256SUMS";

/** Opciones aceptadas al lanzar el proceso del instalador. */
export type SpawnOptions = { stdio?: "inherit", windowsHide?: boolean };
/** Forma de una función que lanza un proceso, sustituible en pruebas por una que no ejecuta nada real. */
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; stderr?: string | Buffer; error?: Error };
/** Forma de una función que descarga el instalador, sustituible en pruebas por una que no usa la red. */
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;
/** Forma de una función que lee la versión ya instalada, sustituible en pruebas. */
type ReadInstalledVersion = (executable?: string) => string;

const WINDOWS_SWAP_HELPER_SCRIPT = `
param(
  [string]$NewBinary,
  [string]$ActiveLauncher,
  [string]$StagingDir,
  [string]$LogFile
)
"$(Get-Date -Format o) starting swap helper" | Out-File -FilePath $LogFile -Append
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    Copy-Item -Path $NewBinary -Destination $ActiveLauncher -Force
  } catch {
    "$(Get-Date -Format o) attempt $i copy failed: $_" | Out-File -FilePath $LogFile -Append
    continue
  }
  $newHash = (Get-FileHash -Path $NewBinary -Algorithm SHA256).Hash
  $activeHash = (Get-FileHash -Path $ActiveLauncher -Algorithm SHA256).Hash
  if ($newHash -eq $activeHash) {
    Remove-Item -Path $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    "$(Get-Date -Format o) swap succeeded on attempt $i" | Out-File -FilePath $LogFile -Append
    exit 0
  }
}
"$(Get-Date -Format o) swap did not succeed after all retries" | Out-File -FilePath $LogFile -Append
`;

const WINDOWS_WMI_LAUNCH_SCRIPT = `
param(
  [string]$CommandLine,
  [string]$SpawnLogPath
)
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $CommandLine }
  if ($result.ReturnValue -ne 0) {
    "$(Get-Date -Format o) Win32_Process.Create failed with ReturnValue=$($result.ReturnValue) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
    exit 1
  }
  "$(Get-Date -Format o) Win32_Process.Create succeeded, ProcessId=$($result.ProcessId) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
} catch {
  "$(Get-Date -Format o) Win32_Process.Create threw: $_" | Out-File -FilePath $SpawnLogPath -Append
  exit 1
}
`;

function quoteWindowsArg(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

/**
 * Da la ruta del comando `forge614-engram` que instaló Engram, según la ubicación de binarios configurada.
 * @returns La ruta absoluta al ejecutable instalado.
 */
export function installedEngramCommand(platform = process.platform): string {
  const command = join(engramBinDirectory(), "forge614-engram");
  return platform === "win32" ? command + ".exe" : command;
}

/**
 * Ejecuta el comando instalado con `--version` y valida que su salida tenga la forma esperada.
 * @param executable Ruta al ejecutable a probar; por defecto usa el comando instalado.
 * @returns La versión reportada por el comando instalado (p. ej. `1.4.0`).
 * @throws Error si el comando no reporta una versión con el formato `forge614-engram X.Y.Z[...]`.
 */
function readInstalledVersion(executable?: string): string {
  const target = executable ?? installedEngramCommand();
  const output = execFileSync(target, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
 * Descarga en memoria el contenido binario desde una URL dada.
 * @param url URL desde la que descargar el contenido binario.
 * @returns Los bytes descargados de la URL.
 * @throws Error si la descarga responde con un estado HTTP de error.
 */
async function fetchBuffer(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download asset.");
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Descarga en memoria el contenido de texto desde una URL dada.
 * @param url URL desde la que descargar el contenido de texto.
 * @returns El texto descargado de la URL.
 * @throws Error si la descarga responde con un estado HTTP de error.
 */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download asset.");
  return await response.text();
}

/**
 * Descarga el instalador más reciente y lo ejecuta con `--force` para reemplazar el comando ya instalado,
 * comprobando después qué versión quedó instalada; siempre limpia el archivo descargado, incluso si la
 * instalación falla. En Windows programa el reemplazo para cuando el proceso salga.
 * @param currentVersion Versión instalada antes de intentar la actualización.
 * @param options Opciones para inyectar dependencias y silenciar la salida.
 * @returns Si la versión instalada cambió (`updated`), la versión anterior y la nueva versión instalada (`installedVersion`); adicionalmente `pendingVersion` en Windows si se programó el reemplazo en segundo plano.
 * @throws El error del proceso si el lanzamiento falla; `Error` con la salida de error del instalador (o un
 * mensaje genérico) si termina con un código de salida distinto de cero.
 */
export async function updateInstalledEngram(currentVersion: string, options: {
  download?: Download;
  spawn?: Spawn;
  readInstalledVersion?: ReadInstalledVersion;
  quiet?: boolean;
  platform?: string;
  arch?: string;
  fetchBuffer?: (url: string) => Promise<Uint8Array>;
  fetchText?: (url: string) => Promise<string>;
} = {}): Promise<{ updated: boolean; previousVersion: string; installedVersion: string; pendingVersion?: string }> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const spawn: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const readVer = options.readInstalledVersion ?? readInstalledVersion;

  if (platform === "win32") {
    if (arch !== "x64") throw new Error("Forge614 Engram updater only supports x64 on Windows.");

    const fetchBuf = options.fetchBuffer ?? fetchBuffer;
    const fetchTxt = options.fetchText ?? fetchText;

    const targetAsset = "forge614-engram-windows-x64.exe";
    const shasums = await fetchTxt(latestShaSum);
    const lines = shasums.split(/\r?\n/);
    const mentions = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const tokens = trimmed.split(/\s+/);
      const assetName = tokens.length > 1 ? tokens[tokens.length - 1] : trimmed;
      return assetName === targetAsset;
    });
    if (mentions.length !== 1) {
      throw new Error("Invalid or ambiguous SHA256SUMS file.");
    }
    const match = /^([0-9a-f]{64})  forge614-engram-windows-x64\.exe$/.exec(mentions[0]!);
    if (!match) {
      throw new Error("Invalid or ambiguous SHA256SUMS file.");
    }
    const expectedHash = match[1]!;

    const exeBytes = await fetchBuf(latestWindowsExe);
    const actualHash = crypto.createHash("sha256").update(exeBytes).digest("hex");
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("Downloaded asset checksum mismatch.");
    }

    const engramDir = join(engramBinDirectory(), "..");
    mkdirSync(engramDir, { recursive: true });
    const stamp = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 8);
    const stagingDir = mkdtempSync(join(engramDir, "update-"));
    let pendingVersion: string;

    try {
      const newExe = join(stagingDir, "forge614-engram-windows-x64.exe");
      writeFileSync(newExe, exeBytes);

      pendingVersion = readVer(newExe);
      const installedVersion = readVer();

      if (pendingVersion === installedVersion) {
        rmSync(stagingDir, { recursive: true, force: true });
        return { updated: false, previousVersion: currentVersion, installedVersion };
      }

      const activeLauncher = installedEngramCommand(platform);
      const helperPath = join(stagingDir, "swap-helper.ps1");
      const wmiLaunchPath = join(stagingDir, "wmi-launch.ps1");
      const swapLogPath = join(engramDir, `swap-helper-${stamp}.log`);
      const spawnLogPath = join(engramDir, `swap-helper-${stamp}.spawn.log`);

      writeFileSync(helperPath, WINDOWS_SWAP_HELPER_SCRIPT);
      writeFileSync(wmiLaunchPath, WINDOWS_WMI_LAUNCH_SCRIPT);

      const helperArgs = [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", helperPath,
        "-NewBinary", newExe,
        "-ActiveLauncher", activeLauncher,
        "-StagingDir", stagingDir,
        "-LogFile", swapLogPath
      ];

      let scheduled = false;
      const candidates = ["pwsh", "powershell.exe"];

      for (const shell of candidates) {
        const targetCommandLine = [shell, ...helperArgs].map(quoteWindowsArg).join(" ");
        const wrapperArgs = [
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
          "-File", wmiLaunchPath,
          "-CommandLine", targetCommandLine,
          "-SpawnLogPath", spawnLogPath
        ];
        const res = spawn(shell, wrapperArgs, { windowsHide: true });
        if (res.status === 0) {
          scheduled = true;
          break;
        }
      }

      if (!scheduled) {
        throw new Error("Could not launch WMI process to finish update.");
      }

      return { updated: false, previousVersion: currentVersion, installedVersion, pendingVersion };
    } catch (e) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw e;
    }
  }

  const downloaded = await (options.download ?? downloadInstaller)(latestInstaller);
  try {
    const result = spawn("bash", [downloaded.installer, "--force"], options.quiet ? undefined : { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
      throw new Error(stderr || "Forge614 Engram update failed.");
    }
    const previousVersion = currentVersion;
    const installedVersion = readVer();
    return { updated: installedVersion !== previousVersion, previousVersion, installedVersion };
  } finally {
    downloaded.cleanup();
  }
}
