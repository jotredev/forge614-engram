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
});
