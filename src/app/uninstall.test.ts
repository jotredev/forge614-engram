import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uninstallEngram } from "./uninstall";

async function withHome(run:(home:string)=>Promise<void>) {
  const home=mkdtempSync(join(tmpdir(),"engram-uninstall-"));
  try { await run(home); } finally { rmSync(home,{recursive:true,force:true}); }
}

test("wrong confirmation leaves the Engram product directory intact", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  await expect(uninstallEngram({confirmation:'yes'},{home,executable:process.execPath,clients:[]})).rejects.toMatchObject({code:'UNINSTALL_CONFIRMATION'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

test("Atlas failure leaves Engram intact before assistant cleanup", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),atlas=join(home,'.forge614','atlas','bin');mkdirSync(atlas,{recursive:true});mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  writeFileSync(join(atlas,'forge614-atlas'),'binary',{mode:0o700});
  await expect(uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS'},
    {home,executable:process.execPath,clients:[],runAtlasUninstall:async()=>1},
  )).rejects.toMatchObject({code:'ATLAS_UNINSTALL_FAILED'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

test("removes only the Engram product directory after exact confirmation", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),shell=join(home,'.forge614','shell');mkdirSync(root,{recursive:true});mkdirSync(shell,{recursive:true});
  writeFileSync(join(root,'memory'),'memory');writeFileSync(join(shell,'keep'),'shell');
  const result=await uninstallEngram({confirmation:'REMOVE FORGE614-ENGRAM'},{home,executable:process.execPath,clients:[]});
  expect(result.removed).toBe(true);expect(existsSync(root)).toBe(false);expect(existsSync(join(shell,'keep'))).toBe(true);
}));
