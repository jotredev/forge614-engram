/**
 * Comprueba la sincronización de identidad entre la base y .forge614/project.json: quién
 * gana entre archivo de nodo y archivo de identidad, qué pasa al quitar o cambiar el grupo,
 * degradación ante una carpeta sin permiso de escritura, y a qué carpetas llega una
 * actualización de nombre o grupo (solo a las que declaran el mismo proyecto).
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORGE614_GROUP_ID } from "../modules/ecosystem";
import { MemoryStore } from "./memory-store";
import { applyIdentityFile, groupOf, publishIdentity } from "./project-identity";

const roots: string[] = [];
const stores: MemoryStore[] = [];
function root(): string { const value = mkdtempSync(join(tmpdir(), "engram-app-identity-")); roots.push(value); return value; }
function store(): MemoryStore { const value = new MemoryStore(":memory:"); value.enableProjectBindings(); stores.push(value); return value; }
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const value of roots.splice(0)) { try { chmodSync(value, 0o755); } catch { /* removed */ } rmSync(value, { recursive: true, force: true }); }
});
const identity = (folder: string, content: unknown) => { mkdirSync(join(folder, ".forge614"), { recursive: true }); writeFileSync(join(folder, ".forge614", "project.json"), JSON.stringify(content)); };
const file = (folder: string) => JSON.parse(readFileSync(join(folder, ".forge614", "project.json"), "utf8"));

// Verifica que sin carpeta raíz o sin archivo de identidad no se resuelve ningún proyecto ni se escribe nada en disco.
test("without a root or a file nothing is resolved and nothing is written", () => {
  const db = store(), folder = root();
  expect(applyIdentityFile(db, "/key", null)).toEqual({ projectId: null, notices: [] });
  expect(applyIdentityFile(db, "/key", folder)).toEqual({ projectId: null, notices: [] });
  expect(db.listProjects()).toEqual([]);
  expect(existsSync(join(folder, ".forge614"))).toBe(false);
});

// Verifica que un archivo sin sección "ecosystem" se completa con null (sin inventar un grupo) y conserva la identidad del proyecto.
test("a file without an ecosystem section is completed with null and keeps its identity", () => {
  const db = store(), folder = root(), id = crypto.randomUUID();
  identity(folder, { schemaVersion: 1, project: { id, name: "viejo" } });
  expect(applyIdentityFile(db, "/key", folder).projectId).toBe(id);
  expect(file(folder)).toEqual({ schemaVersion: 1, project: { id, name: "viejo" }, ecosystem: null });
});

// Verifica que el grupo declarado en el archivo de nodo (forge614.node.json) gana sobre uno distinto declarado en el archivo de identidad, sin reescribir este último.
test("the node file's group wins over a different group in the identity file", () => {
  const db = store(), folder = root(), id = crypto.randomUUID(), other = crypto.randomUUID();
  writeFileSync(join(folder, "forge614.node.json"), JSON.stringify({ ecosystem: "forge614" }));
  identity(folder, { schemaVersion: 1, project: { id, name: "engram" }, ecosystem: { id: other, name: "otro" } });
  applyIdentityFile(db, "/key", folder);
  expect(groupOf(db, id)).toEqual({ id: FORGE614_GROUP_ID, name: "forge614" });
  expect(db.groupOfProject(id)?.source).toBe("node-file");
  expect(file(folder).ecosystem).toEqual({ id: other, name: "otro" });
  expect(db.identityEvents(id).map(event => event.action)).toEqual(["GROUP_BOUND"]);
});

// Verifica que quitar el grupo de un archivo que había establecido la membresía la quita también en la base, pero una membresía hecha por comando explícito sobrevive a un archivo que aún no se puso al día.
test("removing the group from a file that established the membership removes the membership, a command's membership survives", () => {
  const db = store(), folder = root(), id = crypto.randomUUID(), group = { id: crypto.randomUUID(), name: "tienda" };
  identity(folder, { schemaVersion: 1, project: { id, name: "front" }, ecosystem: group });
  applyIdentityFile(db, "/key", folder);
  expect(groupOf(db, id)).toEqual(group);
  identity(folder, { schemaVersion: 1, project: { id, name: "front" }, ecosystem: null });
  applyIdentityFile(db, "/key", folder);
  expect(groupOf(db, id)).toBeUndefined();
  expect(db.identityEvents(id).map(event => event.action)).toEqual(["GROUP_BOUND", "GROUP_UNBOUND"]);
  // Una membresía hecha por comando no la deshace un archivo que todavía no se ha puesto al día.
  db.bindProjectToGroup(id, db.ensureGroup(group.id, group.name).group.id, "command");
  applyIdentityFile(db, "/key", folder);
  expect(groupOf(db, id)).toEqual(group);
});

// Verifica que una carpeta sin permiso de escritura no rompe la operación: solo genera un aviso PROJECT_FILE_NOT_WRITTEN.
test("an unwritable folder degrades to a notice instead of failing the operation", () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  const db = store(), folder = root(), project = db.createProject("Solo lectura");
  chmodSync(folder, 0o555);
  const notices = publishIdentity(db, project, folder, true);
  expect(notices).toEqual([expect.objectContaining({ code: "PROJECT_FILE_NOT_WRITTEN" })]);
});

// Verifica que el aviso de proyecto heredado (legacy) que recibe su primer archivo se informa una sola vez, y que sin carpeta no hay aviso.
test("publishing reports the legacy upgrade once and stays quiet afterwards", () => {
  const db = store(), folder = root(), project = db.createProject("Legado");
  expect(publishIdentity(db, project, folder, true)).toEqual([expect.objectContaining({ code: "PROJECT_FILE_CREATED" })]);
  expect(publishIdentity(db, project, folder, true)).toEqual([]);
  expect(publishIdentity(db, project, null, true)).toEqual([]);
});

import { updateIdentityFiles } from "./project-identity";

// Verifica que un cambio de nombre o de grupo llega al archivo de identidad de cada carpeta ligada que declara este proyecto, incluidos cambios repetidos (sin volver a marcar "updated" si no cambió nada).
test("renames and group changes reach the identity file of every bound folder that carries this project", () => {
  const db = store(), folder = root(), other = root(), project = db.createProject("Viejo");
  db.enableEcosystem();
  db.bindProjectDirectory(folder, project.projectId);
  publishIdentity(db, project, folder, false);
  const group = db.createGroup("tienda");
  expect(updateIdentityFiles(db, project.projectId, { name: "Nuevo" })).toEqual({ updated: 1, skipped: 0 });
  expect(file(folder).project).toEqual({ id: project.projectId, name: "Nuevo" });
  expect(updateIdentityFiles(db, project.projectId, { group: { id: group.id, name: group.name } }).updated).toBe(1);
  expect(file(folder).ecosystem).toEqual({ id: group.id, name: "tienda" });
  expect(updateIdentityFiles(db, project.projectId, { group: { id: group.id, name: "mi-tienda" } }).updated).toBe(1);
  expect(updateIdentityFiles(db, project.projectId, { group: { id: group.id, name: "mi-tienda" } }).updated).toBe(0);
  expect(updateIdentityFiles(db, project.projectId, { group: null }).updated).toBe(1);
  expect(file(folder)).toEqual({ schemaVersion: 1, project: { id: project.projectId, name: "Nuevo" }, ecosystem: null });
  // Una carpeta cuyo archivo declara un proyecto distinto no es nuestra para cambiarla.
  const stranger = crypto.randomUUID();
  db.bindProjectDirectory(other, project.projectId);
  identity(other, { schemaVersion: 1, project: { id: stranger, name: "ajeno" }, ecosystem: null });
  expect(updateIdentityFiles(db, project.projectId, { name: "Otra vez" }).updated).toBe(1);
  expect(file(other).project.id).toBe(stranger);
  expect(file(other).project.name).toBe("ajeno");
});

// Verifica que un archivo dañado (JSON inválido) se salta y se cuenta como tal, y que un archivo ausente solo se crea cuando el cambio es de grupo, no de nombre.
test("a broken file is skipped and reported, and a missing file is created only for a group change", () => {
  const db = store(), broken = root(), missing = root(), project = db.createProject("P");
  db.enableEcosystem();
  db.bindProjectDirectory(broken, project.projectId); db.bindProjectDirectory(missing, project.projectId);
  mkdirSync(join(broken, ".forge614")); writeFileSync(join(broken, ".forge614", "project.json"), "{");
  const group = db.createGroup("tienda");
  expect(updateIdentityFiles(db, project.projectId, { name: "Nuevo" })).toEqual({ updated: 0, skipped: 1 });
  expect(existsSync(join(missing, ".forge614"))).toBe(false);
  expect(updateIdentityFiles(db, project.projectId, { group: { id: group.id, name: "tienda" } })).toEqual({ updated: 1, skipped: 1 });
  expect(file(missing)).toEqual({ schemaVersion: 1, project: { id: project.projectId, name: "P" }, ecosystem: { id: group.id, name: "tienda" } });
  expect(readFileSync(join(broken, ".forge614", "project.json"), "utf8")).toBe("{");
});

// Verifica que un vínculo hecho sobre la carpeta .git de un checkout resuelve la raíz de identidad en el checkout, mientras que un repositorio bare (sin árbol de trabajo) no tiene ninguna carpeta de identidad que actualizar.
test("a Git binding key resolves to its checkout, a bare repository to none", () => {
  const db = store(), checkout = root(), bare = root(), project = db.createProject("Git");
  mkdirSync(join(checkout, ".git"));
  db.bindProjectDirectory(join(checkout, ".git"), project.projectId);
  for (const entry of ["objects", "refs"]) mkdirSync(join(bare, entry));
  writeFileSync(join(bare, "HEAD"), "ref: refs/heads/main\n");
  db.bindProjectDirectory(bare, project.projectId);
  expect(updateIdentityFiles(db, project.projectId, { group: null })).toEqual({ updated: 1, skipped: 0 });
  expect(file(checkout).project.id).toBe(project.projectId);
  expect(existsSync(join(bare, ".forge614"))).toBe(false);
});
