import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafePath, guardedWrite, readSafeFile } from "./private-files";
import * as windowsReparseGuard from "./windows-reparse-guard";
import { withDirectory } from "../__test-support__/fixtures";

type Equal<Left,Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Condition extends true> = Condition;

const nativeGuardModule = { ...windowsReparseGuard };
function withNativeWindowsGuard(checker:(path:string)=>unknown,operation:()=>void):void{
  const platform=Object.getOwnPropertyDescriptor(process,"platform");if(!platform)throw new Error("Missing process.platform descriptor.");
  mock.module("./windows-reparse-guard",()=>({...nativeGuardModule,hasWindowsReparsePoint:checker}));
  Object.defineProperty(process,"platform",{...platform,value:"win32"});
  try{operation();}finally{
    Object.defineProperty(process,"platform",platform);
    mock.module("./windows-reparse-guard",()=>nativeGuardModule);
  }
}

test("assertSafePath exposes no checker bypass in its public API", () => {
  type AssertSafePathPublicSignature = Expect<Equal<Parameters<typeof assertSafePath>,[path:string,platform?:NodeJS.Platform]>>;
  const signature:AssertSafePathPublicSignature=true;
  expect(signature).toBe(true);
});

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

test("a native guard exception rejects the path", () => withDirectory(dir => {
  const path = join(dir, "config");
  withNativeWindowsGuard(() => { throw new Error("native"); }, () => {
    expect(() => assertSafePath(path, "win32")).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });
}));

test("a native guard reparse result rejects the path", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "config");
  withNativeWindowsGuard(() => true, () => {
    expect(() => assertSafePath(path, "win32")).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });
}));

test("an unexpected native guard result rejects the path", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "config");
  withNativeWindowsGuard(() => "safe", () => {
    expect(() => assertSafePath(path, "win32")).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });
}));

const nativeWindows = process.platform === "win32" ? test : test.skip;
nativeWindows("native Windows tests require a built, nonempty reparse addon", () => {
  const addon = fileURLToPath(new URL("../../../native/windows-reparse-guard/build/Release/windows_reparse_guard.node", import.meta.url));
  expect(statSync(addon).size).toBeGreaterThan(0);
});

nativeWindows("native Windows guarded publication accepts ordinary ancestors without shell lookup", () => withDirectory(dir => {
  const path = join(dir, "config");
  const previousPath = process.env.PATH, previousSystemRoot = process.env.SystemRoot;
  process.env.PATH = "";
  process.env.SystemRoot = dir;
  try {
    guardedWrite({path,before:null,after:"new",kind:"config"},()=>{},()=>{});
    expect(readSafeFile(path)).toBe("new");
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousSystemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previousSystemRoot;
  }
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
