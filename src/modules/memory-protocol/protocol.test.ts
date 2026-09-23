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
