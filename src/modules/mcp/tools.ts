/**
 * Lista fija de nombres de herramientas que expone el servidor MCP de esta memoria. La usan
 * `src/interfaces/mcp/context.ts` y `tools.ts` para registrar cada herramienta ante el cliente y
 * validar que un nombre recibido sea uno de los reconocidos.
 */
export const MCP_TOOL_NAMES = [
  "memory_context", "memory_current_project", "memory_get", "memory_history",
  "memory_save", "memory_search", "memory_session_end", "memory_session_start",
  "memory_session_summary", "memory_timeline",
] as const;

/** Uno de los nombres de herramienta MCP definidos en `MCP_TOOL_NAMES`. */
export type McpToolName = typeof MCP_TOOL_NAMES[number];
