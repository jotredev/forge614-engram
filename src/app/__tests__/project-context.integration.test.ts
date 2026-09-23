import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { MemoryStore } from "../memory-store";
import { bindProjectContext, resolveProjectContext, saveProjectMemory, startProjectSession } from "../project-context";

const directories: string[] = [];
const stores: MemoryStore[] = [];
function temporary(prefix = "forge614-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
function store(path = join(temporary(), "engram.db")): MemoryStore {
  const value = new MemoryStore(path); stores.push(value); return value;
}
function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-c", "commit.gpgSign=false", "-C", cwd, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
function repository(): string {
  const directory = temporary("forge614-repo-");
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "tests@example.invalid");
  git(directory, "config", "user.name", "Forge614 Tests");
  writeFileSync(join(directory, "README.md"), "fixture\n");
  git(directory, "add", "README.md");
  git(directory, "commit", "--quiet", "-m", "fixture");
  return directory;
}
const cli = resolve(import.meta.dir,"../../cli.ts");
// See src/interfaces/cli/__tests__/cli.e2e.test.ts: Bun.spawnSync has a confirmed,
// unfixed upstream hang bug (oven-sh/bun#34069), so this uses async Bun.spawn instead.
async function runCli(cwd:string,userDirectory:string,...args:string[]) {
  const child = Bun.spawn([process.execPath,cli,...args],{
    cwd,env:{...process.env,FORGE614_HOME:join(userDirectory,".forge614")},stdout:"pipe",stderr:"pipe",
  });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});


test("project-binding enrollment explicitly upgrades schema 3 or 4 to exact schema 5", async () => {
  for (const enableSync of [false, true]) {
    const path = join(temporary(), "engram.db");
    const value = store(path);
    if (enableSync) value.enableSync();
    value.enableProjectBindings();
    const db = new Database(path, { readonly: true });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sync_checkpoints','project_bindings') ORDER BY name").all())
      .toEqual([{ name: "project_bindings" }, { name: "sync_checkpoints" }]);
    db.close();
    value.enableProjectBindings();
  }
});


test("read-only resolution never creates a project or binding", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  expect(resolveProjectContext(value, directory, false)).toEqual({
    projectId: null, directory: realpathSync(directory), source: "unbound",
  });
  expect(value.listProjects()).toEqual([]);
});


test("nested Git directories and linked worktrees share the Git common-directory binding", async () => {
  const value = store(); value.enableProjectBindings();
  const repo = repository(); const child = join(repo, "src", "nested"); mkdirSync(child, { recursive: true });
  const linked = temporary("forge614-worktree-"); rmSync(linked, { recursive: true });
  git(repo, "worktree", "add", "--quiet", "-b", "fixture-worktree", linked);
  const first = resolveProjectContext(value, repo, true);
  expect(first.projectId).toMatch(/^[0-9a-f-]{36}$/);
  expect(resolveProjectContext(value, child, false).projectId).toBe(first.projectId);
  expect(resolveProjectContext(value, linked, false).projectId).toBe(first.projectId);
  expect(first.directory).toBe(realpathSync(join(repo, ".git")));
  expect(value.listProjects()).toHaveLength(1);
});


test("sessions share project identity across worktrees but retain distinct runtime roots", async () => {
  const path = join(temporary(),"sessions.db"); const value = store(path); value.enableSessions();
  const repo = repository(); const child = join(repo,"src"); mkdirSync(child);
  const linked = temporary("forge614-session-worktree-"); rmSync(linked,{recursive:true});
  git(repo,"worktree","add","--quiet","-b","session-worktree",linked);
  const first = startProjectSession(value,child,"conversation-main");
  const replay = startProjectSession(value,repo,"conversation-main");
  const second = startProjectSession(value,linked,"conversation-linked");
  expect(replay).toEqual(first);
  expect(second.projectId).toBe(first.projectId);
  expect(first.sessionId).not.toBe(second.sessionId);
  const db = new Database(path,{readonly:true});
  expect(db.query("SELECT sessionId,directory FROM local_session_bindings ORDER BY sessionId").all()).toEqual([
    {sessionId:"conversation-linked",directory:realpathSync(linked)},
    {sessionId:"conversation-main",directory:realpathSync(repo)},
  ]);
  db.close();
});


test("non-Git session roots are explicit and a failed start rolls back project and binding", async () => {
  const value = store(); value.enableSessions();
  const owner = value.createProject("Owner"); value.startSession(owner.projectId,"occupied");
  const directory = temporary("forge614-nongit-session-");
  expect(() => startProjectSession(value,directory,"occupied")).toThrow("no está disponible");
  expect(value.listProjects().map(project => project.projectId)).toEqual([owner.projectId]);
  expect(resolveProjectContext(value,directory,false).projectId).toBeNull();
  const started = startProjectSession(value,directory,"available");
  expect(startProjectSession(value,join(directory,"."),"available")).toEqual(started);
});


test("inherited Git redirection variables cannot replace the explicit repository", async () => {
  const value = store(); value.enableProjectBindings();
  const expected = repository(); const redirected = repository();
  const previous = { dir:process.env.GIT_DIR,tree:process.env.GIT_WORK_TREE,common:process.env.GIT_COMMON_DIR };
  process.env.GIT_DIR = join(redirected,".git"); process.env.GIT_WORK_TREE = redirected; process.env.GIT_COMMON_DIR = join(redirected,".git");
  try { expect(resolveProjectContext(value,expected,true).directory).toBe(realpathSync(join(expected,".git"))); }
  finally {
    if (previous.dir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous.dir;
    if (previous.tree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = previous.tree;
    if (previous.common === undefined) delete process.env.GIT_COMMON_DIR; else process.env.GIT_COMMON_DIR = previous.common;
  }
});


test("a broken enclosing Git repository fails closed without creating a second identity", async () => {
  const value = store(); value.enableProjectBindings();
  const repo = repository(); const child = join(repo,"src"); mkdirSync(child);
  const first = saveProjectMemory(value,repo,{ title:"Root",content:"Original identity",type:"fact" });
  expect(first.projectId).not.toBeNull();
  git(repo,"config","core.repositoryformatversion","999");
  expect(() => saveProjectMemory(value,child,{ title:"Child",content:"Must not fork identity",type:"fact" }))
    .toThrow("identidad Git");
  expect(value.listProjects().map(project => project.projectId)).toEqual([first.projectId!]);
});


test("an unavailable Git executable is not mistaken for a non-Git project", async () => {
  const value = store(); value.enableProjectBindings(); const directory = temporary();
  const original = process.env.PATH; process.env.PATH = "";
  try { expect(() => resolveProjectContext(value,directory,true)).toThrow("identidad Git"); }
  finally { if (original === undefined) delete process.env.PATH; else process.env.PATH = original; }
  expect(value.listProjects()).toEqual([]);
});


test("Git discovery has a finite timeout and leaves storage unchanged when config input blocks", async () => {
  const path = join(temporary(),"engram.db"); const value = store(path); value.enableProjectBindings(); value.close();
  const repo = repository(); const fifo = join(repo,".git","blocking-config");
  const made = Bun.spawnSync(["mkfifo",fifo],{ stderr:"pipe" });
  if (made.exitCode !== 0) throw new Error(made.stderr.toString());
  appendFileSync(join(repo,".git","config"),`\n[include]\n\tpath = ${fifo}\n`);
  const storeModule = resolve(import.meta.dir,"../memory-store.ts");
  const contextModule = resolve(import.meta.dir,"../project-context.ts");
  const script = `import {MemoryStore} from ${JSON.stringify(storeModule)};
    import {saveProjectMemory} from ${JSON.stringify(contextModule)};
    const store=new MemoryStore(${JSON.stringify(path)});
    try {
      saveProjectMemory(store,${JSON.stringify(repo)},{title:"Blocked",content:"Must fail",type:"fact"});
      process.exitCode=2;
    } catch(error) {
      console.log(JSON.stringify({code:error?.code,message:error?.message}));
    } finally { store.close(); }`;
  const child = Bun.spawn([process.execPath,"-e",script],{stdout:"pipe",stderr:"pipe"});
  const outcome = await Promise.race([
    child.exited.then(code => ({ timedOut:false,code })),
    Bun.sleep(1800).then(() => ({ timedOut:true,code:null })),
  ]);
  if (outcome.timedOut) { child.kill("SIGKILL"); await child.exited; }
  expect(outcome).toEqual({ timedOut:false,code:0 });
  const output = await new Response(child.stdout).text();
  expect(output).toContain("PROJECT_IDENTITY_UNAVAILABLE");
  expect(store(path).listProjects()).toEqual([]);
},4000);


test("same-name existing projects require an explicit binding instead of identity guessing", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  const existing = value.createProject(basename(directory));
  expect(() => resolveProjectContext(value, directory, true)).toThrow("vinculación explícita");
  expect(value.listProjects()).toHaveLength(1);
  expect(bindProjectContext(value, directory, existing.projectId).projectId).toBe(existing.projectId);
  expect(resolveProjectContext(value, directory, false).projectId).toBe(existing.projectId);
});


test.each([false,true])("renaming a %s Git directory requires explicit binding and preserves memory identity", (withGit) => {
  const value=store();value.enableProjectBindings();
  const root=temporary(),old=join(root,"old-name"),moved=join(root,"new-name");mkdirSync(old);
  if(withGit)git(old,"init","--quiet");
  const saved=saveProjectMemory(value,old,{title:"Before",content:"Keep identity",type:"fact"});
  renameSync(old,moved);
  expect(resolveProjectContext(value,moved,false).projectId).toBeNull();
  expect(()=>saveProjectMemory(value,moved,{title:"After",content:"Do not split",type:"fact"})).toThrow("vinculación explícita");
  expect(()=>resolveProjectContext(value,moved,true)).toThrow("vinculación explícita");
  const unrelated=join(root,"unrelated");mkdirSync(unrelated);
  expect(()=>resolveProjectContext(value,unrelated,true)).toThrow("vinculación explícita");
  expect(value.listProjects()).toHaveLength(1);
  bindProjectContext(value,moved,saved.projectId!);
  expect(saveProjectMemory(value,moved,{title:"After",content:"Same identity",type:"fact"}).projectId).toBe(saved.projectId);
  expect(value.get(saved.projectId,saved.id)?.content).toBe("Keep identity");
  expect(saveProjectMemory(value,unrelated,{title:"New",content:"New project",type:"fact"}).projectId).not.toBe(saved.projectId);
  expect(JSON.stringify(value.syncSnapshot())).not.toContain(root);
});


test("an inaccessible recorded binding fails closed but synthetic store bindings remain usable", async () =>{
  const value=store();value.enableProjectBindings();const root=temporary();
  const notDirectory=join(root,"file");writeFileSync(notDirectory,"fixture");
  value.resolveProjectDirectory(join(notDirectory,"child"),"Synthetic",true);
  // stat fails with ENOTDIR, which must be treated as unavailable, never as evidence of a live project.
  expect(()=>resolveProjectContext(value,temporary(),true)).toThrow("vinculación explícita");
  expect(value.resolveProjectDirectory("synthetic/second","Second",true).created).toBe(true);
});


test("missing, home and filesystem-root directories are rejected without writes", async () => {
  const value = store(); value.enableProjectBindings();
  for (const directory of [join(temporary(), "missing"), homedir(), realpathSync("/")]) {
    expect(() => resolveProjectContext(value, directory, true)).toThrow();
  }
  expect(value.listProjects()).toEqual([]);
});


test("first project save creates identity, binding and memory atomically", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  expect(() => saveProjectMemory(value, directory, {
    title: " ", content: "invalid", type: "fact",
  })).toThrow();
  expect(value.listProjects()).toEqual([]);
  expect(resolveProjectContext(value, directory, false).projectId).toBeNull();

  const saved = saveProjectMemory(value, directory, {
    title: "Decision", content: "Use SQLite", type: "decision", topicKey: "database", requestKey: "first",
  });
  const context = resolveProjectContext(value, directory, false);
  expect(context.projectId).not.toBeNull();
  expect(saved.projectId).toBe(context.projectId);
  expect(value.get(context.projectId!, saved.id)?.content).toBe("Use SQLite");
});


test("sync snapshots preserve project UUIDs but exclude machine-local path bindings", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  const saved = saveProjectMemory(value, directory, { title: "Local", content: "Bound", type: "fact" });
  const snapshot = value.syncSnapshot();
  expect(saved.projectId).not.toBeNull();
  expect(snapshot.projects[0]?.projectId).toBe(saved.projectId!);
  expect(JSON.stringify(snapshot)).not.toContain(realpathSync(directory));
  expect(Object.hasOwn(snapshot, "projectBindings")).toBe(false);
});


test("concurrent first resolution creates one project identity and one binding", async () => {
  const path = join(temporary(),"engram.db"); const value = store(path); value.enableProjectBindings(); value.close();
  const directory = temporary(); const storeModule = resolve(import.meta.dir,"../memory-store.ts");
  const contextModule = resolve(import.meta.dir,"../project-context.ts");
  const script = `import {MemoryStore} from ${JSON.stringify(storeModule)};
    import {resolveProjectContext} from ${JSON.stringify(contextModule)};
    const store=new MemoryStore(${JSON.stringify(path)});
    try { console.log(resolveProjectContext(store,${JSON.stringify(directory)},true).projectId); }
    finally { store.close(); }`;
  const children = Array.from({length:4},() => Bun.spawn([process.execPath,"-e",script],{stdout:"pipe",stderr:"pipe"}));
  const results = await Promise.all(children.map(async child => ({
    code:await child.exited,stdout:await new Response(child.stdout).text(),stderr:await new Response(child.stderr).text(),
  })));
  expect(results.every(result => result.code === 0)).toBe(true);
  expect(new Set(results.map(result => result.stdout.trim())).size).toBe(1);
  const reopened = store(path);
  expect(reopened.listProjects()).toHaveLength(1);
  expect(resolveProjectContext(reopened,directory,false).projectId).toBe(results[0]!.stdout.trim());
});
