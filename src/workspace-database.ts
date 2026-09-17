import { closeSync, lstatSync, openSync } from "node:fs";
import { MemoryError } from "./domain";
import { MemoryStore } from "./store";

function existsAsOwnedFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new MemoryError("DATABASE_PATH_UNSAFE", "La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido. No se abrió SQLite.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Called only after the private workspace root has been validated. */
export function openWorkspaceDatabase(path: string, create: boolean, readonly: boolean): MemoryStore {
  // Validate sidecars too: SQLite may open them as part of normal journal handling.
  for (const suffix of ["-wal", "-shm", "-journal"]) existsAsOwnedFile(path + suffix);
  const exists = existsAsOwnedFile(path);
  if (!exists && !create) throw new MemoryError("DATABASE_MISSING", "Falta la base configurada. No se creó un reemplazo; conserva la configuración y recupera tu base.");
  if (!exists) {
    try { closeSync(openSync(path, "wx", 0o600)); }
    catch (error) {
      // Another initializer can win the exclusive creation race. Never truncate.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    existsAsOwnedFile(path);
  }
  return new MemoryStore(path, { create, readonly });
}
