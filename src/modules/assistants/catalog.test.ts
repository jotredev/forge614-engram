import { expect, test } from "bun:test";
import { coverageWarnings, isClientId } from "./catalog";

test("client validation distinguishes supported IDs from labels and inherited object names", () => {
  for (const id of ["claude-code","codex","cursor","opencode","gemini-cli"]) expect(isClientId(id)).toBe(true);
  for (const id of ["Codex","toString","","unknown"]) expect(isClientId(id)).toBe(false);
});
test("OpenCode warnings explain active override sources only when those sources exist", () => {
  const plain = coverageWarnings("opencode", {env:{}});
  expect(plain.some(message => message.includes("OPENCODE_CONFIG_CONTENT"))).toBe(false);
  expect(plain.some(message => message.includes("multiple configuration sources"))).toBe(false);
  const overridden = coverageWarnings("opencode", {env:{OPENCODE_CONFIG_CONTENT:"{}",OPENCODE_CONFIG:"/tmp/config"}});
  expect(overridden.some(message => message.includes("OPENCODE_CONFIG_CONTENT"))).toBe(true);
  expect(overridden.some(message => message.includes("multiple configuration sources"))).toBe(true);
  expect(coverageWarnings("codex").some(message => message.includes("/hooks"))).toBe(true);
  expect(coverageWarnings("cursor").some(message => message.includes("sessionStart only"))).toBe(true);
});
