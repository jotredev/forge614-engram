import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectAssistant, resolveAssistantPaths } from "./catalog";
import { withDirectory } from "../__test-support__/fixtures";

test("assistant detection distinguishes executable presence from stale configuration", () => withDirectory(home => {
  const config = join(home, ".claude"); mkdirSync(config);
  const options = { home, env: {}, path: "", platform: "linux" as const };
  expect(inspectAssistant("claude-code", options).detected).toMatchObject({ installed: false, configFound: true });
  const executable = join(home, "claude"); writeFileSync(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  expect(inspectAssistant("claude-code", { ...options, path: home }).detected).toMatchObject({ installed: true, executable });
}));

test("OpenCode rejects ambiguous JSON/JSONC sources and honors explicit selection", () => withDirectory(home => {
  const configDir = join(home, ".config", "opencode"); mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "opencode.json"), "{}"); writeFileSync(join(configDir, "opencode.jsonc"), "{}");
  expect(() => resolveAssistantPaths("opencode", { home, env: {} })).toThrow(expect.objectContaining({ code: "AMBIGUOUS" }));
  expect(resolveAssistantPaths("opencode", { home, env: {}, locations: { opencode: { configFile: join(configDir, "opencode.jsonc") } } }).config).toBe(join(configDir, "opencode.jsonc"));
}));
