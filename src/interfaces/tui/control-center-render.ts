import type { ControlCenterIntent, ControlCenterState } from "./control-center-state";

const MENU = ["Summary", "Projects", "Shared", "Storage", "Actions", "Assistants", "Exit"] as const;

const ACTION_LABELS: Record<Exclude<ControlCenterIntent["kind"], "open-assistants">, string> = {
  "create-project": "Create project",
  "rename-project": "Rename project",
  "bind-directory": "Bind directory",
  "enable-integration": "Enable assistant integration",
  "enable-sessions": "Enable sessions",
  "enable-reinforcement": "Enable search reinforcement",
  "sync-now": "Synchronize now",
};

const CAPABILITY_TARGET_SCHEMA: Partial<Record<Exclude<ControlCenterIntent["kind"], "open-assistants">, 5 | 6 | 7>> = {
  "enable-integration": 5,
  "enable-sessions": 6,
  "enable-reinforcement": 7,
};

function clean(text: string): string {
  return Array.from(text.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "?"))
    .map(character => character.codePointAt(0)! > 0x7f ? "?" : character)
    .join("");
}

function safeExternal(text: string): string {
  return clean(text).replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "[URL omitted]");
}

function projectForState(state: ControlCenterState) {
  return state.snapshot.projects.find(project => project.projectId === state.selectedProjectId) ?? null;
}

function intentSummary(intent: ControlCenterIntent): readonly string[] {
  if (intent.kind === "create-project") return [`Name: ${safeExternal(intent.name)}`];
  if (intent.kind === "rename-project") return [`Project UUID: ${safeExternal(intent.projectId)}`, `New name: ${safeExternal(intent.name)}`];
  if (intent.kind === "bind-directory") return [`Project UUID: ${safeExternal(intent.projectId)}`, `Directory: ${safeExternal(intent.directory)}`];
  if (intent.kind === "open-assistants") return ["Open the existing assistant configurator."];
  if (intent.kind === "sync-now") return ["This sync does not promote format and does not start a background service."];
  return [
    `Target schema: ${CAPABILITY_TARGET_SCHEMA[intent.kind]}`,
    "Existing memories are preserved.",
    "No downgrade is offered.",
  ];
}

/** Renders safe, bounded terminal text. It does not perform terminal or storage I/O. */
export function renderControlCenterScreen(state: ControlCenterState, width: number, height: number): string {
  const columns = Math.min(240, Math.max(1, Number.isFinite(width) ? Math.floor(width) : 80));
  const rows = Math.min(200, Math.max(1, Number.isFinite(height) ? Math.floor(height) : 24));
  const lines: string[] = [];
  let focused = 0;
  const add = (text: string) => lines.push(safeExternal(text));
  const item = (index: number, text: string) => {
    if (state.cursor === index) focused = lines.length;
    add(`${state.cursor === index ? ">" : " "} ${text}`);
  };

  add("Forge614 Engram | Control Center");
  add("Default: solo lectura. Navigating never writes data.");

  if (state.notice) add(state.notice);

  if (state.page === "menu") {
    MENU.forEach((label, index) => item(index, label));
  }

  if (state.page === "overview") {
    add(`Storage: ${state.snapshot.storage.initialized ? "initialized" : "not initialized"}`);
    add(`Projects: ${state.snapshot.projects.length}`);
    add(`Shared: ${state.snapshot.shared ? `${state.snapshot.shared.active} active, ${state.snapshot.shared.archived} archived` : "unavailable"}`);
    const capabilities = state.snapshot.storage.capabilities;
    if (capabilities) {
      add(`Schema: ${capabilities.schema}`);
      add(`Assistant integration: ${capabilities.assistantIntegration ? "enabled" : "disabled"}`);
      add(`Sessions: ${capabilities.sessions ? "enabled" : "disabled"}`);
      add(`Search reinforcement: ${capabilities.reinforcement ? "enabled" : "disabled"}`);
    }
  }

  if (state.page === "projects") {
    add(state.pendingKind === "rename-project" || state.pendingKind === "bind-directory"
      ? "Choose a project by UUID. Selection alone performs no action."
      : "Projects (names are labels; UUIDs are identity):");
    if (state.snapshot.projects.length === 0) add("No projects.");
    state.snapshot.projects.forEach((project, index) => {
      item(index, `${project.name} | ${project.projectId.slice(0, 8)} | ${project.memories.active} active | ${project.memories.archived} archived`);
    });
  }

  if (state.page === "project-detail") {
    const project = projectForState(state);
    if (!project) {
      add("Project no longer available.");
    } else {
      add(`Project: ${project.name}`);
      add(`UUID: ${project.projectId}`);
      add(`Created: ${project.createdAt}`);
      add(`Updated: ${project.updatedAt}`);
      add(`Memories: ${project.memories.active} active, ${project.memories.archived} archived`);
      add(`Last memory update: ${project.memories.lastUpdatedAt ?? "none"}`);
      add("Bound directories (local metadata):");
      if (project.bindings.length === 0) add("None.");
      project.bindings.forEach(binding => add(binding));
    }
  }

  if (state.page === "shared") {
    add("Shared is one explicit global collection, separate from every project.");
    if (state.snapshot.shared) {
      add(`Active: ${state.snapshot.shared.active}`);
      add(`Archived: ${state.snapshot.shared.archived}`);
      add(`Last update: ${state.snapshot.shared.lastUpdatedAt ?? "none"}`);
    } else add("Shared summary unavailable.");
  }

  if (state.page === "storage") {
    add(`Local database: ${state.snapshot.storage.initialized ? "initialized" : "not initialized"}`);
    const path = state.snapshot.storage.databasePath;
    add(`SQLite path: ${path && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path : path ? "[URL omitted]" : "unavailable"}`);
    const capabilities = state.snapshot.storage.capabilities;
    if (capabilities) {
      add(`Schema: ${capabilities.schema}`);
      add(`Assistant integration: ${capabilities.assistantIntegration ? "enabled" : "disabled"}`);
      add(`Sessions: ${capabilities.sessions ? "enabled" : "disabled"}`);
      add(`Search reinforcement: ${capabilities.reinforcement ? "enabled" : "disabled"}`);
    } else add("Capabilities: unavailable until setup or init.");
    add(`PostgreSQL: ${state.snapshot.storage.postgres === "configured" ? "configured (URL hidden; connectivity not tested)" : "not configured"}`);
  }

  if (state.page === "actions") {
    add("Actions are explicit and require final confirmation.");
    if (!state.snapshot.storage.initialized) add("Run setup or init first; this screen creates nothing.");
    else if (state.actionKinds.length === 0) add("No actions are currently available.");
    state.actionKinds.forEach((kind, index) => {
      item(index, ACTION_LABELS[kind]);
      const targetSchema = CAPABILITY_TARGET_SCHEMA[kind];
      if (targetSchema) add(`  Preview: target schema ${targetSchema}.`);
      if (kind === "sync-now") add("  Preview: does not promote format and does not start a background service.");
    });
    if (state.actionKinds.some(kind => CAPABILITY_TARGET_SCHEMA[kind])) {
      add("Existing memories are preserved by capability migrations.");
      add("No downgrade is offered.");
    }
    add("No format promotion or background sync-watch is offered here.");
  }

  if (state.page === "input") {
    const label = state.pendingKind === "create-project" ? "Project name"
      : state.pendingKind === "rename-project" ? "New project name"
      : "Absolute directory";
    add(`${label}:`);
    add("[entrada oculta durante escritura]");
    if (state.selectedProjectId) add(`Project UUID: ${state.selectedProjectId}`);
    add("Enter validates. Escape discards this input.");
  }

  if (state.page === "confirm") {
    add("Preview: this action aun no se ha ejecutado.");
    if (state.pendingIntent) {
      add(`Action: ${state.pendingIntent.kind === "open-assistants" ? "Assistants" : ACTION_LABELS[state.pendingIntent.kind]}`);
      intentSummary(state.pendingIntent).forEach(add);
    }
    add('Type "confirm" (case-insensitive), then press Enter. Escape cancels.');
    add("Enter alone never authorizes a mutation.");
  }

  if (state.page === "result") {
    add(state.result || "Waiting for the requested operation to finish.");
    add("Enter returns to the menu. No operation is repeated from this page.");
  }

  const footer = state.page === "confirm"
    ? "Type confirm + Enter | Esc cancel | Ctrl+C cancel session"
    : state.page === "input"
      ? "Type value | Enter validate | Backspace | Esc cancel | Ctrl+C"
      : state.page === "menu" || state.page === "projects" || state.page === "actions"
        ? "Arrows navigate | Enter open | PgUp/PgDn read | Esc back | Ctrl+C"
        : "Arrows/PgUp/PgDn read | Enter continue | Esc back | Ctrl+C";

  const wrapped: string[] = [];
  let focusRow = 0;
  for (const [index, line] of lines.entries()) {
    if (index === focused) focusRow = wrapped.length;
    const characters = Array.from(line);
    for (let offset = 0; offset < Math.max(characters.length, 1); offset += columns) {
      wrapped.push(characters.slice(offset, offset + columns).join(""));
    }
  }
  const bodyRows = Math.max(0, rows - 1);
  const navigable = state.page === "menu" || state.page === "projects" || state.page === "actions";
  const desiredOffset = navigable && state.scroll === 0 ? Math.max(0, focusRow - bodyRows + 1) : state.scroll;
  const offset = Math.min(desiredOffset, Math.max(0, wrapped.length - bodyRows));
  const safeFooter = Array.from(safeExternal(footer)).slice(0, columns).join("");
  return [...wrapped.slice(offset, offset + bodyRows), safeFooter].join("\n");
}
