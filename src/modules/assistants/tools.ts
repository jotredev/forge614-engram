export const MCP_TOOL_NAMES = [
  "memory_context", "memory_current_project", "memory_get", "memory_history",
  "memory_save", "memory_search", "memory_session_end", "memory_session_start",
  "memory_session_summary", "memory_timeline",
] as const;

export type McpToolName = typeof MCP_TOOL_NAMES[number];
