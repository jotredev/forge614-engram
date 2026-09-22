import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

type CanonicalProject = { directory: string; name: string; git: boolean };
const GIT_TIMEOUT_MS = 1000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;

function invalidDirectory(): never {
  throw new MemoryError("INVALID_DIRECTORY","La carpeta de proyecto no existe, no es válida o no puede usarse como proyecto.");
}

function readableDirectory(directory: string): string {
  if (typeof directory !== "string" || !directory.trim() || directory.includes("\0") || directory.length > 4096) invalidDirectory();
  let canonical: string;
  try {
    canonical = realpathSync(resolve(directory.trim()));
    if (!statSync(canonical).isDirectory()) invalidDirectory();
    accessSync(canonical, constants.R_OK | constants.X_OK);
  } catch { invalidDirectory(); }
  return canonical;
}

function bindableProjectDirectory(directory: string): string {
  const canonical = readableDirectory(directory);
  if (canonical === parse(canonical).root || canonical === realpathSync(homedir())) invalidDirectory();
  return canonical;
}

function gitEnvironment(): Record<string,string> {
  const environment: Record<string,string> = {};
  for (const [key,value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) environment[key] = value;
  }
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.LC_ALL = "C";
  return environment;
}

function projectIdentityUnavailable(): never {
  throw new MemoryError("PROJECT_IDENTITY_UNAVAILABLE","No se pudo determinar de forma segura la identidad Git del proyecto.");
}

function hasGitMarker(directory: string): boolean {
  let current = directory;
  while (true) {
    const inspect = (candidate:string) => {
      try { return lstatSync(candidate); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") projectIdentityUnavailable();
        return null;
      }
    };
    if (inspect(join(current,".git"))) return true;
    const head = inspect(join(current,"HEAD"));
    const objects = inspect(join(current,"objects"));
    const refs = inspect(join(current,"refs"));
    if (head?.isFile() && objects?.isDirectory() && refs?.isDirectory()) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function canonicalProjectFromDirectory(explicit: string): CanonicalProject {
  const marker = hasGitMarker(explicit);
  const executable = process.env.PATH === undefined ? Bun.which("git") : Bun.which("git",{ PATH:process.env.PATH });
  if (!executable) projectIdentityUnavailable();
  let result: Bun.ReadableSyncSubprocess;
  try {
    result = Bun.spawnSync([executable,"-C",explicit,"rev-parse","--path-format=absolute","--git-common-dir"], {
      env:gitEnvironment(),stdout:"pipe",stderr:"pipe",timeout:GIT_TIMEOUT_MS,
      maxBuffer:GIT_MAX_OUTPUT_BYTES,killSignal:"SIGKILL",
    });
  } catch { projectIdentityUnavailable(); }
  if (result.exitedDueToTimeout || result.exitedDueToMaxBuffer) projectIdentityUnavailable();
  if (result.exitCode !== 0) {
    const ordinaryNonGit = result.stderr.toString().includes("not a git repository");
    if (marker || !ordinaryNonGit) projectIdentityUnavailable();
    return { directory:explicit,name:basename(explicit) || explicit,git:false };
  }
  const output = result.stdout.toString().trim();
  if (!output || output.includes("\0") || !isAbsolute(output)) projectIdentityUnavailable();
  let common: string;
  try { common = realpathSync(output); }
  catch { projectIdentityUnavailable(); }
  const name = basename(common) === ".git" ? basename(dirname(common)) : basename(common);
  return { directory:common, name, git:true };
}

export function canonicalProjectForRead(directory: string): CanonicalProject {
  const explicit = readableDirectory(directory);
  try { return canonicalProjectFromDirectory(explicit); }
  catch (error) {
    if (error instanceof MemoryError && error.code === "PROJECT_IDENTITY_UNAVAILABLE") {
      return { directory:explicit, name:basename(explicit) || explicit, git:false };
    }
    throw error;
  }
}

export function canonicalProject(directory: string): CanonicalProject {
  return canonicalProjectFromDirectory(bindableProjectDirectory(directory));
}

export function runtimeProjectDirectory(directory: string, project: CanonicalProject): string {
  const explicit = bindableProjectDirectory(directory);
  if (!project.git) return explicit;
  const executable = process.env.PATH === undefined ? Bun.which("git") : Bun.which("git",{ PATH:process.env.PATH });
  if (!executable) projectIdentityUnavailable();
  let result: Bun.ReadableSyncSubprocess;
  try {
    result = Bun.spawnSync([executable,"-C",explicit,"rev-parse","--show-toplevel"], {
      env:gitEnvironment(),stdout:"pipe",stderr:"pipe",timeout:GIT_TIMEOUT_MS,
      maxBuffer:GIT_MAX_OUTPUT_BYTES,killSignal:"SIGKILL",
    });
  } catch { projectIdentityUnavailable(); }
  if (result.exitedDueToTimeout || result.exitedDueToMaxBuffer || result.exitCode !== 0) projectIdentityUnavailable();
  const output = result.stdout.toString().trim();
  if (!output || output.includes("\0") || !isAbsolute(output)) projectIdentityUnavailable();
  try { return realpathSync(output); }
  catch { projectIdentityUnavailable(); }
}

export function assertGitProjectDirectory(directory: string): void {
  if (!canonicalProject(directory).git) {
    throw new MemoryError("PROJECT_DIRECTORY_REQUIRED","Una carpeta sin Git requiere directory explícito o una raíz MCP única.");
  }
}

// Inspect only recorded bindings. The store remains usable with synthetic paths.
export function bindingAvailable(directory:string):boolean {
  try{return statSync(directory).isDirectory();}catch{return false;}
}
