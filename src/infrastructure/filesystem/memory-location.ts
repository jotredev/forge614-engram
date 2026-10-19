/** Decide dónde viven los datos persistentes de Engram y migra la instalación 1.9.0 de forma atómica. */
import { Database } from "bun:sqlite";
import { backup, DatabaseSync } from "node:sqlite";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { withMemoryMigrationLock } from "./memory-migration-lock";

function exists(path: string): boolean {
  try { return lstatSync(path).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Comprueba la existencia de cualquier tipo de entrada sin seguir enlaces simbólicos. */
function pathExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  let stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Unsafe Engram memory directory");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    chmodSync(path, 0o700);
    stat = lstatSync(path);
    if ((stat.mode & 0o077) !== 0) throw new Error("Engram memory directory permissions are not private");
  }
}

/** Detecta descriptores abiertos de la base antigua antes de moverla fuera de su ruta publicada. */
function hasOpenLegacyHandle(databasePath: string): boolean {
  if (process.platform === "win32") {
    const probe = `${databasePath}.migration-probe`;
    try { renameSync(databasePath, probe); renameSync(probe, databasePath); return false; }
    catch { try { if (exists(probe)) renameSync(probe, databasePath); } catch { /* La ruta original sigue protegida por el bloqueo. */ } return true; }
  }
  const target = realpathSync(databasePath);
  if (process.platform === "linux") {
    let pids: string[];
    try { pids = readdirSync("/proc").filter(name => /^\d+$/.test(name)); }
    catch { return true; }
    for (const pid of pids) {
      let descriptors: string[];
      try { descriptors = readdirSync(`/proc/${pid}/fd`); }
      catch { continue; }
      for (const descriptor of descriptors) {
        try { if (realpathSync(`/proc/${pid}/fd/${descriptor}`) === target) return true; }
        catch { /* El proceso cerró el descriptor durante la inspección. */ }
      }
    }
    return false;
  }
  const result = spawnSync("lsof", ["-Fn", databasePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || (result.status !== 0 && Boolean(result.stderr.trim()))) return true;
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * Devuelve `memory/` cuando ya es la ubicación activa o no hay base anterior. Si la base 1.9.0
 * sigue abierta y SQLite no puede vaciar su WAL, conserva temporalmente `engram/` como ubicación.
 * @param forgeHome Raíz configurada de Forge614.
 * @param engramHome Carpeta del programa, que contiene los datos de 1.9.0.
 * @returns La carpeta elegida para la base, `.env` y respaldos.
 */
export function resolveMemoryDirectoryUnlocked(forgeHome: string, engramHome: string): string {
  const target = join(forgeHome, "memory");
  const targetDb = join(target, "engram.db");
  const legacyDb = join(engramHome, "engram.db");
  const probeDb = `${legacyDb}.migration-probe`;
  if (!pathExists(legacyDb) && pathExists(probeDb)) renameSync(probeDb, legacyDb);
  if (exists(targetDb)) { privateDirectory(target); return target; }
  if (!exists(legacyDb)) return target;

  if (hasOpenLegacyHandle(legacyDb)) return engramHome;

  const old = new Database(legacyDb, { create: false, readwrite: true });
  let beforeCount: number;
  try {
    const checkpoint = old.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number };
    if (checkpoint.busy !== 0) return engramHome;
    beforeCount = Number((old.query("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count);
  } finally { old.close(); }

  privateDirectory(forgeHome);
  const stage = mkdtempSync(join(forgeHome, ".memory-migration-"));
  try {
    const names = readdirSync(engramHome).filter(name => name === ".env" || name === "engram.db" || name.startsWith("engram.db-"));
    for (const name of names) {
      const source = join(engramHome, name);
      const sourceStat = lstatSync(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || (typeof process.getuid === "function" && sourceStat.uid !== process.getuid())) throw new Error("Unsafe legacy memory file");
      copyFileSync(source, join(stage, name));
      if (process.platform !== "win32") chmodSync(join(stage, name), sourceStat.mode & 0o777);
    }
    if (pathExists(target)) {
      privateDirectory(target);
      for (const name of readdirSync(target)) {
        const source = join(target, name);
        const sourceStat = lstatSync(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || (typeof process.getuid === "function" && sourceStat.uid !== process.getuid())) throw new Error("Unsafe existing memory file");
        copyFileSync(source, join(stage, name));
        if (process.platform !== "win32") chmodSync(join(stage, name), sourceStat.mode & 0o777);
      }
    }
    if (process.env.NODE_ENV === "test" && process.env.FORGE614_MEMORY_MIGRATION_TEST_FAIL === "after-copy") throw new Error("Injected memory migration failure after copy");
    const copy = new Database(join(stage, "engram.db"), { create: false, readonly: true });
    try {
      const integrity = (copy.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      const afterCount = Number((copy.query("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count);
      if (integrity !== "ok" || afterCount !== beforeCount) throw new Error("Legacy memory copy verification failed");
    } finally { copy.close(); }

    if (exists(targetDb)) { rmSync(stage, { recursive: true, force: true }); return target; }
    const displacedTarget = pathExists(target) ? join(forgeHome, `.memory-existing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) : "";
    if (displacedTarget) renameSync(target, displacedTarget);
    try { renameSync(stage, target); }
    catch (error) {
      if (displacedTarget && !exists(target)) renameSync(displacedTarget, target);
      if (exists(targetDb)) { rmSync(stage, { recursive: true, force: true }); return target; }
      if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") { rmSync(stage, { recursive: true, force: true }); return engramHome; }
      throw error;
    }
    if (displacedTarget) rmSync(displacedTarget, { recursive: true, force: true });
    for (const name of names) rmSync(join(engramHome, name), { force: true });
    return target;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

/** Decide y, si procede, migra la carpeta de memoria bajo el bloqueo compartido. */
export function resolveMemoryDirectory(forgeHome: string, engramHome: string): string {
  if (!exists(join(forgeHome, "memory", "engram.db")) && !exists(join(engramHome, "engram.db")) && !pathExists(join(engramHome, "engram.db.migration-probe"))) {
    return join(forgeHome, "memory");
  }
  return withMemoryMigrationLock(forgeHome, () => resolveMemoryDirectoryUnlocked(forgeHome, engramHome));
}

/**
 * Asegura una copia privada y verificada antes de que el instalador elimine `engram/`. Si SQLite mantiene
 * el archivo ocupado, usa la API de respaldo en línea para copiar un snapshot consistente.
 * @param forgeHome Raíz configurada de Forge614.
 * @param engramHome Carpeta del programa y posible ubicación heredada.
 * @returns La carpeta privada que conservará la memoria.
 * @throws Error si no se puede verificar una copia completa; quien llama debe detener la desinstalación.
 */
export async function ensureMemoryBeforeUninstall(forgeHome: string, engramHome: string): Promise<string> {
  const directory = resolveMemoryDirectory(forgeHome, engramHome);
  const target = join(forgeHome, "memory");
  const targetDb = join(target, "engram.db");
  const legacyDb = join(engramHome, "engram.db");
  if (directory === target || !exists(legacyDb)) return target;

  privateDirectory(forgeHome);
  const stage = mkdtempSync(join(forgeHome, ".memory-backup-"));
  let operation = "opening the live memory database";
  try {
    const source = new DatabaseSync(legacyDb, { readOnly: true });
    let beforeCount: number;
    try {
      beforeCount = Number(source.prepare("SELECT COUNT(*) AS count FROM memories").get()?.count ?? 0);
      operation = "creating an online SQLite backup";
      const backupPath = join(stage, "engram.db");
      writeFileSync(backupPath, new Uint8Array(), { mode: 0o600 });
      const pages = await backup(source, backupPath);
      if (!pathExists(backupPath)) throw new Error(`Online backup returned ${pages} pages without creating its destination (${readdirSync(stage).join(",")})`);
    } finally { source.close(); }
    operation = "securing the online database backup";
    chmodSync(join(stage, "engram.db"), 0o600);
    const checkpoint = new Database(join(stage, "engram.db"), { create: false, readwrite: true });
    try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"); }
    finally { checkpoint.close(); }
    const ancillary = readdirSync(engramHome).filter(name => name === ".env" || (name.startsWith("engram.db") && name !== "engram.db" && name !== "engram.db-wal" && name !== "engram.db-shm"));
    for (const name of ancillary) {
      const from = join(engramHome, name);
      const entry = lstatSync(from);
      if (!entry.isFile() || entry.isSymbolicLink() || (typeof process.getuid === "function" && entry.uid !== process.getuid())) throw new Error("Unsafe legacy memory file");
      copyFileSync(from, join(stage, name));
      if (process.platform !== "win32") chmodSync(join(stage, name), entry.mode & 0o777);
    }
    operation = "verifying the online database snapshot";
    const copy = new Database(join(stage, "engram.db"), { create: false, readonly: true });
    try {
      const integrity = (copy.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      const afterCount = Number((copy.query("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count);
      if (integrity !== "ok" || afterCount !== beforeCount) throw new Error("Online memory backup verification failed");
    } finally { copy.close(); }
    if (exists(targetDb)) { rmSync(stage, { recursive: true, force: true }); return target; }
    try { renameSync(stage, target); }
    catch (error) {
      if (exists(targetDb)) { rmSync(stage, { recursive: true, force: true }); return target; }
      throw error;
    }
    privateDirectory(target);
    return target;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error(`${operation}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
