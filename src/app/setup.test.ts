import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";
import { runSetup, type SetupIO } from "./setup";

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-setup-"));
  directories.push(dir);
  const config = new WorkspaceConfig(join(dir, ".forge614"));
  return { config, workspace: new MemoryWorkspace(config) };
}
function conversation(answers: (string | null)[], beforeAnswer?: () => void) {
  const output: string[] = [];
  const questions: string[] = [];
  const io: SetupIO = {
    write: text => { output.push(text); },
    ask: async text => { questions.push(text); beforeAnswer?.(); return answers.shift() ?? null; },
  };
  return { io, output, questions };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("setup cancellation leaves a fresh workspace absent", async () => {
  for (const answer of [null, "q", "cancelar", "", "no", "n"]) {
    const { config } = fixture();
    const { io } = conversation([answer], () => expect(existsSync(config.root)).toBe(false));
    expect(await runSetup(io, config)).toEqual({ cancelled: true });
    expect(existsSync(config.root)).toBe(false);
  }
});

test("setup defaults to no PostgreSQL and initializes global storage without a project", async () => {
  const { config, workspace } = fixture();
  const { io, output, questions } = conversation(["", "sí"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(workspace.listProjects()).toEqual([]);
  expect(readFileSync(join(config.root, ".env"), "utf8")).toBe('FORMAT_VERSION="2"\nSTORAGE="sqlite"\n');
  expect(output.join("\n")).toContain(config.databasePath);
});

test("setup preserves existing projects and memories without asking which project to use", async () => {
  const { config, workspace } = fixture();
  const project = workspace.createProject("PRIVATE_PROJECT_NAME");
  const store = workspace.open();
  let id: string;
  try { id = store.save({ projectId: project.projectId, title: "Keep", content: "SQLite", type: "fact" }).id; }
  finally { store.close(); }
  const before = readFileSync(join(config.root, ".env"));
  const { io, output, questions } = conversation(["no", "yes"]);
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(workspace.listProjects()).toEqual([project]);
  expect(readFileSync(join(config.root, ".env"))).toEqual(before);
  const reopened = workspace.open(true);
  try { expect(reopened.get(project.projectId, id)!.content).toBe("SQLite"); }
  finally { reopened.close(); }
  expect(output.join("\n")).not.toContain(project.name);
  expect(output.join("\n")).not.toContain(project.projectId);
});

test("setup retries invalid confirmation without interpreting old project menu choices", async () => {
  const { config, workspace } = fixture();
  const { io, questions } = conversation(["no", "1", "Demo", "2", "3", "maybe", "si"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(7);
  expect(workspace.listProjects()).toEqual([]);
});

test("setup cancels PostgreSQL before connecting or publishing credentials", async()=>{
  const {config}=fixture();
  const {io,output}=conversation(["si","postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable","no"]);
  expect(await runSetup(io,config)).toEqual({cancelled:true});
  expect(existsSync(config.root)).toBe(false);
  expect(output.join("\n")).not.toContain("SECRET");
});

test("setup cancellation preserves existing project records", async () => {
  const { config, workspace } = fixture();
  const project = workspace.createProject("Original");
  expect(await runSetup(conversation(["no"]).io, config)).toEqual({ cancelled: true });
  expect(workspace.listProjects()).toEqual([project]);
});

test("setup refuses a missing configured database before prompting without recreating it", async () => {
  const { config, workspace } = fixture();
  workspace.init(); rmSync(config.databasePath);
  const { io, questions } = conversation(["si"]);
  await expect(runSetup(io, config)).rejects.toMatchObject({ code: "DATABASE_MISSING" });
  expect(questions).toEqual([]);
  expect(existsSync(config.databasePath)).toBe(false);
});
