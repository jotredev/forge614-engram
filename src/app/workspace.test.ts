/**
 * Comprueba MemoryWorkspace: una única base compartida por todos los proyectos, la garantía
 * de nunca migrar ni recrear una base ya existente sin permiso, el rechazo de enlaces
 * simbólicos o duros peligrosos, permisos de archivo privados, y las operaciones de grupo
 * (ecosistema) sin exponer SQLite directamente.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { expectPosixMode } from "../infrastructure/__test-support__/permissions";
import { MemoryWorkspace } from "./workspace";
import { MemoryStore } from "./memory-store";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-workspace-")); dirs.push(dir);
  const root = join(dir, ".forge614"); const config = new WorkspaceConfig(root);
  return { dir, root, config, workspace: new MemoryWorkspace(config), db: join(root,"engram.db") };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

// Verifica que dos proyectos distintos comparten el mismo archivo de configuración y la misma base, sin mezclar sus memorias.
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

// Verifica que reabrir el espacio de trabajo desde otra instancia lista los mismos proyectos con los mismos ids, sin volver a registrarlos, y que un cambio hecho desde ahí se ve en la instancia original.
test("reopening lists all stored projects with the same IDs without project registration", () => {
  const f = fixture(); const a = f.workspace.createProject("Before");
  const before = readFileSync(f.db); const env = readFileSync(join(f.root,".env"));
  const reopened = new MemoryWorkspace(new WorkspaceConfig(f.root));
  reopened.init(); expect(reopened.listProjects()).toEqual([a]);
  expect(readFileSync(f.db)).toEqual(before); expect(readFileSync(join(f.root,".env"))).toEqual(env);
  expect(reopened.renameProject(a.projectId,"After").projectId).toBe(a.projectId);
  expect(f.workspace.listProjects()[0]?.name).toBe("After");
});

// Verifica que listar un espacio de trabajo sin inicializar no crea nada, y que abrirlo directamente (sin init) falla en vez de crear la base.
test("listing an uninitialized workspace is read-only and opening cannot create storage", () => {
  const f = fixture(); expect(f.workspace.listProjects()).toEqual([]);
  expect(() => f.workspace.open()).toThrow(); expect(existsSync(f.root)).toBe(false);
});

// Verifica que si la configuración existe pero el archivo de base de datos falta, ninguna operación (init, open, list, createProject) lo recrea: todas fallan en su lugar.
test("configured missing database is not recreated by init, save, list or project creation", () => {
  const f = fixture(); f.workspace.init(); rmSync(f.db);
  for (const action of [() => f.workspace.init(), () => f.workspace.open(), () => f.workspace.listProjects(), () => f.workspace.createProject("No")]) {
    expect(action).toThrow(); expect(existsSync(f.db)).toBe(false);
  }
});

// Verifica que init() puede adjuntar una base ya existente y compatible (creada fuera del workspace) sin reescribirla ni perder sus proyectos.
test("init can attach existing compatible database without rewriting or losing projects", () => {
  const f = fixture(); const store = new MemoryStore(f.db); const project = store.createProject("Keep"); store.close();
  const before = readFileSync(f.db); f.workspace.init();
  expect(readFileSync(f.db)).toEqual(before); expect(f.workspace.listProjects()).toEqual([project]);
  expect(existsSync(join(f.root,".env"))).toBe(true);
});

function userVersion(path: string): number {
  const db = new Database(path, { readonly: true });
  try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; }
  finally { db.close(); }
}

// Verifica que una base creada desde cero queda en el nivel de esquema 11 y no genera ningún archivo de respaldo (.bak), porque no había nada que respaldar.
test("init on a folder with no database leaves PRAGMA user_version at 11 and creates no .bak file", () => {
  const f = fixture();
  f.workspace.init();
  expect(userVersion(f.db)).toBe(11);
  expect(readdirSync(f.root).filter(name => name.endsWith(".bak"))).toEqual([]);
});

// GARANTÍA AL DUEÑO: verifica que una base ya poblada por debajo del nivel 11 atraviesa init() sin que cambie ni su nivel de esquema ni una sola fila de memorias, y sin generar respaldo.
test("OWNER GUARANTEE: an existing populated database below level 11 passes through init() unchanged", () => {
  const f = fixture();
  const store = new MemoryStore(f.db);
  const a = store.createProject("Alpha"); const b = store.createProject("Beta");
  store.save({ projectId: a.projectId, title: "One", content: "Project memory", type: "fact" });
  store.save({ projectId: b.projectId, title: "Two", content: "Another project memory", type: "decision" });
  store.save({ scope: "shared", projectId: null, title: "Three", content: "Shared memory", type: "preference" });
  store.close();
  const versionBefore = userVersion(f.db);
  expect(versionBefore).toBeLessThan(11);
  const fingerprint = () => {
    const db = new Database(f.db, { readonly: true });
    try { return db.query("SELECT id,version,title,content FROM memories ORDER BY id").all(); }
    finally { db.close(); }
  };
  const rowsBefore = fingerprint();

  f.workspace.init();

  expect(userVersion(f.db)).toBe(versionBefore);
  expect(fingerprint()).toEqual(rowsBefore);
  expect(readdirSync(f.root).filter(name => name.endsWith(".bak"))).toEqual([]);
});

// GARANTÍA AL DUEÑO: verifica que una base real de la versión 1.6.0 (nivel de esquema 10) sobrevive intacta a dos llamadas seguidas de init(): la primera la adjunta, la segunda es el caso normal de todos los días.
test("OWNER GUARANTEE: a configured 1.6.0 database at level 10 passes through init() twice untouched", () => {
  const f = fixture();
  mkdirSync(f.root, { mode: 0o700 });
  copyFileSync(join(import.meta.dir, "../../tests/fixtures/v1.6.0/schema-10.db"), f.db);
  const rows = () => {
    const db = new Database(f.db, { readonly: true });
    try { return db.query("SELECT id,scope,version,title,content,state FROM memories ORDER BY id").all(); }
    finally { db.close(); }
  };
  const before = rows();
  expect(before.length).toBeGreaterThan(0);
  f.workspace.init(); // Adjunta la base existente y escribe la configuración.
  f.workspace.init(); // El caso de todos los días: configuración y base ya presentes.
  expect(userVersion(f.db)).toBe(10);
  expect(rows()).toEqual(before);
  expect(readdirSync(f.root).filter(name => name.endsWith(".bak"))).toEqual([]);
});

// Verifica que un archivo SQLite ajeno (otro application_id) o con un nivel de esquema demasiado antiguo se rechaza antes de escribir ninguna configuración, y que no pierde sus datos propios.
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

// Verifica que una carpeta raíz insegura (un enlace simbólico que la redirige) o una configuración heredada nunca hacen que init() siga ese redirección ni cree una base donde no debería.
test("unsafe root and legacy config never redirect or trigger database initialization", () => {
  const f = fixture(); const outside = join(f.dir,"outside"); mkdirSync(outside);
  symlinkSync(outside,f.root);
  expect(() => f.workspace.init()).toThrow(); expect(readdirSync(outside)).toEqual([]);
  const g = fixture(); mkdirSync(join(g.root,"projects"),{recursive:true,mode:0o700});
  writeFileSync(join(g.root,"projects","keep"),"KEEP");
  expect(() => g.workspace.init()).toThrow(); expect(existsSync(g.db)).toBe(false);
  expect(readFileSync(join(g.root,"projects","keep"),"utf8")).toBe("KEEP");
});

// Verifica que se puede guardar una memoria compartida (shared) tras init() sin que eso cree ningún proyecto.
test("shared memory can be stored after init without creating a project", () => {
  const f = fixture(); f.workspace.init(); const store = f.workspace.open();
  try {
    const saved = store.save({ scope:"shared", projectId:null, title:"Language", content:"Spanish", type:"preference" });
    expect(store.get(null,saved.id)?.scope).toBe("shared");
  } finally { store.close(); }
  expect(f.workspace.listProjects()).toEqual([]);
});

// Verifica que si el archivo de base de datos es un enlace simbólico a otro archivo, init() lo rechaza sin tocar el archivo al que apunta.
test("initialization rejects a symlinked database without modifying its target", () => {
  const f = fixture(); mkdirSync(f.root,{mode:0o700});
  const outside = join(f.dir,"outside.db"); writeFileSync(outside,"");
  symlinkSync(outside,f.db);
  expect(() => f.workspace.init()).toThrow();
  expect(readFileSync(outside)).toHaveLength(0);
  expect(existsSync(join(f.root,".env"))).toBe(false);
});

// Verifica que, con la configuración ya existente, abrir, inicializar o crear un proyecto se rechaza si el archivo de base de datos es un enlace (simbólico o duro), sin tocar las memorias del archivo real al que apunta.
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

// Verifica que un enlace simbólico en cualquiera de los archivos auxiliares de SQLite (-wal, -shm, -journal) se rechaza antes de inicializar, sin tocar el archivo al que apunta.
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

/** Comprueba que la base nueva tiene permisos privados POSIX (0o600) cuando el sistema los expone. */
test("new workspace database is created with private file permissions", () => {
  const f = fixture(); f.workspace.init();
  expectPosixMode(f.db, 0o600);
});

// Verifica el ciclo completo de grupos a través del workspace: crear, listar, ligar (dos veces, detectando si cambió), renombrar y desligar, además de los nombres inválidos o duplicados.
test("groups are created, listed and bound through the workspace without exposing SQLite", () => {
  const f = fixture();
  expect(f.workspace.listGroups()).toEqual([]);
  const project = f.workspace.createProject("Frontend");
  const group = f.workspace.createGroup("tienda");
  expect(group.name).toBe("tienda");
  expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.workspace.createGroup("otra").name).toBe("otra");
  expect(() => f.workspace.createGroup("tienda")).toThrow(expect.objectContaining({ code: "GROUP_EXISTS" }));
  expect(() => f.workspace.createGroup("Mal Nombre")).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
  expect(f.workspace.bindProjectToGroup(project.projectId, "tienda")).toEqual({ group, changed: true, identityFiles: { updated: 0, skipped: 0 } });
  expect(f.workspace.bindProjectToGroup(project.projectId, group.id).changed).toBe(false);
  expect(f.workspace.listGroups()).toEqual([
    { ...f.workspace.listGroups()[0]!, name: "otra", projects: [] },
    { ...group, projects: [{ projectId: project.projectId, name: "Frontend" }] },
  ]);
  expect(f.workspace.renameGroup("tienda", "mi-tienda").group).toEqual({ ...group, name: "mi-tienda" });
  expect(f.workspace.unbindProject(project.projectId).unbound).toBe(true);
  expect(f.workspace.unbindProject(project.projectId).unbound).toBe(false);
});

// Verifica que las operaciones de grupo sobre un grupo inexistente fallan sin migrar la base solo para reportar que no lo encontraron (la base sigue byte a byte igual).
test("group operations fail cleanly and never migrate a database only to report a missing group", () => {
  const f = fixture();
  const project = f.workspace.createProject("Frontend");
  const before = readFileSync(f.db);
  expect(() => f.workspace.bindProjectToGroup(project.projectId, "no-existe")).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
  expect(f.workspace.unbindProject(project.projectId)).toEqual({ unbound: false, identityFiles: { updated: 0, skipped: 0 } });
  expect(() => f.workspace.renameGroup("no-existe", "otra")).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
  expect(readFileSync(f.db)).toEqual(before);
  f.workspace.createGroup("tienda");
  expect(() => f.workspace.bindProjectToGroup(crypto.randomUUID(), "tienda")).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));
});

// Verifica que activar el ecosistema respalda una base que ya tenía datos por debajo del nivel
// 8, pero no genera respaldo para una base vacía (nada que perder). Aquí las dos bases se crean
// con `new MemoryStore(...)` directamente, sin pasar por `workspace.init()` (que ya adjuntaría
// una base existente sin migrarla, como en la prueba "init can attach..." de arriba): por eso es
// precisamente `createGroup`, más abajo, quien de verdad dispara la migración de ecosistema.
test("enrolling the ecosystem level backs up a database that holds data and skips an empty one", () => {
  const empty = fixture(); new MemoryStore(empty.db).close();
  empty.workspace.createGroup("primero");
  expect(readdirSync(empty.root).filter(name => name.includes("pre-ecosystem"))).toEqual([]);
  const used = fixture();
  const usedStore = new MemoryStore(used.db); usedStore.createProject("Con datos"); usedStore.close();
  used.workspace.createGroup("primero");
  expect(readdirSync(used.root).filter(name => name.includes("pre-ecosystem"))).toHaveLength(1);
});

// Verifica que renombrar un proyecto desde el workspace actualiza el nombre en el archivo de identidad de una carpeta ligada a él.
test("renaming a project keeps every bound identity file in step", () => {
  const f = fixture(); const folder = mkdtempSync(join(tmpdir(), "forge614-ws-id-")); dirs.push(folder);
  const project = f.workspace.createProject("Antes");
  const store = f.workspace.open();
  try { store.enableProjectBindings(); store.bindProjectDirectory(folder, project.projectId); } finally { store.close(); }
  mkdirSync(join(folder, ".forge614"));
  writeFileSync(join(folder, ".forge614", "project.json"), JSON.stringify({ schemaVersion: 1, project: { id: project.projectId, name: "Antes" }, ecosystem: null }));
  f.workspace.renameProject(project.projectId, "Despues");
  expect(JSON.parse(readFileSync(join(folder, ".forge614", "project.json"), "utf8")).project).toEqual({ id: project.projectId, name: "Despues" });
});
