import { createInterface } from "node:readline";
import { MemoryError } from "./domain";
import { runSetup } from "./setup";

/** Human-facing terminal adapter; init and the other CLI commands stay scriptable. */
export async function setupTerminal(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MemoryError("INTERACTIVE_REQUIRED", "setup necesita una terminal interactiva. Para scripts utiliza init y project-create --name <nombre>.");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = terminal[Symbol.asyncIterator]();
  let cancelled = false;
  const interrupt = () => { cancelled = true; terminal.close(); };
  terminal.on("SIGINT", interrupt);
  process.on("SIGINT", interrupt);
  try {
    const result = await runSetup({
      write: message => { process.stdout.write(message + "\n"); },
      ask: async question => {
        if (cancelled) return null;
        process.stdout.write(question);
        const line = await lines.next();
        return cancelled || line.done ? null : line.value;
      },
    });
    if (result.cancelled) process.exitCode = 130;
  } finally {
    process.off("SIGINT", interrupt);
    terminal.off("SIGINT", interrupt);
    terminal.close();
  }
}
