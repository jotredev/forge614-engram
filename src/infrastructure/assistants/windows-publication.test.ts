import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyAssistantConfiguration, planAssistantConfiguration } from "./configuration";
import { withDirectory } from "../__test-support__/fixtures";

const nativeWindows = process.platform === "win32" ? test : test.skip;
nativeWindows("native Windows publishes Antigravity's MCP configuration in a normal temporary home", () => withDirectory(home => {
  const executable = join(home, "forge614-engram.exe"); writeFileSync(executable, "fixture");
  const config = join(home, ".gemini", "config", "mcp_config.json");
  const plan = planAssistantConfiguration("antigravity", executable, {home,env:{LOCALAPPDATA:join(home,"AppData","Local")},path:"",platform:"win32"});
  expect(applyAssistantConfiguration(plan)).toMatchObject({ok:true,appliedPaths:[config]});
  expect(existsSync(config)).toBe(true);
  expect(JSON.parse(readFileSync(config,"utf8"))).toMatchObject({mcpServers:{"forge614-engram":{command:executable,args:["mcp"]}}});
}));
