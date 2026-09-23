import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { runSetup } from "../../src/app/setup";
import { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "../../src/app/workspace";
import { syncWorkspace } from "../../src/app/synchronization";
import { postgresTestTimeoutMs, startPostgresCluster, stopPostgresCluster } from "../../src/infrastructure/__test-support__/postgres";

const cluster=startPostgresCluster();
const integration=cluster.available?test:test.skip;
let directory="",url="",admin!:SQL;
if(cluster.available) { directory=cluster.directory;url=cluster.url;admin=new SQL(url); }
else console.warn(`SKIP PostgreSQL integration: ${cluster.reason}`);
afterAll(async()=>{
  if(!cluster.available) return;
  try { await admin.close(); }
  finally { stopPostgresCluster(cluster); }
},postgresTestTimeoutMs);


integration("configured CLI stays local offline and sync failure preserves the same SQLite data",async()=>{
  // Fresh database, never a user service. Earlier tests intentionally corrupted postgres schema.
  await admin.unsafe("CREATE DATABASE setup_test");
  const testUrl=url.replace("/postgres?","/setup_test?");
  const user=join(directory,"cli-user");const config=new WorkspaceConfig(join(user,".forge614","engram"));
  const answers=["si",testUrl,"no","si"];const output:string[]=[];
  await runSetup({write:t=>output.push(t),ask:async()=>answers.shift()??null},config);
  expect(config.read().postgresUrl).toBe(testUrl);
  const workspace=new MemoryWorkspace(config);expect(workspace.listProjects()).toEqual([]);
  const p=workspace.createProject("CLI");
  const store=workspace.open();let id:string;
  try {id=store.save({projectId:p.projectId,title:"offline",content:"persistent",type:"fact"}).id;}
  finally {store.close();}
  await syncWorkspace(config);
  const other=new WorkspaceConfig(join(directory,"other-user",".forge614","engram"));
  const second=["si",testUrl,"no","si"];await runSetup({write(){},ask:async()=>second.shift()??null},other);
  await syncWorkspace(other);
  const received=new MemoryWorkspace(other).open(true);
  try {expect(received.get(p.projectId,id)!.content).toBe("persistent");} finally {received.close();}
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const before=readFileSync(config.databasePath);
  await expect(syncWorkspace(config)).rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
  expect(readFileSync(config.databasePath)).toEqual(before);
  const cli=resolve(import.meta.dir,"../../src/cli.ts");
  // See src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync has a confirmed,
  // unfixed upstream hang bug (oven-sh/bun#34069), so this uses async Bun.spawn instead.
  const run=async(...args:string[])=>{
    const child=Bun.spawn([process.execPath,cli,...args],{env:{...process.env,FORGE614_HOME:join(user,".forge614")},stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill(),20_000);
    try {
      const [exitCode,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
      return {exitCode,stdout,stderr};
    } finally {clearTimeout(timer);}
  };
  const read=await run("search","--project-id",p.projectId,"--query","persistent");
  expect(read.exitCode).toBe(0);expect(JSON.parse(read.stdout)).toHaveLength(1);
  const saved=await run("save","--project-id",p.projectId,"--title","Later","--content","offline writes");
  expect(saved.exitCode).toBe(0);
  const failed=await run("sync");expect(failed.exitCode).toBe(1);expect(failed.stderr).not.toContain("SECRET");
  expect(output.join("\n")).not.toContain(testUrl);
},postgresTestTimeoutMs);
