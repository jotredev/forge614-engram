/**
 * Prueba projects.ts: la persistencia básica de proyectos (crear, buscar, listar), la resolución de a
 * qué proyecto pertenece una carpeta local, y el corte de nivel de esquema para los vínculos de proyecto.
 */
import { expect, test } from "bun:test";
import { createProject, getProject, listProjects, projectForDirectory, resolveProjectDirectory } from "./projects";
import { enableProjectBindings } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

// Crear un proyecto debe recortar (trim) espacios del nombre visible, y listProjects debe ordenar por
// nombre sin importar en qué orden se crearon.
test("project persistence trims display names and sorts independently of insertion order", () => withDatabase(db => {
  const z = createProject(db, " Zeta "); const a = createProject(db, "Alpha");
  expect(getProject(db, z.projectId)?.name).toBe("Zeta");
  expect(listProjects(db).map(p => p.projectId)).toEqual([a.projectId, z.projectId]);
  expect(() => createProject(db, "  ")).toThrow();
  expect(listProjects(db)).toHaveLength(2);
}));

// Resolver la misma carpeta dos veces debe reutilizar el vínculo (binding) ya creado en vez de duplicar
// el proyecto, y debe rechazar crear uno nuevo si el nombre ya está en uso por otro.
test("directory resolution reuses its binding and refuses same-name ambiguity", () => withDatabase(db => {
  enableProjectBindings(db);
  expect(resolveProjectDirectory(db, "/new", "New", false)).toEqual({ project: null, created: false });
  const first = resolveProjectDirectory(db, "/new", "New", true);
  expect(first.created).toBe(true);
  expect(projectForDirectory(db, "/new")?.projectId).toBe(first.project?.projectId);
  expect(resolveProjectDirectory(db, "/new", "New", true).created).toBe(false);
  expect(() => resolveProjectDirectory(db, "/other", "New", true)).toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
  expect(listProjects(db)).toHaveLength(1);
}));

// Comprueba que el nivel de esquema 7 siga admitiendo vínculos de proyecto, pero que un nivel futuro
// desconocido (13) los rechace en vez de tratarlos como compatibles.
test("schema 7 retains project bindings without admitting future versions", () => withDatabase(db => {
  enableProjectBindings(db); db.exec("PRAGMA user_version=7");
  expect(resolveProjectDirectory(db,"/seven","Seven",true).project?.name).toBe("Seven");
  // El nivel 12 ya es el de la nube (T1); el 13 es la próxima versión todavía desconocida.
  db.exec("PRAGMA user_version=13");
  expect(()=>projectForDirectory(db,"/seven")).toThrow(expect.objectContaining({code:"MIGRATION_REQUIRED"}));
}));
