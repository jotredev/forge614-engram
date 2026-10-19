/** Bloqueo entre procesos para decidir la ubicación de memoria y abrir su base como una sola operación. */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Ejecuta una operación exclusiva para FORGE614_HOME y recupera bloqueos cuyo proceso ya terminó. */
export function withMemoryMigrationLock<T>(forgeHome: string, operation: () => T): T {
  mkdirSync(forgeHome, { recursive: true, mode: 0o700 });
  const lockPath = join(forgeHome, ".memory-migration.lock");
  const token = randomUUID();
  const started = Date.now();
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: number; token?: string } | undefined;
      try { owner = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number; token?: string }; }
      catch { /* La creación del propietario aún puede estar escribiendo el archivo. */ }
      let stale = false;
      if (owner?.pid) stale = !processIsAlive(owner.pid);
      else {
        try { stale = Date.now() - statSync(lockPath).mtimeMs > 5_000; }
        catch { /* El archivo pudo desaparecer mientras se comprobaba. */ }
      }
      if (stale) {
        const stalePath = `${lockPath}.${randomUUID()}.stale`;
        try { renameSync(lockPath, stalePath); rmSync(stalePath, { force: true }); } catch { /* Otro proceso pudo recuperar primero el bloqueo. */ }
        continue;
      }
      if (Date.now() - started > 60_000) throw new Error("Timed out waiting for Engram memory migration lock");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(); }
  finally {
    closeSync(descriptor);
    try {
      const owner = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: string };
      if (owner.token === token) rmSync(lockPath, { force: true });
    } catch { /* No se elimina un bloqueo ajeno o reemplazado. */ }
  }
}
