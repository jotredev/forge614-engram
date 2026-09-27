/**
 * Implementación por terminal interactiva de `SetupIO` (`app/setup.ts`): hace las preguntas de `runSetup` por
 * consola, oculta lo que se escribe cuando la pregunta es secreta y deja cancelar con Ctrl+C. `commands.ts`
 * llama a `initTerminal` cuando `forge614 init` se ejecuta sin `--json`.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { MemoryError } from "../../shared/errors";
import { runSetup } from "../../app";

/** Ejecuta `runSetup` con preguntas y respuestas por la terminal actual; exige una terminal interactiva real (TTY) en ambos extremos. */
async function runTerminalSetup(): Promise<{ cancelled: true } | { cancelled: false; storage: "sqlite" }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MemoryError("INTERACTIVE_REQUIRED", "init necesita una terminal interactiva. Para scripts utiliza init --json y project-create --name <nombre>.");
  }
  // Se apaga el eco durante toda la conversación: una línea secreta pegada por adelantado puede
  // llegar antes de su propia pregunta. Ocultar solo la pregunta actual llegaría demasiado tarde.
  const silent = new Writable({write(_chunk,_encoding,done){done();}});
  const terminal = createInterface({ input: process.stdin, output: silent, terminal: true });
  const lines = terminal[Symbol.asyncIterator]();
  let cancelled = false;
  const interrupt = () => { cancelled = true; terminal.close(); };
  terminal.on("SIGINT", interrupt);
  process.on("SIGINT", interrupt);
  try {
    return await runSetup({
      write: message => { process.stdout.write(message + "\n"); },
      ask: async (question,options) => {
        if (cancelled) return null;
        process.stdout.write(question);
        const line = await lines.next();
        // La línea escrita se repite en pantalla (ya que el eco está apagado), pero una secreta se muestra como "[oculto]" en vez de su valor real.
        if(!line.done&&!cancelled) process.stdout.write(options?.secret?"[oculto]\n":JSON.stringify(line.value)+"\n");
        return cancelled || line.done ? null : line.value;
      },
    });
  } finally {
    process.off("SIGINT", interrupt);
    terminal.off("SIGINT", interrupt);
    terminal.close();
    silent.end();
  }
}

/** Punto de entrada de `forge614 init` sin `--json`: corre el asistente interactivo y, si la persona cancela, deja el código de salida 130 (interrupción, como Ctrl+C). */
export async function initTerminal(): Promise<void> {
  const result = await runTerminalSetup();
  if (result.cancelled) process.exitCode = 130;
}
