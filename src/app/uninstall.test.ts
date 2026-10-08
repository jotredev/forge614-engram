/**
 * Comprueba las condiciones de seguridad de la desinstalación: confirmación exacta,
 * orden Atlas-antes-que-Engram, no tocar carpetas ajenas y no borrar nada si algún paso falla.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uninstallEngram, type UninstallDependencies } from "./uninstall";

async function withHome(run:(home:string)=>Promise<void>) {
  const home=mkdtempSync(join(tmpdir(),"engram-uninstall-"));
  try { await run(home); } finally { rmSync(home,{recursive:true,force:true}); }
}

function dependencies(home: string, extra: Partial<UninstallDependencies> = {}): UninstallDependencies {
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

// Verifica que la desinstalación no toca la configuración de otro programa (aquí, la de otro cliente cualquiera).
test("does not inspect or modify external client configuration during removal", async () => withHome(async home => {
  const root=join(home,'.forge614','engram'),other=join(home,'.other-client');mkdirSync(root,{recursive:true});mkdirSync(other,{recursive:true});
  writeFileSync(join(root,'keep'),'memory');
  const configuration=join(other,'mcp.json');writeFileSync(configuration,'{"mcpServers":{"forge614-engram":{"command":"edited","args":["mcp"]}}}\n');
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

// En Windows busca forge614-atlas.exe y falla con ATLAS_UNINSTALL_REQUIRED si no existe.
test("looks for forge614-atlas.exe on Windows and fails if missing", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const atlas = join(home, ".forge614", "atlas", "bin");
  mkdirSync(atlas, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "keep"), "memory");
  // En Unix se buscaría forge614-atlas, pero en Windows debe exigir forge614-atlas.exe
  writeFileSync(join(atlas, "forge614-atlas"), "unix-binary", { mode: 0o700 });
  await expect(uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS" },
    dependencies(home, { platform: "win32" }),
  )).rejects.toMatchObject({ code: "ATLAS_UNINSTALL_REQUIRED" });
  expect(existsSync(join(root, "keep"))).toBe(true);
}));

// En Windows busca forge614-atlas.exe y ejecuta la desinstalación de Atlas correctamente.
test("looks for forge614-atlas.exe on Windows and executes it", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const atlas = join(home, ".forge614", "atlas", "bin");
  mkdirSync(atlas, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "keep"), "memory");
  const atlasExe = join(atlas, "forge614-atlas.exe");
  writeFileSync(atlasExe, "win-binary");
  let executedCommand = "";
  const result = await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS" },
    dependencies(home, {
      platform: "win32",
      runAtlasUninstall: async (cmd) => { executedCommand = cmd; return 0; },
      removePathPublication: async () => ["User Path"],
    }),
  );
  expect(executedCommand).toBe(atlasExe);
  expect(result.atlasRemoved).toBe(true);
  expect(existsSync(root)).toBe(false);
}));

// Si el desinstalador de Atlas falla en Windows, Engram no se modifica.
test("Atlas failure on Windows leaves Engram intact before local cleanup", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const atlas = join(home, ".forge614", "atlas", "bin");
  mkdirSync(atlas, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "keep"), "memory");
  writeFileSync(join(atlas, "forge614-atlas.exe"), "win-binary");
  await expect(uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS" },
    dependencies(home, {
      platform: "win32",
      runAtlasUninstall: async () => 1,
    }),
  )).rejects.toMatchObject({ code: "ATLAS_UNINSTALL_FAILED" });
  expect(existsSync(join(root, "keep"))).toBe(true);
}));

// En Windows, cuando el proceso corre desde engram/bin/forge614-engram.exe, programa el ayudante por WMI y devuelve pendingRemoval.
test("schedules deferred removal via WMI and returns pendingRemoval on Windows when running from engram bin", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const binDir = join(root, "bin");
  const shell = join(home, ".forge614", "shell");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(shell, { recursive: true });
  writeFileSync(join(binDir, "forge614-engram.exe"), "active-exe");
  writeFileSync(join(shell, "keep"), "shell-content");

  let spawnedShell = "";
  let spawnedArgs: string[] = [];
  let helperContent = "";
  let wmiContent = "";

  const activeExe = join(binDir, "forge614-engram.exe");
  const result = await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM" },
    dependencies(home, {
      platform: "win32",
      executable: activeExe,
      processId: 4321,
      removePathPublication: async () => ["User Path"],
      spawn: (cmd, args) => {
        spawnedShell = cmd;
        spawnedArgs = args;
        const fileIdx = args.indexOf("-File");
        const filePath = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
        if (filePath) {
          wmiContent = readFileSync(filePath, "utf8");
        }
        const cmdLineIdx = args.indexOf("-CommandLine");
        const cmdLine = cmdLineIdx !== -1 ? args[cmdLineIdx + 1] : undefined;
        if (cmdLine) {
          const match = /"-File"\s+"([^"]+)"/.exec(cmdLine);
          if (match && match[1]) {
            helperContent = readFileSync(match[1], "utf8");
          }
        }
        return { status: 0 };
      },
    }),
  );

  expect(result).toEqual({
    removed: false,
    atlasRemoved: false,
    pathPublications: ["User Path"],
    pendingRemoval: true,
  });

  // La carpeta de Engram no debe haberse borrado sincrónicamente
  expect(existsSync(root)).toBe(true);
  // La carpeta hermana shell no debe haberse tocado
  expect(existsSync(join(shell, "keep"))).toBe(true);
  // Se debió invocar pwsh o powershell.exe con el script WMI
  expect(["pwsh", "powershell.exe"]).toContain(spawnedShell);
  expect(spawnedArgs).toContain("-CommandLine");
  expect(wmiContent).toContain("Invoke-CimMethod -ClassName Win32_Process -MethodName Create");
  // El ayudante PowerShell contiene las defensas obligatorias
  expect(helperContent).toContain("[System.IO.FileAttributes]::ReparsePoint");
  expect(helperContent).toContain("parent path is not a safe directory");
  expect(helperContent).toContain("Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction Stop");
  expect(helperContent).toContain("Get-Process -Id $ProcessId");
  expect(helperContent).toContain("process $ProcessId did not exit within timeout");
}));

// En Windows crea los scripts y logs de paso bajo la raíz temporal inyectada tempRoot.
test("creates staging files and logs under injected tempRoot", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "forge614-engram.exe"), "active-exe");
  const customTemp = join(home, "custom-temp");
  mkdirSync(customTemp, { recursive: true });

  let stagingArg = "";
  let logArg = "";

  await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM" },
    dependencies(home, {
      platform: "win32",
      executable: join(binDir, "forge614-engram.exe"),
      tempRoot: customTemp,
      removePathPublication: async () => ["User Path"],
      spawn: (_cmd, args) => {
        const cmdLineIdx = args.indexOf("-CommandLine");
        const cmdLine = cmdLineIdx !== -1 ? args[cmdLineIdx + 1] : undefined;
        if (cmdLine) {
          const stagingMatch = /"-StagingDir"\s+"([^"]+)"/.exec(cmdLine);
          if (stagingMatch && stagingMatch[1]) stagingArg = stagingMatch[1];
          const logMatch = /"-LogFile"\s+"([^"]+)"/.exec(cmdLine);
          if (logMatch && logMatch[1]) logArg = logMatch[1];
        }
        return { status: 0 };
      },
    }),
  );

  expect(stagingArg.startsWith(customTemp)).toBe(true);
  expect(logArg.startsWith(customTemp)).toBe(true);
}));

// Si WMI falla al programar el ayudante, lanza UNINSTALL_SCHEDULE_FAILED y preserva Engram.
test("WMI scheduling failure throws UNINSTALL_SCHEDULE_FAILED and preserves Engram", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "forge614-engram.exe"), "active-exe");

  const activeExe = join(binDir, "forge614-engram.exe");
  await expect(uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM" },
    dependencies(home, {
      platform: "win32",
      executable: activeExe,
      removePathPublication: async () => ["User Path"],
      spawn: () => ({ status: 1 }),
    }),
  )).rejects.toMatchObject({ code: "UNINSTALL_SCHEDULE_FAILED" });

  expect(existsSync(root)).toBe(true);
}));

// En Windows, si el proceso corre desde un ejecutable externo, borra sincrónicamente sin pendingRemoval.
test("performs synchronous removal on Windows when executable is outside engram bin", async () => withHome(async home => {
  const root = join(home, ".forge614", "engram");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "memory"), "data");

  const result = await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM" },
    dependencies(home, {
      platform: "win32",
      executable: "C:\\bun\\bin\\bun.exe",
      removePathPublication: async () => ["User Path"],
    }),
  );

  expect(result).toEqual({
    removed: true,
    atlasRemoved: false,
    pathPublications: ["User Path"],
  });
  expect(result.pendingRemoval).toBeUndefined();
  expect(existsSync(root)).toBe(false);
}));

// Si la carpeta de Engram no existe, devuelve removed: false sin pendingRemoval.
test("returns removed: false without pendingRemoval when Engram does not exist", async () => withHome(async home => {
  const result = await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM" },
    dependencies(home, {
      platform: "win32",
      executable: "C:\\bun\\bin\\bun.exe",
      removePathPublication: async () => [],
    }),
  );

  expect(result).toEqual({
    removed: false,
    atlasRemoved: false,
    pathPublications: [],
  });
  expect(result.pendingRemoval).toBeUndefined();
}));
