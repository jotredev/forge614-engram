/** Prueba el registro de proyectos por su propia identidad (de un clon o un archivo de proyecto) y el
 * re-vínculo de una carpeta a esa identidad. */
import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { identityEvents } from "./ecosystem-groups";
import { getProject, projectForDirectory, registerProject } from "./projects";
import { enableEcosystem, enableProjectBindings } from "./schema";
import { bindProjectDirectory, rebindProjectDirectory } from "./writes";

// Un proyecto que llega con su propia identidad se registra una sola vez y conserva su nombre
// original aunque se repita el registro con otro nombre.
test("a project arriving with its own identity is registered once, keeping id and name", () => withDatabase(db => {
  enableProjectBindings(db);
  const id = crypto.randomUUID();
  const first = registerProject(db, id, "Clonado");
  expect(first.created).toBe(true);
  expect(first.project).toMatchObject({ projectId: id, name: "Clonado" });
  const again = registerProject(db, id, "Otro nombre");
  expect(again.created).toBe(false);
  expect(getProject(db, id)?.name).toBe("Clonado");
  expect(() => registerProject(db, "no-es-uuid", "x")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => registerProject(db, crypto.randomUUID(), " ")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
}));

// En cuanto existe el nivel de esquema del ecosistema, registrar un proyecto por archivo debe quedar
// como un único evento de identidad, sin repetirse en un segundo registro idéntico.
test("registration is recorded as an identity event once the ecosystem level exists", () => withDatabase(db => {
  enableProjectBindings(db); enableEcosystem(db);
  const id = crypto.randomUUID();
  registerProject(db, id, "Clonado"); registerProject(db, id, "Clonado");
  expect(identityEvents(db, id).map(event => event.action)).toEqual(["PROJECT_REGISTERED_FROM_FILE"]);
}));

// Re-vincular una carpeta a la identidad que trae el archivo debe reemplazar el vínculo por ruta,
// registrar el evento con el proyecto anterior, y dejar intacto al proyecto que perdió la carpeta.
test("re-binding a folder to the identity carried by the file replaces the path binding and records the event", () => withDatabase(db => {
  enableProjectBindings(db); enableEcosystem(db);
  const local = registerProject(db, crypto.randomUUID(), "Local").project;
  const fromFile = registerProject(db, crypto.randomUUID(), "Archivo").project;
  bindProjectDirectory(db, "/repo", local.projectId);
  expect(rebindProjectDirectory(db, "/repo", fromFile.projectId)).toEqual({ previousProjectId: local.projectId });
  expect(projectForDirectory(db, "/repo")?.projectId).toBe(fromFile.projectId);
  expect(rebindProjectDirectory(db, "/repo", fromFile.projectId)).toEqual({ previousProjectId: null });
  expect(identityEvents(db, fromFile.projectId).filter(event => event.action === "PROJECT_REBOUND_FROM_FILE")).toEqual([
    expect.objectContaining({ projectId: fromFile.projectId, previousProjectId: local.projectId, directory: "/repo" }),
  ]);
  // El proyecto anterior y sus memorias quedan intactos; solo se movió el vínculo de la carpeta.
  expect(getProject(db, local.projectId)?.name).toBe("Local");
}));

// Re-vincular exige un proyecto que exista; solo registra un evento cuando el nivel del ecosistema
// está habilitado, y un vínculo nuevo (una carpeta libre) no crea ningún evento.
test("re-binding needs the ecosystem level to record its event, an existing project and a fresh binding creates none", () => withDatabase(db => {
  enableProjectBindings(db);
  const project = registerProject(db, crypto.randomUUID(), "P").project;
  expect(() => rebindProjectDirectory(db, "/x", crypto.randomUUID())).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));
  expect(rebindProjectDirectory(db, "/fresh", project.projectId)).toEqual({ previousProjectId: null });
  expect(projectForDirectory(db, "/fresh")?.projectId).toBe(project.projectId);
  const other = registerProject(db, crypto.randomUUID(), "Q").project;
  expect(() => rebindProjectDirectory(db, "/fresh", other.projectId)).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  expect(projectForDirectory(db, "/fresh")?.projectId).toBe(project.projectId);
}));
