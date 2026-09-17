import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { MemoryError } from "./domain";
import { userStorageDirectory } from "./paths";

export interface WorkspaceSettings { storage: "sqlite" }
function failure(code = "CONFIG_INVALID"): never {
  throw new MemoryError(code, "Configuración global inválida o inaccesible. Comprueba su formato, propietario y permisos (carpeta 700, archivo 600), sin compartir su contenido.");
}
function errno(error: unknown, code: string): boolean { return (error as NodeJS.ErrnoException)?.code === code; }
function privateOwned(stat: Stats): boolean {
  return (stat.mode & 0o077) === 0 && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}

/** Single private workspace config. No environment loading or shell evaluation. */
export class WorkspaceConfig {
  readonly root: string;
  constructor(root = userStorageDirectory()) {
    if (typeof root !== "string" || !isAbsolute(root) || /[\x00-\x1f\x7f]/.test(root)) {
      throw new MemoryError("INVALID_INPUT", "La carpeta del usuario requiere una ruta absoluta válida.");
    }
    this.root = resolve(root);
  }
  get databasePath(): string { return join(this.root, "engram.db"); }

  prepare(): void { this.directory(true); }

  private directory(create: boolean): boolean {
    if (create) {
      try { mkdirSync(this.root, { recursive: true, mode: 0o700 }); }
      catch { failure(); }
    }
    try {
      const stat = lstatSync(this.root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwned(stat)) failure();
    } catch (error) {
      if (!create && errno(error, "ENOENT")) return false;
      failure();
    }
    try {
      lstatSync(join(this.root, "projects"));
      throw new MemoryError("LEGACY_CONFIG", "Se detectó configuración antigua por proyecto. No se modificó. Su conversión debe ser explícita; no se importará ni eliminará automáticamente.");
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      if (!errno(error, "ENOENT")) failure();
    }
    return true;
  }

  exists(): boolean {
    if (!this.directory(false)) return false;
    try { lstatSync(join(this.root, ".env")); return true; }
    catch (error) { if (errno(error, "ENOENT")) return false; return failure(); }
  }

  read(): WorkspaceSettings {
    if (!this.directory(false)) failure("CONFIG_NOT_FOUND");
    let fd: number | undefined;
    try {
      fd = openSync(join(this.root, ".env"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || !privateOwned(stat) || stat.size > 16384) failure();
      const values = new Map<string, string>();
      for (const line of readFileSync(fd, "utf8").split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const match = /^([A-Z_]+)=(".*")$/.exec(line);
        if (!match || values.has(match[1]!)) failure();
        const value: unknown = JSON.parse(match[2]!);
        if (typeof value !== "string") failure();
        values.set(match[1]!, value);
      }
      if (values.size !== 2 || values.get("FORMAT_VERSION") !== "2" || values.get("STORAGE") !== "sqlite") failure();
      return { storage: "sqlite" };
    } catch (error) {
      if (errno(error, "ENOENT")) failure("CONFIG_NOT_FOUND");
      return failure();
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  save(): void {
    this.prepare();
    const destination = join(this.root, ".env");
    const content = 'FORMAT_VERSION="2"\nSTORAGE="sqlite"\n';
    const temporary = join(this.root, `.env-${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    let ownsTemporary = false;
    try {
      fd = openSync(temporary, "wx", 0o600); ownsTemporary = true;
      writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
      try { linkSync(temporary, destination); }
      catch (error) {
        if (!errno(error, "EEXIST")) failure();
        this.read(); // Compatible existing config is retained byte-for-byte.
      }
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      failure();
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (ownsTemporary) unlinkSync(temporary);
    }
  }
}
