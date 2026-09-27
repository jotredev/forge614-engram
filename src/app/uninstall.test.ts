/**
 * Comprueba las condiciones de seguridad de la desinstalación: confirmación exacta,
 * orden Atlas-antes-que-Engram, no tocar carpetas ajenas y no borrar nada si algún paso falla.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uninstallEngram, type UninstallDependencies } from "./uninstall";

async function withHome(run:(home:string)=>Promise<void>) {
  const home=mkdtempSync(join(tmpdir(),"engram-uninstall-"));
  try { await run(home); } finally { rmSync(home,{recursive:true,force:true}); }
}

function dependencies(home:string, extra: Omit<UninstallDependencies, "home"|"forgeHome"|"executable"> = {}) {
  return { home, forgeHome: join(home, ".forge614"), executable: process.execPath, ...extra };
}

// Verifica que una frase de confirmación incorrecta rechaza la desinstalación sin borrar nada.
test("wrong confirmation leaves the Engram product directory intact", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  await expect(uninstallEngram({confirmation:'yes'},dependencies(home))).rejects.toMatchObject({code:'UNINSTALL_CONFIRMATION'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

// Verifica que si el desinstalador de Atlas devuelve un código distinto de 0, la carpeta de Engram no se toca.
test("Atlas failure leaves Engram intact before local cleanup", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),atlas=join(home,'.forge614','atlas','bin');mkdirSync(atlas,{recursive:true});mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  writeFileSync(join(atlas,'forge614-atlas'),'binary',{mode:0o700});
  await expect(uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS'},
    dependencies(home,{runAtlasUninstall:async()=>1}),
  )).rejects.toMatchObject({code:'ATLAS_UNINSTALL_FAILED'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

// Verifica que con la frase de confirmación correcta se borra solo la carpeta de Engram, dejando intacta la carpeta hermana "shell".
test("removes only the Engram product directory after exact confirmation", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),shell=join(home,'.forge614','shell');mkdirSync(root,{recursive:true});mkdirSync(shell,{recursive:true});
  writeFileSync(join(root,'memory'),'memory');writeFileSync(join(shell,'keep'),'shell');
  const result=await uninstallEngram({confirmation:'REMOVE FORGE614-ENGRAM'},dependencies(home));
  expect(result.removed).toBe(true);expect(existsSync(root)).toBe(false);expect(existsSync(join(shell,'keep'))).toBe(true);
}));

// Verifica que si retirar la entrada de PATH falla, la carpeta de Engram no se borra.
test("PATH cleanup failure leaves the Engram product directory intact", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'keep'),'memory');
  await expect(uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM'},
    dependencies(home,{removePathPublication:async()=>{throw new Error('cannot clean PATH');}}),
  )).rejects.toMatchObject({code:'PATH_REMOVE_FAILED'});
  expect(existsSync(join(root,'keep'))).toBe(true);
}));

// Verifica que la desinstalación no toca la configuración de otro programa (aquí, la de Cursor).
test("does not inspect or modify external client configuration during removal", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),cursor=join(home,'.cursor');mkdirSync(root,{recursive:true});mkdirSync(cursor,{recursive:true});
  writeFileSync(join(root,'keep'),'memory');
  const configuration=join(cursor,'mcp.json');writeFileSync(configuration,'{"mcpServers":{"forge614-engram":{"command":"edited","args":["mcp"]}}}\n');
  await uninstallEngram({confirmation:'REMOVE FORGE614-ENGRAM'},dependencies(home));
  expect(existsSync(root)).toBe(false);
  expect(existsSync(configuration)).toBe(true);
}));

// Verifica el orden real de las operaciones: la carpeta de Engram todavía existe cuando se retira el PATH, y solo después se borra.
test("removes PATH publication before deleting the Engram product directory", async () => withHome(async home => {
  const root=join(home,'.forge614','engram');mkdirSync(root,{recursive:true});writeFileSync(join(root,'memory'),'memory');
  let rootExistedDuringPathRemoval=false;
  await uninstallEngram(
    {confirmation:'REMOVE FORGE614-ENGRAM'},
    dependencies(home,{removePathPublication:async()=>{
      rootExistedDuringPathRemoval=existsSync(root);return [];
    }}),
  );
  expect(rootExistedDuringPathRemoval).toBe(true);expect(existsSync(root)).toBe(false);
}));
