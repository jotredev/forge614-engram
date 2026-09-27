/**
 * Prepara y protege la carpeta propia de Engram (`~/.forge614/engram` o el equivalente configurado) y
 * migra en el sitio los archivos que versiones anteriores guardaban sueltos en la carpeta compartida de
 * Forge614 (`.env`, la base SQLite y sus auxiliares, el candado de configuración). Comprueba en cada paso
 * que las carpetas y archivos son privados del usuario actual, no enlaces simbólicos, para no operar sobre
 * algo que otro usuario o proceso pudiera haber sustituido. La usa
 * `src/infrastructure/filesystem/workspace-config.ts`.
 */
import { chmodSync, lstatSync, mkdirSync, renameSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";

const LEGACY_NAMES = [".env", "engram.db", "engram.db-wal", "engram.db-shm", ".config-lock"] as const;
/** Nombre de uno de los archivos que Engram guardaba antes directamente en la carpeta de Forge614. */
type LegacyName = (typeof LEGACY_NAMES)[number];

/**
 * Distingue «la ruta no existe» de cualquier otro error del sistema de archivos (permisos, E/S, etc.).
 * @param error Valor capturado de un `catch`, típicamente un error de Node con `code`.
 * @returns `true` si el error es `ENOENT` (ruta inexistente).
 */
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
/**
 * Comprueba que una ruta pertenece al usuario que ejecuta el proceso actual, para no tocar archivos de
 * otra cuenta. En plataformas sin `process.getuid` (Windows) se asume siempre del usuario actual.
 * @param stat Resultado de `lstatSync` sobre la ruta a comprobar.
 * @returns `true` si no hay forma de comprobar el dueño o si el dueño coincide con el usuario actual.
 */
function currentUser(stat: Stats): boolean { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
/**
 * Lanza un `MemoryError` con el código y mensaje dados; su tipo de retorno `never` permite usarla dentro
 * de una expresión sin que el resto del código deba comprobar un valor de error.
 * @param code Código de máquina del fallo (p. ej. `LEGACY_UNSAFE`, `LEGACY_CONFLICT`).
 * @param message Mensaje legible para personas.
 * @throws MemoryError siempre, con el código y mensaje recibidos.
 */
function fail(code: string, message: string): never { throw new MemoryError(code, message); }

/**
 * Obtiene la información de una ruta sin lanzar si no existe.
 * @param path Ruta a inspeccionar.
 * @returns El resultado de `lstatSync` (no sigue enlaces simbólicos), o `null` si la ruta no existe.
 * @throws MemoryError con código `LEGACY_UNSAFE` si `lstat` falla por una razón distinta a que falte la ruta.
 */
function existing(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) { if (missing(error)) return null; fail("LEGACY_UNSAFE", "No se pudo verificar una ruta de Engram."); }
}

/**
 * Asegura que una carpeta propia de Engram existe, es privada del usuario actual y no es un enlace
 * simbólico; si sus permisos permiten acceso a otros usuarios (fuera de `0o700`), intenta repararlos y
 * vuelve a comprobar antes de continuar.
 * @param path Ruta de la carpeta a validar (o crear).
 * @param create Si es `true`, crea la carpeta (y sus carpetas padre) con modo `0o700` antes de validarla.
 * @throws MemoryError con código `LEGACY_UNSAFE` si la carpeta no se puede crear, no es una carpeta válida
 * y privada, o sus permisos no se pueden reparar o siguen sin ser seguros tras el intento.
 */
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

/**
 * Asegura que la carpeta compartida de Forge614 (padre de la de Engram) existe y es del usuario actual.
 * A diferencia de {@link privateDirectory}, nunca le cambia los permisos (`chmod`), porque puede contener
 * carpetas de otros productos hermanos de Forge614 que Engram no debe restringir; solo rechaza si permite
 * escritura de grupo u otros.
 * @param path Ruta de la carpeta compartida a validar (o crear).
 * @param create Si es `true`, crea la carpeta (y sus carpetas padre) con modo `0o700` antes de validarla.
 * @throws MemoryError con código `LEGACY_UNSAFE` si no se puede crear, no es una carpeta privada del
 * usuario actual, o permite escritura de grupo u otros usuarios.
 */
function sharedParentDirectory(path: string, create: boolean): void {
  if (create) {
    try { mkdirSync(path, { recursive: true, mode: 0o700 }); }
    catch { fail("LEGACY_UNSAFE", "No se pudo crear el contenedor compartido de Forge614."); }
  }
  const stat = existing(path);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || !currentUser(stat)) {
    fail("LEGACY_UNSAFE", "La carpeta compartida de Forge614 no es segura.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) {
    fail("LEGACY_UNSAFE", "La carpeta compartida de Forge614 permite escrituras de otros usuarios.");
  }
}

/**
 * Comprueba si un candidato a archivo antiguo de Engram existe y, si existe, que sea un archivo regular
 * del usuario actual y no un enlace simbólico (para no migrar algo que apunte fuera de la carpeta).
 * @param path Ruta del posible archivo antiguo.
 * @returns `true` si el archivo existe y es seguro para migrar; `false` si no existe.
 * @throws MemoryError con código `LEGACY_UNSAFE` si la ruta existe pero no es un archivo regular seguro.
 */
function regularOwnedFile(path: string): boolean {
  const stat = existing(path);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink() || !currentUser(stat)) {
    fail("LEGACY_UNSAFE", "Un archivo antiguo de Engram no es seguro para migrar.");
  }
  return true;
}

/**
 * Representa la carpeta de producto de Engram dentro de la carpeta compartida de Forge614: crea y protege
 * esa carpeta, y migra en el sitio los archivos que versiones anteriores guardaban sueltos en el padre
 * compartido. Nunca crea ni gestiona carpetas de productos hermanos bajo ese mismo padre.
 */
export class EngramProductHome {
  readonly parent: string;
  readonly root: string;

  /**
   * @param parent Carpeta compartida de Forge614 que debe contener a `root`.
   * @param root Carpeta propia de Engram; debe ser exactamente `engram` dentro de `parent`.
   * @throws MemoryError con código `INVALID_INPUT` si `root` no es la subcarpeta `engram` de `parent`.
   */
  constructor(parent: string, root: string) {
    this.parent = resolve(parent);
    this.root = resolve(root);
    if (this.root !== join(this.parent, "engram")) {
      fail("INVALID_INPUT", "El espacio de producto de Engram debe estar dentro de la carpeta Forge614.");
    }
  }

  /**
   * Crea (si hace falta) y valida tanto la carpeta compartida de Forge614 como la carpeta propia de
   * Engram, dejando esta última con permisos privados `0o700`.
   * @throws MemoryError si alguna de las dos carpetas no se puede crear o no queda en un estado seguro.
   */
  prepare(): void {
    sharedParentDirectory(this.parent, true);
    privateDirectory(this.root, true);
  }

  /**
   * Mueve a la carpeta propia de Engram los archivos que versiones anteriores guardaban sueltos en la
   * carpeta compartida de Forge614 (`.env`, `engram.db` y sus auxiliares WAL/SHM, `.config-lock`); si
   * alguno de los movimientos falla a mitad de camino, deshace los que ya se habían movido antes de
   * lanzar, para no dejar los datos repartidos entre las dos carpetas.
   * @returns `"none"` si no había ningún archivo antiguo que migrar; `"migrated"` si se movieron.
   * @throws MemoryError con código `LEGACY_CONFLICT` si hay auxiliares de SQLite (WAL o SHM) sin su base
   * `engram.db`, si la carpeta destino ya existe sin ser segura, o si la carpeta destino ya contiene un
   * archivo que impediría mover los datos antiguos sin reemplazarlo; con código `LEGACY_UNSAFE` si algún
   * archivo o carpeta involucrado no es seguro; con código `LEGACY_MIGRATION_FAILED` si el traslado falla
   * a mitad de camino, después de intentar devolver cada archivo movido a su ubicación original (se lanza
   * aunque la devolución salga bien).
   */
  migrateLegacyWorkspace(): "none" | "migrated" {
    sharedParentDirectory(this.parent, true);
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
      // Mueve los archivos uno por uno, anotando cada uno que se logra mover por si hay que revertir.
      for (const name of sources) {
        renameSync(join(this.parent, name), join(this.root, name));
        moved.push(name);
      }
    } catch {
      // Si un movimiento falla a mitad de la lista, devuelve en orden inverso los que sí se movieron.
      for (const name of moved.reverse()) {
        try { renameSync(join(this.root, name), join(this.parent, name)); }
        catch { /* Conserva cada archivo recuperable y reporta igual la transacción incompleta. */ }
      }
      fail("LEGACY_MIGRATION_FAILED", "No se pudieron mover los datos antiguos de Engram de forma segura.");
    }
    return "migrated";
  }
}
