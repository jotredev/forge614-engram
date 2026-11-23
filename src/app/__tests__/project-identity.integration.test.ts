/**
 * Comprueba la identidad de proyecto sobre repositorios Git reales: un clon con archivo de
 * identidad se registra sin preguntar, el archivo de nodo liga el grupo fijo del ecosistema,
 * un archivo dañado detiene toda operación sin cambiar nada, activar el ecosistema por un
 * archivo hace un respaldo la primera vez y calla después, y las contradicciones con el
 * vínculo de carpeta conservan los datos existentes hasta una confirmación.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORGE614_GROUP_ID } from "../../modules/ecosystem";
import { MemoryStore } from "../memory-store";
import { readStartupBlock, readStartupContext } from "../startup-context";
import { bindProjectContext, resolveProjectContext, resolveStartupProjectContext, saveProjectMemory, startProjectSession } from "../project-context";

const directories: string[] = [];
const stores: MemoryStore[] = [];
function temporary(prefix: string): string { const value = mkdtempSync(join(tmpdir(), prefix)); directories.push(value); return value; }
function store(): MemoryStore {
  const value = new MemoryStore(join(temporary("engram-id-db-"), "engram.db")); value.enableProjectBindings(); stores.push(value); return value;
}
function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-c", "commit.gpgSign=false", "-C", cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
function repository(): string {
  const directory = realpathSync(temporary("engram-id-repo-"));
  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "tests@example.invalid"); git(directory, "config", "user.name", "Tests");
  writeFileSync(join(directory, "README.md"), "x\n"); git(directory, "add", "README.md"); git(directory, "commit", "--quiet", "-m", "x");
  return directory;
}
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});
const filePath = (root: string) => join(root, ".forge614", "project.json");
const writeIdentity = (root: string, content: unknown) => { mkdirSync(join(root, ".forge614"), { recursive: true }); writeFileSync(filePath(root), typeof content === "string" ? content : JSON.stringify(content)); };
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = (root: string) => JSON.parse(readFileSync(filePath(root), "utf8"));

// Verifica que un clon con su propio archivo de identidad se registra por su id sin preguntar, sin unirse a ningún grupo, y que resolver de nuevo devuelve el mismo id sin duplicar el proyecto.
test("a clone carrying its identity file is registered by id without asking and without a group", () => {
  const db = store(), root = repository(), id = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "frontend" }, ecosystem: null });
  const context = resolveProjectContext(db, root, false);
  expect(context).toMatchObject({ projectId: id, source: "file" });
  expect(context.group).toBeUndefined();
  expect(db.getProject(id)?.name).toBe("frontend");
  expect(db.projectForDirectory(context.directory)?.projectId).toBe(id);
  expect(resolveProjectContext(db, root, false).projectId).toBe(id);
  expect(db.listProjects()).toHaveLength(1);
});

// Verifica que el grupo declarado en el archivo de identidad se resuelve por id, no por nombre: el clon se une al grupo correcto aunque ya exista otro grupo distinto con el mismo nombre.
test("the identity file declares its group and the clone joins it by id, even when another group has the same name", () => {
  const db = store(), root = repository(), id = crypto.randomUUID(), groupId = crypto.randomUUID();
  db.enableEcosystem(); db.createGroup("tienda");
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "frontend" }, ecosystem: { id: groupId, name: "tienda" } });
  const context = resolveProjectContext(db, root, false);
  expect(context.group).toEqual({ id: groupId, name: "tienda" });
  expect(db.groupOfProject(id)).toMatchObject({ group: { id: groupId, name: "tienda" }, source: "project-file" });
  expect(db.listGroups().map(group => group.name)).toEqual(["tienda", "tienda"]);
});

// Verifica que un grupo declarado en el archivo de identidad activa por sí solo el nivel de ecosistema en una base que aún no lo tenía, dejando un camino de migración con respaldo.
test("a group in the file enrols the ecosystem level by itself, leaving a backup-safe upgrade path", () => {
  const db = store(), root = repository(), groupId = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id: crypto.randomUUID(), name: "api" }, ecosystem: { id: groupId, name: "mi-tienda" } });
  expect(db.ecosystemEnabled()).toBe(false);
  expect(resolveProjectContext(db, root, false).group).toEqual({ id: groupId, name: "mi-tienda" });
  expect(db.ecosystemEnabled()).toBe(true);
});

// Verifica que un archivo de nodo que declara el ecosistema "forge614" liga el grupo fijo correspondiente (por id conocido), y que eso completa la sección "ecosystem" del archivo de identidad, que estaba en null.
test("a node file declaring the forge614 ecosystem binds the fixed group and completes the identity file", () => {
  const db = store(), root = repository(), id = crypto.randomUUID();
  writeFileSync(join(root, "forge614.node.json"), JSON.stringify({ schemaVersion: 1, node: "engram", kind: "product", ecosystem: "forge614" }));
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "engram" }, ecosystem: null });
  const context = resolveProjectContext(db, root, false);
  expect(context.group).toEqual({ id: FORGE614_GROUP_ID, name: "forge614" });
  expect(db.groupOfProject(id)?.source).toBe("node-file");
  expect(read(root).ecosystem).toEqual({ id: FORGE614_GROUP_ID, name: "forge614" });
  expect(read(root).project.id).toBe(id);
});

// Verifica que crear un proyecto para una carpeta le escribe su archivo de identidad sin avisos, sin grupo si nada lo declara, y que repetir la resolución no vuelve a tocar el archivo (mismo hash).
test("creating a project for a folder writes its identity file silently, loose when nothing declares a group", () => {
  const db = store(), root = repository();
  const context = resolveProjectContext(db, root, true);
  expect(context.source).toBe("created");
  expect(context.notices).toBeUndefined();
  expect(read(root)).toEqual({ schemaVersion: 1, project: { id: context.projectId, name: expect.any(String) }, ecosystem: null });
  const digest = sha(filePath(root));
  for (let repeat = 0; repeat < 3; repeat++) { resolveProjectContext(db, root, true); resolveStartupProjectContext(db, root); }
  expect(sha(filePath(root))).toBe(digest);
  expect(db.listProjects()).toHaveLength(1);
});

// Verifica que un proyecto ya ligado por ruta (sin archivo) recibe su archivo de identidad al arrancar, con un aviso en el resultado la primera vez y sin aviso las siguientes.
test("a project already bound by path receives its file on startup, with a notice in the result", () => {
  const db = store(), root = repository();
  const created = resolveProjectContext(db, root, true);
  rmSync(join(root, ".forge614"), { recursive: true });
  const startup = resolveStartupProjectContext(db, root);
  expect(startup).toMatchObject({ projectId: created.projectId, source: "binding" });
  expect(startup.notices).toEqual([expect.objectContaining({ code: "PROJECT_FILE_CREATED" })]);
  expect(read(root).project.id).toBe(created.projectId);
  expect(resolveStartupProjectContext(db, root).notices).toBeUndefined();
});

// Verifica que una carpeta sin vínculo y sin archivo se queda "unbound" de verdad: no se crea ningún proyecto ni se escribe ningún archivo.
test("an unbound folder without a file stays unbound: nothing is created or written", () => {
  const db = store(), root = repository();
  const context = resolveStartupProjectContext(db, root);
  expect(context).toMatchObject({ projectId: null, source: "unbound" });
  expect(existsSync(join(root, ".forge614"))).toBe(false);
  expect(db.listProjects()).toEqual([]);
});

test("a conflicting file preserves the local binding and the file", () => {
  const db = store(), root = repository();
  const local = resolveProjectContext(db, root, true);
  const foreign = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id: foreign, name: "del-archivo" }, ecosystem: null });
  const digest = sha(filePath(root));
  const context = resolveProjectContext(db, root, false);
  expect(context).toMatchObject({ projectId: null, source: "unbound", notices: [{ code: "PROJECT_BINDING_REQUIRED" }] });
  expect(sha(filePath(root))).toBe(digest);
  expect(db.projectForDirectory(context.directory)?.projectId).toBe(local.projectId!);
  expect(db.getProject(foreign)).toBeNull();
  expect(db.ecosystemEnabled()).toBe(false);
});

// Verifica, para tres formas distintas de archivo inválido (JSON corrupto, versión de esquema desconocida, campos extra), que toda operación (resolver, guardar, iniciar sesión) se detiene con PROJECT_FILE_INVALID sin cambiar el archivo ni crear ningún proyecto.
test.each([
  ["corrupt JSON", "{"],
  ["an unknown schema version", { schemaVersion: 2, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: null }],
  ["extra fields", { schemaVersion: 1, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: null, tokens: "a" }],
])("%s stops every operation with PROJECT_FILE_INVALID and changes nothing", (_label, content) => {
  const db = store(), root = repository(); writeIdentity(root, content);
  const before = typeof content === "string" ? content : JSON.stringify(content);
  for (const operation of [
    () => resolveProjectContext(db, root, false), () => resolveProjectContext(db, root, true), () => resolveStartupProjectContext(db, root),
    () => saveProjectMemory(db, root, { title: "t", content: "c", type: "fact" }), () => startProjectSession(db, root, "s1"),
  ]) expect(operation).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(readFileSync(filePath(root), "utf8")).toBe(before);
  expect(db.listProjects()).toEqual([]);
});

// Verifica que guardar una memoria resuelve el proyecto a través del archivo de identidad cuando existe, y que una carpeta distinta sin archivo recibe uno propio con un proyecto distinto.
test("saving and starting sessions resolve through the file and publish it", () => {
  const db = store(), root = repository(), id = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "frontend" }, ecosystem: null });
  const saved = saveProjectMemory(db, root, { title: "Nota", content: "cuerpo", type: "fact", topicKey: "n" });
  expect(saved.projectId).toBe(id);
  expect(db.listProjects()).toHaveLength(1);
  const other = repository();
  expect(saveProjectMemory(db, other, { title: "Otra", content: "cuerpo", type: "fact" }).projectId).not.toBe(id);
  expect(existsSync(filePath(other))).toBe(true);
});

// Verifica que ligar explícitamente una carpeta a un proyecto le escribe su identidad, que repetir el vínculo no vuelve a tocar el archivo, y que ligarla a otro proyecto se rechaza porque el archivo ya declara uno distinto.
test("an explicit binding writes the identity and refuses a folder that already declares another project", () => {
  const db = store(), root = repository(), project = db.createProject("Manual");
  expect(bindProjectContext(db, root, project.projectId).projectId).toBe(project.projectId);
  expect(read(root).project).toEqual({ id: project.projectId, name: "Manual" });
  const digest = sha(filePath(root));
  bindProjectContext(db, root, project.projectId);
  expect(sha(filePath(root))).toBe(digest);
  const other = db.createProject("Otro");
  expect(() => bindProjectContext(db, root, other.projectId)).toThrow(expect.objectContaining({ code: "PROJECT_FILE_CONFLICT" }));
  expect(read(root).project.id).toBe(project.projectId);
});

// Verifica que una base sin los vínculos de carpeta activados rechaza con MIGRATION_REQUIRED antes de registrar nada, aunque la carpeta traiga un archivo de identidad válido.
test("a base without folder bindings refuses before registering anything from the identity file", () => {
  const value = new MemoryStore(join(temporary("engram-id-db-"), "engram.db")); stores.push(value);
  const root = repository();
  writeIdentity(root, { schemaVersion: 1, project: { id: crypto.randomUUID(), name: "clon" }, ecosystem: null });
  expect(() => resolveStartupProjectContext(value, root)).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  expect(value.listProjects()).toEqual([]);
});

// Verifica que la primera lectura que obliga a migrar la base (por un archivo de nodo con datos previos que respaldar) lo informa una sola vez, nombrando el respaldo, y que las lecturas siguientes ya no lo repiten.
test("the first read that has to upgrade the base says so, once, and names the backup", () => {
  const dbPath = join(temporary("engram-id-db-"), "engram.db");
  const value = new MemoryStore(dbPath); stores.push(value); value.enableProjectBindings();
  const other = repository(); saveProjectMemory(value, other, { title: "Existing", content: "data worth a backup", type: "fact" });
  const root = repository();
  writeFileSync(join(root, "forge614.node.json"), JSON.stringify({ ecosystem: "forge614" }));
  const first = resolveProjectContext(value, root, true);
  const notice = first.notices?.find(item => item.code === "DATABASE_MIGRATED");
  expect(notice).toBeDefined();
  expect(notice!.backup).toMatch(/pre-ecosystem/);
  expect(existsSync(notice!.backup!)).toBe(true);
  expect(notice!.message).toContain(notice!.backup!);
  expect(resolveProjectContext(value, root, true).notices?.some(item => item.code === "DATABASE_MIGRATED") ?? false).toBe(false);
});

test("a file contradicting a confirmed origin leaves shared startup context and blocks writes", () => {
  const database = store();
  database.enableIntelligence();
  const first = repository(), second = repository();
  git(first, "remote", "add", "origin", "https://example.com/Org/Repo.git");
  git(second, "remote", "add", "origin", "git@example.com:Org/Repo.git");
  const projectId = saveProjectMemory(database, first, { title: "Private", content: "Project only", type: "fact", pinned: true }).projectId!;
  const other = crypto.randomUUID();
  writeIdentity(second, { schemaVersion: 1, project: { id: other, name: "Other" }, ecosystem: null });
  const shared = database.save({ projectId: null, scope: "shared", title: "Shared", content: "Shared orientation", type: "fact", pinned: true });
  const startup = readStartupContext(database, second);
  expect(startup.shared.pinned.map(row => row.id)).toEqual([shared.id]);
  expect(startup.ecosystem).toEqual({ status: "none" });
  expect(startup.project).toMatchObject({ status: "unbound", projectId: null, context: null, notices: [{ code: "PROJECT_BINDING_REQUIRED" }] });
  const block = readStartupBlock(database, second);
  expect(block.text).toContain("project-bind");
  expect(block.text).not.toContain("Private");
  expect(block.chars).toBe(Array.from(block.text).length);
  expect(block.chars).toBeLessThanOrEqual(5000);
  expect(() => startProjectSession(database, second, "blocked")).toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(() => saveProjectMemory(database, second, { title: "Blocked", content: "This must not save", type: "fact" }))
    .toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(database.getProject(other)).toBeNull();
  expect(database.projectForDirectory(realpathSync(join(second, ".git")))).toBeNull();
  expect(database.getSession(projectId, "blocked")).toBeNull();
});

test("an invalid save rolls back the legacy project registration, group and folder binding", () => {
  const database = store(), root = repository();
  const id = crypto.randomUUID(), groupId = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "Unimported" }, ecosystem: { id: groupId, name: "team" } });
  const before = sha(filePath(root));
  expect(() => saveProjectMemory(database, root, { title: "", content: "Invalid", type: "fact" })).toThrow();
  expect(database.getProject(id)).toBeNull();
  expect(database.getGroup(groupId)).toBeNull();
  expect(database.projectForDirectory(realpathSync(join(root, ".git")))).toBeNull();
  expect(sha(filePath(root))).toBe(before);
});

test("a free remote conflicts with a copied file for a project whose confirmed remote is different", () => {
  const database = store(), original = repository(), copied = repository();
  database.enableSessions();
  git(original, "remote", "add", "origin", "https://example.com/Org/Original.git");
  git(copied, "remote", "add", "origin", "https://example.com/Org/Independent.git");
  const privateMemory = saveProjectMemory(database, original, { title: "Private", content: "Cannot be inherited", type: "fact", pinned: true });
  writeIdentity(copied, { schemaVersion: 1, project: { id: privateMemory.projectId, name: "Original" }, ecosystem: null });
  const startup = readStartupContext(database, copied);
  expect(startup.project).toMatchObject({ status: "unbound", projectId: null, context: null, notices: [{ code: "PROJECT_BINDING_REQUIRED" }] });
  expect(() => startProjectSession(database, copied, "disagreement")).toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(() => saveProjectMemory(database, copied, { title: "Blocked", content: "Must not save", type: "fact" }))
    .toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(database.getSession(privateMemory.projectId!, "disagreement")).toBeNull();
});
