/** Prueba la creación, el nombrado, la membresía y la resolución de grupos del ecosistema, y que cada
 * cambio quede registrado como evento de identidad. */
import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { FORGE614_GROUP_ID, declaredGroupId } from "../../modules/ecosystem";
import { withDatabase } from "../__test-support__/fixtures";
import { bindProjectToGroup, createGroup, ecosystemEnabled, ensureGroup, getGroup, groupOfProject, identityEvents, listGroups, renameGroup, resolveGroup, unbindProject } from "./ecosystem-groups";
import { createProject } from "./projects";
import { enableEcosystem, enableProjectBindings } from "./schema";

function enabled(run: (db: Database) => void): void {
  withDatabase(db => { enableProjectBindings(db); enableEcosystem(db); run(db); });
}

// Sin el nivel de esquema del ecosistema, las lecturas se degradan a "sin grupo" y las escrituras
// deben rechazarse, no fallar de forma inesperada.
test("groups need the ecosystem level; reads degrade to no group without it", () => withDatabase(db => {
  enableProjectBindings(db);
  const project = createProject(db, "Loose");
  expect(ecosystemEnabled(db)).toBe(false);
  expect(groupOfProject(db, project.projectId)).toBeNull();
  expect(listGroups(db)).toEqual([]);
  expect(() => createGroup(db, "tienda")).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  expect(() => bindProjectToGroup(db, project.projectId, crypto.randomUUID(), "command")).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
}));

// Crear un grupo debe validar el nombre, generarle un identificador propio y rechazar un nombre
// repetido, sin importar mayúsculas ni espacios.
test("creating a group validates the name, generates an identity and refuses duplicates by hand", () => enabled(db => {
  const group = createGroup(db, "mi-tienda");
  expect(group.name).toBe("mi-tienda");
  expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(getGroup(db, group.id)).toEqual(group);
  expect(() => createGroup(db, "Mi Tienda")).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
  expect(() => createGroup(db, "mi-tienda")).toThrow(expect.objectContaining({ code: "GROUP_EXISTS" }));
  expect(identityEvents(db).map(event => event.action)).toEqual(["GROUP_CREATED"]);
}));

// Un grupo que llega con su propia identidad (de un clon, por ejemplo) se registra una sola vez,
// aunque se repita la llamada; la identidad manda sobre el nombre.
test("a group arriving with its own identity is registered once and never duplicated", () => enabled(db => {
  const id = crypto.randomUUID();
  const first = ensureGroup(db, id, "tienda");
  expect(first.created).toBe(true);
  expect(ensureGroup(db, id, "tienda").created).toBe(false);
  // Una identidad distinta puede llevar el mismo nombre: la identidad manda sobre el nombre.
  const other = ensureGroup(db, crypto.randomUUID(), "tienda");
  expect(other.created).toBe(true);
  expect(listGroups(db).map(group => group.name)).toEqual(["tienda", "tienda"]);
}));

// Unir, cambiar y quitar el grupo de un proyecto debe registrar cada paso como evento y ser
// idempotente (repetir la misma llamada no debe generar un cambio ni un evento de más).
test("binding, changing and removing a group are recorded events and stay idempotent", () => enabled(db => {
  const project = createProject(db, "Frontend");
  const a = createGroup(db, "grupo-a"), b = createGroup(db, "grupo-b");
  expect(bindProjectToGroup(db, project.projectId, a.id, "command").changed).toBe(true);
  expect(bindProjectToGroup(db, project.projectId, a.id, "command").changed).toBe(false);
  expect(groupOfProject(db, project.projectId)).toEqual({ group: a, source: "command" });
  expect(bindProjectToGroup(db, project.projectId, b.id, "project-file").changed).toBe(true);
  expect(groupOfProject(db, project.projectId)?.group.id).toBe(b.id);
  expect(unbindProject(db, project.projectId)).toBe(true);
  expect(unbindProject(db, project.projectId)).toBe(false);
  expect(groupOfProject(db, project.projectId)).toBeNull();
  const events = identityEvents(db, project.projectId);
  expect(events.map(event => event.action)).toEqual(["GROUP_BOUND", "GROUP_CHANGED", "GROUP_UNBOUND"]);
  expect(events[1]).toMatchObject({ groupId: b.id, previousGroupId: a.id });
  expect(events[2]).toMatchObject({ previousGroupId: b.id });
}));

// Unir un proyecto a un grupo exige que ambos existan de verdad.
test("binding needs an existing project and group", () => enabled(db => {
  const project = createProject(db, "P"), group = createGroup(db, "g");
  expect(() => bindProjectToGroup(db, crypto.randomUUID(), group.id, "command")).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));
  expect(() => bindProjectToGroup(db, project.projectId, crypto.randomUUID(), "command")).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
}));

// Al listar los grupos, cada uno debe traer sus proyectos miembro (o una lista vacía si no tiene).
test("listing shows each group with the projects it contains", () => enabled(db => {
  const front = createProject(db, "Frontend"), back = createProject(db, "Backend"); createProject(db, "Loose");
  const group = createGroup(db, "tienda"); createGroup(db, "vacio");
  bindProjectToGroup(db, front.projectId, group.id, "command"); bindProjectToGroup(db, back.projectId, group.id, "node-file");
  const listed = listGroups(db);
  expect(listed.map(item => item.name)).toEqual(["tienda", "vacio"]);
  expect(listed[0]!.projects).toEqual([{ projectId: back.projectId, name: "Backend" }, { projectId: front.projectId, name: "Frontend" }]);
  expect(listed[1]!.projects).toEqual([]);
}));

// Renombrar un grupo debe conservar su identificador y registrar el cambio; un nombre inválido o un
// grupo inexistente deben rechazarse.
test("renaming keeps the identity and records the event", () => enabled(db => {
  const group = createGroup(db, "viejo");
  const renamed = renameGroup(db, group.id, "nuevo");
  expect(renamed).toEqual({ ...group, name: "nuevo" });
  expect(() => renameGroup(db, crypto.randomUUID(), "x")).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
  expect(() => renameGroup(db, group.id, "Mal Nombre")).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
  expect(identityEvents(db).map(event => event.action)).toEqual(["GROUP_CREATED", "GROUP_RENAMED"]);
}));

// Resolver una referencia debe probar primero el identificador exacto y, si no coincide, aceptar un
// nombre solo cuando identifica a un único grupo.
test("a group reference resolves by identity first, then by a unique name", () => enabled(db => {
  const a = createGroup(db, "unico");
  const id = crypto.randomUUID();
  ensureGroup(db, id, "repetido"); ensureGroup(db, crypto.randomUUID(), "repetido");
  expect(resolveGroup(db, "unico")).toEqual(a);
  expect(resolveGroup(db, a.id)).toEqual(a);
  expect(resolveGroup(db, id).id).toBe(id);
  expect(() => resolveGroup(db, "repetido")).toThrow(expect.objectContaining({ code: "GROUP_AMBIGUOUS" }));
  expect(() => resolveGroup(db, "no-existe")).toThrow(expect.objectContaining({ code: "GROUP_NOT_FOUND" }));
  expect(() => resolveGroup(db, "Mal Nombre")).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
}));

// El grupo reservado "forge614" siempre debe tener el mismo identificador fijo, sin importar si se
// crea por nombre o llega con su propia identidad.
test("the reserved forge614 group always has its fixed identity, however it is created", () => enabled(db => {
  const created = createGroup(db, "forge614");
  expect(created.id).toBe(FORGE614_GROUP_ID);
  expect(ensureGroup(db, declaredGroupId("forge614"), "forge614")).toEqual({ group: created, created: false });
  expect(listGroups(db)).toHaveLength(1);
  expect(createGroup(db, "otro-grupo").id).not.toBe(declaredGroupId("otro-grupo"));
}));
