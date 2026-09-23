import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { memoryProtocol } from "../../../modules/memory-protocol";

const roots: string[] = [];
function temporary(prefix: string): string { const value = mkdtempSync(join(tmpdir(), prefix)); roots.push(value); return value; }
afterEach(() => { for (const value of roots.splice(0).reverse()) rmSync(value, { recursive: true, force: true }); });

const cli = resolve(import.meta.dir, "../../../cli.ts");
interface Result { code: number; stdout: string; stderr: string }
// Async spawn on purpose: see cli.e2e.test.ts (oven-sh/bun#34069).
async function launch(home: string, cwd: string, args: string[]): Promise<Result> {
  const child = Bun.spawn([process.execPath, cli, ...args], { cwd, env: { ...process.env, FORGE614_HOME: home }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
// A "machine" is an isolated FORGE614_HOME with its own database.
interface Machine { home: string; run: (...args: string[]) => Promise<Result>; ok: (...args: string[]) => Promise<any>; fail: (...args: string[]) => Promise<any>; database: string }
async function machine(initialize = true): Promise<Machine> {
  const base = temporary("engram-eco-e2e-"); const home = join(base, "home");
  const value: Machine = {
    home, database: join(home, "engram", "engram.db"),
    run: (...args) => launch(home, base, args),
    ok: async (...args) => { const result = await launch(home, base, args); if (result.code !== 0) throw new Error(`${args.join(" ")} -> ${result.stderr}`); return JSON.parse(result.stdout); },
    fail: async (...args) => { const result = await launch(home, base, args); expect(result.code).toBe(1); expect(result.stdout).toBe(""); return JSON.parse(result.stderr); },
  };
  if (initialize) await value.ok("init", "--json");
  return value;
}
function folder(prefix = "engram-eco-project-"): string { return temporary(prefix); }
const identityPath = (root: string) => join(root, ".forge614", "project.json");
const writeIdentity = (root: string, content: unknown) => { mkdirSync(join(root, ".forge614"), { recursive: true }); writeFileSync(identityPath(root), typeof content === "string" ? content : JSON.stringify(content)); };
const readIdentity = (root: string) => JSON.parse(readFileSync(identityPath(root), "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const T = 60_000;

test("group-create, group-list and group-rename speak the machine contract with schemaVersion", async () => {
  const engram = await machine();
  const created = await engram.ok("group-create", "--name", "mi-tienda");
  expect(created).toEqual({ schemaVersion: 1, group: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "mi-tienda", createdAt: expect.any(String) } });
  expect(await engram.ok("group-list")).toEqual({ schemaVersion: 1, groups: [{ ...created.group, projects: [] }] });
  const renamed = await engram.ok("group-rename", "--group", "mi-tienda", "--name", "tienda-2");
  expect(renamed).toMatchObject({ schemaVersion: 1, group: { id: created.group.id, name: "tienda-2" } });
  expect((await engram.ok("group-list")).groups[0].name).toBe("tienda-2");
}, T);

test("group errors are {schemaVersion, code, error} on stderr with an UPPER_SNAKE code and exit 1", async () => {
  const engram = await machine();
  await engram.ok("group-create", "--name", "tienda");
  for (const [args, code] of [
    [["group-create", "--name", "Mala Marca"], "GROUP_NAME_INVALID"],
    [["group-create", "--name", "tienda"], "GROUP_EXISTS"],
    [["group-bind", "--project-id", crypto.randomUUID(), "--group", "tienda"], "PROJECT_NOT_FOUND"],
    [["group-bind", "--project-id", crypto.randomUUID(), "--group", "no-existe"], "GROUP_NOT_FOUND"],
    [["group-bind", "--project-id", "no-es-uuid", "--group", "tienda"], "INVALID_INPUT"],
    [["group-create"], "INVALID_INPUT"],
    [["group-list", "--basura", "x"], "INVALID_INPUT"],
  ] as const) {
    const error = await engram.fail(...args);
    expect(error).toEqual({ schemaVersion: 1, code, error: expect.any(String) });
    expect(error.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
  }
}, T);

test("group-bind and group-unbind move a project between groups, record events and keep one group per project", async () => {
  const engram = await machine();
  const project = await engram.ok("project-create", "--name", "frontend");
  const a = (await engram.ok("group-create", "--name", "grupo-a")).group, b = (await engram.ok("group-create", "--name", "grupo-b")).group;
  expect(await engram.ok("group-bind", "--project-id", project.projectId, "--group", "grupo-a")).toMatchObject({ schemaVersion: 1, projectId: project.projectId, group: { id: a.id, name: "grupo-a" }, changed: true });
  expect((await engram.ok("group-bind", "--project-id", project.projectId, "--group", "grupo-a")).changed).toBe(false);
  await engram.ok("group-bind", "--project-id", project.projectId, "--group", b.id);
  expect((await engram.ok("group-list")).groups.map((group: any) => [group.name, group.projects.length])).toEqual([["grupo-a", 0], ["grupo-b", 1]]);
  expect(await engram.ok("group-unbind", "--project-id", project.projectId)).toMatchObject({ schemaVersion: 1, projectId: project.projectId, unbound: true });
  expect((await engram.ok("group-unbind", "--project-id", project.projectId)).unbound).toBe(false);
  const db = new Database(engram.database, { readonly: true });
  try { expect(db.query("SELECT action FROM identity_events WHERE projectId=? ORDER BY id").all(project.projectId).map((row: any) => row.action)).toEqual(["GROUP_BOUND", "GROUP_CHANGED", "GROUP_UNBOUND"]); }
  finally { db.close(); }
}, T);

test("a node file that declares ecosystem forge614 binds the fixed group, writes the identity file and reaches startup-context", async () => {
  const engram = await machine(); const repository = folder();
  writeFileSync(join(repository, "forge614.node.json"), JSON.stringify({ schemaVersion: 1, node: "engram", kind: "product", standard: { version: "1.0.0", sha256: "a".repeat(64) }, ecosystem: "forge614" }));
  await engram.ok("save", "--scope", "shared", "--title", "Persona", "--content", "solo yo", "--type", "preference", "--topic", "user/pref");
  const context = await engram.ok("startup-context", "--directory", repository, "--json");
  expect(context.project.status).toBe("unbound");
  const bound = await engram.ok("init", "--json", "--directory", repository);
  expect(bound.project).toMatchObject({ source: "created", group: { name: "forge614" } });
  const group = bound.project.group;
  expect(group.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(readIdentity(repository)).toEqual({ schemaVersion: 1, project: { id: bound.project.projectId, name: expect.any(String) }, ecosystem: group });
  await engram.ok("save", "--scope", "ecosystem", "--group", "forge614", "--title", "Fuente de verdad", "--content", "las actas viven en forge614-ai", "--type", "decision", "--topic", "eco/source");
  const after = await engram.ok("startup-context", "--directory", repository, "--json");
  expect(after.ecosystem).toMatchObject({ status: "member", group });
  expect(after.ecosystem.context.recent.map((row: any) => row.title)).toEqual(["Fuente de verdad"]);
  expect(after.shared.recent.map((row: any) => row.title)).toEqual(["Persona"]);
  expect(after.project).toMatchObject({ status: "bound", projectId: bound.project.projectId, source: "file" });
  expect(Object.keys(after)).toEqual(["format", "shared", "ecosystem", "project"]);
  // Another machine that never saw the project derives the very same group identity from the node file.
  const other = await machine();
  const clone = await other.ok("startup-context", "--directory", repository, "--json");
  expect(clone.ecosystem.group).toEqual(group);
}, T);

test("a clone carrying .forge614/project.json is registered by id without asking, then joins its group", async () => {
  const engram = await machine(); const repository = folder();
  const project = crypto.randomUUID(), group = { id: crypto.randomUUID(), name: "mi-tienda" };
  writeIdentity(repository, { schemaVersion: 1, project: { id: project, name: "frontend" }, ecosystem: group });
  const context = await engram.ok("startup-context", "--directory", repository, "--json");
  expect(context.project).toMatchObject({ status: "bound", projectId: project, source: "file" });
  expect(context.ecosystem).toMatchObject({ status: "member", group });
  expect((await engram.ok("project-list"))).toEqual([expect.objectContaining({ projectId: project, name: "frontend" })]);
  expect((await engram.ok("group-list")).groups).toEqual([expect.objectContaining({ id: group.id, name: "mi-tienda", projects: [{ projectId: project, name: "frontend" }] })]);
  const digest = sha(identityPath(repository));
  await engram.ok("startup-context", "--directory", repository, "--json");
  expect(sha(identityPath(repository))).toBe(digest);
}, T);

test("startup-context without a group reports ecosystem none and an unbound folder writes nothing", async () => {
  const engram = await machine(); const loose = folder(), unbound = folder();
  const created = await engram.ok("init", "--json", "--directory", loose);
  expect(created.project.group).toBeUndefined();
  const withProject = await engram.ok("startup-context", "--directory", loose, "--json");
  expect(withProject.ecosystem).toEqual({ status: "none" });
  expect(withProject.project).toMatchObject({ status: "bound", source: "file" });
  const without = await engram.ok("startup-context", "--directory", unbound, "--json");
  expect(without.ecosystem).toEqual({ status: "none" });
  expect(without.project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
  expect(existsSync(join(unbound, ".forge614"))).toBe(false);
}, T);

test("a project bound by path receives its identity file on the next startup-context, with a notice", async () => {
  const engram = await machine(); const repository = folder();
  const project = await engram.ok("project-create", "--name", "legado");
  await engram.ok("project-bind", "--directory", repository, "--project-id", project.projectId);
  rmSync(join(repository, ".forge614"), { recursive: true, force: true });
  const context = await engram.ok("startup-context", "--directory", repository, "--json");
  expect(context.project).toMatchObject({ projectId: project.projectId, source: "path", notices: [expect.objectContaining({ code: "PROJECT_FILE_CREATED" })] });
  expect(readIdentity(repository)).toEqual({ schemaVersion: 1, project: { id: project.projectId, name: "legado" }, ecosystem: null });
  expect((await engram.ok("startup-context", "--directory", repository, "--json")).project.notices).toBeUndefined();
}, T);

test("session-start gives a legacy path-bound project its identity file and says so in the result", async () => {
  const engram = await machine(); const repository = folder();
  await engram.ok("sessions-enable");
  const project = await engram.ok("project-create", "--name", "legado");
  await engram.ok("project-bind", "--directory", repository, "--project-id", project.projectId);
  rmSync(join(repository, ".forge614"), { recursive: true, force: true });
  const started = await engram.ok("session-start", "--directory", repository, "--session-id", "chat");
  expect(started).toMatchObject({ sessionId: "chat", projectId: project.projectId, kind: "runtime", notices: [expect.objectContaining({ code: "PROJECT_FILE_CREATED" })] });
  expect(readIdentity(repository).project.id).toBe(project.projectId);
  const again = await engram.ok("session-start", "--directory", repository, "--session-id", "chat");
  expect(again.notices).toBeUndefined();
  expect(Object.keys(again)).toEqual(["sessionId", "projectId", "kind", "startedAt", "endedAt"]);
}, T);

test("init and project-bind are idempotent: a repeated run leaves the identity file byte-identical", async () => {
  const engram = await machine(); const repository = folder();
  const first = await engram.ok("init", "--json", "--directory", repository);
  const digest = sha(identityPath(repository));
  for (let repeat = 0; repeat < 3; repeat++) {
    const again = await engram.ok("init", "--json", "--directory", repository);
    expect(again.project.projectId).toBe(first.project.projectId);
    expect(sha(identityPath(repository))).toBe(digest);
  }
  await engram.ok("project-bind", "--directory", repository, "--project-id", first.project.projectId);
  expect(sha(identityPath(repository))).toBe(digest);
  expect((await engram.ok("project-list"))).toHaveLength(1);
}, T);

test("when the local binding and the file disagree the file wins, the event is recorded and the file is never touched", async () => {
  const engram = await machine(); const repository = folder();
  const local = await engram.ok("project-create", "--name", "local");
  await engram.ok("project-bind", "--directory", repository, "--project-id", local.projectId);
  rmSync(join(repository, ".forge614"), { recursive: true, force: true });
  const declared = crypto.randomUUID();
  writeIdentity(repository, { schemaVersion: 1, project: { id: declared, name: "del-archivo" }, ecosystem: null });
  const digest = sha(identityPath(repository));
  const context = await engram.ok("startup-context", "--directory", repository, "--json");
  expect(context.project).toMatchObject({ projectId: declared, source: "file", notices: [expect.objectContaining({ code: "PROJECT_REBOUND_FROM_FILE" })] });
  expect(sha(identityPath(repository))).toBe(digest);
  const db = new Database(engram.database, { readonly: true });
  try { expect(db.query("SELECT previousProjectId FROM identity_events WHERE action='PROJECT_REBOUND_FROM_FILE'").all()).toEqual([{ previousProjectId: local.projectId }]); }
  finally { db.close(); }
}, T);

test.each([
  ["corrupt JSON", "{ not json"],
  ["an unknown schema version", JSON.stringify({ schemaVersion: 2, project: { id: "6f0e1c1a-0000-4000-8000-000000000001", name: "x" }, ecosystem: null })],
  ["unknown fields", JSON.stringify({ schemaVersion: 1, project: { id: "6f0e1c1a-0000-4000-8000-000000000001", name: "x" }, ecosystem: null, secret: "no" })],
])("%s in project.json is PROJECT_FILE_INVALID on stderr and the file is never overwritten", async (_label, content) => {
  const engram = await machine(); const repository = folder(); writeIdentity(repository, content);
  for (const args of [["startup-context", "--directory", repository, "--json"], ["init", "--json", "--directory", repository], ["session-start", "--directory", repository, "--session-id", "s1"]]) {
    const error = await engram.fail(...args);
    expect(error).toEqual({ schemaVersion: 1, code: "PROJECT_FILE_INVALID", error: expect.any(String) });
  }
  expect(readFileSync(identityPath(repository), "utf8")).toBe(content);
  expect(await engram.ok("project-list")).toEqual([]);
}, T);

test("group-bind updates the identity file of the bound folder; renames follow; ids never change", async () => {
  const engram = await machine(); const repository = folder();
  const created = await engram.ok("init", "--json", "--directory", repository);
  const id = created.project.projectId;
  const bound = await engram.ok("group-create", "--name", "tienda");
  expect(await engram.ok("group-bind", "--project-id", id, "--group", "tienda")).toMatchObject({ identityFilesUpdated: 1 });
  expect(readIdentity(repository).ecosystem).toEqual({ id: bound.group.id, name: "tienda" });
  await engram.ok("group-rename", "--group", "tienda", "--name", "mi-tienda");
  expect(readIdentity(repository).ecosystem).toEqual({ id: bound.group.id, name: "mi-tienda" });
  await engram.ok("project-rename", "--project-id", id, "--name", "frontend-nuevo");
  expect(readIdentity(repository).project).toEqual({ id, name: "frontend-nuevo" });
  await engram.ok("group-unbind", "--project-id", id);
  expect(readIdentity(repository)).toEqual({ schemaVersion: 1, project: { id, name: "frontend-nuevo" }, ecosystem: null });
}, T);

test("a repeated topic key resolves project over ecosystem over shared", async () => {
  const engram = await machine(); const repository = folder();
  const { project } = await engram.ok("init", "--json", "--directory", repository);
  await engram.ok("group-create", "--name", "tienda");
  await engram.ok("group-bind", "--project-id", project.projectId, "--group", "tienda");
  const save = (scope: string[], content: string) => engram.ok("save", ...scope, "--title", "Deploy", "--content", content, "--type", "procedure", "--topic", "deploy");
  const shared = await save(["--scope", "shared"], "compartida despliegue");
  const ecosystem = await save(["--scope", "ecosystem", "--group", "tienda"], "ecosistema despliegue");
  const titles = async () => (await engram.ok("search", "--project-id", project.projectId, "--scope", "all", "--query", "despliegue")).map((result: any) => `${result.memory.scope}`);
  expect(await titles()).toEqual(["ecosystem"]);
  const mine = await save(["--project-id", project.projectId], "proyecto despliegue");
  expect(await titles()).toEqual(["project"]);
  await engram.ok("archive", "--project-id", project.projectId, "--id", mine.id);
  await engram.ok("archive", "--scope", "ecosystem", "--group", "tienda", "--id", ecosystem.id);
  expect(await titles()).toEqual(["shared"]);
  expect(shared.scope).toBe("shared");
  expect(ecosystem).toMatchObject({ scope: "ecosystem", groupId: expect.any(String), projectId: null });
}, T);

test("save, get, history, search and context accept --scope ecosystem --group and refuse inconsistent flags", async () => {
  const engram = await machine();
  const group = (await engram.ok("group-create", "--name", "tienda")).group;
  const saved = await engram.ok("save", "--scope", "ecosystem", "--group", "tienda", "--title", "Regla", "--content", "usa kebab-case", "--type", "decision", "--topic", "estilo");
  expect(await engram.ok("get", "--scope", "ecosystem", "--group", group.id, "--id", saved.id)).toMatchObject({ id: saved.id, scope: "ecosystem", groupId: group.id });
  expect((await engram.ok("get", "--scope", "ecosystem", "--group", "tienda", "--id", saved.id, "--version", "1")).memory.title).toBe("Regla");
  expect(await engram.ok("history", "--scope", "ecosystem", "--group", "tienda", "--id", saved.id)).toHaveLength(1);
  expect((await engram.ok("search", "--scope", "ecosystem", "--group", "tienda", "--query", "kebab-case")).map((result: any) => result.memory.id)).toEqual([saved.id]);
  expect((await engram.ok("search", "--scope", "ecosystem", "--group", "tienda", "--query", "kebab-case", "--preview"))[0].memory.groupId).toBe(group.id);
  expect((await engram.ok("context", "--scope", "ecosystem", "--group", "tienda")).recent.map((row: any) => row.title)).toEqual(["Regla"]);
  expect((await engram.fail("save", "--scope", "ecosystem", "--title", "x", "--content", "y")).code).toBe("INVALID_INPUT");
  expect((await engram.fail("save", "--scope", "shared", "--group", "tienda", "--title", "x", "--content", "y")).code).toBe("INVALID_INPUT");
  expect((await engram.fail("get", "--scope", "ecosystem", "--group", "no-existe", "--id", saved.id)).code).toBe("GROUP_NOT_FOUND");
  expect((await engram.fail("context", "--scope", "ecosystem", "--project-id", crypto.randomUUID())).code).toBe("INVALID_INPUT");
  await engram.ok("archive", "--scope", "ecosystem", "--group", "tienda", "--id", saved.id);
  await engram.ok("restore", "--scope", "ecosystem", "--group", "tienda", "--id", saved.id);
}, T);

test("context for a project in a group also returns its ecosystem block; for a loose project it is unchanged", async () => {
  const engram = await machine();
  const loose = await engram.ok("project-create", "--name", "suelto");
  const member = await engram.ok("project-create", "--name", "miembro");
  const group = (await engram.ok("group-create", "--name", "tienda")).group;
  await engram.ok("group-bind", "--project-id", member.projectId, "--group", "tienda");
  await engram.ok("save", "--scope", "ecosystem", "--group", "tienda", "--title", "Regla", "--content", "de grupo", "--type", "decision");
  expect(Object.keys(await engram.ok("context", "--project-id", loose.projectId))).toEqual(["format", "pinned", "recent", "summaries", "omitted", "truncated"]);
  const withGroup = await engram.ok("context", "--project-id", member.projectId);
  expect(withGroup.ecosystem).toMatchObject({ status: "member", group: { id: group.id, name: "tienda" } });
  expect(withGroup.ecosystem.context.recent.map((row: any) => row.title)).toEqual(["Regla"]);
  expect(withGroup.recent).toEqual([]);
}, T);

test("memory-move re-scopes a memory into a group keeping its id, history and versions", async () => {
  const engram = await machine();
  const project = await engram.ok("project-create", "--name", "frontend");
  await engram.ok("group-create", "--name", "tienda");
  const first = await engram.ok("save", "--project-id", project.projectId, "--title", "Contrato", "--content", "v1", "--type", "decision", "--topic", "api");
  await engram.ok("save", "--project-id", project.projectId, "--title", "Contrato", "--content", "v2", "--type", "decision", "--topic", "api", "--expected-version", "1");
  const moved = await engram.ok("memory-move", "--id", first.id, "--project-id", project.projectId, "--to-scope", "ecosystem", "--group", "tienda");
  expect(moved).toMatchObject({ schemaVersion: 1, from: { scope: "project", projectId: project.projectId }, to: { scope: "ecosystem" }, memory: { id: first.id, scope: "ecosystem", projectId: null, version: 3, content: "v2", state: "active" } });
  const history = await engram.ok("history", "--scope", "ecosystem", "--group", "tienda", "--id", first.id);
  expect(history.map((version: any) => [version.version, version.scope, version.content])).toEqual([[1, "project", "v1"], [2, "project", "v2"], [3, "ecosystem", "v2"]]);
  expect((await engram.fail("get", "--project-id", project.projectId, "--id", first.id)).code).toBe("NOT_FOUND");
  expect(await engram.ok("search", "--project-id", project.projectId, "--scope", "project", "--query", "Contrato")).toEqual([]);
  const db = new Database(engram.database, { readonly: true });
  try { expect(db.query("SELECT action,groupId IS NOT NULL AS g FROM identity_events WHERE action='MEMORY_MOVED'").all()).toEqual([{ action: "MEMORY_MOVED", g: 1 }]); }
  finally { db.close(); }
  // Nothing is copied or deleted silently: a topic already taken in the group stops the move.
  const other = await engram.ok("save", "--project-id", project.projectId, "--title", "Otro", "--content", "c", "--type", "fact", "--topic", "api");
  const conflict = await engram.fail("memory-move", "--id", other.id, "--project-id", project.projectId, "--to-scope", "ecosystem", "--group", "tienda");
  expect(conflict).toEqual({ schemaVersion: 1, code: "TOPIC_CONFLICT", error: expect.any(String) });
  expect(await engram.ok("get", "--project-id", project.projectId, "--id", other.id)).toMatchObject({ scope: "project" });
  // Shared memories can move too.
  const shared = await engram.ok("save", "--scope", "shared", "--title", "Global", "--content", "g", "--type", "fact", "--topic", "g");
  expect((await engram.ok("memory-move", "--id", shared.id, "--scope", "shared", "--to-scope", "ecosystem", "--group", "tienda")).from).toEqual({ scope: "shared", projectId: null });
}, T);

test("memory protocol versions 1 and 2 stay byte-identical and version 3 announces the ecosystem scope", async () => {
  const engram = await machine(false);
  for (const version of [1, 2] as const) {
    const flag = version === 1 ? [] : ["--protocol-version", "2"];
    const result = await engram.run("memory-protocol", "--json", ...flag);
    expect(result.stdout).toBe(`${JSON.stringify(memoryProtocol(version), null, 2)}\n`);
  }
  const explicitOne = await engram.run("memory-protocol", "--json", "--protocol-version", "1");
  expect(explicitOne.stdout).toBe(`${JSON.stringify(memoryProtocol(1), null, 2)}\n`);
  const three = JSON.parse((await engram.run("memory-protocol", "--json", "--protocol-version", "3")).stdout);
  expect(three).toMatchObject({ id: "forge614-engram-memory", version: 3 });
  expect(JSON.stringify(three)).toContain("ecosystem");
  expect(JSON.stringify(three)).toContain("groupIntent");
}, T);

test("a database created by v1.5.3 opens and reads completely with the new version, then upgrades on demand with a backup", async () => {
  const engram = await machine();
  const fixture = resolve(import.meta.dir, "../../../../tests/fixtures/v1.5.3/schema-7.db");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(engram.database + suffix, { force: true });
  copyFileSync(fixture, engram.database);
  // A database in daily use keeps its WAL sidecars next to it (Bun's SQLite cannot open a WAL database
  // read-only without them), so hold one connection open for the duration, as a running assistant would.
  const holder = new Database(engram.database); holder.query("SELECT count(*) FROM memories").get();
  try {
  const projects = await engram.ok("project-list");
  expect(projects.map((project: any) => project.name)).toEqual(["Fixture Alpha", "Fixture Beta"]);
  const alpha = projects.find((project: any) => project.name === "Fixture Alpha");
  const found = await engram.ok("search", "--project-id", alpha.projectId, "--query", "canción");
  expect(found.length).toBeGreaterThan(0);
  expect((await engram.ok("search", "--scope", "shared", "--query", "compartida")).length).toBeGreaterThan(0);
  expect((await engram.ok("context", "--project-id", alpha.projectId)).recent.length).toBeGreaterThan(0);
  const before = new Database(engram.database, { readonly: true });
  const rows = before.query("SELECT count(*) AS n FROM memories").get() as { n: number };
  before.close();
  expect(rows.n).toBe(7);
  expect((await engram.ok("group-list")).groups).toEqual([]);
  const upgraded = await engram.ok("group-create", "--name", "tienda");
  expect(upgraded.group.name).toBe("tienda");
  const after = new Database(engram.database, { readonly: true });
  try {
    expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: 10 });
    expect(after.query("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 7 });
  } finally { after.close(); }
  expect(readdirSync(join(engram.home, "engram")).filter(name => name.includes("pre-ecosystem"))).toHaveLength(1);
  expect((await engram.ok("search", "--project-id", alpha.projectId, "--query", "canción")).map((result: any) => result.memory.id)).toEqual(found.map((result: any) => result.memory.id));
  } finally { holder.close(); }
}, T);

test("existing commands keep their exact JSON shape for someone who never uses the ecosystem scope", async () => {
  const engram = await machine();
  const project = await engram.ok("project-create", "--name", "clasico");
  expect(Object.keys(project)).toEqual(["projectId", "name", "createdAt", "updatedAt"]);
  const saved = await engram.ok("save", "--project-id", project.projectId, "--title", "T", "--content", "C", "--type", "fact", "--topic", "t");
  expect(Object.keys(saved)).toEqual(["id", "projectId", "scope", "topicKey", "type", "title", "content", "pinned", "version", "createdAt", "updatedAt"]);
  expect(Object.keys(await engram.ok("get", "--project-id", project.projectId, "--id", saved.id))).toEqual(["id", "projectId", "scope", "topicKey", "type", "title", "content", "pinned", "version", "state", "createdAt", "updatedAt"]);
  const repository = folder();
  const bound = await engram.ok("project-bind", "--directory", repository, "--project-id", project.projectId);
  expect(Object.keys(bound)).toEqual(["projectId", "directory", "source"]);
  const version = JSON.parse((await engram.run("memory-protocol", "--json")).stdout).version;
  expect(version).toBe(1);
  const error = JSON.parse((await engram.run("get", "--project-id", project.projectId, "--id", "nada")).stderr);
  expect(error).toEqual({ code: "NOT_FOUND", error: "Recuerdo no encontrado en el alcance seleccionado." });
}, T);
