import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORGE614_GROUP_ID } from "../../modules/ecosystem";
import { MemoryStore } from "../memory-store";
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

test("the identity file declares its group and the clone joins it by id, even when another group has the same name", () => {
  const db = store(), root = repository(), id = crypto.randomUUID(), groupId = crypto.randomUUID();
  db.enableEcosystem(); db.createGroup("tienda");
  writeIdentity(root, { schemaVersion: 1, project: { id, name: "frontend" }, ecosystem: { id: groupId, name: "tienda" } });
  const context = resolveProjectContext(db, root, false);
  expect(context.group).toEqual({ id: groupId, name: "tienda" });
  expect(db.groupOfProject(id)).toMatchObject({ group: { id: groupId, name: "tienda" }, source: "project-file" });
  expect(db.listGroups().map(group => group.name)).toEqual(["tienda", "tienda"]);
});

test("a group in the file enrols the ecosystem level by itself, leaving a backup-safe upgrade path", () => {
  const db = store(), root = repository(), groupId = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id: crypto.randomUUID(), name: "api" }, ecosystem: { id: groupId, name: "mi-tienda" } });
  expect(db.ecosystemEnabled()).toBe(false);
  expect(resolveProjectContext(db, root, false).group).toEqual({ id: groupId, name: "mi-tienda" });
  expect(db.ecosystemEnabled()).toBe(true);
});

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

test("an unbound folder without a file stays unbound: nothing is created or written", () => {
  const db = store(), root = repository();
  const context = resolveStartupProjectContext(db, root);
  expect(context).toMatchObject({ projectId: null, source: "unbound" });
  expect(existsSync(join(root, ".forge614"))).toBe(false);
  expect(db.listProjects()).toEqual([]);
});

test("when the local binding disagrees with the file, the file wins, the event is recorded and the file is untouched", () => {
  const db = store(), root = repository();
  const local = resolveProjectContext(db, root, true);
  const foreign = crypto.randomUUID();
  writeIdentity(root, { schemaVersion: 1, project: { id: foreign, name: "del-archivo" }, ecosystem: null });
  const digest = sha(filePath(root));
  const context = resolveProjectContext(db, root, false);
  expect(context).toMatchObject({ projectId: foreign, source: "file" });
  expect(context.notices?.map(item => item.code)).toEqual(["DATABASE_MIGRATED", "PROJECT_REBOUND_FROM_FILE"]);
  expect(sha(filePath(root))).toBe(digest);
  expect(db.projectForDirectory(context.directory)?.projectId).toBe(foreign);
  expect(db.getProject(local.projectId!)).not.toBeNull();
  expect(db.identityEvents(foreign).some(event => event.action === "PROJECT_REBOUND_FROM_FILE" && event.previousProjectId === local.projectId)).toBe(true);
  expect(resolveProjectContext(db, root, false).notices).toBeUndefined();
});

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

test("a base without folder bindings refuses before registering anything from the identity file", () => {
  const value = new MemoryStore(join(temporary("engram-id-db-"), "engram.db")); stores.push(value);
  const root = repository();
  writeIdentity(root, { schemaVersion: 1, project: { id: crypto.randomUUID(), name: "clon" }, ecosystem: null });
  expect(() => resolveStartupProjectContext(value, root)).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  expect(value.listProjects()).toEqual([]);
});

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
