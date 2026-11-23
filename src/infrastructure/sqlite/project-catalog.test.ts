import { expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withDatabase, withDirectory } from "../__test-support__/fixtures";
import { openDatabase } from "./connection";
import { findProjectsByOrigin } from "./project-catalog";
import { createProject, projectForDirectory } from "./projects";
import { enableCloud, enableEcosystem, enableIntelligence, enableProjectBindings, enableSynchronization, ensureProjectIdentitySchema, schemaState } from "./schema";
import { bindProjectDirectory, resolveProjectDirectory, saveForProjectDirectory } from "./writes";

const now = "2026-01-01T00:00:00.000Z";
const origin = "git@Example.com:Org/Repo.git";
const key = "example.com/Org/Repo";
const version = (db: Database) => db.query("PRAGMA user_version").get() as { user_version: number };
const originSettings = (db: Database) => db.query("SELECT project_id, value FROM project_identity_settings WHERE setting='origin' ORDER BY project_id").all();
const schemaObjects = (db: Database) => db.query("SELECT name FROM sqlite_master WHERE name IN ('project_remotes', 'project_identity_settings') ORDER BY name").all();
const rows = (db: Database, table: string) => db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all();

for (const legacy of [3, 4]) {
  test(`level ${legacy} keeps the legacy enrollment contract until a binding write needs the identity catalog`, () => withDatabase(db => {
    if (legacy === 4) enableSynchronization(db);
    expect(version(db)).toEqual({ user_version: legacy });
    enableProjectBindings(db);
    expect(version(db)).toEqual({ user_version: 5 });
    expect(schemaObjects(db)).toEqual([]);
    resolveProjectDirectory(db, "/plain", "Plain", true);
    expect(version(db)).toEqual({ user_version: 5 });
    const saved = saveForProjectDirectory(db, "/repo/.git", "Git", { type: "fact", title: "Title", content: "Content" }, undefined, origin);
    expect(version(db)).toEqual({ user_version: 13 });
    expect(originSettings(db)).toEqual([{ project_id: saved.projectId, value: key }]);
    expect(schemaState(db)).toEqual({ base: 5, ecosystem: false, intelligence: false, cloud: false, projectIdentity: true });
  }));
}

for (const legacy of [5, 8, 11, 12]) {
  test(`level ${legacy} preserves enabled features and stored state through identity migration and reopen`, () => withDirectory(root => {
    const path = join(root, "engram.db");
    let db = openDatabase(path, {});
    try {
      enableProjectBindings(db);
      if (legacy >= 8) enableEcosystem(db);
      if (legacy >= 11) enableIntelligence(db);
      if (legacy === 12) enableCloud(db, "replica");
      const established = createProject(db, "Established");
      bindProjectDirectory(db, join(root, "legacy"), established.projectId);
      db.query("INSERT INTO sync_checkpoints VALUES(?,?)").run("replica", "{}");
      if (legacy >= 8) {
        db.query("INSERT INTO ecosystem_groups VALUES(?,?,?)").run(crypto.randomUUID(), "ecosystem", now);
        db.query("INSERT INTO ecosystem_memberships SELECT ?,id,?,'command' FROM ecosystem_groups").run(established.projectId, now);
      }
      if (legacy >= 11) db.query("INSERT INTO sessions VALUES(?,?, 'runtime',?,NULL)").run("session", established.projectId, now);
      if (legacy === 12) db.query("UPDATE cloud_state SET last_applied_id=37 WHERE id=1").run();
      const tables = ["projects", "project_bindings", "sync_checkpoints"];
      if (legacy >= 8) tables.push("ecosystem_memberships");
      if (legacy >= 11) tables.push("sessions");
      if (legacy === 12) tables.push("cloud_state", "cloud_outbox");
      const previous = tables.map(table => rows(db, table));
      expect(version(db)).toEqual({ user_version: legacy });
      db.close();

      db = openDatabase(path, { readonly: true });
      expect(version(db)).toEqual({ user_version: legacy });
      expect(resolveProjectDirectory(db, join(root, "legacy"), "Established", false, undefined, origin).project).toEqual(established);
      expect(schemaObjects(db)).toHaveLength(legacy === 12 ? 1 : 0);
      db.close();

      db = openDatabase(path, { create: false });
      expect(version(db)).toEqual({ user_version: legacy });
      // La carpeta ya estaba vinculada. Activar el catálogo no adjudica su remoto ni cambia el outbox.
      expect(resolveProjectDirectory(db, join(root, "legacy"), "Established", true, undefined, origin).project).toEqual(established);
      expect(version(db)).toEqual({ user_version: legacy + 8 });
      expect(tables.map(table => rows(db, table))).toEqual(previous);
      expect(originSettings(db)).toEqual([]);
      expect(ensureProjectIdentitySchema(db)).toEqual({ migrated: false, backup: null });
      expect(schemaState(db)).toEqual({ base: legacy < 11 ? 5 : 7, ecosystem: legacy >= 8, intelligence: legacy >= 11, cloud: legacy === 12, projectIdentity: true });
      const backups = readdirSync(root).filter(file => file.endsWith(".bak"));
      expect(backups).toHaveLength(1);
      expect(statSync(join(root, backups[0]!)).mode & 0o777).toBe(0o600);
      const backup = openDatabase(join(root, backups[0]!), { readonly: true });
      try {
        expect(version(backup)).toEqual({ user_version: legacy });
        expect(tables.map(table => rows(backup, table))).toEqual(previous);
      } finally { backup.close(); }
      db.close();

      db = openDatabase(path, { readonly: true });
      expect(projectForDirectory(db, join(root, "legacy"))).toEqual(established);
      expect(version(db)).toEqual({ user_version: legacy + 8 });
      expect(readdirSync(root).filter(file => file.endsWith(".bak"))).toEqual(backups);
    } finally { db.close(); }
  }));
}

test("failed identity DDL rolls back and permits reopening and retrying", () => withDirectory(root => {
  const path = join(root, "engram.db");
  let db = openDatabase(path, {});
  try {
    enableProjectBindings(db);
    const project = createProject(db, "Established");
    const directory = join(root, "legacy");
    bindProjectDirectory(db, directory, project.projectId);
    const exec = db.exec.bind(db);
    // Ejecuta DDL real antes del fallo. La tabla creada al inicio también debe revertirse.
    Object.defineProperty(db, "exec", { value: (sql: string) => {
      if (sql.includes("CREATE TABLE project_identity_settings")) {
        exec(sql);
        throw new Error("interrupted identity migration");
      }
      return exec(sql);
    } });
    expect(() => resolveProjectDirectory(db, directory, "Established", true, undefined, origin)).toThrow("interrupted identity migration");
    const backups = readdirSync(root).filter(file => file.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(existsSync(join(root, backups[0]!))).toBe(true);
    db.close();

    db = openDatabase(path, { create: false });
    expect(version(db)).toEqual({ user_version: 5 });
    expect(schemaObjects(db)).toEqual([]);
    expect(projectForDirectory(db, directory)).toEqual(project);
    expect(resolveProjectDirectory(db, directory, "Established", true, undefined, origin).project).toEqual(project);
    expect(version(db)).toEqual({ user_version: 13 });
  } finally { db.close(); }
}));

test("enabling cloud over a local catalog enqueues each confirmed and compatibility row once", () => withDatabase(db => {
  enableProjectBindings(db);
  const project = resolveProjectDirectory(db, "/repo/.git", "Repo", true, undefined, origin).project!;
  expect(version(db)).toEqual({ user_version: 13 });
  expect(enableCloud(db, "replica").migrated).toBe(true);
  expect(version(db)).toEqual({ user_version: 20 });
  expect(originSettings(db)).toEqual([{ project_id: project.projectId, value: key }]);
  const traveling = db.query("SELECT kind, payload FROM cloud_outbox WHERE kind <> 'projects' ORDER BY id").all() as
    { kind: string; payload: string }[];
  expect(traveling.map(row => ({ kind: row.kind, value: JSON.parse(row.payload) }))).toEqual([
    { kind: "project_remotes", value: { project_id: project.projectId, origin: key, updated_at: expect.any(String) } },
    { kind: "project_identity_settings", value: { project_id: project.projectId, setting: "origin", value: key, updated_at: expect.any(String) } },
  ]);
  expect(enableCloud(db, "replica").migrated).toBe(false);
  expect(rows(db, "cloud_outbox")).toHaveLength(3);
}));

function historicalRemote(db: Database, projectId: string, remote = key): void {
  db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(projectId, remote, now);
}

function gitDirectory(root: string, name: string, remote: string): string {
  const path = join(root, name);
  const init = Bun.spawnSync(["git", "init", "--quiet", path]);
  if (init.exitCode !== 0) throw new Error("No se pudo preparar el repositorio de prueba");
  const add = Bun.spawnSync(["git", "-C", path, "remote", "add", "origin", remote]);
  if (add.exitCode !== 0) throw new Error("No se pudo preparar el remoto de prueba");
  return join(path, ".git");
}

test("only a single concordant Git origin can confirm a historical project remote", () => withDirectory(root => withDatabase(db => {
  enableCloud(db);
  const custom = createProject(db, "Port");
  const absent = createProject(db, "Absent");
  const ambiguous = createProject(db, "Ambiguous");
  const nonGit = createProject(db, "Non-Git");
  const customDirectory = gitDirectory(root, "port", "ssh://git@example.com:2222/Org/Repo.git");
  bindProjectDirectory(db, customDirectory, custom.projectId);
  bindProjectDirectory(db, join(root, "absent"), absent.projectId);
  bindProjectDirectory(db, gitDirectory(root, "same", origin), ambiguous.projectId);
  bindProjectDirectory(db, gitDirectory(root, "different", "ssh://git@example.com:2022/Org/Repo.git"), ambiguous.projectId);
  bindProjectDirectory(db, root, nonGit.projectId);
  writeFileSync(join(root, "config"), `[remote "origin"]\n  url = ${origin}\n`);
  for (const project of [custom, absent, ambiguous, nonGit]) historicalRemote(db, project.projectId);
  const previous = rows(db, "cloud_outbox") as { kind: string; payload: string }[];
  const candidates = [custom, absent, ambiguous, nonGit].sort((a, b) => a.projectId.localeCompare(b.projectId));
  expect(findProjectsByOrigin(db, key)).toEqual(candidates.map(project => ({ project, verified: false })));

  resolveProjectDirectory(db, customDirectory, "Port", true, undefined, "ssh://git@example.com:2222/Org/Repo.git");
  expect(originSettings(db)).toEqual([{ project_id: custom.projectId, value: "example.com:2222/Org/Repo" }]);
  expect(findProjectsByOrigin(db, "example.com:2222/Org/Repo")).toEqual(candidates.map(project => ({ project, verified: project === custom })));
  expect(findProjectsByOrigin(db, key)).toEqual(candidates.filter(project => project !== custom).map(project => ({ project, verified: false })));
  const outbox = rows(db, "cloud_outbox") as { kind: string; payload: string }[];
  expect(outbox.slice(0, previous.length)).toEqual(previous);
  expect(outbox.slice(previous.length).map(row => ({ kind: row.kind, data: JSON.parse(row.payload) }))).toEqual([{
    kind: "project_identity_settings",
    data: { project_id: custom.projectId, setting: "origin", value: "example.com:2222/Org/Repo", updated_at: "1970-01-01T00:00:00.000Z" },
  }]);
  expect(db.query("SELECT count(*) AS n FROM project_remotes").get()).toEqual({ n: 4 });
  expect(() => resolveProjectDirectory(db, join(root, "unbound"), "Unbound", true, undefined, origin))
    .toThrow(expect.objectContaining({ code: "PROJECT_BINDING_REQUIRED" }));
})));

test("a client writing the legacy row cannot replace a confirmed origin", () => withDatabase(db => {
  enableCloud(db);
  const original = resolveProjectDirectory(db, "/first/.git", "First", true, undefined, origin).project!;
  db.query("UPDATE project_remotes SET origin='example.com/Org/Wrong' WHERE project_id=?").run(original.projectId);
  const same = resolveProjectDirectory(db, "/second/.git", "Second", true, undefined, "https://example.com/Org/Repo.git");
  expect(same).toEqual({ project: original, created: false });
  const wrong = resolveProjectDirectory(db, "/wrong/.git", "Wrong", true, undefined, "https://example.com/Org/Wrong.git");
  expect(wrong.created).toBe(true);
  expect(wrong.project?.projectId).not.toBe(original.projectId);
}));

test("a credential-bearing Git URL leaves no credential or remote row in the database or outbox", () => withDatabase(db => {
  enableCloud(db);
  const marker = "example-private-test-fixture";
  const raw = `https://user:${marker}@example.com/Org/Repo.git`;
  const directory = "/first/.git";
  const first = resolveProjectDirectory(db, directory, "Repo", true, undefined, raw);
  expect(JSON.stringify(first)).not.toContain(marker);
  expect(rows(db, "project_remotes")).toEqual([]);
  expect(JSON.stringify(rows(db, "cloud_outbox"))).not.toContain(marker);
  expect(version(db)).toEqual({ user_version: 12 });
}));

test("a first write from a reclone recovers a locally bound legacy project", () => withDirectory(root => withDatabase(db => {
  enableProjectBindings(db);
  const original = createProject(db, "Established");
  const originalDirectory = gitDirectory(root, "first", origin);
  bindProjectDirectory(db, originalDirectory, original.projectId);
  const cloneDirectory = gitDirectory(root, "second", "https://example.com:443/Org/Repo");
  const saved = saveForProjectDirectory(db, cloneDirectory, "Second", { type: "fact", title: "Title", content: "Content" }, undefined, origin);
  expect(saved.projectId).toBe(original.projectId);
  expect(projectForDirectory(db, cloneDirectory)).toEqual(original);
  expect(originSettings(db)).toEqual([{ project_id: original.projectId, value: key }]);
  expect(db.query("SELECT origin FROM project_remotes WHERE project_id=?").get(original.projectId)).toEqual({ origin: key });
})));
