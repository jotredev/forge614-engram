/** Comprueba que las instrucciones MCP publicadas sean exactamente la salida del manual de versión 4 y que quepan bajo el límite de tamaño. */
import { expect, test } from "bun:test";
import { MCP_INSTRUCTIONS_MAX, memoryProtocol } from "../memory-protocol";
import { MEMORY_PROTOCOL } from "./protocol";

// MEMORY_PROTOCOL no debe divergir de lo que genera memoryProtocol(4), y debe quedar por debajo del
// límite de caracteres que el protocolo MCP acepta para las instrucciones del servidor.
test("the MCP server instructions are the version-4 manual's MCP output, under its limit", () => {
  expect(MEMORY_PROTOCOL).toBe(memoryProtocol(4).mcpInstructions);
  expect(Array.from(MEMORY_PROTOCOL).length).toBeLessThan(MCP_INSTRUCTIONS_MAX);
});
