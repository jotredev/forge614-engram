import { expect, test } from "bun:test";
import { MemoryError } from "./errors";

test("domain failures retain machine-readable codes and Error diagnostics", () => {
  const error = new MemoryError("INVALID_INPUT", "Invalid project");
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("INVALID_INPUT");
  expect(error.toString()).toBe("MemoryError: Invalid project");
  expect(error.stack).toContain("Invalid project");
});
