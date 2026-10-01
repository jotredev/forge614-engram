/**
 * Prueba projects.ts: la persistencia básica de proyectos (crear, buscar, listar), la resolución de a
 * qué proyecto pertenece una carpeta local (incluida la identidad por remoto de Git de D6, T3b), y el
 * corte de nivel de esquema para los vínculos de proyecto.
 */
import { expect, test } from "bun:test";
import { createProject, getProject, listProjects, projectForDirectory, resolveProjectDirectory } from "./projects";
import { enableCloud, enableProjectBindings } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";
import type { MemoryError } from "../../shared/errors";

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

// Ejecuta una resolución que debe fallar y devuelve el código y el texto exactos del error, para
// comparar el mensaje completo que ve la persona y no solo una parte.
function failure(run: () => unknown): { code: string; message: string } {
  try { run(); } catch (error) { return { code: (error as MemoryError).code, message: (error as Error).message }; }
  throw new Error("se esperaba un error PROJECT_BINDING_REQUIRED");
}
// Dice que ninguna carpeta registrada existe: así todos los proyectos quedan perdidos.
const nothingExists = () => false;

// Fija que la carpeta perdida de OTRO proyecto, con un nombre que no tiene nada que ver, ya no impide
// registrar una carpeta nueva (el caso «Release probe»: un proyecto de prueba cuya carpeta temporal se borró).
test("una carpeta perdida de otro proyecto con nombre distinto no bloquea una carpeta nueva", () => withDatabase(db => {
  enableProjectBindings(db);
  const lost = resolveProjectDirectory(db, "/gone/git-bound/.git", "Release probe", true);
  const fresh = resolveProjectDirectory(db, "/work/prueba-shell", "prueba-shell", true, nothingExists);
  expect(fresh.created).toBe(true);
  expect(fresh.project!.projectId).not.toBe(lost.project!.projectId);
  expect(projectForDirectory(db, "/work/prueba-shell")?.projectId).toBe(fresh.project!.projectId);
}));

// Fija que la protección sigue donde hay evidencia: una carpeta nueva con el mismo nombre que la carpeta
// perdida (para una clave .git, la carpeta que la contiene) sí bloquea, con el mensaje exacto, que nombra
// el proyecto, su id, la carpeta perdida sin «/.git» y el comando con la carpeta nueva. Con el mismo
// nombre que el proyecto perdido bloquea antes el error de nombre repetido (mismo código, su propio texto).
test("una carpeta nueva con el nombre de la carpeta perdida bloquea con el mensaje exacto", () => withDatabase(db => {
  enableProjectBindings(db);
  const lost = resolveProjectDirectory(db, "/gone/git-bound/.git", "Release probe", true).project!;
  expect(failure(() => resolveProjectDirectory(db, "/work/git-bound", "git-bound", true, nothingExists))).toEqual({
    code: "PROJECT_BINDING_REQUIRED",
    message: `Esta carpeta podría ser el proyecto «Release probe» (${lost.projectId}), cuya carpeta registrada (/gone/git-bound) ya no existe. `
      + `Si es el mismo proyecto, vincúlala con: forge614-engram project-bind --directory /work/git-bound --project-id ${lost.projectId}. `
      + "Si es otro proyecto, créalo con forge614-engram project-create --name <nombre> y vincúlalo con project-bind.",
  });
  expect(failure(() => resolveProjectDirectory(db, "/work/otra", "Release probe", true, nothingExists)).message)
    .toStartWith(`Ya existe un proyecto llamado «Release probe» (${lost.projectId}).`);
  expect(listProjects(db)).toHaveLength(1);
}));

// Fija que un proyecto con una carpeta que existe y otra perdida no cuenta como perdido (como siempre):
// ni siquiera una carpeta nueva con el nombre de la carpeta perdida se bloquea.
test("un proyecto con una carpeta existente y otra perdida no cuenta como perdido", () => withDatabase(db => {
  enableProjectBindings(db);
  const project = resolveProjectDirectory(db, "/exists/a", "Alive", true).project!;
  db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)").run("/gone/b", project.projectId, "2020-01-01T00:00:00.000Z");
  const result = resolveProjectDirectory(db, "/work/b", "b", true, directory => directory.startsWith("/exists"));
  expect(result.created).toBe(true);
}));

// Fija que una comprobación de existencia que lanza cuenta la carpeta como perdida (como hoy), pero que
// eso solo bloquea con coincidencia de nombre: una carpeta de otro nombre se registra sola.
test("una comprobación que lanza cuenta como carpeta perdida pero solo bloquea con el mismo nombre", () => withDatabase(db => {
  enableProjectBindings(db);
  resolveProjectDirectory(db, "/unreadable/git-bound/.git", "Release probe", true);
  const throwing = () => { throw new Error("EACCES"); };
  expect(resolveProjectDirectory(db, "/work/other-name", "other-name", true, throwing).created).toBe(true);
  expect(failure(() => resolveProjectDirectory(db, "/work/git-bound", "git-bound", true, throwing)).message)
    .toStartWith("Esta carpeta podría ser el proyecto «Release probe»");
}));

// Fija el texto exacto del error de nombre repetido: dice qué proyecto es (nombre e id) y qué hacer, y
// muestra la carpeta de trabajo, nunca la ruta interna «/.git» de una carpeta con Git.
test("el error de nombre repetido dice qué proyecto es y cómo resolverlo, sin la ruta .git", () => withDatabase(db => {
  enableProjectBindings(db);
  const existing = resolveProjectDirectory(db, "/new", "New", true).project!;
  const expected = (folder: string) => ({
    code: "PROJECT_BINDING_REQUIRED",
    message: `Ya existe un proyecto llamado «New» (${existing.projectId}). Si esta carpeta es ese proyecto, vincúlala con: `
      + `forge614-engram project-bind --directory ${folder} --project-id ${existing.projectId}. `
      + "Si es otro, créalo con forge614-engram project-create --name <otro nombre> y vincúlalo con project-bind.",
  });
  expect(failure(() => resolveProjectDirectory(db, "/other", "New", true))).toEqual(expected("/other"));
  expect(failure(() => resolveProjectDirectory(db, "/repo/.git", "New", true))).toEqual(expected("/repo"));
}));

// Fija, con nube y un remoto igual al de un proyecto perdido, que la carpeta nueva NUNCA crea un proyecto
// aparte. Con un único proyecto con ese remoto, la regla de 177-183 (D6) la liga a él antes de llegar a
// la comprobación de carpetas perdidas, aunque el nombre sea distinto; con dos proyectos que lo comparten,
// esa regla no adivina y es la decisión 1b la que bloquea, nombrando al primero en orden estable.
test("con nube y el remoto de un proyecto perdido, la carpeta nueva se liga a él o se bloquea, nunca crea otro", () => withDatabase(db => {
  enableCloud(db);
  const when = "2020-01-01T00:00:00.000Z";
  const lost = resolveProjectDirectory(db, "/gone/lost-name", "Lost", true).project!;
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(lost.projectId, "github.com/org/lost", when);
  const linked = resolveProjectDirectory(db, "/work/other-name", "other-name", true, nothingExists, "https://github.com/org/lost.git");
  expect(linked).toEqual({ project: lost, created: false });
  expect(listProjects(db)).toHaveLength(1);

  // Segundo proyecto con el mismo remoto y con carpeta existente: ya no hay coincidencia única.
  const alive = resolveProjectDirectory(db, "/exists/alive", "Alive", true).project!;
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(alive.projectId, "github.com/org/lost", when);
  const blocked = failure(() => resolveProjectDirectory(db, "/work/third", "third", true, directory => directory.startsWith("/exists"), "git@github.com:org/lost.git"));
  expect(blocked.code).toBe("PROJECT_BINDING_REQUIRED");
  expect(blocked.message).toStartWith(`Esta carpeta podría ser el proyecto «Lost» (${lost.projectId}), cuya carpeta registrada (/gone/lost-name) ya no existe.`);
  expect(listProjects(db)).toHaveLength(2);
}));
