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
const cli = resolve(import.meta.dir, "../src/cli.ts");
const preload = resolve(import.meta.dir, "fixtures/user-directory.ts");
function environment(userDirectory: string): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...process.env, FORGE614_TEST_USER_DIRECTORY: userDirectory })
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, "--preload", preload, cli, ...args], {
    cwd, env: environment(userDirectory),
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
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
    args: options.args ?? ["--preload", preload, cli, "mcp"],
    cwd: options.cwd,
    env: environment(options.userDirectory),
    stderr: "pipe",
    maxBufferSize: 256 * 1024,
  });
  await client.connect(transport); clients.push(client); return { client, transport };
}
function data(result: CallToolResult): unknown {
  const block = result.content.find(value => value.type === "text");
  if (!block || block.type !== "text") throw new Error("Missing text result");
  return JSON.parse(block.text);
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: args }) as CallToolResult;
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
    "memory_current_project", "memory_get", "memory_history", "memory_save", "memory_search",
  ]);
  await client.close();
  expect(transport.pid).toBeNull();
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
});

test("mcp never enrolls implicitly and resolves one client root without creating a project", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect(runCli(root, userDirectory, "init").code).toBe(0);
  let connection = await connect({ cwd: root, userDirectory, roots: [project] });
  const before = await call(connection.client, "memory_current_project");
  expect(before.isError).toBe(true);
  await connection.client.close();

  expect(runCli(root, userDirectory, "integration-enable").code).toBe(0);
  connection = await connect({ cwd: root, userDirectory, roots: [project] });
  expect(data(await call(connection.client, "memory_current_project"))).toMatchObject({ projectId: null, source: "unbound" });
  expect(JSON.parse(runCli(root, userDirectory, "project-list").stdout)).toEqual([]);
});

test("a non-Git process cwd is not treated as an implicit non-Git project root", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "integration-enable").code).toBe(0);
  const { client } = await connect({ cwd:root,userDirectory });
  expect((await call(client,"memory_current_project")).isError).toBe(true);
  expect(JSON.parse(runCli(root,userDirectory,"project-list").stdout)).toEqual([]);
});

test("stdio save, search, get, history, update and request replay persist across restarts", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect(runCli(root, userDirectory, "integration-enable").code).toBe(0);
  let connection = await connect({ cwd: project, userDirectory });
  const input = {
    directory: project, title: "Database decision", content: "Use SQLite locally", type: "decision",
    topicKey: "architecture/database", requestKey: "save-1",
  };
  const saved = data(await call(connection.client, "memory_save", input)) as { id: string; projectId: string; version: number };
  expect(saved.version).toBe(1);
  expect(data(await call(connection.client, "memory_save", input))).toEqual(saved);
  expect((data(await call(connection.client, "memory_search", { directory: project, query: "SQLite" })) as unknown[])).toHaveLength(1);
  expect(data(await call(connection.client, "memory_get", { directory: project, id: saved.id }))).toMatchObject({ id: saved.id });
  const updated = data(await call(connection.client, "memory_save", {
    ...input, requestKey: "save-2", content: "Use SQLite with WAL", expectedVersion: 1,
  })) as { version: number };
  expect(updated.version).toBe(2);
  expect(data(await call(connection.client, "memory_history", { directory: project, id: saved.id }))).toHaveLength(2);
  await connection.client.close();

  connection = await connect({ cwd: project, userDirectory });
  const persisted = data(await call(connection.client, "memory_search", { directory:project,query: "SQLite WAL" })) as Array<{memory:{id:string}}>;
  expect(persisted[0]?.memory.id).toBe(saved.id);
});

test("shared saves require explicit scope and a nonempty global-intent explanation", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "integration-enable").code).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory });
  const base = { scope: "shared", title: "Global preference", content: "Use Spanish", type: "preference" };
  expect((await call(client, "memory_save", base)).isError).toBe(true);
  expect((await call(client, "memory_save", { ...base, globalIntent: "   " })).isError).toBe(true);
  const saved = data(await call(client, "memory_save", {
    ...base, globalIntent: "The user explicitly requested this preference across all projects.",
  })) as { scope: string; projectId: null };
  expect(saved).toMatchObject({ scope: "shared", projectId: null });
});

test("owner mismatch, unbound default search, multiple roots and oversized inputs fail safely", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const a = temporary(); const b = temporary();
  expect(runCli(root, userDirectory, "integration-enable").code).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory, roots: [a, b] });
  expect((await call(client, "memory_current_project")).isError).toBe(true);
  const saved = data(await call(client, "memory_save", {
    directory: a, title: "Owned", content: "Only A", type: "fact",
  })) as { id: string };
  expect((await call(client, "memory_get", { directory: b, id: saved.id })).isError).toBe(true);
  expect((await call(client, "memory_search", { directory: b, query: "Only" })).isError).toBe(true);
  expect((await call(client, "memory_search", { directory: a, query: "x".repeat(501) })).isError).toBe(true);
  const invalid = await call(client, "memory_search", { directory: a, query: "Owned", unexpected: "SECRET_MARKER" });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain("SECRET_MARKER");
});

test("compiled executable completes the official SDK stdio handshake without user storage", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const binary = join(root, "forge614-engram");
  const built = Bun.spawnSync([
    process.execPath, "build", "--compile", cli, "--outfile", binary,
  ], { cwd: root, env: environment(userDirectory), stderr: "pipe" });
  expect(built.exitCode).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory, command: binary, args: ["mcp"] });
  expect((await client.listTools()).tools).toHaveLength(5);
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
});

test("raw stdin EOF cancels an unanswered roots request and exits promptly", async () => {
  const root = temporary(); const userDirectory = join(root,"user");
  expect(runCli(root,userDirectory,"integration-enable").code).toBe(0);
  const child = Bun.spawn([process.execPath,"--preload",preload,cli,"mcp"],{
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
},5000);
