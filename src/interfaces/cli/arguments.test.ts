import { expect, test } from "bun:test";
import { integer, nonnegative, parseArguments } from "./arguments";

test("parser trims values, consumes boolean switches and requires command-specific values", () => {
  const parsed = parseArguments(["search", "--query", "  durable memory  ", "--preview", "--scope", "shared"]);
  expect(parsed.command).toBe("search");
  expect([...parsed.values]).toEqual([["query", "durable memory"], ["preview", "true"], ["scope", "shared"]]);
  expect(parsed.need("query")).toBe("durable memory");
  expect(() => parsed.need("project-id")).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

test.each([
  ["unknown"], ["save", "--query", "x"], ["search", "--query", "x", "--query", "y"],
  ["search", "--query"], ["search", "--query", "  "], ["search", "--query", "x\0y"],
  ["search", "--preview", "true"], ["search", "query", "x"],
].map(args=>({args})))("parser rejects malformed command %j", ({args}) => {
  expect(() => parseArguments(args)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

test("numeric options enforce inclusive bounds and reject fractional, signed and unsafe inputs", () => {
  expect(integer("1", "limit", 100)).toBe(1);
  expect(integer("100", "limit", 100)).toBe(100);
  expect(nonnegative("0", "before", 20)).toBe(0);
  expect(nonnegative("20", "before", 20)).toBe(20);
  for (const value of ["0", "101", "1.5", "-1", "+1", "1e2", "9007199254740992"]) {
    expect(() => integer(value, "limit", 100)).toThrow();
  }
  for (const value of ["21", "-1", "1.5", "9007199254740992"]) expect(() => nonnegative(value, "before", 20)).toThrow();
});
