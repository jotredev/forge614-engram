import type { ContextResult } from "../modules/search";
import { MemoryStore } from "./memory-store";
import { resolveProjectContext } from "./project-context";

export interface StartupProjectContext {
  status: "bound" | "unbound";
  projectId: string | null;
  context: ContextResult | null;
}

export interface StartupContextResult {
  format: 1;
  shared: ContextResult;
  project: StartupProjectContext;
}

/**
 * Non-interactive, read-only preload for a host (Shell, Engines) to call before an agent
 * session starts. Never creates a project, binding, memory or session: an unbound directory
 * is a normal outcome, not an error. Each section reuses context()'s own byte ceiling
 * (16384 by default), so the combined payload stays well under a documented bound.
 */
export function readStartupContext(store: MemoryStore, directory: string): StartupContextResult {
  const shared = store.context(null);
  const resolved = resolveProjectContext(store, directory, false);
  const project: StartupProjectContext = resolved.projectId === null
    ? { status: "unbound", projectId: null, context: null }
    : { status: "bound", projectId: resolved.projectId, context: store.context(resolved.projectId) };
  return { format: 1, shared, project };
}
