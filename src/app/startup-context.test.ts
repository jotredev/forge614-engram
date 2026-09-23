import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";
import { bindProjectContext } from "./project-context";
import { readStartupContext } from "./startup-context";

const directories: string[] = [];
function temporary(prefix = "engram-startup-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("startup-context returns shared and the bound project's context, both with previews", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Bound");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    store.save({ scope: "shared", projectId: null, title: "Shared fact", content: "Applies everywhere", type: "fact" });
    store.save({ scope: "project", projectId: project.projectId, title: "Project fact", content: "Applies to this repo", type: "fact" });

    const result = readStartupContext(store, directory);

    expect(result.format).toBe(1);
    expect(result.shared.recent).toHaveLength(1);
    expect(result.shared.recent[0]!.title).toBe("Shared fact");
    expect(result.shared.recent[0]).toHaveProperty("preview");
    expect(result.project.status).toBe("bound");
    expect(result.project.projectId).toBe(project.projectId);
    expect(result.project.context).not.toBeNull();
    const titles = result.project.context!.recent.map(row => row.title).sort();
    expect(titles).toEqual(["Project fact", "Shared fact"]);
  } finally { store.close(); }
});

test("startup-context reports an unbound directory without creating a project, and still returns shared", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    store.save({ scope: "shared", projectId: null, title: "Shared fact", content: "Applies everywhere", type: "fact" });
    const directory = temporary();

    const result = readStartupContext(store, directory);

    expect(result.project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
    expect(result.ecosystem).toEqual({ status: "none" });
    expect(result.shared.recent).toHaveLength(1);
    expect(store.listProjects()).toEqual([]);
  } finally { store.close(); }
});

test("a project memory on the same topic supersedes the shared entry inside project.context, but the top-level shared section is unaffected", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Overrides");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    store.save({ scope: "shared", projectId: null, title: "Shared language", content: "Spanish", type: "preference", topicKey: "user/preference/language" });
    store.save({ scope: "project", projectId: project.projectId, title: "Project language", content: "English for this repo", type: "preference", topicKey: "user/preference/language" });

    const result = readStartupContext(store, directory);

    expect(result.shared.recent.map(row => row.title)).toEqual(["Shared language"]);
    expect(result.project.context!.recent.map(row => row.title)).toEqual(["Project language"]);
  } finally { store.close(); }
});

test("startup-context never writes: a readonly connection succeeds for both a bound and an unbound directory", () => {
  const directory = temporary();
  const dbPath = join(temporary(), "engram.db");
  const boundDirectory = temporary();
  let projectId: string;
  {
    const writable = new MemoryStore(dbPath);
    try {
      writable.enableProjectBindings();
      const project = writable.createProject("Readonly check");
      projectId = project.projectId;
      bindProjectContext(writable, boundDirectory, projectId);
      writable.save({ scope: "shared", projectId: null, title: "Shared", content: "Read-only safe", type: "fact" });
    } finally { writable.close(); }
  }
  const readonlyStore = new MemoryStore(dbPath, { readonly: true });
  try {
    expect(readStartupContext(readonlyStore, boundDirectory)).toMatchObject({ project: { status: "bound", projectId } });
    expect(readStartupContext(readonlyStore, directory)).toMatchObject({ project: { status: "unbound", projectId: null, context: null } });
  } finally { readonlyStore.close(); }
});

test("startup-context keeps the combined payload within a documented byte ceiling even under heavy seeding", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Bounded");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    for (let i = 0; i < 40; i++) {
      store.save({ scope: "shared", projectId: null, title: `Shared ${i}`, content: "x".repeat(2000), type: "fact" });
      store.save({ scope: "project", projectId: project.projectId, title: `Project ${i}`, content: "y".repeat(2000), type: "fact" });
    }

    const result = readStartupContext(store, directory);
    const size = Buffer.byteLength(JSON.stringify(result), "utf8");

    expect(result.shared.truncated).toBe(true);
    expect(result.project.context!.truncated).toBe(true);
    // Each section is independently bounded by context()'s own default 16384-byte ceiling.
    expect(size).toBeLessThanOrEqual(2 * 16384 + 4096);
  } finally { store.close(); }
});

test("a project in a group gets a third block, ordered shared, ecosystem, project, each within its own byte ceiling", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Frontend");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    store.enableEcosystem();
    const group = store.ensureGroup(crypto.randomUUID(), "tienda").group;
    store.bindProjectToGroup(project.projectId, group.id, "command");
    store.save({ scope: "shared", projectId: null, title: "Shared fact", content: "everywhere", type: "fact" });
    store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Group fact", content: "every repo of the group", type: "decision" });
    for (let index = 0; index < 60; index++) {
      store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: `Bulk ${index}`, content: "x".repeat(900), type: "fact" });
      store.save({ scope: "shared", projectId: null, title: `Bulk shared ${index}`, content: "y".repeat(900), type: "fact" });
    }

    const result = readStartupContext(store, directory);

    expect(Object.keys(result)).toEqual(["format", "shared", "ecosystem", "project"]);
    expect(result.format).toBe(1);
    if (result.ecosystem.status !== "member") throw new Error("expected a member block");
    expect(result.ecosystem.group).toEqual({ id: group.id, name: "tienda" });
    expect(result.ecosystem.context.recent.every(row => row.scope === "ecosystem")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.ecosystem.context))).toBeLessThanOrEqual(16384);
    expect(Buffer.byteLength(JSON.stringify(result.shared))).toBeLessThanOrEqual(16384);
    expect(result.ecosystem.context.truncated).toBe(true);
    expect(result.project.context!.recent.some(row => row.scope === "ecosystem")).toBe(false);
  } finally { store.close(); }
});

test("a project outside any group, or a database below the ecosystem level, reports ecosystem none", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Loose");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    expect(readStartupContext(store, directory).ecosystem).toEqual({ status: "none" });
    store.enableEcosystem();
    expect(readStartupContext(store, directory).ecosystem).toEqual({ status: "none" });
  } finally { store.close(); }
});

test("project.source tells whether the identity came from the file or from the recorded path", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    const project = store.createProject("Bound by path");
    const directory = temporary();
    bindProjectContext(store, directory, project.projectId);
    rmSync(join(directory, ".forge614"), { recursive: true });
    const first = readStartupContext(store, directory);
    expect(first.project.source).toBe("path");
    expect(first.project.notices).toEqual([expect.objectContaining({ code: "PROJECT_FILE_CREATED" })]);
    const second = readStartupContext(store, directory);
    expect(second.project.source).toBe("file");
    expect(second.project.notices).toBeUndefined();
  } finally { store.close(); }
});
