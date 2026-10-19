/** Actualiza Engram con el portero verificado de la release solicitada y comprueba la versión instalada. */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { engramBinDirectory } from "./filesystem/paths";

const REPOSITORY = "jotredev/forge614-engram";
const RELEASES = `https://github.com/${REPOSITORY}/releases`;

/** Opciones de ejecución del portero. */
export type SpawnOptions = { stdio?: "inherit"; windowsHide?: boolean };
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; stderr?: string | Buffer; error?: Error };
type FetchBuffer = (url: string) => Promise<Uint8Array>;
type FetchText = (url: string) => Promise<string>;

/** Da la ruta canónica del lanzador publicado dentro de `FORGE614_HOME/engram/bin/`. */
export function installedEngramCommand(platform: string = process.platform): string {
  const command = join(engramBinDirectory(), "forge614-engram");
  return platform === "win32" ? `${command}.exe` : command;
}

/** Lee la versión real de un lanzador compilado. */
function readInstalledVersion(executable?: string): string {
  const output = execFileSync(executable ?? installedEngramCommand(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const match = /^forge614-engram\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(output);
  if (!match) throw new Error("Installed Forge614 Engram did not report a valid version.");
  return match[1]!;
}

/** Descarga bytes con fetch y devuelve solo respuestas HTTP correctas. */
async function fetchBuffer(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the verified installer asset.");
  return new Uint8Array(await response.arrayBuffer());
}

/** Descarga texto con fetch y devuelve solo respuestas HTTP correctas. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download release metadata.");
  return response.text();
}

/** Valida el manifiesto GNU completo y devuelve el mapa de nombres únicos a sus huellas. */
export function parseChecksumManifest(text: string): Map<string, string> {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length) throw new Error("Invalid SHA256SUMS file.");
  const result = new Map<string, string>();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || result.has(match[2]!)) throw new Error("Invalid SHA256SUMS file.");
    result.set(match[2]!, match[1]!);
  }
  return result;
}

/** Resuelve la release objetivo sin pasar nunca `--latest` al portero. */
async function resolveTag(version: string | undefined, baseUrl: string, fetchTxt: FetchText, latestVersion?: () => Promise<string>): Promise<string> {
  let selected = version;
  if (!selected) {
    if (latestVersion) selected = await latestVersion();
    else {
      const api = baseUrl ? `${baseUrl}/repos/${REPOSITORY}/releases/latest` : `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
      const release = JSON.parse(await fetchTxt(api)) as { tag_name?: unknown };
      if (typeof release.tag_name !== "string") throw new Error("Could not resolve the latest Engram release.");
      selected = release.tag_name;
    }
  }
  const normalized = selected.startsWith("v") ? selected : `v${selected}`;
  if (!/^v\d+\.\d+\.\d+$/.test(normalized)) throw new Error("Invalid Engram release version.");
  return normalized;
}

/** Comprueba que una base URL de pruebas local solo apunte al loopback del propio proceso. */
function testBaseUrl(): string {
  const value = process.env.FORGE614_INSTALL_TEST_BASE_URL ?? "";
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("FORGE614_INSTALL_TEST_BASE_URL must use loopback HTTP.");
  }
  return value.replace(/\/$/, "");
}

/** Descarga y verifica `install.sh` o `install.ps1` contra una entrada GNU exacta de SHA256SUMS. */
async function downloadVerifiedInstaller(tag: string, assetName: string, baseUrl: string, getText: FetchText, getBuffer: FetchBuffer): Promise<{ path: string; cleanup: () => void }> {
  const downloadBase = baseUrl
    ? `${baseUrl}/repos/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}`
    : `${RELEASES}/download/${encodeURIComponent(tag)}`;
  const checksums = parseChecksumManifest(await getText(`${downloadBase}/SHA256SUMS`));
  const expected = checksums.get(assetName);
  if (!expected) throw new Error(`SHA256SUMS does not contain ${assetName}.`);
  const bytes = await getBuffer(`${downloadBase}/${assetName}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error("Downloaded installer checksum mismatch.");
  const directory = mkdtempSync(join(tmpdir(), "forge614-engram-update-"));
  const path = join(directory, assetName);
  writeFileSync(path, bytes, { mode: 0o600 });
  if (assetName === "install.sh") chmodSync(path, 0o700);
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/** Quita en el inicio de `update` los `.old-*` de una ejecución Windows ya terminada. */
function cleanupOldExecutables(): void {
  const directory = engramBinDirectory();
  for (const name of readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.startsWith(".old-")).map(entry => entry.name)) {
    rmSync(join(directory, name), { force: true });
  }
}

/**
 * Descarga el portero exacto de una release publicada, valida SHA256SUMS, lo ejecuta con su tag ya resuelto
 * y lee el lanzador instalado después de que termine. Windows aparta el `.exe` activo como `.old-*` antes
 * de reemplazarlo; ese archivo solo se elimina al comenzar el siguiente `update` o `uninstall`.
 * @param currentVersion Versión que reportaba el proceso al iniciarse.
 * @param options Versión objetivo, plataforma simulada y dependencias sustituibles para pruebas locales.
 * @returns Resultado que conserva el contrato que consume Forge614 Shell.
 */
export async function updateInstalledEngram(currentVersion: string, options: {
  version?: string;
  download?: never;
  spawn?: Spawn;
  readInstalledVersion?: (executable?: string) => string;
  quiet?: boolean;
  platform?: string;
  arch?: string;
  fetchBuffer?: FetchBuffer;
  fetchText?: FetchText;
  latestVersion?: () => Promise<string>;
} = {}): Promise<{ updated: boolean; previousVersion: string; installedVersion: string; pendingVersion?: string }> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform === "win32" && arch !== "x64") throw new Error("Forge614 Engram updater only supports x64 on Windows.");
  const baseUrl = testBaseUrl();
  const getText = options.fetchText ?? fetchText;
  const getBuffer = options.fetchBuffer ?? fetchBuffer;
  const run: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const readVer = options.readInstalledVersion ?? readInstalledVersion;
  try { cleanupOldExecutables(); } catch { /* Los restos anteriores no impiden inspeccionar una actualización. */ }
  const previousVersion = readVer();
  const tag = await resolveTag(options.version, baseUrl, getText, options.latestVersion);
  const assetName = platform === "win32" ? "install.ps1" : "install.sh";
  const installer = await downloadVerifiedInstaller(tag, assetName, baseUrl, getText, getBuffer);
  let oldExecutable = "";
  const activeExecutable = installedEngramCommand(platform);
  try {
    if (platform === "win32" && existsSync(activeExecutable)) {
      oldExecutable = join(dirname(activeExecutable), `.old-${Date.now()}-${cryptoRandomSuffix()}`);
      renameSync(activeExecutable, oldExecutable);
    }
    const args = platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", installer.path, "--force", "--version", tag]
      : [installer.path, "--force", "--version", tag];
    const result = platform === "win32"
      ? run("powershell.exe", args, options.quiet ? undefined : { stdio: "inherit", windowsHide: true })
      : run("bash", args, options.quiet ? undefined : { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
      throw new Error(stderr || "Forge614 Engram update failed.");
    }
    const installedVersion = readVer();
    return { updated: installedVersion !== previousVersion, previousVersion, installedVersion };
  } catch (error) {
    if (oldExecutable && !existsSync(activeExecutable)) {
      try { renameSync(oldExecutable, activeExecutable); } catch { /* Se conserva el `.old-*` recuperable para la siguiente orden. */ }
    }
    throw error;
  } finally { installer.cleanup(); }
}

function cryptoRandomSuffix(): string { return Math.random().toString(36).slice(2, 10); }
