import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { MemoryError } from "../../shared/errors";
import { runSetup } from "../../app";
import { assistantTui } from "../tui/controller";

/** Human-facing initialization adapter; init --json and the other CLI commands stay scriptable. */
export async function completeSetup<T extends { cancelled: boolean }>(
  run: () => Promise<T>,
  openAssistants: () => Promise<{ cancelled: boolean }>,
): Promise<T> {
  const result = await run();
  if (!result.cancelled) await openAssistants();
  return result;
}

async function runTerminalSetup(): Promise<{ cancelled: true } | { cancelled: false; storage: "sqlite" }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MemoryError("INTERACTIVE_REQUIRED", "init necesita una terminal interactiva. Para scripts utiliza init --json y project-create --name <nombre>.");
  }
  // Suppress echo for the entire conversation: pasted future secret lines can
  // arrive before their prompt. Masking only the current question is too late.
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

export async function initTerminal(): Promise<void> {
  const result = await completeSetup(runTerminalSetup, assistantTui);
  if (result.cancelled) process.exitCode = 130;
}
