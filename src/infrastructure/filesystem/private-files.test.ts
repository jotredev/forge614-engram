import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { assertSafePath, guardedWrite, readSafeFile } from "./private-files";
import { withDirectory } from "../__test-support__/fixtures";

test("guarded replacement retains exact backup and private published bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "old");
  const backups: string[] = [], published: string[] = [];
  guardedWrite({ path, before: "old", after: "new", kind: "config" }, p => backups.push(p), p => published.push(p));
  expect(readSafeFile(path)).toBe("new"); expect(published).toEqual([path]);
  expect(backups).toHaveLength(1); expect(readFileSync(backups[0]!, "utf8")).toBe("old");
  if(process.platform!=="win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir).some(p => p.includes("-tmp-"))).toBe(false);
}));

test("Windows path validation accepts ordinary writable config parents without trusting POSIX mode bits", () => withDirectory(dir => {
  const writable = join(dir, "writable"); mkdirSync(writable); chmodSync(writable, 0o777);
  expect(() => assertSafePath(join(writable, "config"), "win32")).not.toThrow();
}));

const nativeWindows = process.platform === "win32" ? test : test.skip;
nativeWindows("diagnostic: Windows reparse query startup reports bounded process metadata", () => withDirectory(dir => {
  const systemRoot=process.env.SystemRoot;
  const executable=systemRoot?join(systemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"):null;
  const started=Date.now();
  const result=executable&&existsSync(executable)
    ? spawnSync(executable,["-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop';$path=[Environment]::GetEnvironmentVariable('FORGE614_ENGRAM_REPARSE_PATH',[System.EnvironmentVariableTarget]::Process);$attributes=[System.IO.File]::GetAttributes($path);if(([int]$attributes -band [int][System.IO.FileAttributes]::ReparsePoint) -ne 0){exit 1};exit 0"],{env:{...process.env,FORGE614_ENGRAM_REPARSE_PATH:dir},shell:false,stdio:"ignore",timeout:2000,windowsHide:true})
    : null;
  console.info(JSON.stringify({diagnostic:"windows-reparse-query",systemRootPresent:!!systemRoot,executableAvailable:!!executable&&existsSync(executable),status:result?.status??null,signal:result?.signal??null,errorCode:(result?.error as NodeJS.ErrnoException|undefined)?.code??null,elapsedMs:Date.now()-started}));
}));
nativeWindows("native Windows guarded publication accepts an ordinary writable directory", () => withDirectory(dir => {
  const path = join(dir, "config");
  guardedWrite({path,before:null,after:"new",kind:"config"},()=>{},()=>{});
  expect(readSafeFile(path)).toBe("new");
}));

function mountvol(args:string[]){
  const systemRoot=process.env.SystemRoot;if(!systemRoot)throw new Error("SystemRoot is required for native Windows test coverage.");
  return spawnSync(join(systemRoot,"System32","mountvol.exe"),args,{encoding:"utf8",stdio:"pipe",windowsHide:true});
}
function otherVolumeRoot(current:string):string{
  for(let code=67;code<=90;code++){
    const root=`${String.fromCharCode(code)}:\\`;
    if(root.toLowerCase()!==current.toLowerCase()&&existsSync(root))return root;
  }
  throw new Error("Native Windows runner needs a second mounted volume for reparse-point coverage.");
}

nativeWindows("native Windows rejects file links, directory junctions, and mount-point reparse ancestors", () => withDirectory(dir => {
  const target=join(dir,"target");writeFileSync(target,"outside");const fileLink=join(dir,"file-link");symlinkSync(target,fileLink,"file");
  expect(lstatSync(fileLink).isSymbolicLink()).toBe(true);expect(()=>readSafeFile(fileLink)).toThrow(expect.objectContaining({code:"UNSAFE_PATH"}));
  const directory=join(dir,"directory");mkdirSync(directory);const junction=join(dir,"junction");symlinkSync(directory,junction,"junction");
  expect(lstatSync(junction).isSymbolicLink()).toBe(true);expect(()=>readSafeFile(join(junction,"config"))).toThrow(expect.objectContaining({code:"UNSAFE_PATH"}));
  const mount=join(dir,"mount");mkdirSync(mount);let mounted=false;
  try{
    const volume=mountvol([otherVolumeRoot(parse(dir).root),"/l"]);expect(volume.status).toBe(0);
    const volumeName=volume.stdout.trim();expect(volumeName).toMatch(/^\\\\\?\\Volume\{[0-9a-f-]+\}\\$/i);
    expect(mountvol([mount,volumeName]).status).toBe(0);mounted=true;
    expect(lstatSync(mount).isSymbolicLink()).toBe(false);
    expect(()=>readSafeFile(join(mount,"config"))).toThrow(expect.objectContaining({code:"UNSAFE_PATH"}));
  }finally{
    if(mounted)mountvol([mount,"/d"]);
    rmSync(mount,{recursive:true,force:true});
  }
}));

test("stale preview and symlink reads fail without changing target bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "external");
  expect(() => guardedWrite({ path, before: "old", after: "new", kind: "config" }, () => {}, () => {})).toThrow(expect.objectContaining({ code: "CHANGED" }));
  const link = join(dir, "link"); symlinkSync(path, link);
  expect(() => readSafeFile(link)).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  expect(readFileSync(path, "utf8")).toBe("external"); expect(readdirSync(dir).sort()).toEqual(["config", "link"]);
}));
