import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { runSetup } from "../../src/app/setup";
import { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "../../src/app/workspace";
import { syncWorkspace } from "../../src/app/synchronization";

// Explicit test-only local binaries. Never use DATABASE_URL or a user's database.
const bin=process.env.FORGE614_TEST_POSTGRES_BIN;
const integration=bin?test:test.skip;
let directory="",url="",admin:SQL;
function command(name:string,args:string[]) {
  const result=Bun.spawnSync([join(bin!,name),...args],{stdout:"pipe",stderr:"pipe"});
  if(result.exitCode!==0) throw new Error(result.stderr.toString());
}
beforeAll(async()=>{
  if(!bin) return;
  directory=mkdtempSync(join(tmpdir(),"forge614-pg-test-"));
  command("initdb",["-D",join(directory,"data"),"-U","postgres","-A","trust","--no-locale","--encoding=UTF8"]);
  // Ask the OS for a free loopback port; start immediately. A collision fails safely.
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}); const port=listener.port;listener.stop(true);
  command("pg_ctl",["-D",join(directory,"data"),"-l",join(directory,"log"),"-o",`-h 127.0.0.1 -p ${port} -k ${directory}`,"-w","start"]);
  url=`postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;admin=new SQL(url);
},30000);
afterAll(async()=>{
  if(!bin||!directory) return;
  if(admin) await admin.close();
  try { command("pg_ctl",["-D",join(directory,"data"),"-m","fast","-w","stop"]); }
  finally { rmSync(directory,{recursive:true,force:true}); }
},30000);


integration("configured CLI stays local offline and sync failure preserves the same SQLite data",async()=>{
  // Fresh database, never a user service. Earlier tests intentionally corrupted postgres schema.
  await admin.unsafe("CREATE DATABASE setup_test");
  const testUrl=url.replace("/postgres?","/setup_test?");
  const user=join(directory,"cli-user");const config=new WorkspaceConfig(join(user,".forge614"));
  const answers=["si",testUrl,"no","si"];const output:string[]=[];
  await runSetup({write:t=>output.push(t),ask:async()=>answers.shift()??null},config);
  expect(config.read().postgresUrl).toBe(testUrl);
  const workspace=new MemoryWorkspace(config);expect(workspace.listProjects()).toEqual([]);
  const p=workspace.createProject("CLI");
  const store=workspace.open();let id:string;
  try {id=store.save({projectId:p.projectId,title:"offline",content:"persistent",type:"fact"}).id;}
  finally {store.close();}
  await syncWorkspace(config);
  const other=new WorkspaceConfig(join(directory,"other-user",".forge614"));
  const second=["si",testUrl,"no","si"];await runSetup({write(){},ask:async()=>second.shift()??null},other);
  await syncWorkspace(other);
  const received=new MemoryWorkspace(other).open(true);
  try {expect(received.get(p.projectId,id)!.content).toBe("persistent");} finally {received.close();}
  config.configurePostgres("postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable",config.revision());
  const before=readFileSync(config.databasePath);
  await expect(syncWorkspace(config)).rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
  expect(readFileSync(config.databasePath)).toEqual(before);
  const cli=resolve(import.meta.dir,"../../src/cli.ts"),preload=resolve(import.meta.dir,"../fixtures/user-directory.ts");
  const run=(...args:string[])=>Bun.spawnSync([process.execPath,"--preload",preload,cli,...args],{env:{...process.env,FORGE614_TEST_USER_DIRECTORY:user}});
  const read=run("search","--project-id",p.projectId,"--query","persistent");
  expect(read.exitCode).toBe(0);expect(JSON.parse(read.stdout.toString())).toHaveLength(1);
  const saved=run("save","--project-id",p.projectId,"--title","Later","--content","offline writes");
  expect(saved.exitCode).toBe(0);
  const failed=run("sync");expect(failed.exitCode).toBe(1);expect(failed.stderr.toString()).not.toContain("SECRET");
  expect(output.join("\n")).not.toContain(testUrl);
});
