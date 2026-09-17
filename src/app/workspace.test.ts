import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";
import { MemoryStore } from "./memory-store";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-workspace-")); dirs.push(dir);
  const root = join(dir, ".forge614"); const config = new WorkspaceConfig(root);
  return { dir, root, config, workspace: new MemoryWorkspace(config), db: join(root,"engram.db") };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

test("all projects share one config and one database", () => {
  const f = fixture(); const a = f.workspace.createProject("Same");
  const b = f.workspace.createProject("Same");
  const store = f.workspace.open();
  try {
    const saved = store.save({ projectId:a.projectId, title:"SQLite", content:"Choice", type:"fact" });
    expect(store.get(b.projectId,saved.id)).toBeNull();
    expect(store.listProjects()).toHaveLength(2);
  } finally { store.close(); }
  expect(f.workspace.listProjects()).toHaveLength(2);
  expect(readdirSync(f.root).filter(n => !n.endsWith("-wal") && !n.endsWith("-shm")).sort()).toEqual([".env","engram.db"]);
  expect(f.config.read()).toEqual({ storage:"sqlite" });
});

test("reopening lists all stored projects with the same IDs without project registration", () => {
  const f = fixture(); const a = f.workspace.createProject("Before");
  const before = readFileSync(f.db); const env = readFileSync(join(f.root,".env"));
  const reopened = new MemoryWorkspace(new WorkspaceConfig(f.root));
  reopened.init(); expect(reopened.listProjects()).toEqual([a]);
  expect(readFileSync(f.db)).toEqual(before); expect(readFileSync(join(f.root,".env"))).toEqual(env);
  expect(reopened.renameProject(a.projectId,"After").projectId).toBe(a.projectId);
  expect(f.workspace.listProjects()[0]?.name).toBe("After");
});

test("listing an uninitialized workspace is read-only and opening cannot create storage", () => {
  const f = fixture(); expect(f.workspace.listProjects()).toEqual([]);
  expect(() => f.workspace.open()).toThrow(); expect(existsSync(f.root)).toBe(false);
});

test("configured missing database is not recreated by init, save, list or project creation", () => {
  const f = fixture(); f.workspace.init(); rmSync(f.db);
  for (const action of [() => f.workspace.init(), () => f.workspace.open(), () => f.workspace.listProjects(), () => f.workspace.createProject("No")]) {
    expect(action).toThrow(); expect(existsSync(f.db)).toBe(false);
  }
});

test("init can attach existing compatible database without rewriting or losing projects", () => {
  const f = fixture(); const store = new MemoryStore(f.db); const project = store.createProject("Keep"); store.close();
  const before = readFileSync(f.db); f.workspace.init();
  expect(readFileSync(f.db)).toEqual(before); expect(f.workspace.listProjects()).toEqual([project]);
  expect(existsSync(join(f.root,".env"))).toBe(true);
});

test("foreign and old databases are refused before config publication", () => {
  for (const version of [0,1,2]) {
    const f = fixture(); mkdirSync(f.root, {mode:0o700});
    const db = new Database(f.db); db.exec("CREATE TABLE private_data(value TEXT); INSERT INTO private_data VALUES('keep');");
    if (version) db.exec(`PRAGMA application_id=1177956660; PRAGMA user_version=${version};`);
    db.close(); const before = readFileSync(f.db);
    expect(() => f.workspace.init()).toThrow();
    expect(readFileSync(f.db)).toEqual(before); expect(existsSync(join(f.root,".env"))).toBe(false);
  }
});

test("unsafe root and legacy config never redirect or trigger database initialization", () => {
  const f = fixture(); const outside = join(f.dir,"outside"); mkdirSync(outside);
  symlinkSync(outside,f.root);
  expect(() => f.workspace.init()).toThrow(); expect(readdirSync(outside)).toEqual([]);
  const g = fixture(); mkdirSync(join(g.root,"projects"),{recursive:true,mode:0o700});
  writeFileSync(join(g.root,"projects","keep"),"KEEP");
  expect(() => g.workspace.init()).toThrow(); expect(existsSync(g.db)).toBe(false);
  expect(readFileSync(join(g.root,"projects","keep"),"utf8")).toBe("KEEP");
});

test("shared memory can be stored after init without creating a project", () => {
  const f = fixture(); f.workspace.init(); const store = f.workspace.open();
  try {
    const saved = store.save({ scope:"shared", projectId:null, title:"Language", content:"Spanish", type:"preference" });
    expect(store.get(null,saved.id)?.scope).toBe("shared");
  } finally { store.close(); }
  expect(f.workspace.listProjects()).toEqual([]);
});

test("initialization rejects a symlinked database without modifying its target", () => {
  const f = fixture(); mkdirSync(f.root,{mode:0o700});
  const outside = join(f.dir,"outside.db"); writeFileSync(outside,"");
  symlinkSync(outside,f.db);
  expect(() => f.workspace.init()).toThrow();
  expect(readFileSync(outside)).toHaveLength(0);
  expect(existsSync(join(f.root,".env"))).toBe(false);
});

test("configured opens reject database links and keep target memories unchanged", () => {
  for (const link of [symlinkSync, linkSync]) {
    const f = fixture(); f.workspace.init(); rmSync(f.db);
    const outside = join(f.dir,"outside.db"); const store = new MemoryStore(outside);
    const project = store.createProject("Keep"); store.close();
    link(outside,f.db); const before = readFileSync(outside);
    expect(() => f.workspace.open()).toThrow();
    expect(() => f.workspace.init()).toThrow();
    expect(() => f.workspace.createProject("No")).toThrow();
    expect(readFileSync(outside)).toEqual(before);
    const check = new MemoryStore(outside,{readonly:true});
    try { expect(check.listProjects()).toEqual([project]); } finally { check.close(); }
  }
});

test("SQLite auxiliary file links are rejected before initialization", () => {
  for (const suffix of ["-wal","-shm","-journal"]) {
    const f = fixture(); mkdirSync(f.root,{mode:0o700});
    const outside = join(f.dir,"outside"); writeFileSync(outside,"KEEP");
    symlinkSync(outside,f.db + suffix);
    expect(() => f.workspace.init()).toThrow();
    expect(readFileSync(outside,"utf8")).toBe("KEEP");
    expect(existsSync(f.db)).toBe(false);
  }
});

test("new workspace database is created with private file permissions", () => {
  const f = fixture(); f.workspace.init();
  expect(statSync(f.db).mode & 0o777).toBe(0o600);
});
