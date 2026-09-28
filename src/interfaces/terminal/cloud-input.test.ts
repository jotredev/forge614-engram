/** Comprueba `readCloudPostgresUrl`: sin terminal (tubería) lee una sola línea tal cual y nunca la repite en pantalla; una entrada vacía o cerrada sin dar nada falla. */
import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readCloudPostgresUrl } from "./cloud-input";

/** Reemplaza `process.stdin`/`process.stdout` por flujos (streams) de prueba durante `body`, y los restaura después. */
async function withStdio<T>(input: string, body: () => Promise<T>): Promise<{ result?: T; error?: unknown; printed: string }> {
  const stdin = new PassThrough(); stdin.end(input);
  const stdout = new PassThrough(); let printed = "";
  stdout.on("data", chunk => { printed += chunk.toString(); });
  const realStdin = process.stdin, realStdout = process.stdout;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  Object.defineProperty(process, "stdout", { value: stdout, configurable: true });
  try {
    try { return { result: await body(), printed }; }
    catch (error) { return { error, printed }; }
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
    Object.defineProperty(process, "stdout", { value: realStdout, configurable: true });
  }
}

// Sin terminal (una tubería), la línea llega tal cual, recortada, y no se imprime nada por stdout.
test("readCloudPostgresUrl reads one piped line verbatim and never echoes it", async () => {
  const { result, printed } = await withStdio("  postgresql://u@127.0.0.1/db?sslmode=disable  \n", () => readCloudPostgresUrl());
  expect(result).toBe("postgresql://u@127.0.0.1/db?sslmode=disable");
  expect(printed).toBe("");
});

// Una entrada vacía falla con INVALID_INPUT, sin repetir nada de lo recibido.
test("readCloudPostgresUrl rejects an empty line", async () => {
  const { error } = await withStdio("\n", () => readCloudPostgresUrl());
  expect((error as { code?: unknown })?.code).toBe("INVALID_INPUT");
});

// La entrada cerrada sin ninguna línea (tubería vacía) también falla con INVALID_INPUT.
test("readCloudPostgresUrl rejects a closed input that never sent a line", async () => {
  const { error } = await withStdio("", () => readCloudPostgresUrl());
  expect((error as { code?: unknown })?.code).toBe("INVALID_INPUT");
});
