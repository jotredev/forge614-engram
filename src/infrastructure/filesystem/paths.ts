import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

/** Shared Forge614 parent. Individual products must use their own child directory. */
export function forge614Home(): string {
  if (!Object.hasOwn(process.env, "FORGE614_HOME")) return join(homedir(), ".forge614");
  const configured = process.env.FORGE614_HOME;
  if (!configured || configured.includes("\0") || !isAbsolute(configured)) {
    throw new MemoryError("INVALID_FORGE614_HOME", "FORGE614_HOME debe ser una ruta absoluta no vacía.");
  }
  return resolve(configured);
}

/** Engram-owned storage, independent of the project or process working directory. */
export function engramHome(): string { return join(forge614Home(), "engram"); }

export function engramBinDirectory(): string { return join(engramHome(), "bin"); }

/** Backwards-compatible name for the default Engram workspace. */
export function userStorageDirectory(): string { return engramHome(); }

export function defaultDatabasePath(): string { return join(engramHome(), "engram.db"); }

/** Previous releases stored this database directly in the shared Forge614 parent. */
export function legacyDatabasePath(): string { return join(forge614Home(), "engram.db"); }
