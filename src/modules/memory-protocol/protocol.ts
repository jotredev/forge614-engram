interface MemoryProtocolLifecycle {
  readonly start: readonly string[];
  readonly save: readonly string[];
  readonly compact: readonly string[];
  readonly resume: readonly string[];
  readonly end: readonly string[];
}
interface MemoryProtocolScopes {
  readonly shared: string;
  readonly project: string;
}
interface MemoryProtocolSecurity {
  readonly neverSave: readonly string[];
}

export interface MemoryProtocolV1 {
  readonly id: "forge614-engram-memory";
  readonly version: 1;
  readonly instructions: string;
  readonly lifecycle: MemoryProtocolLifecycle;
  readonly scopes: MemoryProtocolScopes;
  readonly security: MemoryProtocolSecurity;
}

/** Announces the read-only host preload command without altering version 1's instructions. */
export interface MemoryProtocolV2 extends Omit<MemoryProtocolV1,"version"> {
  readonly version: 2;
  readonly startupContext: {
    readonly command: string;
    readonly description: string;
  };
}

export type MemoryProtocol = MemoryProtocolV1 | MemoryProtocolV2;

const protocolV1: MemoryProtocolV1 = Object.freeze({
  id: "forge614-engram-memory",
  version: 1,
  instructions: [
    "Forge614 Engram is the shared durable memory for this user and their projects. Do not use a client-private file as a substitute for shared Forge614 memory.",
    "At the start of a conversation, call memory_context to retrieve relevant project memory and shared preferences. Never claim to remember something when Engram returned no result.",
    "When the user explicitly says remember, save, retain, keep in mind, or equivalent, save the information automatically with memory_save. Do not ask for a second confirmation.",
    "Save durable preferences, collaboration preferences, documentation preferences, decisions, rules, discoveries, and outcomes when they will be useful beyond the immediate turn. Do not save every turn or raw transcripts.",
    "Use scope shared with a truthful globalIntent for a preference that should work across configured AI clients. Use project scope for repository-specific knowledge.",
    "Use a stable topicKey to update an evolving subject instead of duplicating it. For example, user/preference/favorite-color identifies a favorite-color preference.",
    "Before compaction or another context reset, call memory_session_summary with completed work, decisions, pending work, risks, and the next step. After compaction, call memory_context before continuing.",
    "At a normal session end, save the useful summary and call memory_session_end. If Engram is unavailable, continue working, report the truthful failure, and never pretend a private fallback file is shared memory.",
    "Never save passwords, tokens, private keys, credentials, or connection strings containing credentials in memory_save, session summaries, topic keys, logs, errors, or fallback files.",
  ].join("\n\n"),
  lifecycle: Object.freeze({
    start: Object.freeze([
      "Call memory_context for relevant project memory and shared preferences.",
      "Do not invent memories when Engram returns no result.",
    ]),
    save: Object.freeze([
      "Save an explicit user request to remember automatically with memory_save.",
      "Save durable preferences, collaboration rules, documentation preferences, decisions, discoveries, and outcomes without recording raw transcripts.",
      "Use shared scope with globalIntent for cross-client preferences and project scope for repository knowledge.",
      "Use a stable topicKey to update an evolving subject instead of duplicating it.",
    ]),
    compact: Object.freeze([
      "Call memory_session_summary before compacting or discarding context.",
      "Include completed work, decisions, pending work, risks, and the next step.",
    ]),
    resume: Object.freeze([
      "Call memory_context after compaction before continuing work.",
      "Use the recovered summary and relevant memories without inventing missing context.",
    ]),
    end: Object.freeze([
      "Save a useful final summary when durable work or learning occurred.",
      "Call memory_session_end after the final summary.",
    ]),
  }),
  scopes: Object.freeze({
    shared: "Cross-client preferences require scope shared and a truthful globalIntent.",
    project: "Repository-specific knowledge uses project scope.",
  }),
  security: Object.freeze({
    neverSave: Object.freeze([
      "passwords",
      "tokens",
      "private keys",
      "credentials",
      "connection strings containing credentials",
    ]),
  }),
});

const protocolV2: MemoryProtocolV2 = Object.freeze({
  ...protocolV1,
  version: 2,
  startupContext: Object.freeze({
    command: "forge614-engram startup-context --directory <absolute-directory> --json",
    description: "Non-interactive, read-only command a host (Shell, Engines) can run before an agent session starts, to preload bounded shared and project context without depending on the model choosing to call memory_context. Never creates a project, binding, memory or session; an unbound directory is reported as project.status=\"unbound\", not an error.",
  }),
});

export function memoryProtocol(version?: 1): MemoryProtocolV1;
export function memoryProtocol(version: 2): MemoryProtocolV2;
export function memoryProtocol(version: 1 | 2): MemoryProtocol;
export function memoryProtocol(version: 1 | 2 = 1): MemoryProtocol {
  return version === 2 ? protocolV2 : protocolV1;
}
