/** Comprueba el servidor MCP real por stdio (entrada y salida estándar): arranque, lista de herramientas y cierre ordenado, con el CLI en fuente y compilado. */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { procSnapshot } from "../../../tests/fixtures/proc-snapshot";
import { memoryProtocol } from "../../modules/memory-protocol";
import { enableCloud } from "../../infrastructure/sqlite/schema";

const temporaryDirectories: string[] = [];
const clients: Client[] = [];
function temporary(prefix = "forge614-mcp-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix)); temporaryDirectories.push(directory); return directory;
}
const cli = resolve(import.meta.dir, "../../cli.ts");
function environment(userDirectory: string): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...process.env, FORGE614_HOME: join(userDirectory,".forge614") })
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
// Ver src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync tiene un error de bloqueo confirmado
// y sin corregir en Bun (oven-sh/bun#34069), por eso aquí se usa el Bun.spawn asíncrono en su lugar.
async function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: environment(userDirectory), stdout:"pipe", stderr:"pipe",
  });
  let killedByWatchdog = false;
  let procSnapshotResult: Record<string, unknown> | undefined;
  const timer = setTimeout(() => { killedByWatchdog = true; procSnapshotResult = procSnapshot(child.pid); child.kill(); }, 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if (killedByWatchdog) {
      let completeJson = false;
      try { JSON.parse(stdout); completeJson = true; } catch {}
      console.error(JSON.stringify({
        diag: "watchdog-killed", args, code,
        stdoutBytes: stdout.length, stderrBytes: stderr.length, completeJson,
        stdoutTail: stdout.slice(-300), stderrTail: stderr.slice(-300),
        procSnapshot: procSnapshotResult,
      }));
    }
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
async function connect(options: {
  cwd: string; userDirectory: string; roots?: string[]; command?: string; args?: string[];
}): Promise<{ client: Client; transport: StdioClientTransport }> {
  const client = new Client({ name: "forge614-tests", version: "1.0.0" }, {
    capabilities: options.roots ? { roots: { listChanged: false } } : {},
  });
  if (options.roots) {
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: options.roots!.map(directory => ({ uri: pathToFileURL(directory).href })),
    }));
  }
  const transport = new StdioClientTransport({
    command: options.command ?? process.execPath,
    args: options.args ?? [cli, "mcp"],
    cwd: options.cwd,
    env: environment(options.userDirectory),
    stderr: "pipe",
    maxBufferSize: 256 * 1024,
  });
  await client.connect(transport); clients.push(client); return { client, transport };
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const directory of temporaryDirectories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});
// El servidor arranca sin crear ningún archivo de usuario (.forge614) hasta la primera llamada, y anuncia exactamente las diez herramientas.
test("stdio initializes and advertises exactly the bounded memory tool surface", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const { client, transport } = await connect({ cwd: root, userDirectory });
  expect(client.getInstructions()).toBe(memoryProtocol(4).mcpInstructions);
  expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
    "memory_context", "memory_current_project", "memory_get", "memory_history",
    "memory_save", "memory_search", "memory_session_end", "memory_session_start",
    "memory_session_summary", "memory_timeline",
  ]);
  await client.close();
  expect(transport.pid).toBeNull();
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
}, 40000);

// El mismo protocolo de arranque funciona igual desde el ejecutable compilado (bun build --compile), no solo desde la fuente.
test("compiled executable completes the official SDK stdio handshake without user storage", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const binary = join(root, "forge614-engram");
  const buildChild = Bun.spawn([
    process.execPath, "build", "--compile", cli, "--outfile", binary,
  ], { cwd: root, env: environment(userDirectory), stdout: "pipe", stderr: "pipe" });
  expect(await buildChild.exited).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory, command: binary, args: ["mcp"] });
  expect((await client.listTools()).tools).toHaveLength(10);
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
}, 40000);

// Sin cliente SDK de por medio: si stdin se cierra mientras la petición roots/list sigue sin respuesta, el proceso igual sale pronto.
test("raw stdin EOF cancels an unanswered roots request and exits promptly", async () => {
  const root = temporary(); const userDirectory = join(root,"user");
  expect((await runCli(root,userDirectory,"init","--json")).code).toBe(0);
  const child = Bun.spawn([process.execPath,cli,"mcp"],{
    cwd:root,env:environment(userDirectory),stdin:"pipe",stdout:"pipe",stderr:"pipe",
  });
  const reader = child.stdout.getReader(); let output = "";
  const messages = [
    {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{roots:{listChanged:false}},clientInfo:{name:"raw-eof-test",version:"1.0.0"}}},
    {jsonrpc:"2.0",method:"notifications/initialized",params:{}},
    {jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"memory_current_project",arguments:{}}},
  ].map(message => JSON.stringify(message)).join("\n") + "\n";
  try {
    child.stdin.write(messages); await child.stdin.flush();
    const rootsRequested = await Promise.race([
      (async () => {
        while (!output.includes('"method":"roots/list"')) {
          const next = await reader.read(); if (next.done) return false;
          output += new TextDecoder().decode(next.value);
        }
        return true;
      })(),
      Bun.sleep(2000).then(() => false),
    ]);
    expect(rootsRequested).toBe(true);
    child.stdin.end();
    const exited = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(700).then(() => false),
    ]);
    expect(exited).toBe(true);
  } finally {
    child.kill("SIGKILL"); await child.exited; await reader.cancel().catch(() => {});
  }
},30000);

// D8: con nube configurada contra un servidor TCP que acepta la conexión y nunca responde, memory_context
// no se queda esperando a Neon: el tope de la espera de arranque (1000 ms) la corta y responde con lo
// local. El servidor, además, sigue cerrando bien (stdin) tras esa llamada.
test("memory_context returns within the startup wait cutoff against a cloud endpoint that never answers, and the server still shuts down cleanly", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  // Servidor TCP mudo: acepta la conexión (el intento de conectar no falla al instante) pero nunca contesta nada.
  const mute = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  try {
    const dbPath = join(userDirectory, ".forge614", "engram", "engram.db");
    const db = new Database(dbPath); enableCloud(db); db.close();
    const envPath = join(userDirectory, ".forge614", "engram", ".env");
    writeFileSync(envPath,
      `FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u@127.0.0.1:${mute.port}/db?sslmode=disable"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n`,
      { mode: 0o600 });
    const { client, transport } = await connect({ cwd: root, userDirectory });
    const start = Date.now();
    const result = await client.callTool({ name: "memory_context", arguments: { scope: "shared" } }) as CallToolResult;
    expect(Date.now() - start).toBeLessThanOrEqual(1300);
    const block = result.content.find(value => value.type === "text");
    expect(block && block.type === "text" ? JSON.parse(block.text) : null).toMatchObject({ format: 1 });
    await client.close();
    expect(transport.pid).toBeNull();
  } finally { mute.stop(true); }
}, 40000);
