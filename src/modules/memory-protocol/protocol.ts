export interface MemoryProtocol {
  readonly id: "forge614-engram-memory";
  readonly version: 1;
  readonly instructions: string;
  readonly lifecycle: {
    readonly start: readonly string[];
    readonly save: readonly string[];
    readonly compact: readonly string[];
    readonly resume: readonly string[];
    readonly end: readonly string[];
  };
  readonly scopes: {
    readonly shared: string;
    readonly project: string;
  };
  readonly security: {
    readonly neverSave: readonly string[];
  };
}

const protocol: MemoryProtocol = Object.freeze({
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

export function memoryProtocol(): MemoryProtocol {
  return protocol;
}
