/**
 * Lee la URL de conexión a PostgreSQL para `forge614 cloud on` cuando no llega por `--postgres-url`
 * (D13): con terminal interactiva, oculta lo que se escribe (mismo patrón que `terminal/setup.ts`);
 * sin terminal (redirección o tubería), lee una sola línea de la entrada estándar tal cual. Nunca
 * la repite en pantalla ni la deja aparecer en un error. `commands.ts` la llama para `cloud on`.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { MemoryError } from "../../shared/errors";

/** Salida que absorbe todo lo que se le escribe, para apagar el eco de la terminal (igual que `terminal/setup.ts`). */
function silentOutput(): Writable {
  return new Writable({ write(_chunk, _encoding, done) { done(); } });
}

/**
 * Lee una sola línea de la entrada estándar sin mostrarla nunca, ni siquiera en un error.
 * @throws MemoryError con código `INVALID_INPUT` si la entrada se cierra sin dar ninguna línea, o
 * la línea recibida está vacía.
 */
export async function readCloudPostgresUrl(): Promise<string> {
  const interactive = Boolean(process.stdin.isTTY);
  const terminal = createInterface({ input: process.stdin, output: silentOutput(), terminal: interactive });
  try {
    // Con terminal real se pide explícitamente (el eco ya está apagado); sin terminal, la línea llega de una tubería que el propietario ya preparó, sin pedir nada.
    if (interactive) process.stdout.write("URL de PostgreSQL (no se mostrará): ");
    const line = await terminal[Symbol.asyncIterator]().next();
    if (interactive) process.stdout.write("[oculto]\n");
    if (line.done || !line.value.trim()) throw new MemoryError("INVALID_INPUT", "cloud on necesita una URL de PostgreSQL no vacía.");
    return line.value.trim();
  } finally { terminal.close(); }
}
