/**
 * Quita del perfil de shell del usuario (`.zshrc`, `.bash_profile`, `.bashrc` o el archivo de Fish) el
 * bloque de PATH que los instaladores de Forge614 Engram agregaron para que sus binarios se encuentren
 * desde la terminal; solo quita el bloque si su contenido coincide exactamente con lo que Engram habría
 * escrito, para no borrar algo que el usuario haya editado a mano. La usa `src/app/uninstall.ts`.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PrivateFileError, fail, guardedWrite, readSafeFile, type PrivateWrite } from "./private-files";
import { engramBinDirectory } from "./paths";

const START = "# >>> forge614-engram PATH >>>";
const END = "# <<< forge614-engram PATH <<<";

/** Identificador estable reportado cuando la publicación en el Path de usuario en Windows es retirada. */
export const WINDOWS_PATH_IDENTIFIER = "User Path";

/** Opciones para spawn al invocar PowerShell en Windows. */
export interface WindowsSpawnOptions {
  readonly input?: string | Uint8Array;
  readonly encoding?: string;
  readonly windowsHide?: boolean;
}

/** Resultado retornado por la ejecución de spawn en Windows. */
export interface WindowsSpawnResult {
  readonly status: number | null;
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
  readonly error?: Error;
}

/** Opciones para {@link removePathPublication}. */
export interface PathPublicationOptions {
  /** Carpeta personal del usuario donde buscar los archivos de perfil de shell. */
  readonly home: string;
  /** Carpeta de binarios de Engram que se esperaba publicar en el PATH; si se omite, se usa {@link engramBinDirectory}. */
  readonly binDirectory?: string;
  /** Plataforma objetivo (por defecto `process.platform`). */
  readonly platform?: string;
  /** Función inyectable para leer el Path de usuario en Windows. */
  readonly readUserPath?: () => Promise<string | null>;
  /** Función inyectable para escribir el nuevo Path de usuario en Windows. */
  readonly writeUserPath?: (newPath: string) => Promise<void>;
  /** Función inyectable para ejecutar comandos en Windows (usada si no se inyectan read/write). */
  readonly spawn?: (command: string, args: string[], options?: WindowsSpawnOptions) => WindowsSpawnResult;
}

/**
 * Escapa un valor para insertarlo de forma segura en un script de shell POSIX, anteponiendo una barra
 * invertida a cualquier carácter que no sea alfanumérico o uno de los símbolos seguros sin comillas.
 * @param value Texto a escapar (típicamente una ruta de carpeta).
 * @returns El texto con cada carácter especial precedido por `\`.
 */
function shellQuote(value: string): string {
  return value.replace(/[^A-Za-z0-9_@%+=:,./-]/g, character => `\\${character}`);
}

/**
 * Reconstruye el cuerpo exacto que el instalador habría escrito entre las marcas de inicio y fin, para
 * poder compararlo con lo que hay realmente en el archivo antes de quitarlo.
 * @param directory Carpeta de binarios de Engram que el bloque debía anteponer al PATH.
 * @param fish Si es `true`, genera la sintaxis de Fish shell; si es `false`, la sintaxis POSIX (`sh`/`bash`/`zsh`).
 * @returns El texto esperado del cuerpo del bloque, sin las líneas de marca.
 */
function expectedUnixBody(directory: string, fish: boolean): string {
  const quoted = shellQuote(directory);
  return fish
    ? `if not contains -- ${quoted} $PATH\n  set -gx PATH ${quoted} $PATH\nend`
    : `case ":$PATH:" in\n  *:${quoted}:*) ;;\n  *) export PATH=${quoted}:"$PATH" ;;\nesac`;
}

/**
 * Prepara la escritura que quitaría el bloque de PATH de un archivo de perfil, si existe y su contenido
 * coincide exactamente con lo esperado; rechaza si hay más de un bloque, si falta una de las dos marcas, o
 * si el cuerpo entre marcas fue editado.
 * @param path Ruta del archivo de perfil de shell a inspeccionar.
 * @param directory Carpeta de binarios de Engram que el bloque debía anteponer al PATH.
 * @param fish Si el archivo usa la sintaxis de Fish shell.
 * @returns Una {@link PrivateWrite} que borra el bloque, o `null` si el archivo no existe o no tiene bloque.
 * @throws PrivateFileError con código `PATH_CONFLICT` si el archivo tiene un bloque duplicado o
 * incompleto, o si su contenido no coincide con el que Engram habría escrito.
 */
function removeMarkedBlock(path: string, directory: string, fish: boolean): PrivateWrite | null {
  const before = readSafeFile(path);
  if (before === null) return null;
  const lines = before.split("\n");
  const starts = lines.reduce<number[]>((all, line, index) => line === START ? [...all, index] : all, []);
  const ends = lines.reduce<number[]>((all, line, index) => line === END ? [...all, index] : all, []);
  if (starts.length === 0 && ends.length === 0) return null;
  const start = starts[0];
  const end = ends[0];
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end <= start) {
    fail("PATH_CONFLICT", "The Forge614 Engram PATH block was changed or duplicated. It was not removed.");
  }
  const body = lines.slice(start + 1, end).join("\n");
  if (body !== expectedUnixBody(directory, fish)) {
    fail("PATH_CONFLICT", "The Forge614 Engram PATH block was edited. It was not removed.");
  }
  const after = [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n");
  return { path, before, after, kind: "config" };
}

/**
 * Calcula, para cada archivo de perfil de shell candidato (zsh y bash con sintaxis POSIX, y Fish con la
 * suya) dentro de la carpeta personal dada, la escritura necesaria para quitarle el bloque de PATH de
 * Engram, si lo tiene.
 * @param home Carpeta personal del usuario donde buscar los archivos de perfil.
 * @param directory Carpeta de binarios de Engram que el bloque debía anteponer al PATH.
 * @returns La lista de escrituras a aplicar, una por cada archivo que tenía el bloque.
 */
function unixWrites(home: string, directory: string): PrivateWrite[] {
  const candidates: readonly [string, boolean][] = [
    [join(home, ".zshrc"), false],
    [join(home, ".bash_profile"), false],
    [join(home, ".bashrc"), false],
    [join(home, ".config", "fish", "conf.d", "forge614-engram.fish"), true],
  ];
  const writes: PrivateWrite[] = [];
  for (const [path, fish] of candidates) {
    const write = removeMarkedBlock(path, directory, fish);
    if (write) writes.push(write);
  }
  return writes;
}

/**
 * Normaliza una ruta para la comparación insensible a mayúsculas y tolerante al separador final en Windows.
 * @param entry Ruta a normalizar.
 * @returns La ruta en minúsculas y sin separadores invertidos finales sobrantes.
 */
function normalizeWindowsPathEntry(entry: string): string {
  let normalized = entry.trim().replace(/\//g, "\\");
  while (normalized.length > 1 && normalized.endsWith("\\")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

const WINDOWS_READ_PATH_COMMAND = "$val = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($null -ne $val) { [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($val)) }";

const WINDOWS_WRITE_PATH_COMMAND = "$b64 = [Console]::In.ReadToEnd().Trim(); if ($b64) { $bytes = [Convert]::FromBase64String($b64); $val = [System.Text.Encoding]::Unicode.GetString($bytes); [Environment]::SetEnvironmentVariable('Path', $val, 'User') } else { [Environment]::SetEnvironmentVariable('Path', '', 'User') }";

/**
 * Lee el valor actual de la variable de entorno User Path mediante PowerShell y salida codificada en base64 de UTF-16LE.
 * @param spawnFn Ejecutor opcional inyectado.
 * @returns El contenido de la variable User Path, o lanza un error si la lectura falla.
 */
function defaultReadUserPath(spawnFn?: PathPublicationOptions["spawn"]): string | null {
  const runner = spawnFn ?? spawnSync;
  for (const shell of ["pwsh", "powershell.exe"]) {
    try {
      const res = runner(shell, ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_READ_PATH_COMMAND], { encoding: "utf8" });
      if (res.status === 0 && res.stdout !== undefined) {
        const trimmed = String(res.stdout).trim();
        if (!trimmed) return null;
        return Buffer.from(trimmed, "base64").toString("utf16le");
      }
    } catch {
      // Intentar con el siguiente candidato
    }
  }
  throw new Error("Could not read User Path environment variable.");
}

/**
 * Escribe el nuevo valor de la variable de entorno User Path mediante PowerShell pasando los datos por stdin en base64 de UTF-16LE.
 * @param newPath Nuevo valor a asignar a la variable.
 * @param spawnFn Ejecutor opcional inyectado.
 */
function defaultWriteUserPath(newPath: string, spawnFn?: PathPublicationOptions["spawn"]): void {
  const runner = spawnFn ?? spawnSync;
  const input = Buffer.from(newPath, "utf16le").toString("base64");
  for (const shell of ["pwsh", "powershell.exe"]) {
    try {
      const res = runner(shell, ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_WRITE_PATH_COMMAND], {
        input,
        encoding: "utf8",
      });
      if (res.status === 0) {
        return;
      }
    } catch {
      // Intentar con el siguiente candidato
    }
  }
  throw new Error("Could not write User Path environment variable.");
}

/**
 * Quita únicamente los elementos de User Path en Windows que coinciden de forma exacta con la carpeta de binarios de Engram.
 * @param options Opciones de publicación de ruta.
 * @returns Lista con el identificador estable si se eliminó una publicación, o lista vacía si no hubo coincidencia.
 */
async function removeWindowsPathPublication(options: PathPublicationOptions): Promise<string[]> {
  const targetDir = options.binDirectory ?? engramBinDirectory();
  const normalizedTarget = normalizeWindowsPathEntry(targetDir);

  let currentPath: string | null;
  if (options.readUserPath) {
    currentPath = await options.readUserPath();
  } else {
    currentPath = defaultReadUserPath(options.spawn);
  }

  if (!currentPath) {
    return [];
  }

  const rawElements = currentPath.split(";");
  let matched = false;
  const remainingElements: string[] = [];

  for (const element of rawElements) {
    if (element.trim() !== "" && normalizeWindowsPathEntry(element) === normalizedTarget) {
      matched = true;
    } else {
      remainingElements.push(element);
    }
  }

  if (!matched) {
    return [];
  }

  const newPath = remainingElements.join(";");
  if (options.writeUserPath) {
    await options.writeUserPath(newPath);
  } else {
    defaultWriteUserPath(newPath, options.spawn);
  }

  return [WINDOWS_PATH_IDENTIFIER];
}

/**
 * Quita únicamente la publicación exacta de PATH que crearon los instaladores de Forge614 Engram, en cada
 * archivo de perfil de shell donde aparezca sin cambios en Unix o en la variable de entorno User Path en Windows.
 * @param options Carpeta personal del usuario y, opcionalmente, la carpeta de binarios esperada y dependencias inyectables.
 * @returns Las rutas de los archivos o identificadores de los que se quitó la publicación.
 * @throws PrivateFileError con código `PATH_CONFLICT` si algún archivo tiene el bloque duplicado,
 * incompleto o editado; con código `PATH_REMOVE_FAILED` si ocurre cualquier otro error al aplicar los cambios.
 */
export async function removePathPublication(options: PathPublicationOptions): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  try {
    if (platform === "win32") {
      return await removeWindowsPathPublication(options);
    }
    if (platform !== "darwin" && platform !== "linux") return [];
    const writes = unixWrites(options.home, options.binDirectory ?? engramBinDirectory());
    const applied: string[] = [];
    for (const write of writes) {
      guardedWrite(write, () => {}, path => applied.push(path));
    }
    return applied;
  } catch (error) {
    if (error instanceof PrivateFileError) throw error;
    fail("PATH_REMOVE_FAILED", "Forge614 Engram could not safely remove its PATH publication.");
  }
}
