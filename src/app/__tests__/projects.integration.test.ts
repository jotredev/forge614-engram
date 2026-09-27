/**
 * Comprueba proyectos e integridad del esquema en MemoryStore: identidades independientes
 * pese a nombres iguales, que renombrar conserva historial y estado, que un id no
 * registrado no puede guardar memorias, y que la base rechaza (sin reparar ni modificar)
 * un archivo de esquema antiguo, forjado, con disparadores (triggers) rotos o con tablas
 * u objetos ajenos que imitan los nombres internos de SQLite.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../app/memory-store";

const dirs: string[] = [];
const stores: MemoryStore[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-projects-")); dirs.push(dir);
  return join(dir, "memory.sqlite");
}
function open(path = ":memory:") { const store = new MemoryStore(path); stores.push(store); return store; }
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

// Verifica que dos proyectos con el mismo nombre visible (uno con espacios extra) tienen ids distintos e independientes, cada uno con su propia clave temática, y que el id sobrevive a cerrar y reabrir la base.
test("same display names have independent persistent identities and topics", () => {
  const path = fixture(); const store = open(path);
  const a = store.createProject(" My App "); const b = store.createProject("My App");
  expect(a.projectId).toMatch(/^[0-9a-f-]{36}$/);
  expect(a.projectId).not.toBe(b.projectId);
  expect(a.name).toBe("My App");
  const saved = store.save({ projectId: a.projectId, title: "SQLite", content: "choice", type: "decision", topicKey: "db" });
  store.save({ projectId: b.projectId, title: "SQLite", content: "other", type: "decision", topicKey: "db" });
  expect(store.search(a.projectId, "SQLite").map(r => r.memory.id)).toEqual([saved.id]);
  expect(store.get(b.projectId, saved.id)).toBeNull();
  store.close();
  expect(open(path).getProject(a.projectId)).toEqual(a);
});

// Verifica que renombrar un proyecto no rompe la propiedad de sus memorias, su historial de versiones, si están archivadas, ni la repetición de una petición ya guardada (misma requestKey).
test("renaming preserves memory ownership, history, archive state and request replay", () => {
  const store = open(); const project = store.createProject("Before");
  const input = { projectId: project.projectId, title: "Title", content: "SQLite", type: "fact" as const, requestKey: "same", topicKey: "db" };
  const saved = store.save(input);
  store.save({ ...input, requestKey: "revision", content: "PostgreSQL", expectedVersion: 1 });
  store.archive(project.projectId, saved.id);
  expect(store.renameProject(project.projectId, "After").projectId).toBe(project.projectId);
  expect(store.getProject(project.projectId)?.name).toBe("After");
  expect(store.save(input)).toEqual(saved);
  expect(store.history(project.projectId, saved.id).map(v => v.content)).toEqual(["SQLite", "PostgreSQL"]);
  expect(store.get(project.projectId, saved.id)?.state).toBe("archived");
  expect(store.listProjects()).toHaveLength(1);
});

// Verifica que ningún id sin registrar (uno inventado, uno con caracteres de escape de ruta, o un UUID válido pero no creado) puede usarse para guardar una memoria, y que un nombre en blanco no puede crear un proyecto.
test("unregistered IDs and project names cannot save memories", () => {
  const store = open();
  for (const projectId of ["demo", "../escape", crypto.randomUUID()]) {
    expect(() => store.save({ projectId, title: "Title", content: "Text", type: "fact" })).toThrow();
  }
  expect(store.listProjects()).toEqual([]);
  expect(() => store.createProject(" ")).toThrow();
});

// Verifica que un archivo forjado como nivel de esquema 1 o 2 se rechaza al abrirlo, sin modificar ni un byte del archivo.
test("version 1 and 2 databases are rejected byte-for-byte unchanged", () => {
  for (const version of [1,2]) {
    const path = fixture(); const db = new Database(path);
    db.exec(`CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('keep'); PRAGMA application_id=1177956660; PRAGMA user_version=${version};`);
    db.close(); const before = readFileSync(path);
    expect(() => new MemoryStore(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
  }
});

// Verifica que declarar el nivel de esquema actual sin que la tabla realmente lo tenga no engaña a la apertura para que la "repare": se rechaza sin cambiar el archivo.
test("a forged current schema version does not authorize schema repair", () => {
  const path = fixture(); const db = new Database(path);
  db.exec("CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('keep'); PRAGMA application_id=1177956660; PRAGMA user_version=3;");
  db.close(); const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

// Verifica que una base a la que le falta un disparador (trigger) de búsqueda de texto (FTS) se rechaza al abrirla, en vez de recrearlo silenciosamente.
test("missing FTS triggers are rejected without repair", () => {
  const path = fixture(); open(path).close();
  const db = new Database(path); db.exec("DROP TRIGGER memory_update;"); db.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
});

// Verifica que una tabla o un disparador (trigger) ajeno, con un nombre parecido a los internos de SQLite, no pasa desapercibido: la apertura los detecta y se rechaza.
test("names similar to SQLite internals cannot hide foreign tables or triggers", () => {
  const path = fixture();
  const foreign = new Database(path); foreign.exec("CREATE TABLE sqlitex_private(value TEXT);"); foreign.close();
  const before = readFileSync(path);
  expect(() => new MemoryStore(path)).toThrow();
  expect(readFileSync(path)).toEqual(before);
  const modified = fixture(); open(modified).close();
  const db = new Database(modified);
  db.exec("CREATE TRIGGER sqlitex_extra AFTER INSERT ON projects BEGIN SELECT 1; END;"); db.close();
  expect(() => new MemoryStore(modified)).toThrow();
});
