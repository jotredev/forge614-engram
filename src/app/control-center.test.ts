import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";
import { MemoryStore } from "./memory-store";
import { MemoryWorkspace } from "./workspace";
import { executeControlCenterMutation, readControlCenter } from "./control-center";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "engram-control-center-"));
  directories.push(directory);
  const config = new WorkspaceConfig(join(directory, ".forge614"));
  return { directory, config, workspace:new MemoryWorkspace(config) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, {recursive:true, force:true}); });

test("missing configuration returns the exact uninitialized snapshot without creating storage", () => {
  const {config} = fixture();
  expect(readControlCenter(config)).toEqual({
    storage: {initialized:false, databasePath:null, capabilities:null, postgres:"not-configured"},
    projects: [],
    shared: null,
  });
  expect(existsSync(config.root)).toBe(false);
});

test("uninitialized snapshots are independent read-only values", () => {
  const {config} = fixture();
  const first = readControlCenter(config);
  first.projects.push({
    projectId:"11111111-1111-4111-8111-111111111111", name:"mutated", createdAt:"", updatedAt:"", bindings:[],
    memories:{active:0, archived:0, lastUpdatedAt:null},
  });
  first.storage.postgres = "configured";

  expect(readControlCenter(config)).toEqual({
    storage: {initialized:false, databasePath:null, capabilities:null, postgres:"not-configured"},
    projects: [],
    shared: null,
  });
});

test("configured storage reports schema 7 capabilities and only PostgreSQL status", () => {
  for (const postgres of [false, true]) {
    const {config, workspace} = fixture();
    workspace.init();
    const store = workspace.open();
    try { store.enableSearchReinforcement(); }
    finally { store.close(); }
    if (postgres) {
      config.configurePostgres("postgresql://u:CONTROL_CENTER_SECRET@127.0.0.1/db?sslmode=disable", config.revision());
    }

    const snapshot = readControlCenter(config);
    expect(snapshot.storage).toEqual({
      initialized:true,
      databasePath:config.databasePath,
      capabilities:{schema:7, assistantIntegration:true, sessions:true, reinforcement:true},
      postgres:postgres ? "configured" : "not-configured",
    });
    expect(JSON.stringify(snapshot)).not.toContain("CONTROL_CENTER_SECRET");
    expect(JSON.stringify(snapshot)).not.toContain("postgresql://");
  }
});

test("configured missing or unsafe databases preserve safe failures without creating or changing data", () => {
  const missing = fixture();
  missing.workspace.init();
  rmSync(missing.config.databasePath);
  expect(() => readControlCenter(missing.config)).toThrow(expect.objectContaining({code:"DATABASE_MISSING"}));
  expect(existsSync(missing.config.databasePath)).toBe(false);

  const unsafe = fixture();
  unsafe.workspace.init();
  rmSync(unsafe.config.databasePath);
  const target = join(unsafe.directory, "target.db");
  writeFileSync(target, "KEEP");
  symlinkSync(target, unsafe.config.databasePath);
  expect(() => readControlCenter(unsafe.config)).toThrow(expect.objectContaining({code:"DATABASE_PATH_UNSAFE"}));
  expect(readFileSync(target, "utf8")).toBe("KEEP");
});

test("opened storage closes after both successful and failed summary reads", () => {
  const {config, workspace} = fixture();
  workspace.init();
  const close = spyOn(MemoryStore.prototype, "close");
  try {
    readControlCenter(config);
    expect(close).toHaveBeenCalledTimes(1);

    const failure = new MemoryError("DATABASE_SCHEMA", "safe summary failure");
    const summarize = spyOn(MemoryStore.prototype, "controlCenter").mockImplementation(() => { throw failure; });
    try { expect(() => readControlCenter(config)).toThrow(failure); }
    finally { summarize.mockRestore(); }
    expect(close).toHaveBeenCalledTimes(2);
  } finally { close.mockRestore(); }
});

test("mutation executor refuses a missing workspace instead of initializing it", async () => {
  const {config} = fixture();
  await expect(executeControlCenterMutation(config, {kind:"create-project", name:"No implicit init"}))
    .rejects.toMatchObject({code:"CONFIG_NOT_FOUND"});
  expect(existsSync(config.root)).toBe(false);
});

test("project mutations use the workspace APIs and return only known project metadata", async () => {
  const {config, workspace, directory} = fixture();
  workspace.init();

  const createdMessage = await executeControlCenterMutation(config, {kind:"create-project", name:"Demo"});
  const [created] = workspace.listProjects();
  expect(created).toMatchObject({name:"Demo"});
  expect(createdMessage).toBe(`Proyecto creado: Demo (${created!.projectId}).`);

  const renamedMessage = await executeControlCenterMutation(config, {
    kind:"rename-project", projectId:created!.projectId, name:"Renamed",
  });
  expect(workspace.listProjects()[0]?.name).toBe("Renamed");
  expect(renamedMessage).toBe(`Proyecto renombrado: Renamed (${created!.projectId}).`);

  await executeControlCenterMutation(config, {kind:"enable-integration"});
  const boundMessage = await executeControlCenterMutation(config, {
    kind:"bind-directory", projectId:created!.projectId, directory,
  });
  expect(readControlCenter(config).projects[0]?.bindings).toEqual([realpathSync(directory)]);
  expect(boundMessage).toBe(`Directorio vinculado al proyecto ${created!.projectId}.`);
  for (const message of [createdMessage, renamedMessage, boundMessage]) {
    expect(message).not.toContain("postgresql://");
    expect(message).not.toContain(config.root);
  }
});

test("project success messages redact URL-shaped user labels embedded after word characters", async () => {
  const {config, workspace} = fixture();
  workspace.init();
  for (const prefix of ["_", "7"]) {
    const message = await executeControlCenterMutation(config, {
      kind:"create-project",
      name:`${prefix}postgresql://user:RESULT_SECRET@example.test/engram`,
    });
    expect(message).toContain("[URL omitted]");
    expect(message).not.toContain("postgresql://");
    expect(message).not.toContain("RESULT_SECRET");
  }
});

test("bind closes its opened store when the safe workspace operation fails", async () => {
  const {config, workspace, directory} = fixture();
  workspace.init();
  const close = spyOn(MemoryStore.prototype, "close");
  try {
    await expect(executeControlCenterMutation(config, {
      kind:"bind-directory",
      projectId:"11111111-1111-4111-8111-111111111111",
      directory,
    })).rejects.toMatchObject({code:"MIGRATION_REQUIRED"});
    expect(close).toHaveBeenCalledTimes(1);
  } finally { close.mockRestore(); }
});

test("capability mutations enable exactly their documented target schema", async () => {
  const cases = [
    [{kind:"enable-integration"} as const, 5, "Integración de asistentes habilitada: esquema 5."],
    [{kind:"enable-sessions"} as const, 6, "Sesiones habilitadas: esquema 6."],
    [{kind:"enable-reinforcement"} as const, 7, "Refuerzo de búsqueda habilitado: esquema 7."],
  ] as const;
  for (const [mutation, schema, message] of cases) {
    const {config, workspace} = fixture();
    workspace.init();
    expect(await executeControlCenterMutation(config, mutation)).toBe(message);
    const capabilities = readControlCenter(config).storage.capabilities;
    expect(capabilities?.schema).toBe(schema);
    expect(capabilities).toEqual({
      schema,
      assistantIntegration:true,
      sessions:schema >= 6,
      reinforcement:schema >= 7,
    });
  }
});

test("sync delegates without format promotion and preserves SQLite when connection fails", async () => {
  const {config, workspace} = fixture();
  workspace.init();
  config.configurePostgres("postgresql://user:SYNC_SECRET@127.0.0.1/engram?sslmode=disable", config.revision());
  const before = readFileSync(config.databasePath);
  const connect = spyOn(PostgresReplica, "connect").mockRejectedValue(
    new MemoryError("POSTGRES_UNAVAILABLE", "PostgreSQL no disponible; SYNC_SECRET no debe mostrarse."),
  );
  try {
    await expect(executeControlCenterMutation(config, {kind:"sync-now"}))
      .rejects.toMatchObject({code:"POSTGRES_UNAVAILABLE"});
    expect(connect).toHaveBeenCalledTimes(1);
    expect(readFileSync(config.databasePath)).toEqual(before);
  } finally { connect.mockRestore(); }
});
