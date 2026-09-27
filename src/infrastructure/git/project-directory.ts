/**
 * Calcula la identidad canónica (estable, independiente de la ruta usada para invocar) de un proyecto a
 * partir de una carpeta: si está dentro de un repositorio Git, su directorio común de Git (`.git`, o su
 * equivalente en un `worktree`); si no, la propia carpeta resuelta. También calcula la carpeta de trabajo
 * en tiempo de ejecución (el `worktree` actual) y valida que una operación exija Git cuando corresponda.
 * Nunca ejecuta Git contra la carpeta personal del usuario ni contra la raíz del sistema de archivos para
 * fines de vinculación (aunque sí para lectura). La importan `src/app/project-context.ts` y
 * `src/app/project-identity.ts`; `project-context.ts` pasa `bindingAvailable` como parámetro a
 * `src/app/memory-store.ts`, que la entrega a `src/infrastructure/sqlite/projects.ts` y `writes.ts`.
 */
import { accessSync, constants, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

/** Identidad canónica de un proyecto: su carpeta de referencia, un nombre para mostrar y si es un repositorio Git. */
type CanonicalProject = { directory: string; name: string; git: boolean };
const GIT_TIMEOUT_MS = 1000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Lanza el error estándar de carpeta de proyecto inválida.
 * @throws MemoryError con código `INVALID_DIRECTORY` siempre.
 */
function invalidDirectory(): never {
  throw new MemoryError("INVALID_DIRECTORY","La carpeta de proyecto no existe, no es válida o no puede usarse como proyecto.");
}

/**
 * Resuelve una carpeta dada por el usuario a su forma canónica (enlaces simbólicos ya seguidos) y
 * comprueba que sea legible y recorrible.
 * @param directory Ruta de carpeta a validar, tal como la dio el usuario.
 * @returns La ruta canónica y absoluta de la carpeta.
 * @throws MemoryError con código `INVALID_DIRECTORY` si la ruta no es una cadena utilizable, no existe, no
 * es una carpeta, o no se puede leer ni recorrer.
 */
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

/**
 * Además de validar que la carpeta es legible ({@link readableDirectory}), rechaza dos carpetas que nunca
 * deben tratarse como proyecto vinculable: la raíz del sistema de archivos y la carpeta personal del
 * usuario (evita que Engram trate «todo el disco» o «todo el home» como un solo proyecto).
 * @param directory Ruta de carpeta a validar.
 * @returns La ruta canónica de la carpeta, ya confirmada como vinculable.
 * @throws MemoryError con código `INVALID_DIRECTORY` si la carpeta no es legible, o si es la raíz del
 * sistema de archivos o la carpeta personal del usuario.
 */
function bindableProjectDirectory(directory: string): string {
  const canonical = readableDirectory(directory);
  if (canonical === parse(canonical).root || canonical === realpathSync(homedir())) invalidDirectory();
  return canonical;
}

/**
 * Construye el entorno con el que se invoca a `git`, aislado de variables `GIT_*` heredadas y forzado a
 * ignorar la configuración global y del sistema, para que el resultado dependa solo del repositorio.
 * @returns Un entorno de proceso sin variables `GIT_*` heredadas, con bloqueos opcionales desactivados,
 * sin configuración global ni de sistema, y con salida en el idioma neutro `C` (para reconocer mensajes
 * de error de Git de forma estable).
 */
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

/**
 * Lanza el error estándar de identidad Git no determinable de forma segura.
 * @throws MemoryError con código `PROJECT_IDENTITY_UNAVAILABLE` siempre.
 */
function projectIdentityUnavailable(): never {
  throw new MemoryError("PROJECT_IDENTITY_UNAVAILABLE","No se pudo determinar de forma segura la identidad Git del proyecto.");
}

/**
 * Comprueba, sin invocar a `git`, si una carpeta o alguna de sus carpetas padre parece un repositorio Git:
 * o bien tiene una entrada `.git`, o bien ella misma tiene la forma de un repositorio Git «bare» (`HEAD`,
 * `objects` y `refs` en su raíz). Sirve para distinguir «no hay Git» de «Git falló» en
 * {@link canonicalProjectFromDirectory}.
 * @param directory Carpeta desde la que empezar a subir hacia la raíz.
 * @returns `true` si se encontró un indicio de repositorio Git en la carpeta o en algún ancestro.
 * @throws MemoryError con código `PROJECT_IDENTITY_UNAVAILABLE` si inspeccionar alguna ruta falla por una
 * razón distinta a que no exista.
 */
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

/**
 * Calcula la identidad canónica de una carpeta ya validada, preguntándole a `git` su directorio común
 * (`--git-common-dir`); si `git` responde que la carpeta no es un repositorio y no había ningún indicio
 * previo de Git ({@link hasGitMarker}), la trata como un proyecto sin Git en vez de fallar.
 * @param explicit Carpeta canónica ya validada desde la que consultar a `git`.
 * @returns La identidad canónica: si es un repositorio Git, su directorio común real (`.git` u otra
 * carpeta en un `worktree`) y el nombre derivado de él; si no, la carpeta misma y su nombre base.
 * @throws MemoryError con código `PROJECT_IDENTITY_UNAVAILABLE` si no hay ejecutable `git` en el `PATH`, si
 * el proceso falla, se agota el tiempo o el búfer de salida, si `git` falla por una razón distinta a «no es
 * un repositorio» (o falla así pero sí había un indicio de Git), o si su salida no es una ruta absoluta
 * utilizable.
 */
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

/**
 * Calcula la identidad canónica de una carpeta para operaciones de solo lectura, sin restringir la
 * carpeta personal del usuario ni la raíz del sistema de archivos (a diferencia de {@link canonicalProject});
 * si la identidad Git no se puede determinar de forma segura, degrada a tratar la carpeta como un
 * proyecto sin Git en vez de fallar.
 * @param directory Carpeta a identificar, tal como la dio el usuario.
 * @returns La identidad canónica del proyecto.
 * @throws MemoryError con código `INVALID_DIRECTORY` si la carpeta no es legible.
 */
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

/**
 * Calcula la identidad canónica de una carpeta para operaciones que crean o vinculan un proyecto,
 * rechazando la carpeta personal del usuario y la raíz del sistema de archivos.
 * @param directory Carpeta a identificar, tal como la dio el usuario.
 * @returns La identidad canónica del proyecto.
 * @throws MemoryError con código `INVALID_DIRECTORY` si la carpeta no es vinculable; con
 * `PROJECT_IDENTITY_UNAVAILABLE` si la identidad Git no se pudo determinar de forma segura.
 */
export function canonicalProject(directory: string): CanonicalProject {
  return canonicalProjectFromDirectory(bindableProjectDirectory(directory));
}

/**
 * Calcula la carpeta de trabajo (`worktree`) actual correspondiente a una identidad canónica ya conocida:
 * para un proyecto sin Git, es la propia carpeta validada; para uno con Git, es lo que reporte
 * `git rev-parse --show-toplevel` desde esa carpeta (puede diferir del `worktree` original si el
 * repositorio se movió).
 * @param directory Carpeta desde la que consultar, tal como la dio el usuario.
 * @param project Identidad canónica ya calculada (p. ej. con {@link canonicalProject}).
 * @returns La ruta canónica de la carpeta de trabajo actual.
 * @throws MemoryError con código `INVALID_DIRECTORY` si la carpeta no es vinculable; con
 * `PROJECT_IDENTITY_UNAVAILABLE` si `project.git` es `true` y no se pudo determinar la carpeta de trabajo
 * (sin `git` en el `PATH`, fallo, tiempo agotado, o salida no utilizable).
 */
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

/**
 * Exige que una carpeta sea (o esté dentro de) un repositorio Git, para operaciones que dependen de tener
 * un repositorio real y no aceptan una carpeta sin Git como sustituto implícito.
 * @param directory Carpeta a comprobar.
 * @throws MemoryError con código `PROJECT_DIRECTORY_REQUIRED` si la carpeta no es un repositorio Git; los
 * códigos de {@link canonicalProject} si la carpeta ni siquiera es vinculable o su identidad no se pudo
 * determinar.
 */
export function assertGitProjectDirectory(directory: string): void {
  if (!canonicalProject(directory).git) {
    throw new MemoryError("PROJECT_DIRECTORY_REQUIRED","Una carpeta sin Git requiere directory explícito o una raíz MCP única.");
  }
}

/**
 * Comprueba si una carpeta vinculada anteriormente (guardada como clave de vinculación) sigue existiendo
 * en disco; solo inspecciona vinculaciones ya registradas, nunca calcula una nueva. El almacén sigue siendo
 * utilizable con rutas sintéticas (que nunca existirán en disco) para proyectos de prueba.
 * @param directory Ruta guardada como clave de vinculación de un proyecto.
 * @returns `true` si la ruta existe y es una carpeta.
 */
export function bindingAvailable(directory:string):boolean {
  try{return statSync(directory).isDirectory();}catch{return false;}
}

/**
 * Da la raíz del `worktree` que debería contener `.forge614/project.json` para una carpeta dada.
 * @param directory Carpeta a identificar, tal como la dio el usuario.
 * @param canonical Identidad canónica ya calculada, si se conoce; si se omite, se calcula con
 * {@link canonicalProjectForRead}.
 * @returns La ruta de la raíz del `worktree`, o `null` si no hay una raíz segura y ordinaria (identidad no
 * determinable, o cualquier otro fallo al resolverla).
 */
export function identityRoot(directory: string, canonical?: CanonicalProject): string | null {
  try { return runtimeProjectDirectory(directory, canonical ?? canonicalProjectForRead(directory)); }
  catch { return null; }
}

/**
 * Una clave de vinculación registrada es el directorio común de Git para repositorios normales (su carpeta
 * padre es el `worktree`) o la propia carpeta en cualquier otro caso. Los repositorios «bare» no tienen
 * `worktree`, así que no tienen archivo de identidad.
 * @param key Clave de vinculación guardada (directorio común de Git, o carpeta sin Git).
 * @returns La carpeta padre si `key` es un `.git` normal; `null` si `key` no existe, no es una carpeta, o
 * tiene la forma de un repositorio Git «bare»; en cualquier otro caso, la propia `key`.
 */
export function rootOfBinding(key: string): string | null {
  try {
    if (!statSync(key).isDirectory()) return null;
    if (basename(key) === ".git") return dirname(key);
    if (existsSync(join(key, "HEAD")) && existsSync(join(key, "objects")) && existsSync(join(key, "refs"))) return null;
    return key;
  } catch { return null; }
}
