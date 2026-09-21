import { expect, test } from "bun:test";
import { memoryProtocol } from "./protocol";

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
