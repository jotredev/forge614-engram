/**
 * Comprueba la resolución de proyecto a partir de carpetas Git reales: los directorios
 * Git anidados y los árboles de trabajo (worktrees) enlazados comparten identidad, las
 * sesiones comparten proyecto pero no raíz en tiempo de ejecución, nunca se adivina una
 * identidad ni se crean identidades duplicadas ante un Git roto, inalcanzable o lento, y la
 * primera resolución concurrente desde varios procesos crea un único proyecto y vínculo.
 */
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
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
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
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});


// Verifica que activar los vínculos de proyecto sube la base al nivel de esquema exacto 5, creando la tabla project_bindings (y sync_checkpoints si sync ya estaba activado), y que repetir la activación no falla.
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


// Verifica que resolver con create=false sobre una carpeta sin proyecto no crea nada: devuelve "unbound" y la lista de proyectos sigue vacía.
test("read-only resolution never creates a project or binding", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  expect(resolveProjectContext(value, directory, false)).toEqual({
    projectId: null, directory: realpathSync(directory), source: "unbound",
  });
  expect(value.listProjects()).toEqual([]);
});


// Verifica que una subcarpeta dentro de un repositorio y un árbol de trabajo (worktree) enlazado a él resuelven al mismo proyecto, porque ambos comparten la carpeta común de Git (.git).
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


// Verifica que iniciar la misma sesión desde distintos worktrees del mismo repositorio comparte el proyecto, pero cada raíz de ejecución (runtime) queda registrada por separado en local_session_bindings.
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


// Verifica que una carpeta sin Git necesita un id de sesión explícito no ocupado, que un intento fallido (id ya usado por otro proyecto) deshace el proyecto y el vínculo que se hubieran creado, y que repetir con éxito y desde una ruta equivalente (con ".") da el mismo resultado.
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


// Verifica que las variables de entorno de redirección de Git (GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR) heredadas de otro repositorio no pueden sustituir al repositorio real de la carpeta que se está resolviendo.
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


// Verifica que si el repositorio Git que envuelve a una subcarpeta está roto (versión de formato desconocida), la resolución falla en vez de crear una segunda identidad para esa subcarpeta.
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


// Verifica que si el ejecutable "git" no está disponible (PATH vacío), eso se trata como un fallo de Git, no como si la carpeta simplemente no tuviera Git.
test("an unavailable Git executable is not mistaken for a non-Git project", async () => {
  const value = store(); value.enableProjectBindings(); const directory = temporary();
  const original = process.env.PATH; process.env.PATH = "";
  try { expect(() => resolveProjectContext(value,directory,true)).toThrow("identidad Git"); }
  finally { if (original === undefined) delete process.env.PATH; else process.env.PATH = original; }
  expect(value.listProjects()).toEqual([]);
});


// Verifica que descubrir el repositorio Git tiene un tiempo límite: si la lectura de su configuración se bloquea (aquí, con un FIFO), la operación falla con PROJECT_IDENTITY_UNAVAILABLE en vez de colgarse, y no crea ningún proyecto.
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


// Verifica que si ya existe un proyecto con el mismo nombre que la carpeta, la resolución automática no adivina que es ese: exige un vínculo explícito.
test("same-name existing projects require an explicit binding instead of identity guessing", async () => {
  const value = store(); value.enableProjectBindings();
  const directory = temporary();
  const existing = value.createProject(basename(directory));
  expect(() => resolveProjectContext(value, directory, true)).toThrow(`Ya existe un proyecto llamado «${basename(directory)}» (${existing.projectId})`);
  expect(value.listProjects()).toHaveLength(1);
  expect(bindProjectContext(value, directory, existing.projectId).projectId).toBe(existing.projectId);
  expect(resolveProjectContext(value, directory, false).projectId).toBe(existing.projectId);
});


// Verifica, con y sin Git, que mover una carpeta sin archivo de identidad (o que lo perdió) a otro lugar conservando su nombre no reconoce el proyecto por accidente: exige un vínculo explícito, y una vez ligada de nuevo conserva la identidad de las memorias ya guardadas. Una carpeta no relacionada ya no queda bloqueada por esa carpeta perdida y se registra sola.
test.each([false,true])("moving a %s Git directory without an identity file keeps requiring explicit binding and preserves memory identity", (withGit) => {
  const value=store();value.enableProjectBindings();
  const root=temporary(),old=join(root,"old-name"),elsewhere=join(root,"elsewhere"),moved=join(elsewhere,"old-name");mkdirSync(old);mkdirSync(elsewhere);
  if(withGit)git(old,"init","--quiet");
  const saved=saveProjectMemory(value,old,{title:"Before",content:"Keep identity",type:"fact"});
  // Una carpeta anterior al archivo de identidad portátil (o que lo perdió) sigue necesitando un vínculo explícito.
  rmSync(join(old,".forge614"),{recursive:true});
  renameSync(old,moved);
  expect(resolveProjectContext(value,moved,false).projectId).toBeNull();
  expect(()=>saveProjectMemory(value,moved,{title:"After",content:"Do not split",type:"fact"})).toThrow("project-bind");
  expect(()=>resolveProjectContext(value,moved,true)).toThrow("project-bind");
  expect(value.listProjects()).toHaveLength(1);
  bindProjectContext(value,moved,saved.projectId!);
  expect(saveProjectMemory(value,moved,{title:"After",content:"Same identity",type:"fact"}).projectId).toBe(saved.projectId);
  expect(value.get(saved.projectId,saved.id)?.content).toBe("Keep identity");
  // Cambiado a propósito (antes: lanzaba «vinculación explícita»): una carpeta sin relación con el proyecto ya no se bloquea.
  const unrelated=join(root,"unrelated");mkdirSync(unrelated);
  expect(saveProjectMemory(value,unrelated,{title:"New",content:"New project",type:"fact"}).projectId).not.toBe(saved.projectId);
  expect(JSON.stringify(value.syncSnapshot())).not.toContain(root);
});


// Fija el límite documentado de 1.8.4: una carpeta renombrada a OTRO nombre, sin archivo de identidad y sin remoto, ya no se bloquea; se registra sola como proyecto nuevo (la memoria anterior queda en el proyecto viejo y se recupera con project-bind).
test.each([false,true])("renaming a %s Git directory to another name without an identity file registers it alone (documented limit)", (withGit) => {
  const value=store();value.enableProjectBindings();
  const root=temporary(),old=join(root,"old-name"),renamed=join(root,"new-name");mkdirSync(old);
  if(withGit)git(old,"init","--quiet");
  const saved=saveProjectMemory(value,old,{title:"Before",content:"Keep identity",type:"fact"});
  rmSync(join(old,".forge614"),{recursive:true});
  renameSync(old,renamed);
  expect(resolveProjectContext(value,renamed,false).projectId).toBeNull();
  const created=saveProjectMemory(value,renamed,{title:"After",content:"Separate project",type:"fact"});
  expect(created.projectId).not.toBe(saved.projectId);
  expect(value.listProjects()).toHaveLength(2);
  expect(value.get(saved.projectId,saved.id)?.content).toBe("Keep identity");
});


// Reproduce el caso «Release probe»: un proyecto de prueba vinculado a una carpeta temporal con Git que ya no existe no debe impedir que una carpeta nueva con Git y otro nombre abra sesión y se registre sola; después, buscar ya no da PROJECT_NOT_BOUND. Una carpeta con el mismo nombre que la carpeta perdida sigue bloqueada.
test("a lost folder of another project does not block a new Git folder with another name (Release probe)", () => {
  const value=store();value.enableProjectBindings();value.enableSessions();
  const gone=join(temporary(),"git-bound");
  const probe=value.resolveProjectDirectory(join(gone,".git"),"Release probe",true).project!;
  const fresh=temporary("forge614-shell-");git(fresh,"init","--quiet");
  expect(resolveProjectContext(value,fresh,false).projectId).toBeNull();
  const session=startProjectSession(value,fresh,"probe-session");
  expect(session.projectId).not.toBe(probe.projectId);
  expect(resolveProjectContext(value,fresh,false)).toMatchObject({projectId:session.projectId,source:"file"});
  expect(value.listProjects()).toHaveLength(2);
  const sameName=join(temporary(),"git-bound");mkdirSync(sameName);git(sameName,"init","--quiet");
  expect(()=>startProjectSession(value,sameName,"other-session")).toThrow(`Esta carpeta podría ser el proyecto «Release probe» (${probe.projectId}), cuya carpeta registrada (${gone}) ya no existe.`);
  expect(()=>startProjectSession(value,sameName,"other-session")).toThrow(`--directory ${realpathSync(sameName)} --project-id ${probe.projectId}`);
});


// Verifica, con y sin Git, que renombrar una carpeta que sí lleva su archivo de identidad conserva el proyecto automáticamente, sin necesitar ninguna acción manual.
test.each([false,true])("renaming a %s Git directory that carries its identity file keeps the project with no action", (withGit) => {
  const value=store();value.enableProjectBindings();
  const root=temporary(),old=join(root,"old-name"),moved=join(root,"new-name");mkdirSync(old);
  if(withGit)git(old,"init","--quiet");
  const saved=saveProjectMemory(value,old,{title:"Before",content:"Keep identity",type:"fact"});
  renameSync(old,moved);
  expect(resolveProjectContext(value,moved,false)).toMatchObject({projectId:saved.projectId,source:"file"});
  expect(saveProjectMemory(value,moved,{title:"After",content:"Same identity",type:"fact"}).projectId).toBe(saved.projectId);
  expect(value.listProjects()).toHaveLength(1);
});


// Verifica que un vínculo ya registrado pero inaccesible en disco (una ruta cuyo padre es un archivo, no una carpeta) cuenta como carpeta perdida: bloquea solo a una carpeta que podría ser ese proyecto (mismo nombre), mientras que una carpeta nueva con otro nombre se registra sola y otros vínculos sintéticos de la base siguen funcionando con normalidad.
test("an inaccessible recorded binding fails closed but synthetic store bindings remain usable", async () =>{
  const value=store();value.enableProjectBindings();const root=temporary();
  const notDirectory=join(root,"file");writeFileSync(notDirectory,"fixture");
  value.resolveProjectDirectory(join(notDirectory,"child"),"Synthetic",true);
  // stat falla con ENOTDIR, y eso debe tratarse como "no disponible", nunca como prueba de que hay un proyecto vivo ahí.
  const sameName=join(temporary(),"child");mkdirSync(sameName);
  expect(()=>resolveProjectContext(value,sameName,true)).toThrow("Esta carpeta podría ser el proyecto «Synthetic»");
  // Cambiado a propósito (antes: lanzaba «vinculación explícita»): una carpeta nueva con otro nombre se registra aunque el vínculo previo sea ilegible.
  expect(resolveProjectContext(value,temporary(),true).source).toBe("created");
  expect(value.resolveProjectDirectory("synthetic/second","Second",true).created).toBe(true);
});


// Verifica que una carpeta inexistente, la carpeta personal (home) y la raíz del sistema de archivos se rechazan como carpetas de proyecto, sin crear nada.
test("missing, home and filesystem-root directories are rejected without writes", async () => {
  const value = store(); value.enableProjectBindings();
  for (const directory of [join(temporary(), "missing"), homedir(), realpathSync("/")]) {
    expect(() => resolveProjectContext(value, directory, true)).toThrow();
  }
  expect(value.listProjects()).toEqual([]);
});


// Verifica que un guardado inválido no crea nada, y que el primer guardado válido en una carpeta nueva crea a la vez la identidad del proyecto, su vínculo y la memoria, todo consistente entre sí.
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


// Verifica que la fotografía (snapshot) de sincronización conserva el id del proyecto pero nunca incluye la ruta de la carpeta local ni un campo de vínculos de carpeta, porque eso es propio de cada máquina.
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


// Verifica que cuatro procesos que resuelven a la vez la misma carpeta sin proyecto previo crean un único proyecto y un único vínculo, no cuatro proyectos distintos por una condición de carrera.
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
