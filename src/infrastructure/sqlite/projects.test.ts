/**
 * Prueba projects.ts: la persistencia básica de proyectos (crear, buscar, listar), la resolución de a
 * qué proyecto pertenece una carpeta local (incluida la identidad por remoto de Git de D6, T3b), y el
 * corte de nivel de esquema para los vínculos de proyecto.
 */
import { expect, test } from "bun:test";
import { createProject, getProject, listProjects, projectForDirectory, resolveProjectDirectory } from "./projects";
import { enableCloud, enableProjectBindings } from "./schema";
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

// D6 (T3b): con la nube activa, una carpeta sin ligar cuyo remoto coincide con el de un proyecto ya
// conocido se liga a ese proyecto en vez de crear uno nuevo, sin que el nombre repetido lo impida
// (justo el caso de una carpeta que llegó de otra Mac con el mismo nombre de proyecto).
test("D6: con nube, remoto coincidente liga a un proyecto existente con el mismo nombre en vez de rechazarlo", () => withDatabase(db => {
  enableCloud(db);
  const existing = createProject(db, "Shared");
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)")
    .run(existing.projectId, "github.com/org/repo", "2020-01-01T00:00:00.000Z");
  const result = resolveProjectDirectory(db, "/mac-2/shared", "Shared", true, undefined, "https://github.com/org/repo.git");
  expect(result).toEqual({ project: existing, created: false });
  expect(projectForDirectory(db, "/mac-2/shared")?.projectId).toBe(existing.projectId);
}));

// D6 (T3b): sin ninguna coincidencia por remoto, el flujo sigue siendo el de siempre: se crea un
// proyecto nuevo, y su remoto queda anotado (ya normalizado) para la próxima vez.
test("D6: con nube, sin coincidencia de remoto crea un proyecto nuevo como siempre y anota su remoto", () => withDatabase(db => {
  enableCloud(db);
  const result = resolveProjectDirectory(db, "/mac-1/fresh", "Fresh", true, undefined, "https://github.com/org/fresh.git");
  expect(result.created).toBe(true);
  expect(db.query("SELECT origin FROM project_remotes WHERE project_id=?").get(result.project!.projectId)).toEqual({ origin: "github.com/org/fresh" });
}));

// D6 (T3b): dos proyectos que comparten el mismo remoto son una ambigüedad que nunca se resuelve
// adivinando; la carpeta nueva sigue el flujo de hoy (aquí, con un nombre sin choque, crea un proyecto).
test("D6: dos proyectos con el mismo remoto no ligan a ninguno; sigue el flujo de hoy", () => withDatabase(db => {
  enableCloud(db);
  const p1 = createProject(db, "One"); const p2 = createProject(db, "Two");
  const now = "2020-01-01T00:00:00.000Z";
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(p1.projectId, "github.com/org/dup", now);
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(p2.projectId, "github.com/org/dup", now);
  const result = resolveProjectDirectory(db, "/mac-3/dup", "Three", true, undefined, "https://github.com/org/dup.git");
  expect(result.created).toBe(true);
  expect(result.project!.projectId).not.toBe(p1.projectId);
  expect(result.project!.projectId).not.toBe(p2.projectId);
}));

// D6 (T3b): el remoto anotado nunca conserva las credenciales embebidas que traía la entrada.
test("D6: el remoto guardado nunca conserva credenciales", () => withDatabase(db => {
  enableCloud(db);
  const result = resolveProjectDirectory(db, "/mac-1/creds", "Creds", true, undefined, "https://user:token@github.com/org/creds.git");
  const stored = db.query("SELECT origin FROM project_remotes WHERE project_id=?").get(result.project!.projectId) as { origin: string };
  expect(stored.origin).toBe("github.com/org/creds");
  expect(stored.origin).not.toContain("@");
  expect(stored.origin).not.toContain("token");
}));

// D6 (T3b): resolver dos veces la misma carpeta con el mismo remoto no debe reescribir updated_at ni
// encolar un segundo cambio a la nube (evita encolar en cada guardado de un proyecto ya conocido).
test("D6: resolver dos veces con el mismo remoto no cambia updated_at ni vuelve a encolar", () => withDatabase(db => {
  enableCloud(db);
  const first = resolveProjectDirectory(db, "/mac-1/stable", "Stable", true, undefined, "https://github.com/org/stable.git");
  const before = db.query("SELECT updated_at FROM project_remotes WHERE project_id=?").get(first.project!.projectId) as { updated_at: string };
  db.exec("DELETE FROM cloud_outbox");
  resolveProjectDirectory(db, "/mac-1/stable", "Stable", true, undefined, "https://github.com/org/stable.git");
  const after = db.query("SELECT updated_at FROM project_remotes WHERE project_id=?").get(first.project!.projectId) as { updated_at: string };
  expect(after.updated_at).toBe(before.updated_at);
  expect(db.query("SELECT count(*) AS n FROM cloud_outbox WHERE kind='project_remotes'").get()).toEqual({ n: 0 });
}));

// D6 (T3b): un remoto distinto para una carpeta ya ligada sí actualiza origin y updated_at, y encola el cambio.
test("D6: un remoto nuevo actualiza origin y updated_at, y encola el cambio", () => withDatabase(db => {
  enableCloud(db);
  const first = resolveProjectDirectory(db, "/mac-1/moved", "Moved", true, undefined, "https://github.com/org/old.git");
  db.exec("DELETE FROM cloud_outbox");
  resolveProjectDirectory(db, "/mac-1/moved", "Moved", true, undefined, "https://github.com/org/new.git");
  const stored = db.query("SELECT origin FROM project_remotes WHERE project_id=?").get(first.project!.projectId) as { origin: string };
  expect(stored.origin).toBe("github.com/org/new");
  expect(db.query("SELECT count(*) AS n FROM cloud_outbox WHERE kind='project_remotes'").get()).toEqual({ n: 1 });
}));

// D6 (T3b): sin nube activa, la tabla project_remotes ni siquiera existe; resolver con un remoto
// no debe fallar ni intentar consultarla.
test("D6: sin nube, resolver con un remoto no toca project_remotes ni falla", () => withDatabase(db => {
  enableProjectBindings(db);
  const result = resolveProjectDirectory(db, "/mac-1/no-cloud", "NoCloud", true, undefined, "https://github.com/org/no-cloud.git");
  expect(result.created).toBe(true);
  expect(db.query("SELECT name FROM sqlite_master WHERE name='project_remotes'").all()).toEqual([]);
}));

// D6 (T3b): un remoto cuyo contenido, tras normalizarse, todavía parece un secreto (aquí, en la ruta)
// nunca se anota, aunque el proyecto sí se resuelva con normalidad.
test("D6: un remoto con un secreto que sobrevive a la normalización no se anota", () => withDatabase(db => {
  enableCloud(db);
  const result = resolveProjectDirectory(db, "/mac-1/leaky", "Leaky", true, undefined, "https://github.com/org/AKIAABCDEFGHIJKLMNOP");
  expect(result.created).toBe(true);
  expect(db.query("SELECT * FROM project_remotes WHERE project_id=?").get(result.project!.projectId)).toBeNull();
}));
