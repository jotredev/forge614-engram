import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
// See src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync has a confirmed,
// unfixed upstream hang bug (oven-sh/bun#34069), so this uses async Bun.spawn instead.
async function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: environment(userDirectory), stdout:"pipe", stderr:"pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
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
test("stdio initializes and advertises exactly the bounded memory tool surface", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const { client, transport } = await connect({ cwd: root, userDirectory });
  expect(client.getInstructions()).toContain("memory_current_project");
  expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
    "memory_context", "memory_current_project", "memory_get", "memory_history",
    "memory_save", "memory_search", "memory_session_end", "memory_session_start",
    "memory_session_summary", "memory_timeline",
  ]);
  await client.close();
  expect(transport.pid).toBeNull();
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
}, 40000);

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
