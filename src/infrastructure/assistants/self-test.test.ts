import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testInstalledServer } from "./self-test";

async function childPid(path:string):Promise<number>{
  const deadline=Date.now()+2500;
  while(!existsSync(path)&&Date.now()<deadline)await Bun.sleep(10);
  return Number(readFileSync(path,"utf8").trim());
}
async function expectStopped(pid:number):Promise<void>{
  const deadline=Date.now()+2000;let alive=true;
  while(alive&&Date.now()<deadline){try{process.kill(pid,0);await Bun.sleep(10);}catch{alive=false;}}
  expect(alive).toBe(false);
}

test("pre-cancelled inspection never launches the supplied installation", async () => {
  const controller = new AbortController(); controller.abort();
  expect(await testInstalledServer("/nonexistent/engram", { signal: controller.signal })).toEqual({ status: "not-run", code: "CANCELLED" });
});

test("missing installation yields bounded MCP failure under isolated home", async () => {
  const home = mkdtempSync(join(tmpdir(), "engram-self-test-"));
  try {
    expect(await testInstalledServer(join(home, "missing"), { signal: new AbortController().signal, home, timeoutMs: 1000 })).toEqual({ status: "failed", code: "MCP_FAILED" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("cancelling an in-progress inspection terminates its spawned server", async () => {
  const home = mkdtempSync(join(tmpdir(), "engram-self-test-cancel-"));
  const executable=join(home,"engram"),pidPath=join(home,"child.pid");
  writeFileSync(executable,`#!/bin/sh\necho $$ > '${pidPath}'\nexec /bin/sleep 30\n`,{mode:0o700});
  const controller=new AbortController();
  try {
    const pending=testInstalledServer(executable,{signal:controller.signal,home,timeoutMs:5000});
    const pid=await childPid(pidPath);controller.abort();
    expect(await pending).toEqual({status:"not-run",code:"CANCELLED"});
    await expectStopped(pid);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
