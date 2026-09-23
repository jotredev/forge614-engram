import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "../../app/workspace";
import { parseArguments } from "./arguments";
import { dispatch, runUpdateCommand, updateResultJson } from "./commands";
import { procSnapshot } from "../../../tests/fixtures/proc-snapshot";

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../../cli.ts");
// See src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync has a confirmed,
// unfixed upstream hang bug (oven-sh/bun#34069), so this uses async Bun.spawn instead.
async function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath,cli,...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614") }, stdout:"pipe", stderr:"pipe",
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
async function run(cwd: string, ...args: string[]) { return (await runAs(cwd,join(cwd,"user"),...args)); }
async function create(dir: string, name = "demo"): Promise<string> {
  const result = await run(dir,"project-create","--name",name);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout).projectId;
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir,{recursive:true}); });

test("update JSON output contains only the structured update result", async () => {
  expect(updateResultJson({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" })).toBe(
    '{"updated":true,"previousVersion":"1.3.0","installedVersion":"1.4.0"}',
  );
}, 40000);

test("update --json prints structured output while plain update remains silent", async () => {
  const output: string[] = [];
  const update = async () => ({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });

  await runUpdateCommand(true, "1.3.0", update, value => output.push(value));
  await runUpdateCommand(false, "1.3.0", update, value => output.push(value));

  expect(output).toEqual(['{"updated":true,"previousVersion":"1.3.0","installedVersion":"1.4.0"}']);
}, 40000);
test("CLI shared memories work without a project and require explicit scope for mutations", async () => {
  const dir = workspace(); expect((await run(dir,"init","--json")).code).toBe(0);
  const result = (await run(dir,"save","--scope","shared","--title","Idioma","--content","Spanish","--type","preference","--topic","language"));
  expect(result.code).toBe(0); const shared = JSON.parse(result.stdout);
  expect(shared.projectId).toBeNull(); expect(shared.scope).toBe("shared");
  expect(JSON.parse((await run(dir,"project-list")).stdout)).toEqual([]);
  const a = (await create(dir));
  expect(JSON.parse((await run(dir,"search","--project-id",a,"--query","Spanish")).stdout)[0].memory.id).toBe(shared.id);
  expect(JSON.parse((await run(dir,"search","--project-id",a,"--query","Spanish","--scope","project")).stdout)).toEqual([]);
  expect(JSON.parse((await run(dir,"search","--scope","shared","--query","Spanish")).stdout)[0].memory.scope).toBe("shared");
  expect((await run(dir,"archive","--project-id",a,"--id",shared.id)).code).toBe(1);
  expect((await run(dir,"archive","--scope","shared","--id",shared.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"search","--scope","shared","--query","Spanish")).stdout)).toEqual([]);
  expect((await run(dir,"restore","--scope","shared","--id",shared.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"history","--scope","shared","--id",shared.id)).stdout)).toHaveLength(1);
  expect(JSON.parse((await run(dir,"get","--scope","shared","--id",shared.id)).stdout).state).toBe("active");
}, 40000);

test("invalid scope, legacy and per-project connection flags fail before any storage changes", async () => {
  const dir = workspace(); const id = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["unknown"], ["save","--project","demo","--title","Title","--content","Text"],
    ["project-create","--name"," "], ["project-create","--name","Demo","--db","SECRET_MARKER"],
    ["project-connect","--project-id",id,"--db","SECRET_MARKER"], ["project-list","--db","SECRET_MARKER"],
    ["save","--id-project",id,"--title","Title","--content","Text"],
    ["save","--project-id",id,"--title","Title"],
    ["save","--project-id",id,"--title","Title","--content","SECRET_MARKER","--type","invalid"],
    ["search","--project-id",id,"--query","abc","--limit","0"],
    ["search","--project-id",id,"--project-id",id,"--query","abc"],
    ["search","--project-id","../../../tests/escape","--query","abc"],
    ["search","--scope","all","--query","abc"], ["search","--query","abc"],
    ["search","--scope","invalid","--project-id",id,"--query","abc"],
    ["save","--scope","all","--project-id",id,"--title","T","--content","C"],
    ["save","--scope","shared","--project-id",id,"--title","T","--content","C"],
    ["get","--scope","shared","--project-id",id,"--id","any"],
    ["get","--scope","all","--project-id",id,"--id","any"],
  ];
  for (const args of cases) {
    const result = (await run(dir,...args)); expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
    expect(result.stderr).not.toContain("SECRET_MARKER"); expect(result.stdout).toBe("");
    expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  }
}, 40000);

test("CLI rejects valued boolean flags, malformed summaries, unknown summary keys and watch promotion", async () =>{
  const dir=workspace();
  for(const args of [
    ["search","--scope","shared","--query","x","--preview","true"],
    ["session-summary","--project-id","11111111-1111-4111-8111-111111111111","--session-id","s","--summary-json","{bad","--request-key","r"],
    ["session-summary","--project-id","11111111-1111-4111-8111-111111111111","--session-id","s","--summary-json",JSON.stringify({goal:"x",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[],extra:true}),"--request-key","r"],
    ["sync-watch","--upgrade-format"],
    ["context","--scope","shared","--project-id","11111111-1111-4111-8111-111111111111"],
    ["save","--scope","shared","--title","x","--content","y","--session-id","s"],
  ]) expect(JSON.parse((await run(dir,...args)).stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
}, 40000);

test("init --json remains noninteractive, reports initialization status and does not configure external clients", async () => {
  const dir = workspace();
  const result = (await run(dir, "init", "--json"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    initialized: true,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: false,
  });
  expect(result.stderr).toBe("");
  expect(existsSync(join(dir, "user", ".claude.json"))).toBe(false);
  expect(existsSync(join(dir, "user", ".codex", "config.toml"))).toBe(false);
}, 40000);

test("init --json rejects an unavailable PostgreSQL URL without exposing it or creating storage", async () => {
  const dir = workspace();
  const secret = "POSTGRES_SECRET_MARKER";
  const result = (await run(dir, "init", "--json", "--postgres-url", `postgresql://user:${secret}@127.0.0.1:1/engram?sslmode=disable`));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({code: "POSTGRES_UNAVAILABLE"});
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(secret);
  expect(existsSync(join(dir, "user", ".forge614", "engram"))).toBe(false);
}, 40000);

test("repeating init --json preserves an existing PostgreSQL configuration", async () => {
  const dir = workspace();
  const config = new WorkspaceConfig(join(dir, "user", ".forge614", "engram"));
  new MemoryWorkspace(config).init();
  config.configurePostgres("postgresql://user:password@127.0.0.1:5432/engram?sslmode=disable", config.revision());

  const result = (await run(dir, "init", "--json"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({initialized: true, storage: "sqlite", postgresConfigured: true});
  expect(config.read().postgresUrl).toBe("postgresql://user:password@127.0.0.1:5432/engram?sslmode=disable");
}, 40000);

test("reinforcement enrollment is explicit, repeatable, and never recreates a missing configured database", async () => {
  const dir=workspace();
  expect((await run(dir,"init","--json")).code).toBe(0);
  const config=new WorkspaceConfig(join(dir,"user",".forge614","engram"));
  const memoryWorkspace=new MemoryWorkspace(config);
  let store=memoryWorkspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  expect((await run(dir,"init","--json")).code).toBe(0);
  expect((await run(dir,"sessions-enable")).code).toBe(0);
  store=memoryWorkspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  for (let attempt=0;attempt<2;attempt++) {
    const result=(await run(dir,"reinforcement-enable"));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({enabled:true,schema:7});
  }
  store=memoryWorkspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(true); }
  finally { store.close(); }

  rmSync(config.databasePath);
  const missing=(await run(dir,"reinforcement-enable"));
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.stderr).code).toBe("DATABASE_MISSING");
  expect(existsSync(config.databasePath)).toBe(false);
}, 40000);

// Regression guard for the v1.5.3 hang investigation (experiment 4): commands.ts must
// keep loading the MCP SDK and zod lazily, only for the "mcp" command. The preload
// plugin throws if anything under node_modules/zod or node_modules/@modelcontextprotocol
// is loaded, so a command that must not need them fails loudly on any regression, while
// "mcp" (which does need them) is expected to fail specifically because of that throw.
const mcpImportGuard = resolve(import.meta.dir,"../../../tests/fixtures/fail-on-mcp-import.ts");
async function runGuarded(cwd: string, userDirectory: string, marker: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath,"--preload",mcpImportGuard,cli,...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614"), FORGE614_MCP_IMPORT_MARKER: marker },
    stdout:"pipe", stderr:"pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
test("memory-protocol, sync and project-list never load the MCP SDK or zod", async () => {
  const dir = workspace();
  const cases: [string[], number][] = [
    [["memory-protocol","--json"], 0],
    [["sync"], 1], // CONFIG_NOT_FOUND, unrelated to the guard
    [["project-list"], 0],
  ];
  for (const [args, expectedCode] of cases) {
    const marker = join(dir, `marker-${args[0]}.txt`);
    const result = await runGuarded(dir, join(dir,"user"), marker, ...args);
    expect(existsSync(marker)).toBe(false);
    expect(result.code).toBe(expectedCode);
  }
}, 40000);
test("the mcp command still loads the MCP SDK (the guard itself is not a false negative)", async () => {
  const dir = workspace();
  const marker = join(dir, "marker-mcp.txt");
  await runGuarded(dir, join(dir,"user"), marker, "mcp");
  expect(existsSync(marker)).toBe(true);
  expect(readFileSync(marker,"utf8")).toContain("zod");
}, 40000);
