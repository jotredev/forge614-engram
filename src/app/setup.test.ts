import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

test("setup automatically restricts an existing user-owned workspace directory before prompting", async () => {
  const { config } = fixture();
  mkdirSync(config.root, { mode: 0o755 });
  chmodSync(config.root, 0o755);

  expect(await runSetup(conversation(["q"]).io, config)).toEqual({ cancelled: true });

  expect(statSync(config.root).mode & 0o777).toBe(0o700);
  expect(existsSync(join(config.root, ".env"))).toBe(false);
  expect(existsSync(config.databasePath)).toBe(false);
});

test("setup defaults to no PostgreSQL and initializes global storage without a project", async () => {
  const { config, workspace } = fixture();
  const { io, output, questions } = conversation(["", "", "sí"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(3);
  expect(workspace.listProjects()).toEqual([]);
  expect(readFileSync(join(config.root, ".env"), "utf8")).toBe('FORMAT_VERSION="2"\nSTORAGE="sqlite"\n');
  expect(output.join("\n")).toContain(config.databasePath);
  const store = workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }
});

test("setup preserves existing projects and memories without asking which project to use", async () => {
  const { config, workspace } = fixture();
  const project = workspace.createProject("PRIVATE_PROJECT_NAME");
  const store = workspace.open();
  let id: string;
  try { id = store.save({ projectId: project.projectId, title: "Keep", content: "SQLite", type: "fact" }).id; }
  finally { store.close(); }
  const before = readFileSync(join(config.root, ".env"));
  const { io, output, questions } = conversation(["no", "no", "yes"]);
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(3);
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
  const { io, questions } = conversation(["no", "no", "1", "Demo", "2", "3", "maybe", "si"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(8);
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

test("setup only enrolls reinforcement after the final confirmation", async () => {
  const declined = fixture();
  declined.workspace.init();
  const declinedConfig = readFileSync(join(declined.config.root, ".env"));
  expect(await runSetup(conversation(["no", "no", "si"]).io, declined.config))
    .toEqual({ cancelled: false, storage: "sqlite" });
  expect(readFileSync(join(declined.config.root, ".env"))).toEqual(declinedConfig);
  let store = declined.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  const cancelled = fixture();
  cancelled.workspace.init();
  const cancelledDatabase = readFileSync(cancelled.config.databasePath);
  const cancelledConfig = readFileSync(join(cancelled.config.root, ".env"));
  expect(await runSetup(conversation(["no", "si", "no"]).io, cancelled.config))
    .toEqual({ cancelled: true });
  expect(readFileSync(cancelled.config.databasePath)).toEqual(cancelledDatabase);
  expect(readFileSync(join(cancelled.config.root, ".env"))).toEqual(cancelledConfig);
  store = cancelled.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  const accepted = fixture();
  const { io, output } = conversation(["no", "si", "si"], () => expect(existsSync(accepted.config.root)).toBe(false));
  expect(await runSetup(io, accepted.config)).toEqual({ cancelled: false, storage: "sqlite" });
  store = accepted.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(true); }
  finally { store.close(); }
  expect(output.join("\n")).toContain("registrar repeticiones mejora el orden; no verifica la verdad.");
  expect(output.join("\n")).toContain("sincronizar esta función requiere actualizar todos los equipos.");
  expect(output.join("\n")).toContain("sync --upgrade-format");
});

test("setup reports existing reinforcement without offering a downgrade", async () => {
  const { config, workspace } = fixture();
  workspace.init();
  const store = workspace.open();
  try { store.enableSearchReinforcement(); }
  finally { store.close(); }
  const { io, output, questions } = conversation(["no", "si"]);
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(output.join("\n")).toContain("El refuerzo de recuerdos ya está habilitado.");
  expect(output.join("\n")).not.toContain("¿Quieres habilitar el refuerzo de recuerdos?");
  const reopened = workspace.open(true);
  try { expect(reopened.reinforcementEnabled()).toBe(true); }
  finally { reopened.close(); }
});
