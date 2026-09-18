import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import {
  executeControlCenterMutation,
  MemoryWorkspace,
  readControlCenter,
  WorkspaceConfig,
} from "../../../app";
import { MemoryError } from "../../../shared/errors";
import { resolveProjectContext } from "../../../app/project-context";
import { controlCenterTui } from "../control-center";

const roots:string[] = [];

function initialized(enableIntegration = false, postgres = false) {
  const root = mkdtempSync(join(tmpdir(), "engram-control-center-tui-"));
  roots.push(root);
  const config = new WorkspaceConfig(join(root, ".forge614"));
  const workspace = new MemoryWorkspace(config);
  workspace.init();
  if (enableIntegration) {
    const store = workspace.open();
    try { store.enableAssistantIntegration(); }
    finally { store.close(); }
  }
  if (postgres) {
    config.configurePostgres("postgresql://test:NOT_RENDERED@127.0.0.1/engram?sslmode=disable", config.revision());
  }
  return {root, config, workspace};
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true});
});

function terminal() {
  const input = new PassThrough() as PassThrough & Partial<ReadStream>;
  const output = new PassThrough() as PassThrough & Partial<WriteStream>;
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = ((raw:boolean) => { input.isRaw = raw; return input as unknown as ReadStream; }) as ReadStream["setRawMode"];
  output.isTTY = true;
  output.columns = 100;
  output.rows = 40;
  let text = "";
  output.on("data", chunk => { text += chunk.toString(); });
  return {input:input as unknown as ReadStream, output:output as unknown as WriteStream, text:() => text};
}

function press(input:ReadStream, name:string, text = ""):void {
  input.emit("keypress", text, {name, ctrl:false, meta:false, shift:false, sequence:text});
}

function type(input:ReadStream, value:string):void {
  for (const character of value) press(input, character === " " ? "space" : character, character);
}

function menu(input:ReadStream, index:number):void {
  for (let cursor = 0; cursor < index; cursor += 1) press(input, "down");
  press(input, "return");
}

function action(input:ReadStream, index:number):void {
  menu(input, 4);
  for (let cursor = 0; cursor < index; cursor += 1) press(input, "down");
  press(input, "return");
}

function confirm(input:ReadStream):void {
  type(input, "confirm");
  press(input, "return");
}

function cancel(input:ReadStream):void {
  input.emit("keypress", "\x03", {name:"c", ctrl:true});
}

async function waitFor(predicate:()=>boolean):Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error("condition not reached");
}

test("read-only project detail leaves database bytes unchanged", async () => {
  const {config, workspace} = initialized();
  workspace.createProject("Read only");
  const before = readFileSync(config.databasePath);
  const tty = terminal();
  const run = controlCenterTui({...tty, config});
  menu(tty.input, 1);
  press(tty.input, "return");
  press(tty.input, "escape");
  press(tty.input, "escape");
  cancel(tty.input);
  await run;
  expect(readFileSync(config.databasePath)).toEqual(before);
});

test("confirmed create, rename and bind flows persist only their final mutation", async () => {
  const created = initialized();
  let tty = terminal();
  let run = controlCenterTui({...tty, config:created.config});
  action(tty.input, 0);
  type(tty.input, "Created in TUI");
  press(tty.input, "return");
  confirm(tty.input);
  await waitFor(() => created.workspace.listProjects().length === 1);
  cancel(tty.input);
  await run;
  const projectId = created.workspace.listProjects()[0]!.projectId;

  tty = terminal();
  run = controlCenterTui({...tty, config:created.config});
  action(tty.input, 1);
  press(tty.input, "return");
  type(tty.input, "Renamed in TUI");
  press(tty.input, "return");
  confirm(tty.input);
  await waitFor(() => created.workspace.listProjects()[0]?.name === "Renamed in TUI");
  cancel(tty.input);
  await run;

  await executeControlCenterMutation(created.config, {kind:"enable-integration"});
  tty = terminal();
  run = controlCenterTui({...tty, config:created.config});
  action(tty.input, 2);
  press(tty.input, "return");
  type(tty.input, created.root);
  press(tty.input, "return");
  confirm(tty.input);
  await waitFor(() => readControlCenter(created.config).projects[0]?.bindings.length === 1);
  cancel(tty.input);
  await run;
  expect(readControlCenter(created.config).projects[0]).toMatchObject({
    projectId,
    name:"Renamed in TUI",
    bindings:[realpathSync(created.root)],
  });
});

test.each(["root", "subdirectory", "symlink"] as const)("TUI %s binding resolves to the chosen project from every Git directory", async (target) => {
  const {config, workspace, root} = initialized(true);
  const repository = join(root, "MyRepository");
  const child = join(repository, "Sources", "Nested");
  const alias = join(root, "RepositoryAlias");
  mkdirSync(child, {recursive:true});
  const initializedGit = Bun.spawnSync(["git", "init", "--quiet", repository], {stderr:"pipe"});
  if (initializedGit.exitCode !== 0) throw new Error(initializedGit.stderr.toString());
  symlinkSync(repository, alias);
  const chosen = workspace.createProject("Chosen project");
  const directory = target === "root" ? repository : target === "subdirectory" ? child : alias;
  await executeControlCenterMutation(config, {kind:"bind-directory", projectId:chosen.projectId, directory});

  const store = workspace.open(true);
  try {
    for (const lookup of [repository, child, alias]) {
      expect(resolveProjectContext(store, lookup, false)).toEqual({
        projectId:chosen.projectId, directory:realpathSync(join(repository, ".git")), source:"binding",
      });
    }
    expect(store.listProjects()).toHaveLength(1);
  } finally { store.close(); }
});

test("TUI binding rejects nonexistent paths and files with safe validation before storing a binding", async () => {
  const {config, workspace, root} = initialized(true);
  const chosen = workspace.createProject("Chosen project");
  const file = join(root, "not-a-directory");
  writeFileSync(file, "fixture");
  const before = readFileSync(config.databasePath);
  for (const directory of [join(root, "missing"), file, "/"]) {
    await expect(executeControlCenterMutation(config, {
      kind:"bind-directory", projectId:chosen.projectId, directory,
    })).rejects.toMatchObject({code:"INVALID_DIRECTORY"});
  }
  expect(readControlCenter(config).projects[0]?.bindings).toEqual([]);
  expect(readFileSync(config.databasePath)).toEqual(before);
});

test("cancelling every available mutation flow leaves config and database bytes unchanged", async () => {
  for (let actionIndex = 0; actionIndex < 7; actionIndex += 1) {
    const {config, workspace, root} = initialized(false, true);
    workspace.createProject("Existing");
    const configBefore = readFileSync(join(config.root, ".env"));
    const databaseBefore = readFileSync(config.databasePath);
    const tty = terminal();
    const run = controlCenterTui({...tty, config});
    action(tty.input, actionIndex);
    if (actionIndex === 0) {
      type(tty.input, "Cancelled create");
      press(tty.input, "return");
    } else if (actionIndex === 1 || actionIndex === 2) {
      press(tty.input, "return");
      type(tty.input, actionIndex === 1 ? "Cancelled rename" : root);
      press(tty.input, "return");
    }
    press(tty.input, "escape");
    cancel(tty.input);
    await run;
    expect(readFileSync(join(config.root, ".env"))).toEqual(configBefore);
    expect(readFileSync(config.databasePath)).toEqual(databaseBefore);
  }
});

test("unconfigured PostgreSQL hides synchronization from the action screen", async () => {
  const {config} = initialized();
  const tty = terminal();
  const run = controlCenterTui({...tty, config});
  menu(tty.input, 4);
  expect(tty.text()).not.toContain("Synchronize now");
  cancel(tty.input);
  await run;
});

test("injected sync error preserves local bytes and displays only the safe MemoryError", async () => {
  const {config} = initialized(false, true);
  const before = readFileSync(config.databasePath);
  const tty = terminal();
  const run = controlCenterTui({
    ...tty,
    config,
    executeMutation:async (usedConfig, mutation) => {
      if (mutation.kind === "sync-now") {
        throw new MemoryError("POSTGRES_UNAVAILABLE", "PostgreSQL no disponible.");
      }
      return executeControlCenterMutation(usedConfig, mutation);
    },
  });
  action(tty.input, 4);
  confirm(tty.input);
  await waitFor(() => tty.text().includes("POSTGRES_UNAVAILABLE"));
  expect(tty.text()).not.toContain("NOT_RENDERED");
  cancel(tty.input);
  await run;
  expect(readFileSync(config.databasePath)).toEqual(before);
});
