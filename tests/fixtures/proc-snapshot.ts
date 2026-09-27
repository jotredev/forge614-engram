/**
 * Accesorio (fixture) de diagnóstico: captura en qué está bloqueado un proceso hijo que sigue
 * corriendo, justo antes de que el vigilante (watchdog) del arnés de pruebas lo mate.
 */
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/**
 * Solo para diagnóstico (investigación del coordinador de forge614-ai sobre el cuelgue de la
 * v1.5.3, experimento 4): captura, vía `/proc`, exactamente en qué está bloqueado un proceso hijo
 * que sigue corriendo, justo antes de que el vigilante (watchdog) del arnés de pruebas lo mate.
 * Solo en Linux; en cualquier otro sistema no hace nada. No se usa fuera de la rama de esa investigación.
 */
export function procSnapshot(pid: number): Record<string, unknown> {
  if (process.platform !== "linux") return { platform: process.platform, skipped: true };
  const read = (path: string): string => {
    try { return readFileSync(path, "utf8"); }
    catch (error) { return `<error: ${(error as Error).message}>`; }
  };
  const status = read(`/proc/${pid}/status`);
  // El estado (`State:`) es la primera pista de por qué sigue vivo (por ejemplo, "D" es espera
  // de E/S no interrumpible, la señal típica de un cuelgue real de disco o red).
  const state = status.split("\n").find(line => line.startsWith("State:")) ?? "<missing>";
  const dump: Record<string, unknown> = {
    pid,
    state,
    wchan: read(`/proc/${pid}/wchan`),
    syscall: read(`/proc/${pid}/syscall`),
  };
  try {
    const entries = readdirSync(`/proc/${pid}/fd`);
    // Para cada descriptor de archivo abierto se sigue el enlace a lo que apunta; si además
    // parece un archivo de base de datos (SQLite y sus archivos auxiliares -wal/-shm/-journal),
    // se agrega también su `fdinfo` (posición, banderas) porque ahí suele estar el bloqueo real.
    dump.fds = entries.map(fd => {
      let target = "<unreadable>";
      try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { /* el descriptor pudo haberse cerrado a mitad de la lectura */ }
      const isDb = /\.db(-wal|-shm|-journal)?$/.test(target);
      return { fd, target, fdinfo: isDb ? read(`/proc/${pid}/fdinfo/${fd}`) : undefined };
    });
  } catch (error) { dump.fdsError = (error as Error).message; }
  try {
    // El árbol de procesos (`ps --forest`) muestra si el proceso bloqueado generó hijos propios
    // que también quedaron colgados, algo que /proc de un solo pid no puede mostrar por sí solo.
    const ps = Bun.spawnSync(["ps", "-eo", "pid,ppid,stat,wchan:20,args", "--forest"], {
      stdout: "pipe", stderr: "pipe", timeout: 3000,
    });
    dump.psForest = ps.stdout.toString();
  } catch (error) { dump.psError = (error as Error).message; }
  return dump;
}
