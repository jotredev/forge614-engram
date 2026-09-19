import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";
import { inspectMemoryInitialization, previewMemoryInitialization } from "./initialization";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "forge614-initialization-"));
  directories.push(directory);
  const config = new WorkspaceConfig(join(directory, ".forge614", "engram"));
  return { config, workspace: new MemoryWorkspace(config) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("inspection reports absent storage without creating it", () => {
  const { config } = fixture();

  expect(inspectMemoryInitialization(config)).toEqual({
    initialized: false,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: false,
  });
  expect(existsSync(config.root)).toBe(false);
});

test("inspection reports enabled reinforcement from an existing local workspace", () => {
  const { config, workspace } = fixture();
  workspace.init();
  const store = workspace.open();
  try { store.enableSearchReinforcement(); }
  finally { store.close(); }

  expect(inspectMemoryInitialization(config)).toEqual({
    initialized: true,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: true,
  });
});

test("preview validates a PostgreSQL request without exposing its credential or creating storage", async () => {
  const { config } = fixture();

  const preview = await previewMemoryInitialization({
    postgresUrl: "postgresql://user:SECRET_MARKER@127.0.0.1/db?sslmode=disable",
    enableReinforcement: true,
  }, config);

  expect(preview).toEqual({
    status: {
      initialized: false,
      storage: "sqlite",
      postgresConfigured: false,
      reinforcementEnabled: false,
    },
    expectedRevision: null,
    initializesStorage: true,
    configuresPostgres: true,
    enablesReinforcement: true,
  });
  expect(JSON.stringify(preview)).not.toContain("SECRET_MARKER");
  expect(existsSync(config.root)).toBe(false);
});
