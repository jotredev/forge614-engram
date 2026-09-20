import { expect, test } from "bun:test";
import { MemoryError } from "./errors";

test("domain failures retain machine-readable codes and Error diagnostics", () => {
  const error = new MemoryError("INVALID_INPUT", "Invalid project");
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe("INVALID_INPUT");
  expect(error.toString()).toBe("MemoryError: Invalid project");
  expect(error.stack).toContain("Invalid project");
});

test("domain failures redact PostgreSQL connection strings", () => {
  const url = "postgresql://engram_user:POSTGRES_SECRET_MARKER@db.example.test:5432/engram?sslmode=require";
  const error = new MemoryError("POSTGRES_UNAVAILABLE", `No se pudo conectar a ${url}`);

  expect(error.code).toBe("POSTGRES_UNAVAILABLE");
  expect(error.message).not.toContain(url);
  expect(error.message).not.toContain("engram_user");
  expect(error.message).not.toContain("POSTGRES_SECRET_MARKER");
  expect(error.message).toContain("[URL de PostgreSQL oculta]");
});
