/** Prueba de punta a punta del servidor MCP real por stdio, arrancado desde el CLI: proyectos, guardado, sesiones y alcances (scopes). */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { procSnapshot } from "../../../../tests/fixtures/proc-snapshot";

const temporaryDirectories: string[] = [];
const clients: Client[] = [];
function temporary(prefix = "forge614-mcp-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix)); temporaryDirectories.push(directory); return directory;
}
const cli = resolve(import.meta.dir, "../../../cli.ts");
function environment(userDirectory: string): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...process.env, FORGE614_HOME: join(userDirectory,".forge614") })
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
// Ver cli.e2e.test.ts: Bun.spawnSync tiene un error de bloqueo confirmado y sin corregir en Bun
// (oven-sh/bun#34069), por eso el lanzador del CLI usa aquí el camino asíncrono Bun.spawn en su lugar.
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

// Con una sola raíz MCP anunciada, memory_current_project resuelve esa carpeta sin crear un proyecto (source "unbound"); project-list del CLI sigue vacío.
test("init enables project bindings and MCP resolves one client root without creating a project", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const connection = await connect({ cwd: root, userDirectory, roots: [project] });
  expect(data(await call(connection.client, "memory_current_project"))).toMatchObject({ projectId: null, source: "unbound" });
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
}, 40000);

/**
 * En una carpeta nueva (sin proyecto), memory_search con scope project responde sin error y con la nota de carpeta sin proyecto, sobre un servidor real por stdio
 * con FORGE614_HOME temporal. Existe porque el error PROJECT_NOT_BOUND en esa búsqueda de orientación confundía al asistente; además comprueba que leer no registra la carpeta.
 */
test("searching a new folder without a project answers without an error and with a note", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory, roots: [project] });
  const result = await call(client, "memory_search", { query: "anything", scope: "project" });
  expect(result.isError).not.toBe(true);
  expect(data(result)).toEqual({ format: 2, results: [], project: { status: "unbound",
    message: "Esta carpeta todavía no tiene proyecto en Engram, así que no hay recuerdos de proyecto ni de grupo. Se crea al iniciar sesión (memory_session_start) o al guardar." } });
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
  expect(existsSync(join(project, ".forge614"))).toBe(false);
}, 40000);

/**
 * En un proyecto ligado que no pertenece a ningún grupo, memory_search con scope ecosystem responde sin error y con la nota «sin grupo», sobre un servidor real
 * por stdio con FORGE614_HOME temporal. Existe porque el manual manda buscar una vez por scope y ese caso daba GROUP_REQUIRED aunque no fuera un error real.
 */
test("searching the ecosystem scope in a project without a group answers without an error and with a note", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const { client } = await connect({ cwd: project, userDirectory });
  expect((await call(client, "memory_save", { directory: project, title: "Seed", content: "creates the project", type: "fact" })).isError).not.toBe(true);
  const result = await call(client, "memory_search", { directory: project, query: "anything", scope: "ecosystem" });
  expect(result.isError).not.toBe(true);
  expect(data(result)).toEqual({ format: 2, results: [], ecosystem: { status: "none",
    message: "Este proyecto no pertenece a ningún grupo, así que no hay recuerdos de grupo. Se vincula a uno con forge614-engram group-bind." } });
}, 40000);

// Sin raíces anunciadas y con el directorio de trabajo del proceso sin Git, memory_current_project falla en vez de tratar esa carpeta como proyecto implícito.
test("a non-Git process cwd is not treated as an implicit non-Git project root", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const { client } = await connect({ cwd:root,userDirectory });
  expect((await call(client,"memory_current_project")).isError).toBe(true);
  expect(JSON.parse((await runCli(root,userDirectory,"project-list")).stdout)).toEqual([]);
}, 40000);

// Guardar, buscar, leer, revisar historial y repetir con la misma requestKey funcionan sobre un servidor real, y lo guardado sigue disponible tras cerrar y reabrir la conexión.
test("stdio save, search, get, history, update and request replay persist across restarts", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const project = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  let connection = await connect({ cwd: project, userDirectory });
  const input = {
    directory: project, title: "Database decision", content: "Use SQLite locally", type: "decision",
    topicKey: "architecture/database", requestKey: "save-1",
  };
  const saved = data(await call(connection.client, "memory_save", input)) as { id: string; projectId: string; version: number;sessionId:string;sessionSource:string };
  expect(saved.version).toBe(1);
  // Una base de datos recién creada nace con las sesiones ya activas (esquema 11): un guardado con
  // directorio explícito y sin sesión explícita se une a la sesión manual de esa carpeta.
  expect(saved).toMatchObject({sessionId:expect.any(String),sessionSource:"manual"});
  expect(data(await call(connection.client, "memory_save", input))).toEqual(saved);
  expect((data(await call(connection.client, "memory_search", { directory: project, query: "SQLite" })) as {format:number;results:unknown[]}).results).toHaveLength(1);
  expect(data(await call(connection.client, "memory_get", { directory: project, id: saved.id }))).toMatchObject({ memory:{id: saved.id},currentVersion:1 });
  const updated = data(await call(connection.client, "memory_save", {
    ...input, requestKey: "save-2", content: "Use SQLite with WAL", expectedVersion: 1,
  })) as { version: number };
  expect(updated.version).toBe(2);
  expect(data(await call(connection.client, "memory_history", { directory: project, id: saved.id }))).toHaveLength(2);
  await connection.client.close();

  connection = await connect({ cwd: project, userDirectory });
  const persisted = data(await call(connection.client, "memory_search", { directory:project,query: "SQLite WAL" })) as {results:Array<{memory:{id:string}}>};
  expect(persisted.results[0]?.memory.id).toBe(saved.id);
}, 40000);

// Con el reforzamiento de duplicados activo, dos raíces distintas (a y b) guardan cada una su propio recuerdo con el mismo título y contenido; repetir el guardado en a solo refuerza el de a, sin tocar el de b ni subir de versión.
test("stdio duplicate saves reinforce only the selected project without increasing its version", async () => {
  const root=temporary();const userDirectory=join(root,"user");const a=temporary();const b=temporary();
  expect((await runCli(root,userDirectory,"reinforcement-enable")).code).toBe(0);
  const firstConnection=await connect({cwd:root,userDirectory,roots:[a]});
  const input={title:"Runtime owner",content:"Project-local observation",type:"decision",topicKey:"runtime-owner"};
  const first=data(await call(firstConnection.client,"memory_save",{...input,requestKey:"a-create"})) as {id:string;projectId:string;version:number};
  const secondConnection=await connect({cwd:root,userDirectory,roots:[b]});
  const foreign=data(await call(secondConnection.client,"memory_save",{...input,requestKey:"b-create"})) as {id:string;projectId:string};
  const repeated=data(await call(firstConnection.client,"memory_save",{...input,expectedVersion:1,requestKey:"a-observation"})) as {id:string;projectId:string;version:number};
  expect(repeated).toEqual(expect.objectContaining({id:first.id,projectId:first.projectId,version:1}));
  expect(repeated.id).not.toBe(foreign.id);
  const history=data(await call(firstConnection.client,"memory_history",{id:first.id})) as unknown[];
  expect(history).toHaveLength(1);
  const searched=data(await call(firstConnection.client,"memory_search",{query:"observation",scope:"project"})) as {results:Array<{memory:{id:string};explanation:{reinforcement:{duplicateCount:number}}}>};
  expect(searched.results).toHaveLength(1);
  expect(searched.results[0]).toMatchObject({memory:{id:first.id},explanation:{reinforcement:{duplicateCount:1}}});
}, 40000);

// Un guardado shared sin globalIntent, o con uno vacío tras recortar espacios, falla; solo un texto explícito y no vacío lo acepta con projectId nulo.
test("shared saves require explicit scope and a nonempty global-intent explanation", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory });
  const base = { scope: "shared", title: "Global preference", content: "Use Spanish", type: "preference" };
  expect((await call(client, "memory_save", base)).isError).toBe(true);
  expect((await call(client, "memory_save", { ...base, globalIntent: "   " })).isError).toBe(true);
  const saved = data(await call(client, "memory_save", {
    ...base, globalIntent: "The user explicitly requested this preference across all projects.",
  })) as { scope: string; projectId: null };
  expect(saved).toMatchObject({ scope: "shared", projectId: null });
}, 40000);

// Con dos raíces anunciadas, memory_current_project falla (ambigüedad); leer o buscar el recuerdo de una raíz (a) desde la otra (b) falla; una consulta demasiado larga o con un campo no esperado también falla, y el valor del campo rechazado (SECRET_MARKER) nunca aparece en la respuesta de error.
test("owner mismatch, unbound default search, multiple roots and oversized inputs fail safely", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const a = temporary(); const b = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const { client } = await connect({ cwd: root, userDirectory, roots: [a, b] });
  expect((await call(client, "memory_current_project")).isError).toBe(true);
  const saved = data(await call(client, "memory_save", {
    directory: a, title: "Owned", content: "Only A", type: "fact",
  })) as { id: string };
  expect((await call(client, "memory_get", { directory: b, id: saved.id })).isError).toBe(true);
  // Cambiada a propósito en 1.8.5: buscar desde la carpeta b (sin proyecto) ya no da error, pero sigue sin ver el recuerdo de a: 0 resultados y la nota.
  const foreignSearch = await call(client, "memory_search", { directory: b, query: "Only" });
  expect(foreignSearch.isError).not.toBe(true);
  expect(data(foreignSearch)).toMatchObject({ format: 2, results: [], project: { status: "unbound" } });
  expect((await call(client, "memory_search", { directory: a, query: "x".repeat(501) })).isError).toBe(true);
  const invalid = await call(client, "memory_search", { directory: a, query: "Owned", unexpected: "SECRET_MARKER" });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain("SECRET_MARKER");
}, 40000);

// Dos sesiones abiertas a la vez, revisiones con versión exacta, repetición de un resumen con la misma requestKey, que un resumen incompleto o con expectedVersion equivocada se rechaza y que el texto guardado empieza por el bloque «Goal:», y que un guardado shared no filtre el sessionId de origen: todo sobre un servidor real.
test("MCP session contracts support parallel chats, exact versions, replay, summary ordering and private shared origins",async()=>{
  const root=temporary(),userDirectory=join(root,"user"),project=temporary();
  expect((await runCli(root,userDirectory,"sessions-enable")).code).toBe(0);
  const {client}=await connect({cwd:root,userDirectory,roots:[project]});
  const one=data(await call(client,"memory_session_start",{sessionId:"chat-one"})) as {projectId:string};
  expect((await call(client,"memory_session_start",{sessionId:"chat-two"})).isError).not.toBe(true);
  const saveOne={title:"Choice",content:"First",type:"decision",topicKey:"choice",requestKey:"save-1",sessionId:"chat-one"};
  const saved=data(await call(client,"memory_save",saveOne)) as {id:string;sessionId:string;sessionSource:string};
  expect(saved).toMatchObject({sessionId:"chat-one",sessionSource:"explicit"});
  const updated=data(await call(client,"memory_save",{title:"Choice",content:"Second",type:"decision",topicKey:"choice",expectedVersion:1,requestKey:"save-2",sessionId:"chat-two"})) as {version:number};
  expect(updated.version).toBe(2);
  expect(data(await call(client,"memory_get",{id:saved.id,version:1}))).toMatchObject({memory:{content:"First",version:1},currentVersion:2});
  expect(data(await call(client,"memory_timeline",{sessionId:"chat-one",id:saved.id,version:1,before:0,after:0}))).toMatchObject({sessionId:"chat-one",before:[],after:[]});
  expect((await call(client,"memory_timeline",{sessionId:"chat-two",id:saved.id,version:1})).isError).toBe(true);
  expect((await call(client,"memory_session_summary",{sessionId:"chat-one",requestKey:"sum-1",summary:{goal:"Ship"}})).isError).toBe(true);
  const summary={goal:"Ship",instructions:"Keep",discoveries:"Found",accomplishments:"Done",nextSteps:"Close",files:[]};
  const first=data(await call(client,"memory_session_summary",{sessionId:"chat-one",requestKey:"sum-1",summary}));
  expect(data(await call(client,"memory_session_summary",{sessionId:"chat-one",requestKey:"sum-1",summary}))).toEqual(first);
  const badUpdate=await call(client,"memory_session_summary",{sessionId:"chat-one",requestKey:"sum-bad",expectedVersion:99,summary:{...summary,goal:"Changed"}});
  expect(badUpdate.isError).toBe(true);
  expect(data(await call(client,"memory_get",{id:(first as any).memory.id}))).toMatchObject({memory:{version:1,content:expect.stringContaining("Goal:\nShip")}});
  expect(data(await call(client,"memory_session_end",{sessionId:"chat-one"}))).toMatchObject({endedAt:expect.any(String)});
  expect(data(await call(client,"memory_save",saveOne))).toEqual(saved);
  expect(data(await call(client,"memory_save",{title:"Inferred",content:"One open runtime",type:"fact"}))).toMatchObject({sessionId:"chat-two",sessionSource:"inferred"});
  expect((await call(client,"memory_session_start",{sessionId:"chat-one"})).isError).toBe(true);
  const shared=data(await call(client,"memory_save",{scope:"shared",globalIntent:"Explicit cross-project rule",title:"Shared",content:"Private origin",type:"preference",sessionId:"chat-two",sessionProjectId:one.projectId})) as {id:string};
  expect(JSON.stringify(data(await call(client,"memory_get",{scope:"shared",id:shared.id})))).not.toContain("chat-two");
  expect((await call(client,"memory_save",{scope:"shared",globalIntent:"Explicit",title:"Bad",content:"Missing owner",type:"fact",sessionId:"chat-two"})).isError).toBe(true);
  expect(data(await call(client,"memory_context",{}))).toMatchObject({format:1,pinned:expect.any(Array),recent:expect.any(Array),summaries:expect.any(Array)});
}, 40000);

// El SDK acepta un sessionId hasta su límite exacto (200 caracteres Unicode) y rechaza uno más largo o con espacio exterior; con dos sesiones abiertas a la vez, un guardado sin sessionId explícito no puede inferir cuál usar (AMBIGUOUS_SESSION).
test("MCP accepts the SDK session identifier boundary and reports ambiguous assistant inference",async()=>{
  const root=temporary(),userDirectory=join(root,"user"),project=temporary();
  expect((await runCli(root,userDirectory,"sessions-enable")).code).toBe(0);
  const {client}=await connect({cwd:root,userDirectory,roots:[project]});
  expect(data(await call(client,"memory_save",{title:"Manual",content:"No runtime yet",type:"fact"}))).toMatchObject({sessionId:expect.any(String),sessionSource:"manual"});
  const longId="🧠".repeat(200);
  expect((await call(client,"memory_session_start",{sessionId:longId})).isError).not.toBe(true);
  expect((await call(client,"memory_session_start",{sessionId:"x".repeat(201)})).isError).toBe(true);
  expect((await call(client,"memory_session_start",{sessionId:" chat"})).isError).toBe(true);
  expect((await call(client,"memory_session_start",{sessionId:"chat-two"})).isError).not.toBe(true);
  // 1.7.1: abrir chat-two no marca a nadie (iniciar una sesión ya no interrumpe otras sesiones
  // abiertas). longId y chat-two son ambas sesiones de ejecución abiertas en la misma carpeta, así
  // que un guardado sin sessionId explícito es realmente ambiguo entre las dos de inmediato.
  const result=await call(client,"memory_save",{title:"Ambiguous",content:"Two chats",type:"fact"});
  expect(result.isError).toBe(true);expect(data(result)).toMatchObject({code:"AMBIGUOUS_SESSION"});
}, 40000);
