import { chmodSync, lstatSync, mkdirSync, renameSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

const LEGACY_NAMES = [".env", "engram.db", "engram.db-wal", "engram.db-shm", ".config-lock"] as const;
type LegacyName = (typeof LEGACY_NAMES)[number];

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function currentUser(stat: Stats): boolean { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
function fail(code: string, message: string): never { throw new MemoryError(code, message); }

function existing(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) { if (missing(error)) return null; fail("LEGACY_UNSAFE", "No se pudo verificar una ruta de Engram."); }
}

function privateDirectory(path: string, create: boolean): void {
  if (create) {
    try { mkdirSync(path, { recursive: true, mode: 0o700 }); }
    catch { fail("LEGACY_UNSAFE", "No se pudo crear el espacio privado de Engram."); }
  }
  const stat = existing(path);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || !currentUser(stat)) {
    fail("LEGACY_UNSAFE", "La carpeta de Forge614 o Engram no es una carpeta privada válida.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    try { chmodSync(path, 0o700); }
    catch { fail("LEGACY_UNSAFE", "No se pudieron reparar los permisos privados de Engram."); }
  }
  const repaired = existing(path);
  if (!repaired || !repaired.isDirectory() || repaired.isSymbolicLink() || !currentUser(repaired) ||
    (process.platform !== "win32" && (repaired.mode & 0o077) !== 0)) {
    fail("LEGACY_UNSAFE", "La carpeta de Forge614 o Engram no cumple los permisos privados requeridos.");
  }
}

function regularOwnedFile(path: string): boolean {
  const stat = existing(path);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || !currentUser(stat)) {
    fail("LEGACY_UNSAFE", "Un archivo antiguo de Engram no es seguro para migrar.");
  }
  return true;
}

/** Owns the Engram product directory but never a sibling under the Forge614 parent. */
export class EngramProductHome {
  readonly parent: string;
  readonly root: string;

  constructor(parent: string, root: string) {
    this.parent = resolve(parent);
    this.root = resolve(root);
    if (this.root !== join(this.parent, "engram")) {
      fail("INVALID_INPUT", "El espacio de producto de Engram debe estar dentro de la carpeta Forge614.");
    }
  }

  prepare(): void {
    privateDirectory(this.parent, true);
    privateDirectory(this.root, true);
  }

  migrateLegacyWorkspace(): "none" | "migrated" {
    privateDirectory(this.parent, true);
    const sources = LEGACY_NAMES.filter(name => regularOwnedFile(join(this.parent, name)));
    if (sources.length === 0) {
      privateDirectory(this.root, true);
      return "none";
    }

    if ((sources.includes("engram.db-wal") || sources.includes("engram.db-shm")) && !sources.includes("engram.db")) {
      fail("LEGACY_CONFLICT", "Los archivos auxiliares antiguos de SQLite requieren su base engram.db para migrarse.");
    }

    const rootStat = existing(this.root);
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !currentUser(rootStat))) {
      fail("LEGACY_CONFLICT", "La carpeta destino de Engram ya existe y no es segura.");
    }
    for (const name of LEGACY_NAMES) {
      if (existing(join(this.root, name))) {
        fail("LEGACY_CONFLICT", "La carpeta nueva de Engram ya contiene un archivo que impediría migrar datos sin reemplazarlos.");
      }
    }

    privateDirectory(this.root, true);
    const moved: LegacyName[] = [];
    try {
      for (const name of sources) {
        renameSync(join(this.parent, name), join(this.root, name));
        moved.push(name);
      }
    } catch {
      for (const name of moved.reverse()) {
        try { renameSync(join(this.root, name), join(this.parent, name)); }
        catch { /* Preserve every recoverable file and report the incomplete transaction. */ }
      }
      fail("LEGACY_MIGRATION_FAILED", "No se pudieron mover los datos antiguos de Engram de forma segura.");
    }
    return "migrated";
  }
}
