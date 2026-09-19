import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectAssistant, resolveAssistantPaths } from "./catalog";
import { CLIENT_IDS } from "../../modules/assistants";
import { withDirectory } from "../__test-support__/fixtures";

test("Antigravity resolves only its documented global MCP file on every supported platform", () => withDirectory(home => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const paths = resolveAssistantPaths("antigravity", { home, env: {}, platform });
    expect(paths.config).toBe(join(home, ".gemini", "config", "mcp_config.json"));
    expect(paths.hooks).toBeUndefined();
  }
}));

test("Antigravity detection checks PATH and documented platform fallbacks", () => withDirectory(home => {
  const pathDirectory = join(home, "path"); mkdirSync(pathDirectory);
  const pathBinary = join(pathDirectory, "agy"); writeFileSync(pathBinary, "#!/bin/sh\nexit 0\n", {mode:0o700});
  expect(inspectAssistant("antigravity", {home,env:{},path:pathDirectory,platform:"linux"}).detected.executable).toBe(pathBinary);
  const unix = join(home, ".local", "bin"); mkdirSync(unix, {recursive:true});
  const unixBinary = join(unix, "agy"); writeFileSync(unixBinary, "#!/bin/sh\nexit 0\n", {mode:0o700});
  expect(inspectAssistant("antigravity", {home,env:{},path:"",platform:"linux"}).detected.executable).toBe(unixBinary);
  const local = join(home, "AppData", "Local"); const windows = join(local, "agy", "bin"); mkdirSync(windows,{recursive:true});
  const windowsBinary = join(windows, "agy.exe"); writeFileSync(windowsBinary, "fixture", {mode:0o700});
  expect(inspectAssistant("antigravity", {home,env:{LOCALAPPDATA:local},path:"",platform:"win32"}).detected.executable).toBe(windowsBinary);
}));

test("every managed assistant resolves its configuration paths on Windows", () => withDirectory(home => {
  for (const id of CLIENT_IDS) expect(resolveAssistantPaths(id, {home,env:{LOCALAPPDATA:join(home,"AppData","Local")},platform:"win32"}).config).toStartWith(home);
}));

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
