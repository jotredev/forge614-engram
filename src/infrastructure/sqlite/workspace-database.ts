/**
 * Valida que la base de datos SQLite del área de trabajo (workspace) y sus archivos auxiliares
 * (los que SQLite crea junto al principal: -wal, -shm, -journal) sean seguros de abrir antes de
 * dejar que bun:sqlite los toque, y crea el archivo principal de forma exclusiva cuando hace
 * falta, evitando una carrera (que dos procesos lo creen a la vez) y sin truncar una base existente.
 */
import { closeSync, existsSync, lstatSync, openSync, readSync } from "node:fs";
import { MemoryError } from "../../shared/errors";

/**
 * Comprueba que `path`, si existe, sea un archivo normal (ni enlace simbólico ni con más de un
 * enlace duro) y del mismo dueño que el proceso actual; si no lo es, lanza DATABASE_PATH_UNSAFE.
 * @param path Ruta a comprobar (puede ser el archivo principal o uno de sus auxiliares).
 * @returns `true` si el archivo existe y es seguro; `false` si no existe.
 * @throws DATABASE_PATH_UNSAFE si el archivo existe pero no es un archivo normal de un solo dueño.
 */
function existsAsOwnedFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    // Un enlace simbólico, un archivo con más de un enlace duro o de otro dueño podría apuntar
    // fuera del área privada; se rechaza antes de que SQLite llegue a abrirlo.
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new MemoryError("DATABASE_PATH_UNSAFE", "La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido. No se abrió SQLite.");
    }
    return true;
  } catch (error) {
    // ENOENT (el archivo no existe) no es un problema de seguridad: simplemente no hay nada que validar todavía.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Comprueba si `path` es el caso preciso de T6b: una base cuyo encabezado ya quedó en modo WAL
 * (el byte 18 vale 2, ver la documentación del formato de archivo de SQLite) pero a la que le
 * falta su archivo auxiliar `-shm`, porque SQLite los borra al cerrarse la última conexión y
 * puede pasar justo antes de la primera sesión. Solo lee el encabezado, sin abrir la base con
 * SQLite; si `path` no se puede leer (por ejemplo, sin permiso), no es este caso.
 * @param path Ruta del archivo principal de la base de datos.
 * @returns `true` solo cuando el encabezado es legible, está en modo WAL y falta `-shm`.
 */
export function missingWalSidecar(path: string): boolean {
  if (existsSync(path + "-shm")) return false;
  try {
    const fd = openSync(path, "r");
    try {
      const header = Buffer.alloc(20);
      readSync(fd, header, 0, 20, 0);
      return header[18] === 2;
    } finally { closeSync(fd); }
  } catch { return false; }
}

/**
 * Abre la base de datos del área de trabajo tras validar que ella y sus auxiliares son seguros,
 * creándola de forma exclusiva si hace falta y sin truncar una que ya exista.
 * Solo se llama después de haber validado la carpeta privada del área de trabajo.
 * @param path Ruta del archivo principal de la base de datos.
 * @param create Si se permite crear la base cuando no existe.
 * @param readonly Si la conexión debe abrirse en modo de solo lectura.
 * @param open Función que abre la conexión real (por ejemplo `openDatabase`), inyectada para poder probarla.
 * @returns El resultado de `open`, típicamente la conexión ya abierta.
 * @throws DATABASE_MISSING si la base no existe y `create` es falso.
 * @throws DATABASE_PATH_UNSAFE si el archivo principal o alguno de sus auxiliares no es seguro (ver `existsAsOwnedFile`).
 */
export function openWorkspaceDatabase<T>(path: string, create: boolean, readonly: boolean, open: (path: string, options: { create: boolean; readonly: boolean }) => T): T {
  // También se validan los archivos auxiliares (sidecars): SQLite puede abrirlos como parte del manejo normal de su bitácora de transacciones (journal).
  for (const suffix of ["-wal", "-shm", "-journal"]) existsAsOwnedFile(path + suffix);
  const exists = existsAsOwnedFile(path);
  if (!exists && !create) throw new MemoryError("DATABASE_MISSING", "Falta la base configurada. No se creó un reemplazo; conserva la configuración y recupera tu base.");
  if (!exists) {
    // "wx" crea el archivo de forma exclusiva (falla si ya existe), así se reclama la ruta antes de que SQLite la toque.
    try { closeSync(openSync(path, "wx", 0o600)); }
    catch (error) {
      // Otro proceso que inicializa al mismo tiempo puede ganar la carrera de creación exclusiva; nunca se trunca (vacía) el archivo existente.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Se revalida por si, en esa carrera, el archivo lo creó un proceso con un dueño o tipo distinto.
    existsAsOwnedFile(path);
  }
  return open(path, { create, readonly });
}
