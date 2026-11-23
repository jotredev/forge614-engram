/** Operaciones explícitas de identidad sobre Git y la CLI de una instalación temporal. */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProjectContext, MemoryStore } from "../../../app";

const directories: string[] = [];
const cliPath = resolve(import.meta.dir, "../../../cli.ts");
function temporary(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "engram-explicit-identity-")));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true });
});

function git(directory: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function repository(origin: string): string {
  const directory = temporary();
  git(directory, "init", "--quiet");
  git(directory, "remote", "add", "origin", origin);
  return directory;
}

async function machine() {
  const home = temporary(), forge = join(home, ".forge614");
  const runtime = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forge };
  async function run(...args: string[]) {
    const child = Bun.spawn([process.execPath, ...args], { env: runtime, cwd: home, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  }
  const call = (...args: string[]) => run(cliPath, ...args);
  async function ok(...args: string[]) {
    const result = await call(...args);
    expect(result, args.join(" ")).toMatchObject({ code: 0, stderr: "" });
    return JSON.parse(result.stdout);
  }
  async function error(code: string, ...args: string[]) {
    const result = await call(...args);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe(code);
  }
  await ok("init", "--json");
  const database = join(forge, "memory", "engram.db");
  const save = (folder: string) => run("-e", `
    import { MemoryStore, saveProjectMemoryWithSession } from ${JSON.stringify(resolve(import.meta.dir, "../../../app/index.ts"))};
    const db = new MemoryStore(${JSON.stringify(database)});
    try {
      console.log(JSON.stringify(saveProjectMemoryWithSession(db, ${JSON.stringify(folder)},
        { type: "fact", title: "Racing save", content: "Keeps its resolved owner" }).memory));
    } finally { db.close(); }`);
  return { ok, error, database, save };
}

function seedLegacyFile(root: string, projectId: string, group: { id: string; name: string } | null = null): string {
  const folder = join(root, ".forge614");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "project.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, project: { id: projectId, name: "Copied" }, ecosystem: group ? { id: group.id, name: group.name } : null }));
  return file;
}

const originalURL = "https://example.com/Owner/Original.git";
const equivalentURL = "git@example.com:Owner/Original.git";

test.each([false, true])("project-create --directory elects an empty identity with or without a previous binding (%s)", async bound => {
  const m = await machine();
  const original = repository(originalURL), copy = repository(equivalentURL);
  const a = (await m.ok("init", "--json", "--directory", original)).project.projectId;
  const { group } = await m.ok("group-create", "--name", "original-group");
  await m.ok("group-bind", "--project-id", a, "--group", group.id);
  const old = await m.ok("save", "--project-id", a, "--title", "Original note", "--content", "Original memory");
  const oldSession = await m.ok("session-start", "--directory", original, "--session-id", "original-session");
  if (bound) await m.ok("init", "--json", "--directory", copy);
  const file = seedLegacyFile(copy, a, group);
  const before = readFileSync(file);
  writeFileSync(join(copy, "forge614.node.json"), JSON.stringify({ ecosystem: group.name }));
  const args = ["project-create", "--name", "Independent", "--directory", copy];
  if (bound) await m.error("PROJECT_BINDING_CONFLICT", ...args);
  const complete = bound ? [...args, "--replace-from", a] : args;
  const created = await m.ok(...complete);
  const b = created.projectId;
  expect(b).not.toBe(a);
  expect(created.notices).toEqual([expect.objectContaining({ code: "PROJECT_FILE_DISPLACED" })]);
  expect((await m.ok(...complete)).projectId).toBe(b);
  expect(await m.ok("startup-context", "--json", "--directory", copy)).toMatchObject({
    project: { status: "bound", projectId: b, context: { pinned: [], recent: [], summaries: [] } },
    ecosystem: { status: "none" },
  });

  const db = new Database(m.database, { readonly: true });
  try {
    expect(db.query("SELECT setting,value FROM project_identity_settings WHERE project_id=?").all(b)).toEqual([{ setting: "group_policy", value: "explicit" }]);
    expect(db.query("SELECT sessionId FROM sessions WHERE projectId=?").all(b)).toEqual([]);
    expect(db.query("SELECT value FROM project_identity_settings WHERE project_id=? AND setting='origin'").get(a)).toEqual({ value: "example.com/Owner/Original" });
  } finally { db.close(); }

  await m.error("SESSION_CONFLICT", "session-start", "--directory", copy, "--session-id", oldSession.sessionId);
  const newSession = await m.ok("session-start", "--directory", copy, "--session-id", "new-session");
  expect(newSession.projectId).toBe(b);
  const saved = await m.ok("save", "--project-id", b, "--title", "Independent note", "--content", "Belongs only to B");
  expect(saved.projectId).toBe(b);
  const oldMemory = await m.ok("get", "--project-id", a, "--id", old.id);
  expect(oldMemory.content).toBe("Original memory");
  expect((await m.ok("startup-context", "--json", "--directory", original)).ecosystem)
    .toMatchObject({ status: "member", group: { id: group.id } });
  expect(readFileSync(file)).toEqual(before);
  expect(await m.ok("project-list")).toHaveLength(2);
}, 40_000);

test("project-bind confirms a free moved origin without assigning an occupied one", async () => {
  const m = await machine();
  const first = repository(originalURL), olderCheckout = repository(equivalentURL);
  const occupied = repository("https://example.com/Owner/Occupied.git");
  const a = (await m.ok("init", "--json", "--directory", first)).project.projectId;
  const b = (await m.ok("init", "--json", "--directory", occupied)).project.projectId;
  expect((await m.ok("init", "--json", "--directory", olderCheckout)).project.projectId).toBe(a);
  git(first, "remote", "set-url", "origin", "ssh://git@example.com:2222/Owner/Moved.git");
  const args = ["project-bind", "--directory", first, "--project-id", a, "--accept-origin"];
  expect((await m.ok(...args)).projectId).toBe(a);
  expect((await m.ok(...args)).projectId).toBe(a);
  const clone = repository("ssh://git@EXAMPLE.com:2222/Owner/Moved");
  expect((await m.ok("startup-context", "--json", "--directory", clone)).project.projectId).toBe(a);
  expect((await m.ok("startup-context", "--json", "--directory", olderCheckout)).project.projectId).toBe(a);
  git(first, "remote", "set-url", "origin", "https://example.com/Owner/Occupied.git");
  await m.error("PROJECT_BINDING_REQUIRED", ...args);
  expect((await m.ok("startup-context", "--json", "--directory", clone)).project.projectId).toBe(a);
  expect((await m.ok("startup-context", "--json", "--directory", occupied)).project.projectId).toBe(b);
}, 40_000);

test("project-bind can correct a legacy file before a binding exists and reevaluates later corrections", async () => {
  const m = await machine();
  const copy = repository(equivalentURL);
  const a = (await m.ok("project-create", "--name", "Previous")).projectId;
  const b = (await m.ok("project-create", "--name", "Chosen")).projectId;
  const c = (await m.ok("project-create", "--name", "Later")).projectId;
  const file = seedLegacyFile(copy, a);
  const before = readFileSync(file);
  const toB = ["project-bind", "--directory", copy, "--project-id", b];
  await m.error("PROJECT_FILE_CONFLICT", ...toB);
  await m.error("PROJECT_BINDING_CONFLICT", ...toB, "--replace-from", c);
  expect((await m.ok(...toB, "--replace-from", a)).projectId).toBe(b);
  expect((await m.ok(...toB, "--replace-from", a)).projectId).toBe(b);
  expect((await m.ok("startup-context", "--json", "--directory", copy)).project.projectId).toBe(b);
  expect((await m.ok("project-bind", "--directory", copy, "--project-id", c, "--replace-from", b)).projectId).toBe(c);
  await m.error("PROJECT_BINDING_CONFLICT", ...toB, "--replace-from", a);
  expect((await m.ok("startup-context", "--json", "--directory", copy)).project.projectId).toBe(c);
  expect(readFileSync(file)).toEqual(before);
  seedLegacyFile(copy, b);
  expect((await m.ok("startup-context", "--json", "--directory", copy)).project.notices)
    .toEqual([expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" })]);
  expect(existsSync(file)).toBe(true);
}, 40_000);

test.each([false, true])("explicit creation in a new folder can be retried without adding a second UUID (%s)", async withOrigin => {
  const m = await machine();
  const folder = withOrigin ? repository(originalURL) : temporary();
  const args = ["project-create", "--name", "New project", "--directory", folder];
  const created = await m.ok(...args);
  expect((await m.ok(...args)).projectId).toBe(created.projectId);
  expect(await m.ok("project-list")).toHaveLength(1);
  const db = new Database(m.database, { readonly: true });
  try {
    expect(db.query("SELECT previous_project_id, project_id FROM project_binding_corrections").all()).toEqual([
      { previous_project_id: null, project_id: created.projectId },
    ]);
    expect(db.query("SELECT value FROM project_identity_settings WHERE setting='origin'").all())
      .toEqual(withOrigin ? [{ value: "example.com/Owner/Original" }] : []);
  } finally { db.close(); }
}, 40_000);

test("replaying a corrected binding cannot reverse a later origin confirmation on another checkout", async () => {
  const m = await machine();
  const oldFolder = repository("https://example.com/Owner/Previous.git");
  const selectedFolder = repository("https://example.com/Owner/Selected.git");
  const previous = (await m.ok("init", "--json", "--directory", oldFolder)).project.projectId;
  const selected = (await m.ok("init", "--json", "--directory", selectedFolder)).project.projectId;
  git(oldFolder, "remote", "set-url", "origin", "https://example.com/Owner/FirstMove.git");
  const correction = ["project-bind", "--directory", oldFolder, "--project-id", selected, "--replace-from", previous, "--accept-origin"];
  await m.ok(...correction);
  git(selectedFolder, "remote", "set-url", "origin", "https://example.com/Owner/LaterMove.git");
  await m.ok("project-bind", "--directory", selectedFolder, "--project-id", selected, "--accept-origin");
  expect((await m.ok(...correction)).projectId).toBe(selected);
  const latest = repository("git@example.com:Owner/LaterMove.git");
  expect((await m.ok("startup-context", "--json", "--directory", latest)).project.projectId).toBe(selected);
  const superseded = repository("git@example.com:Owner/FirstMove.git");
  expect((await m.ok("startup-context", "--json", "--directory", superseded)).project.projectId).toBeNull();
}, 40_000);

test("a failure during correction rolls back the new project, its settings and the binding", async () => {
  const m = await machine(), folder = repository(originalURL);
  const original = (await m.ok("init", "--json", "--directory", folder)).project.projectId;
  const store = new MemoryStore(m.database);
  const db = new Database(m.database);
  try {
    db.exec(`CREATE TRIGGER interrupt_correction BEFORE INSERT ON project_binding_corrections
      BEGIN SELECT RAISE(ABORT,'interrupted correction'); END`);
    expect(() => createProjectContext(store, folder, { name: "Must roll back", replaceFrom: original })).toThrow("interrupted correction");
    expect(store.projectForDirectory(realpathSync(join(folder, ".git")))?.projectId).toBe(original);
    expect(store.listProjects().map(project => project.projectId)).toEqual([original]);
    expect(db.query("SELECT setting,value FROM project_identity_settings").all()).toEqual([
      { setting: "origin", value: "example.com/Owner/Original" },
    ]);
    expect(db.query("SELECT * FROM project_binding_corrections").all()).toEqual([]);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS interrupt_correction");
    db.close();
    store.close();
  }
}, 40_000);

test("a correction is shared across worktrees and concurrent saves keep their resolved owner", async () => {
  const m = await machine(), folder = repository(originalURL), sibling = temporary();
  git(folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "worktree");
  rmSync(sibling, { recursive: true });
  git(folder, "worktree", "add", "--quiet", "-b", "sibling", sibling);
  const previous = (await m.ok("init", "--json", "--directory", folder)).project.projectId;
  await m.ok("session-start", "--directory", folder, "--session-id", "old-worktree-session");
  const sourceFile = seedLegacyFile(folder, previous);
  seedLegacyFile(sibling, previous);
  const initialBytes = readFileSync(sourceFile);
  const [corrected, saved] = await Promise.all([
    m.ok("project-create", "--name", "Chosen from sibling", "--directory", sibling, "--replace-from", previous),
    m.save(folder),
  ]);
  expect(saved).toMatchObject({ code: 0, stderr: "" });
  const memory = JSON.parse(saved.stdout);
  expect([previous, corrected.projectId]).toContain(memory.projectId);
  expect((await m.ok("get", "--project-id", memory.projectId, "--id", memory.id)).content).toBe("Keeps its resolved owner");
  for (const directory of [folder, sibling]) {
    expect((await m.ok("startup-context", "--json", "--directory", directory)).project.projectId).toBe(corrected.projectId);
  }
  await m.error("SESSION_CONFLICT", "session-start", "--directory", sibling, "--session-id", "old-worktree-session");
  expect((await m.ok("session-start", "--directory", sibling, "--session-id", "new-worktree-session")).projectId).toBe(corrected.projectId);
  expect(readFileSync(sourceFile)).toEqual(initialBytes);
  const newestSave = await m.save(folder);
  expect(newestSave.code).toBe(0);
  expect(JSON.parse(newestSave.stdout).projectId).toBe(corrected.projectId);
}, 40_000);

test("a newly discovered remote candidate makes a previous correction pending again", async () => {
  const m = await machine();
  const original = repository(originalURL), copy = repository(equivalentURL);
  const a = (await m.ok("init", "--json", "--directory", original)).project.projectId;
  const chosen = (await m.ok("project-create", "--name", "Chosen", "--directory", copy)).projectId;
  expect((await m.ok("startup-context", "--json", "--directory", copy)).project.projectId).toBe(chosen);
  const third = (await m.ok("project-create", "--name", "Replicated later")).projectId;
  const db = new Database(m.database);
  try {
    db.query("INSERT INTO project_identity_settings(project_id,setting,value,updated_at) VALUES(?,'origin',?,?)")
      .run(third, "example.com/Owner/Original", "2026-01-01T00:00:00.000Z");
  } finally { db.close(); }
  const after = await m.ok("startup-context", "--json", "--directory", copy);
  expect(after.project).toMatchObject({ status: "unbound", projectId: null, notices: [{ code: "PROJECT_BINDING_REQUIRED" }] });
  await m.error("PROJECT_BINDING_REQUIRED", "session-start", "--directory", copy, "--session-id", "cannot-start");
  expect(a).not.toBe(chosen);
}, 40_000);

test("group bind and project rename report tracked identities and keep the index and file intact", async () => {
  const m = await machine(), folder = repository(originalURL);
  const project = (await m.ok("init", "--json", "--directory", folder)).project.projectId;
  expect(existsSync(join(folder, ".forge614"))).toBe(false);
  const { group } = await m.ok("group-create", "--name", "team");
  const clean = await m.ok("group-bind", "--project-id", project, "--group", group.id);
  expect(clean.identityFilesUpdated).toBe(0);
  expect(existsSync(join(folder, ".forge614"))).toBe(false);
  const file = seedLegacyFile(folder, project);
  git(folder, "add", "-f", ".forge614/project.json");
  const bytes = readFileSync(file);
  const index = readFileSync(join(folder, ".git", "index"));
  const notice = { code: "PROJECT_FILE_TRACKED" };
  expect((await m.ok("startup-context", "--json", "--directory", folder)).project).toMatchObject({
    projectId: project, notices: [notice],
  });
  expect(await m.ok("group-bind", "--project-id", project, "--group", group.id)).toMatchObject({
    identityFilesUpdated: 0, notices: [notice],
  });
  expect(await m.ok("project-rename", "--project-id", project, "--name", "New name")).toMatchObject({
    projectId: project, name: "New name", notices: [notice],
  });
  expect(readFileSync(file)).toEqual(bytes);
  expect(readFileSync(join(folder, ".git", "index"))).toEqual(index);
  expect(existsSync(join(folder, ".gitignore"))).toBe(false);
}, 40_000);

test("a long name stays valid in SQLite when legacy publication cannot represent it", async () => {
  const m = await machine(), folder = temporary();
  git(folder, "init", "--quiet");
  const chosen = await m.ok("project-create", "--name", "x".repeat(301), "--directory", folder);
  expect(chosen.notices).toEqual([expect.objectContaining({ code: "PROJECT_FILE_NOT_WRITTEN" })]);
  expect(existsSync(join(folder, ".gitignore"))).toBe(false);
  expect(existsSync(join(folder, ".forge614", "project.json"))).toBe(false);
  expect((await m.ok("startup-context", "--json", "--directory", folder)).project.projectId).toBe(chosen.projectId);
}, 40_000);
