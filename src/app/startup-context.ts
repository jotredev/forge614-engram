import type { ContextInput, ContextResult } from "../modules/search";
import { MemoryStore } from "./memory-store";
import { resolveStartupProjectContext } from "./project-context";
import type { IdentityNotice } from "./project-identity";

export interface StartupProjectContext {
  status: "bound" | "unbound";
  projectId: string | null;
  context: ContextResult | null;
  /** How the project was identified: its own identity file, a recorded folder binding, or not at all. */
  source: "file" | "path" | "unbound";
  notices?: IdentityNotice[];
}

export type StartupEcosystemContext =
  | { status: "member"; group: { id: string; name: string }; context: ContextResult }
  | { status: "none" };

/**
 * `format` stays 1: `ecosystem` and `project.source` are additive fields, so a consumer that ignores
 * unknown fields keeps working unchanged.
 */
export interface StartupContextResult {
  format: 1;
  shared: ContextResult;
  ecosystem: StartupEcosystemContext;
  project: StartupProjectContext;
}

/** A project's context; a member of a group also gets its ecosystem block (absent for everyone else). */
export type ProjectContextResult = ContextResult & { ecosystem?: Extract<StartupEcosystemContext, { status: "member" }> };
export function readProjectContext(store: MemoryStore, projectId: string, options?: ContextInput): ProjectContextResult {
  const context = store.context(projectId, options);
  const member = store.groupOfProject(projectId);
  return member
    ? { ...context, ecosystem: { status: "member", group: { id: member.group.id, name: member.group.name }, context: store.contextForGroup(member.group.id, options) } }
    : context;
}

/**
 * Non-interactive preload for a host (Shell, Engines) to call before an agent session starts. Never
 * creates a memory or a session, and never creates a project for an unbound directory (that is a normal
 * outcome, not an error). It does keep the repository's own identity file and the local base in step:
 * a clone is registered by its identity, and a project bound only by path receives its file.
 * Each block reuses context()'s own byte ceiling (16384 by default), so the combined payload stays
 * within a documented bound.
 */
export function readStartupContext(store: MemoryStore, directory: string): StartupContextResult {
  const shared = store.context(null);
  const resolved = resolveStartupProjectContext(store, directory);
  const ecosystem: StartupEcosystemContext = resolved.group
    ? { status: "member", group: resolved.group, context: store.contextForGroup(resolved.group.id) }
    : { status: "none" };
  const notices = resolved.notices ? { notices: resolved.notices } : {};
  const project: StartupProjectContext = resolved.projectId === null
    ? { status: "unbound", projectId: null, context: null, source: "unbound" }
    : { status: "bound", projectId: resolved.projectId, context: store.context(resolved.projectId),
        source: resolved.source === "file" ? "file" : "path", ...notices };
  return { format: 1, shared, ecosystem, project };
}
