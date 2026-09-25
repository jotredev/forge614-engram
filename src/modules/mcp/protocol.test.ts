import { expect, test } from "bun:test";
import { MCP_INSTRUCTIONS_MAX, memoryProtocol } from "../memory-protocol";
import { MEMORY_PROTOCOL } from "./protocol";

test("the MCP server instructions are the version-4 manual's MCP output, under its limit", () => {
  expect(MEMORY_PROTOCOL).toBe(memoryProtocol(4).mcpInstructions);
  expect(Array.from(MEMORY_PROTOCOL).length).toBeLessThan(MCP_INSTRUCTIONS_MAX);
});
