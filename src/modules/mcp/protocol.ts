import { memoryProtocol } from "../memory-protocol";

// The MCP server instructions are the version-4 manual's MCP output: one source, never edited here.
export const MEMORY_PROTOCOL = memoryProtocol(4).mcpInstructions;
