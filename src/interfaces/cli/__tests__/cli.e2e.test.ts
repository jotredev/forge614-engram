import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceConfig } from "../../../infrastructure/filesystem/workspace-config";

const directories: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-cli-")); directories.push(dir); return dir;
}
const cli = resolve(import.meta.dir,"../../../cli.ts");
// Bun.spawnSync has a confirmed, unfixed upstream bug (oven-sh/bun#34069, PR #40078 still
// open) where the isolated sync-wait loop can lose a child's exit notification under high
// spawn volume next to sqlite, hanging until an external timeout kills it. Bun.spawn's async
// path does not use that isolated loop, so every launcher here awaits it instead.
async function runAs(cwd: string, userDirectory: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath,cli,...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614") }, stdout:"pipe", stderr:"pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
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

test("retired setup tells the user to use init and leaves storage absent", async () => {
  const dir = workspace();
  const result = (await run(dir, "setup"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({
    code: "COMMAND_RETIRED",
    error: expect.stringContaining("forge614-engram init"),
  });
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

test("init requires a terminal while init --json stays noninteractive", async () => {
  const dir = workspace();
  const interactive = (await run(dir, "init"));
  expect(interactive.code).toBe(1);
  expect(JSON.parse(interactive.stderr)).toMatchObject({
    code: "INTERACTIVE_REQUIRED",
    error: expect.stringContaining("init necesita una terminal interactiva"),
  });
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
  expect((await run(dir, "init", "--json")).code).toBe(0);
  expect(JSON.parse((await run(dir, "project-list")).stdout)).toEqual([]);
  expect((await run(dir, "search", "--scope", "shared", "--query", "anything")).code).toBe(0);
}, 40000);

test("init rejects unknown flags without entering prompts or creating files", async () => {
  const dir = workspace();
  const result = (await run(dir, "init", "--db", "PRIVATE_VALUE"));
  expect(JSON.parse(result.stderr).code).toBe("INVALID_INPUT");
  expect(result.stderr).not.toContain("PRIVATE_VALUE");
  expect(result.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

test("help distinguishes read-only startup-context from project binding", async () => {
  const dir = workspace();
  const result = (await run(dir, "help"));
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Acepta cualquier carpeta existente y legible");
  expect(result.stdout).toContain("startup-context no");
  expect(result.stdout).not.toContain("requiere Git disponible, incluso para carpetas sin Git");
}, 40000);

test("memory-protocol is public, JSON-only, and creates no product files", async () => {
  const dir = workspace();
  const result = (await run(dir, "memory-protocol", "--json"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    id: "forge614-engram-memory",
    version: 1,
  });
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const missingJson = (await run(dir, "memory-protocol"));
  expect(missingJson.code).toBe(1);
  expect(JSON.parse(missingJson.stderr).code).toBe("INVALID_INPUT");
  expect(missingJson.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const unknownFlag = (await run(dir, "memory-protocol", "--json", "--format", "text"));
  expect(unknownFlag.code).toBe(1);
  expect(JSON.parse(unknownFlag.stderr).code).toBe("INVALID_INPUT");
  expect(unknownFlag.stdout).toBe("");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);

  const v2 = (await run(dir, "memory-protocol", "--json", "--protocol-version", "2"));
  expect(v2.code).toBe(0);
  expect(JSON.parse(v2.stdout)).toMatchObject({ id: "forge614-engram-memory", version: 2 });
  expect(JSON.parse(v2.stdout).startupContext.command).toContain("startup-context");

  const invalidVersion = (await run(dir, "memory-protocol", "--json", "--protocol-version", "3"));
  expect(invalidVersion.code).toBe(1);
  expect(JSON.parse(invalidVersion.stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(dir, "user", ".forge614"))).toBe(false);
}, 40000);

test("sync without PostgreSQL configuration never creates storage", async () =>{
  const dir=workspace();const result=(await run(dir,"sync"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  expect((await run(dir,"init","--json")).code).toBe(0);
  expect(JSON.parse((await run(dir,"sync")).stderr).code).toBe("SYNC_DISABLED");
  expect(JSON.parse((await run(dir,"sync-watch","--interval","0")).stderr).code).toBe("INVALID_INPUT");
}, 40000);

test("all projects and working directories share exactly one workspace configuration", async () => {
  const a = workspace(); const b = workspace(); const id = (await create(a));
  (await create(a,"Another")); const user = join(a,"user");
  const saved = (await run(a,"save","--project-id",id,"--title","Global storage","--content","Persistent SQLite"));
  expect(saved.code).toBe(0);
  const result = (await runAs(b,user,"search","--project-id",id,"--query","SQLite"));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)[0].memory.id).toBe(JSON.parse(saved.stdout).id);
  expect(JSON.parse((await runAs(b,user,"project-list")).stdout)).toHaveLength(2);
  expect(existsSync(join(a,".forge614"))).toBe(false);
  expect(existsSync(join(b,".forge614"))).toBe(false);
  expect(readdirSync(join(user,".forge614")).sort()).toEqual(["engram"]);
  expect(readdirSync(join(user,".forge614","engram")).filter(n=>!n.endsWith("-wal")&&!n.endsWith("-shm")).sort()).toEqual([".env","engram.db"]);
  expect(readFileSync(join(user,".forge614","engram",".env"),"utf8")).not.toContain(id);
}, 45_000);

test("SDK workspace and CLI share the same identity and database", async () => {
  const dir = workspace(); const index = resolve(import.meta.dir,"../../../index.ts");
  const code = `import { MemoryWorkspace } from ${JSON.stringify(index)};
    const workspace = new MemoryWorkspace();
    const p = workspace.createProject("SDK");
    const store = workspace.open();
    try { store.save({projectId:p.projectId,title:'SDK',content:'SQLite shared',type:'fact'}); }
    finally { store.close(); }
    console.log(p.projectId);`;
  const child = Bun.spawn([process.execPath,"-e",code],{
    cwd:dir,env:{...process.env,FORGE614_HOME:join(dir,"user",".forge614")},stdout:"pipe",stderr:"pipe",
  });
  const [exitCode,stdout] = await Promise.all([child.exited,new Response(child.stdout).text()]);
  expect(exitCode).toBe(0);
  const id = stdout.trim();
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","SQLite")).stdout)).toHaveLength(1);
}, 40000);

test("project CLI saves, revises, searches, archives and restores with UUID identity", async () => {
  const dir = workspace(); const id = (await create(dir));
  const first = (await run(dir,"save","--project-id",id,"--title","Base","--content","SQLite","--topic","db","--request-key","first"));
  expect(first.code).toBe(0); const saved = JSON.parse(first.stdout);
  const update = (await run(dir,"save","--project-id",id,"--title","Base","--content","PostgreSQL","--topic","db","--expected-version","1"));
  expect(update.code).toBe(0); expect(JSON.parse(update.stdout).version).toBe(2);
  expect(JSON.parse((await run(dir,"history","--project-id",id,"--id",saved.id)).stdout)).toHaveLength(2);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","PostgreSQL")).stdout)[0].memory.id).toBe(saved.id);
  expect((await run(dir,"archive","--project-id",id,"--id",saved.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","PostgreSQL")).stdout)).toEqual([]);
  expect((await run(dir,"restore","--project-id",id,"--id",saved.id)).code).toBe(0);
  expect(JSON.parse((await run(dir,"get","--project-id",id,"--id",saved.id)).stdout).state).toBe("active");
}, 40000);

test("explicit reinforcement enrollment is repeatable and exact CLI saves stay owner-scoped without a new version", async () => {
  const dir=workspace();
  for(let attempt=0;attempt<2;attempt++) {
    const enabled=(await run(dir,"reinforcement-enable"));
    expect(enabled.code).toBe(0);
    expect(JSON.parse(enabled.stdout)).toEqual({enabled:true,schema:7});
  }
  const a=(await create(dir,"A")),b=(await create(dir,"B"));
  const base=["--title","Runtime owner","--content","Project-local observation","--type","decision","--topic","runtime-owner"];
  const first=JSON.parse((await run(dir,"save","--project-id",a,...base,"--request-key","a-create")).stdout);
  const foreign=JSON.parse((await run(dir,"save","--project-id",b,...base,"--request-key","b-create")).stdout);
  const repeated=JSON.parse((await run(dir,"save","--project-id",a,...base,"--expected-version","1","--request-key","a-observation")).stdout);
  expect(repeated).toMatchObject({id:first.id,projectId:a,version:1});
  expect(repeated.id).not.toBe(foreign.id);
  expect(JSON.parse((await run(dir,"history","--project-id",a,"--id",first.id)).stdout)).toHaveLength(1);
  const results=JSON.parse((await run(dir,"search","--project-id",a,"--scope","project","--query","observation")).stdout);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({memory:{id:first.id,version:1},explanation:{reinforcement:{duplicateCount:1}}});
}, 40000);

test("init is repeatable and rename retains identity without per-project registration", async () => {
  const dir = workspace(); const id = (await create(dir)); const root = join(dir,"user",".forge614","engram");
  const before = readFileSync(join(root,"engram.db")); const config = readFileSync(join(root,".env"));
  expect((await run(dir,"init","--json")).code).toBe(0);
  expect(readFileSync(join(root,"engram.db"))).toEqual(before);
  expect(readFileSync(join(root,".env"))).toEqual(config);
  expect((await run(dir,"project-rename","--project-id",id,"--name","Renamed")).code).toBe(0);
  const listed = JSON.parse((await run(dir,"project-list")).stdout);
  expect(listed[0].name).toBe("Renamed"); expect(listed[0].projectId).toBe(id);
  expect((await run(dir,"project-list")).stdout).not.toContain(root);
}, 40000);

test("two identical project names stay isolated from each other", async () => {
  const dir = workspace(); const a = (await create(dir,"Same")); const b = (await create(dir,"Same"));
  expect(a).not.toBe(b);
  expect((await run(dir,"save","--project-id",a,"--title","SQLite","--content","One")).code).toBe(0);
  expect(JSON.parse((await run(dir,"search","--project-id",b,"--query","SQLite")).stdout)).toEqual([]);
}, 40000);

test("missing configuration and configured missing database never cause silent reinitialization", async () => {
  const dir = workspace();
  expect(JSON.parse((await run(dir,"search","--scope","shared","--query","SQLite")).stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(existsSync(join(dir,"user",".forge614"))).toBe(false);
  const id = (await create(dir));
  expect(JSON.parse((await run(dir,"get","--project-id",id,"--id","missing")).stderr).code).toBe("NOT_FOUND");
  const path = join(dir,"user",".forge614","engram","engram.db"); rmSync(path);
  for (const args of [["init","--json"],["project-create","--name","No"],["search","--scope","shared","--query","SQLite"]]) {
    expect((await run(dir,...args)).code).toBe(1); expect(existsSync(path)).toBe(false);
  }
}, 40000);

async function parallel(dir: string, args: string[]) {
  return Promise.all(Array.from({length:4},async () => {
    const child = Bun.spawn([process.execPath,cli,...args], {
      cwd:dir,env:{...process.env,FORGE614_HOME:join(dir,"user",".forge614")},stdout:"pipe",stderr:"pipe",
    });
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,stdout,stderr};
  }));
}
test("concurrent project and shared request replays create one memory per namespace", async () => {
  const dir = workspace(); const id = (await create(dir));
  for (const target of [["--project-id",id],["--scope","shared"]]) {
    const results = await parallel(dir,["save",...target,"--title","parallel","--content","One operation","--request-key","same-request"]);
    for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
    expect(new Set(results.map(result => JSON.parse(result.stdout).id)).size).toBe(1);
  }
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","parallel")).stdout)).toHaveLength(2);
}, 40000);

test("concurrent initializers keep a single config and preserve all projects", async () => {
  const dir = workspace(); const results = await parallel(dir,["project-create","--name","parallel"]);
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(new Set(results.map(result => JSON.parse(result.stdout).projectId)).size).toBe(4);
  expect(JSON.parse((await run(dir,"project-list")).stdout)).toHaveLength(4);
  expect(existsSync(join(dir,"user",".forge614","projects"))).toBe(false);
}, 40000);

test("concurrent init of existing workspace leaves existing memories and configuration intact", async () => {
  const dir = workspace(); const id = (await create(dir));
  expect((await run(dir,"save","--project-id",id,"--title","Keep","--content","SQLite")).code).toBe(0);
  const path = join(dir,"user",".forge614","engram",".env"); const before = readFileSync(path);
  const results = await parallel(dir,["init","--json"]);
  for (const result of results) { expect(result.code).toBe(0); expect(result.stderr).toBe(""); }
  expect(readFileSync(path)).toEqual(before);
  expect(JSON.parse((await run(dir,"search","--project-id",id,"--query","SQLite")).stdout)).toHaveLength(1);
}, 40000);

test("explicit session CLI lifecycle, previews, version reads, timeline and context stay noninteractive", async () =>{
  const dir=workspace();
  expect((await run(dir,"sessions-enable")).code).toBe(0);
  const started=(await run(dir,"session-start","--directory",dir,"--session-id","chat-one"));
  expect(started.code).toBe(0);const session=JSON.parse(started.stdout);
  const saved=(await run(dir,"save","--project-id",session.projectId,"--title","Decision","--content","Use WAL","--session-id","chat-one"));
  expect(saved.code).toBe(0);const memory=JSON.parse(saved.stdout);
  const preview=JSON.parse((await run(dir,"search","--project-id",session.projectId,"--query","WAL","--preview")).stdout);
  expect(preview[0].memory).not.toHaveProperty("content");
  expect(JSON.parse((await run(dir,"get","--project-id",session.projectId,"--id",memory.id,"--version","1")).stdout)).toMatchObject({memory:{id:memory.id,version:1},currentVersion:1});
  expect(JSON.parse((await run(dir,"timeline","--project-id",session.projectId,"--session-id","chat-one","--id",memory.id,"--version","1","--before","0","--after","0")).stdout)).toMatchObject({sessionId:"chat-one",before:[],after:[]});
  expect(JSON.parse((await run(dir,"context","--project-id",session.projectId,"--compact","--max-bytes","1024")).stdout).format).toBe(1);
  const summary=JSON.stringify({goal:"Ship",instructions:"",discoveries:"WAL",accomplishments:"Done",nextSteps:"None",files:[]});
  expect((await run(dir,"session-summary","--project-id",session.projectId,"--session-id","chat-one","--summary-json",summary,"--request-key","summary-1")).code).toBe(0);
  expect(JSON.parse((await run(dir,"session-end","--project-id",session.projectId,"--session-id","chat-one")).stdout).endedAt).not.toBeNull();
}, 40000);
