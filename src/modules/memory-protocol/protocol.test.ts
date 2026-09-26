import { expect, test } from "bun:test";
import { FIELD_DESCRIPTIONS, MANUAL_MAX, MCP_INSTRUCTIONS_MAX, memoryProtocol } from "./protocol";

test("publishes the fixed version-one memory lifecycle", () => {
  const protocol = memoryProtocol();

  expect(protocol.id).toBe("forge614-engram-memory");
  expect(protocol.version).toBe(1);
  expect(protocol.instructions).toContain("memory_save");
  expect(protocol.instructions).toContain("globalIntent");
  expect(protocol.instructions).toContain("topicKey");
  expect(protocol.lifecycle.compact.join(" ")).toContain("memory_session_summary");
  expect(protocol.lifecycle.resume.join(" ")).toContain("memory_context");
  expect(protocol.lifecycle.end.join(" ")).toContain("memory_session_end");
  expect(protocol.security.neverSave).toContain("passwords");
  expect(protocol.security.neverSave).toContain("connection strings containing credentials");
  expect(protocol).not.toHaveProperty("startupContext");
});

test("version 1 stays byte-identical whether requested explicitly or by default", () => {
  expect(memoryProtocol(1)).toEqual(memoryProtocol());
});

test("version 2 keeps version 1's instructions and lifecycle unchanged while announcing startup-context", () => {
  const v1 = memoryProtocol(1);
  const v2 = memoryProtocol(2);

  expect(v2.id).toBe("forge614-engram-memory");
  expect(v2.version).toBe(2);
  expect(v2.instructions).toBe(v1.instructions);
  expect(v2.lifecycle).toEqual(v1.lifecycle);
  expect(v2.scopes).toEqual(v1.scopes);
  expect(v2.security).toEqual(v1.security);
  expect(v2.startupContext.command).toContain("startup-context");
  expect(v2.startupContext.command).toContain("--directory");
  expect(v2.startupContext.description).toContain("memory_context");
  expect(v2.startupContext.description.toLowerCase()).not.toMatch(/password|token|credential|connection string/);
});

// Published protocol versions are immutable: these digests were taken from v1.5.3's own output.
test("versions 1 and 2 are byte-identical to what v1.5.3 published", () => {
  const digest = (version: 1 | 2) => new Bun.CryptoHasher("sha256").update(JSON.stringify(memoryProtocol(version), null, 2)).digest("hex");
  expect(digest(1)).toBe("f3817767979b2e7df397c53a139d0b90cb6bf5afe7f6773b7d7513f8d58c821b");
  expect(digest(2)).toBe("d531af56e00424aea2fccc5304a2dd3a8c7455ca3f118a360e22c59f38b7387e");
  expect(Object.isFrozen(memoryProtocol(1))).toBe(true);
  expect(Object.isFrozen(memoryProtocol(2))).toBe(true);
});

test("version 3 announces the ecosystem scope, requires groupIntent and updates the lifecycle", () => {
  const v3 = memoryProtocol(3);
  expect(v3).toMatchObject({ id: "forge614-engram-memory", version: 3 });
  expect(v3.scopes.ecosystem).toContain("groupIntent");
  expect(v3.scopes.shared).toBe(memoryProtocol(1).scopes.shared);
  expect(v3.scopes.project).toBe(memoryProtocol(1).scopes.project);
  expect(v3.instructions).toContain("scope ecosystem");
  expect(v3.instructions).toContain("groupIntent");
  expect(v3.instructions).toContain("globalIntent");
  expect(v3.instructions).toMatch(/project takes precedence over ecosystem, and ecosystem over shared/);
  expect(v3.lifecycle.start.join(" ")).toContain("ecosystem");
  expect(v3.lifecycle.save.join(" ")).toContain("groupIntent");
  expect(v3.startupContext.command).toBe(memoryProtocol(2).startupContext.command);
  expect(v3.startupContext.description).toContain("ecosystem");
  expect(v3.security).toEqual(memoryProtocol(1).security);
  expect(Object.isFrozen(v3)).toBe(true);
  expect(Object.isFrozen(v3.scopes)).toBe(true);
  expect(JSON.stringify(v3).toLowerCase()).not.toMatch(/password":|secret|claude|openai|anthropic/);
});

test("the default and explicit selections never change: 1 stays the default", () => {
  expect(memoryProtocol().version).toBe(1);
  expect(memoryProtocol(2).version).toBe(2);
  expect(memoryProtocol(3).version).toBe(3);
});

// Version 3 as published by 1.6.0; a new version must never touch it.
test("version 3 stays byte-identical to what 1.6.0 published", () => {
  expect(new Bun.CryptoHasher("sha256").update(JSON.stringify(memoryProtocol(3), null, 2)).digest("hex"))
    .toBe("77732768998c56c7da85de311583a8565ff3fa9d46bdfbcc4f9d12d643332f19");
});

test("version 4 is one master manual: the MCP output keeps whole rules of the complete one, in order and within both limits", () => {
  const v4 = memoryProtocol(4);
  const count = (text: string) => Array.from(text).length;
  expect(Object.keys(v4)).toEqual(["id", "version", "instructions", "mcpInstructions", "startupContext"]);
  expect(v4).toMatchObject({ id: "forge614-engram-memory", version: 4 });
  expect(count(v4.instructions)).toBeLessThanOrEqual(MANUAL_MAX);
  expect(count(v4.mcpInstructions)).toBeLessThan(MCP_INSTRUCTIONS_MAX);
  const full = v4.instructions.split("\n\n"), mcp = v4.mcpInstructions.split("\n\n");
  expect(full.filter(rule => mcp.includes(rule))).toEqual(mcp);
  expect(mcp.length).toBeLessThan(full.length);
  for (const term of ["retrieved data", "memory_context", "memory_search", "memory_get", "memory_session_start", "previous", "memory_session_summary",
    "SECRET_REJECTED", "similar", "supersedes", "topicKey", "short version", "globalIntent"]) expect(v4.mcpInstructions).toContain(term);
  for (const term of ["groupIntent", "affects", "ECOSYSTEM_", "ecosystem/estado-actual"]) expect(v4.instructions).toContain(term);
  expect(v4.startupContext).toEqual({ command: "forge614-engram startup-context --directory <absolute-directory> --json --format 2",
    format: 2, description: expect.stringContaining("retrieved data") });
  expect(Object.isFrozen(v4)).toBe(true);
  expect(Object.isFrozen(v4.startupContext)).toBe(true);
  expect(JSON.stringify(v4).toLowerCase()).not.toMatch(/claude|openai|anthropic/);
  expect(memoryProtocol().version).toBe(1);
});

// 1.7.1: the session rule now distinguishes a parallel session from one left open, and the
// writing rule asks for the reason when keeping a save apart from a similar one.
// 1.7.2: the session rule names previous first, and for parallel says only that it is open now.
test("version 4 tells previous and parallel apart, asks for a reason when keeping a save apart, and stays within both limits", () => {
  const v4 = memoryProtocol(4);
  const count = (text: string) => Array.from(text).length;
  expect(v4.instructions).toContain("If it returns previous, say it was left open and when, and offer to continue from its summary, without inventing what it did; if parallel, only say another session is open now.");
  expect(v4.mcpInstructions).toContain("If it returns previous, say it was left open and when, and offer to continue from its summary, without inventing what it did; if parallel, only say another session is open now.");
  expect(v4.instructions).toContain("keep yours apart telling the person why,");
  expect(v4.mcpInstructions).toContain("keep yours apart telling the person why,");
  expect(count(v4.instructions)).toBe(2386);
  expect(count(v4.mcpInstructions)).toBe(1997);
  expect(count(v4.instructions)).toBeLessThanOrEqual(MANUAL_MAX);
  expect(count(v4.mcpInstructions)).toBeLessThan(MCP_INSTRUCTIONS_MAX);
});

test("field descriptions are short, frozen and never name a product", () => {
  expect(Object.isFrozen(FIELD_DESCRIPTIONS)).toBe(true);
  for (const text of Object.values(FIELD_DESCRIPTIONS)) {
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text.toLowerCase()).not.toMatch(/claude|openai|anthropic/);
  }
});
