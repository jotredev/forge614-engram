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
  await expect(uninstallEngram({confirmation:'yes'},{home,executable:process.execPath})).rejects.toMatchObject({code:'UNINSTALL_CONFIRMATION'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

test("Atlas failure leaves Engram intact before local cleanup", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),atlas=join(home,'.forge614','atlas','bin');mkdirSync(atlas,{recursive:true});mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  writeFileSync(join(atlas,'forge614-atlas'),'binary',{mode:0o700});
  await expect(uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS'},
    {home,executable:process.execPath,runAtlasUninstall:async()=>1},
  )).rejects.toMatchObject({code:'ATLAS_UNINSTALL_FAILED'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

test("removes only the Engram product directory after exact confirmation", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),shell=join(home,'.forge614','shell');mkdirSync(root,{recursive:true});mkdirSync(shell,{recursive:true});
  writeFileSync(join(root,'memory'),'memory');writeFileSync(join(shell,'keep'),'shell');
  const result=await uninstallEngram({confirmation:'REMOVE FORGE614-ENGRAM'},{home,executable:process.execPath});
  expect(result.removed).toBe(true);expect(existsSync(root)).toBe(false);expect(existsSync(join(shell,'keep'))).toBe(true);
}));

test("PATH cleanup failure leaves the Engram product directory intact", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  await expect(uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM'},
    {home,executable:process.execPath,removePathPublication:async()=>{throw new Error('cannot clean PATH');}},
  )).rejects.toMatchObject({code:'PATH_REMOVE_FAILED'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

test("does not inspect or modify external client configuration during removal", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),cursor=join(home,'.cursor');mkdirSync(root,{recursive:true});mkdirSync(cursor,{recursive:true});
  writeFileSync(join(root,'keep'),'memory');
  const configuration=join(cursor,'mcp.json');writeFileSync(configuration,'{"mcpServers":{"forge614-engram":{"command":"edited","args":["mcp"]}}}\n');
  await uninstallEngram({confirmation:'REMOVE FORGE614-ENGRAM'},{home,executable:process.execPath});
  expect(existsSync(root)).toBe(false);
  expect(existsSync(configuration)).toBe(true);
}));

test("removes PATH publication before deleting the Engram product directory", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'memory'),'memory');
  let rootExistedDuringPathRemoval=false;
  await uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM'},
    {home,executable:process.execPath,removePathPublication:async()=>{
      rootExistedDuringPathRemoval=existsSync(root);return [];
    }},
  );
  expect(rootExistedDuringPathRemoval).toBe(true);expect(existsSync(root)).toBe(false);
}));
