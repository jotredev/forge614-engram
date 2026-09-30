/**
 * Avance de `sync` en la terminal: una sola línea en stderr que se reescribe con cada lote y se borra al
 * terminar. Solo existe si stderr es una terminal real (no una tubería, archivo, cron ni agente) y `TERM`
 * no es `dumb`; en cualquier otro caso `createSyncProgress` da `undefined` y no se escribe nada, así stderr
 * sigue conteniendo únicamente el JSON de error. La capa de aplicación solo avisa por `onProgress`; lo único
 * que escribe es este archivo, y solo lo usa la rama `sync` de `commands.ts`.
 */
import type { CloudProgress } from "../../app";

/** Textos del avance, agrupados aquí para moverlos de una vez al catálogo es/en (D16, 1.9.0). */
const TEXT = {
  upload: (done: string, total: string) => `Subiendo ${done} de ${total} cambios…`,
  download: (done: string) => `Bajando cambios de la nube: ${done} leídos…`,
};

/** Da un entero con espacio como separador de miles (`2426` → `2 426`), sin depender del idioma del sistema. */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** La línea de avance: se reescribe y se borra. */
export interface SyncProgress {
  /** Reescribe la línea con el avance dado. */
  update(progress: CloudProgress): void;
  /** Borra la línea, solo si se escribió algo. */
  finish(): void;
}

/**
 * Crea el avance de `sync`.
 * @param stream Flujo de salida del avance (stderr por defecto).
 * @param env Variables de entorno (para `TERM`).
 * @returns El avance, o `undefined` si `stream` no es una terminal o `TERM` es `dumb`.
 */
export function createSyncProgress(
  stream: { isTTY?: boolean | undefined; write(text: string): unknown } = process.stderr,
  env: Record<string, string | undefined> = process.env,
): SyncProgress | undefined {
  if (stream.isTTY !== true || env.TERM === "dumb") return undefined;
  let written = false;
  return {
    update(progress) {
      const text = progress.phase === "upload"
        ? TEXT.upload(formatCount(progress.done), formatCount(progress.total))
        : TEXT.download(formatCount(progress.done));
      stream.write(`\r${text}\x1b[K`);
      written = true;
    },
    finish() {
      if (!written) return;
      stream.write("\r\x1b[K");
      written = false;
    },
  };
}
