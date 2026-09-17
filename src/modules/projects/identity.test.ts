import { expect, test } from "bun:test";
import { projectIdentity } from "./identity";

test("project identity accepts a UUID v4 and rejects names, other versions and variants", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  expect(projectIdentity(id)).toBe(id);
  for (const value of [null, 42, "Project", id.toUpperCase(), id.replace("4234", "1234"), id.replace("8234", "7234"), ` ${id}`]) {
    expect(() => projectIdentity(value)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});
