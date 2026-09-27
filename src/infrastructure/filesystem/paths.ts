/**
 * Calcula las rutas de almacenamiento de Engram en el disco del usuario: la carpeta compartida de
 * Forge614, la carpeta propia de Engram dentro de ella, su carpeta de binarios y la ruta de la base
 * de datos por defecto (además de la ruta heredada de versiones anteriores). La usan
 * `src/app/uninstall.ts`, `src/app/index.ts`,
 * `src/infrastructure/filesystem/workspace-config.ts`, `src/infrastructure/filesystem/path-publication.ts`,
 * `src/infrastructure/sqlite/connection.ts`, `src/infrastructure/updater.ts` y `src/index.ts`;
 * `src/app/memory-store.ts` recibe `defaultDatabasePath` a través de `src/infrastructure/sqlite/connection.ts`,
 * que la reexporta.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

/**
 * Da la carpeta padre compartida por todos los productos de Forge614 (cada producto debe usar su propia
 * subcarpeta dentro de ella, nunca escribir directamente aquí).
 * @returns `$FORGE614_HOME` resuelto a ruta absoluta si la variable de entorno está definida; si no,
 * `~/.forge614`.
 * @throws MemoryError con código `INVALID_FORGE614_HOME` si `FORGE614_HOME` está definida pero vacía,
 * contiene un carácter nulo o no es una ruta absoluta.
 */
export function forge614Home(): string {
  if (!Object.hasOwn(process.env, "FORGE614_HOME")) return join(homedir(), ".forge614");
  const configured = process.env.FORGE614_HOME;
  if (!configured || configured.includes("\0") || !isAbsolute(configured)) {
    throw new MemoryError("INVALID_FORGE614_HOME", "FORGE614_HOME debe ser una ruta absoluta no vacía.");
  }
  return resolve(configured);
}

/**
 * Da la carpeta propia de Engram, independiente del proyecto o del directorio de trabajo del proceso.
 * @returns La subcarpeta `engram` dentro de {@link forge614Home}.
 */
export function engramHome(): string { return join(forge614Home(), "engram"); }

/**
 * Da la carpeta donde Engram publica sus binarios ejecutables (el enlace o copia que el usuario invoca
 * desde la terminal).
 * @returns La subcarpeta `bin` dentro de {@link engramHome}.
 */
export function engramBinDirectory(): string { return join(engramHome(), "bin"); }

/**
 * Nombre de compatibilidad hacia atrás para {@link engramHome}, usado donde el código todavía habla de
 * «almacenamiento del usuario» en vez de «carpeta de Engram».
 * @returns El mismo valor que {@link engramHome}.
 */
export function userStorageDirectory(): string { return engramHome(); }

/**
 * Da la ruta del archivo de base de datos SQLite que usa Engram quien no configura una base de proyecto.
 * @returns `engram.db` dentro de {@link engramHome}.
 */
export function defaultDatabasePath(): string { return join(engramHome(), "engram.db"); }

/**
 * Da la ruta donde versiones anteriores de Engram guardaban la base de datos directamente en la carpeta
 * compartida de Forge614, antes de moverla a su propia subcarpeta; solo la usa su propia prueba para
 * comprobar la ruta heredada, ningún otro módulo la llama.
 * @returns `engram.db` dentro de {@link forge614Home}.
 */
export function legacyDatabasePath(): string { return join(forge614Home(), "engram.db"); }
