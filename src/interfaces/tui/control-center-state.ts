import type { ControlCenterMutation, ControlCenterSnapshot } from "../../modules/control-center";

export type ControlCenterIntent =
  | ControlCenterMutation
  | { kind: "open-assistants" };

export type ControlCenterPage =
  | "menu"
  | "overview"
  | "projects"
  | "project-detail"
  | "shared"
  | "storage"
  | "actions"
  | "input"
  | "confirm"
  | "result";

export type ControlCenterActionKind = Exclude<ControlCenterIntent["kind"], "open-assistants">;

export type ControlCenterState = {
  readonly snapshot: ControlCenterSnapshot;
  readonly page: ControlCenterPage;
  readonly cursor: number;
  readonly scroll: number;
  readonly selectedProjectId: string | null;
  readonly actionKinds: readonly ControlCenterActionKind[];
  readonly pendingKind: ControlCenterActionKind | null;
  readonly pendingIntent: ControlCenterIntent | null;
  readonly input: string;
  readonly notice: string;
  readonly result: string;
  readonly intent: ControlCenterIntent | null;
  readonly done: boolean;
  readonly cancelled: boolean;
};

const MENU_SIZE = 7;
const MAX_INPUT_LENGTH = 4096;

function availableActions(snapshot: ControlCenterSnapshot): readonly ControlCenterActionKind[] {
  if (!snapshot.storage.initialized) return [];
  const actions: ControlCenterActionKind[] = ["create-project"];
  if (snapshot.projects.length > 0) actions.push("rename-project", "bind-directory");
  const capabilities = snapshot.storage.capabilities;
  if (capabilities && !capabilities.assistantIntegration) actions.push("enable-integration");
  if (capabilities && !capabilities.sessions) actions.push("enable-sessions");
  if (capabilities && !capabilities.reinforcement) actions.push("enable-reinforcement");
  if (snapshot.storage.postgres === "configured") actions.push("sync-now");
  return actions;
}

function initialState(snapshot: ControlCenterSnapshot): ControlCenterState {
  return {
    snapshot,
    page: "menu",
    cursor: 0,
    scroll: 0,
    selectedProjectId: null,
    actionKinds: availableActions(snapshot),
    pendingKind: null,
    pendingIntent: null,
    input: "",
    notice: "",
    result: "",
    intent: null,
    done: false,
    cancelled: false,
  };
}

function isAbsoluteDirectory(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function isTextKey(name: string): boolean {
  return Array.from(name).length === 1 && !/[\x00-\x1f\x7f-\x9f]/.test(name);
}

/** Pure keyboard state. It never opens storage, touches files, or performs an intent. */
export class ControlCenterSession {
  private current: ControlCenterState;

  constructor(snapshot: ControlCenterSnapshot) {
    this.current = initialState(snapshot);
  }

  get state(): ControlCenterState {
    return this.current;
  }

  key(name: string): void {
    if (this.current.done) return;
    if (name === "cancel") {
      this.current = {
        ...this.current,
        done: true,
        cancelled: true,
        input: "",
        notice: "",
        pendingKind: null,
        pendingIntent: null,
        intent: null,
      };
      return;
    }
    if (name === "escape") {
      this.escape();
      return;
    }
    if (name === "pageup" || name === "pagedown") {
      this.current = {
        ...this.current,
        scroll: Math.max(0, this.current.scroll + (name === "pagedown" ? 5 : -5)),
      };
      return;
    }
    if (this.current.page === "input" || this.current.page === "confirm") {
      this.inputKey(name);
      return;
    }
    if (name === "up" || name === "down") {
      this.move(name === "down" ? 1 : -1);
      return;
    }
    if (name !== "enter") return;
    this.enter();
  }

  openAction(kind: ControlCenterIntent["kind"]): void {
    if (this.current.done) return;
    if (kind === "open-assistants") {
      this.current = {
        ...this.current,
        page: "result",
        cursor: 0,
        scroll: 0,
        input: "",
        notice: "",
        result: "",
        pendingKind: null,
        pendingIntent: null,
        intent: { kind },
      };
      return;
    }
    if (!this.current.actionKinds.includes(kind)) return;
    const common = {
      cursor: 0,
      scroll: 0,
      input: "",
      notice: "",
      result: "",
      intent: null,
      pendingKind: kind,
      pendingIntent: null,
    } as const;
    if (kind === "rename-project" || kind === "bind-directory") {
      this.current = { ...this.current, ...common, page: "projects", selectedProjectId: null };
      return;
    }
    if (kind === "create-project") {
      this.current = { ...this.current, ...common, page: "input" };
      return;
    }
    this.current = { ...this.current, ...common, page: "confirm", pendingIntent: { kind } };
  }

  consumeConfirmation(): ControlCenterIntent | null {
    const intent = this.current.intent;
    if (!intent) return null;
    this.current = { ...this.current, intent: null };
    return intent;
  }

  setResult(message: string): void {
    this.current = {
      ...this.current,
      page: "result",
      cursor: 0,
      scroll: 0,
      input: "",
      notice: "",
      result: message,
      pendingKind: null,
      pendingIntent: null,
      intent: null,
    };
  }

  refresh(snapshot: ControlCenterSnapshot): void {
    const selectedProjectId = this.current.selectedProjectId &&
      snapshot.projects.some(project => project.projectId === this.current.selectedProjectId)
      ? this.current.selectedProjectId
      : null;
    const actionKinds = availableActions(snapshot);
    const selectedProjectDisappeared = this.current.selectedProjectId !== null && selectedProjectId === null;
    const projectIntentKind = this.current.pendingIntent?.kind ?? this.current.intent?.kind;
    const invalidProjectFlow = selectedProjectDisappeared && (
      this.current.pendingKind === "rename-project" ||
      this.current.pendingKind === "bind-directory" ||
      projectIntentKind === "rename-project" ||
      projectIntentKind === "bind-directory"
    );
    const pendingStillAvailable = !invalidProjectFlow && this.current.pendingKind !== null && actionKinds.includes(this.current.pendingKind);
    const losesProject = this.current.page === "project-detail" && selectedProjectId === null;
    const cursor = invalidProjectFlow ? 0
      : this.current.page === "projects" ? Math.min(this.current.cursor, Math.max(0, snapshot.projects.length - 1))
      : this.current.page === "actions" ? Math.min(this.current.cursor, Math.max(0, actionKinds.length - 1))
      : this.current.cursor;
    this.current = {
      ...this.current,
      snapshot,
      actionKinds,
      selectedProjectId,
      page: invalidProjectFlow ? "actions" : losesProject ? "projects" : this.current.page,
      pendingKind: pendingStillAvailable ? this.current.pendingKind : null,
      pendingIntent: pendingStillAvailable ? this.current.pendingIntent : null,
      input: pendingStillAvailable ? this.current.input : "",
      notice: pendingStillAvailable ? this.current.notice : "",
      result: invalidProjectFlow ? "" : this.current.result,
      intent: null,
      cursor,
    };
  }

  private escape(): void {
    const { page, pendingKind } = this.current;
    let nextPage: ControlCenterPage = "menu";
    if (page === "project-detail") nextPage = "projects";
    else if (page === "input" || page === "confirm" || page === "result" || (page === "projects" && pendingKind)) nextPage = "actions";
    else if (page === "menu") nextPage = "menu";
    this.current = {
      ...this.current,
      page: nextPage,
      cursor: page === "project-detail" ? this.current.cursor : 0,
      scroll: 0,
      input: "",
      notice: "",
      result: "",
      pendingKind: null,
      pendingIntent: null,
      intent: null,
    };
  }

  private inputKey(name: string): void {
    if (name === "backspace") {
      this.current = { ...this.current, input: Array.from(this.current.input).slice(0, -1).join(""), notice: "" };
      return;
    }
    if (name === "enter") {
      if (this.current.page === "input") this.finishInput();
      else this.finishConfirmation();
      return;
    }
    const character = name === "space" ? " " : isTextKey(name) ? name : null;
    if (character === null || this.current.input.length + character.length > MAX_INPUT_LENGTH) return;
    this.current = { ...this.current, input: this.current.input + character, notice: "" };
  }

  private finishInput(): void {
    const value = this.current.input.trim();
    const kind = this.current.pendingKind;
    if (!kind || value.length === 0 || value.includes("\0")) {
      this.current = { ...this.current, notice: "La entrada no puede estar vacía ni contener NUL." };
      return;
    }
    if (kind === "bind-directory" && !isAbsoluteDirectory(value)) {
      this.current = { ...this.current, notice: "El directorio debe ser una ruta absoluta." };
      return;
    }
    let pendingIntent: ControlCenterIntent | null = null;
    if (kind === "create-project") pendingIntent = { kind, name: value };
    else if (kind === "rename-project" && this.current.selectedProjectId) {
      pendingIntent = { kind, projectId: this.current.selectedProjectId, name: value };
    } else if (kind === "bind-directory" && this.current.selectedProjectId) {
      pendingIntent = { kind, projectId: this.current.selectedProjectId, directory: value };
    }
    if (!pendingIntent) {
      this.current = { ...this.current, notice: "Selecciona un proyecto por UUID antes de continuar." };
      return;
    }
    this.current = { ...this.current, page: "confirm", scroll: 0, input: "", notice: "", pendingIntent };
  }

  private finishConfirmation(): void {
    if (this.current.input.trim().toLowerCase() !== "confirm") {
      this.current = { ...this.current, input: "", notice: "Escribe confirm para autorizar esta operación." };
      return;
    }
    const intent = this.current.pendingIntent;
    if (!intent) return;
    this.current = {
      ...this.current,
      page: "result",
      scroll: 0,
      input: "",
      notice: "",
      result: "",
      pendingKind: null,
      pendingIntent: null,
      intent,
    };
  }

  private move(direction: 1 | -1): void {
    const page = this.current.page;
    if (page === "menu") {
      this.current = { ...this.current, cursor: (this.current.cursor + direction + MENU_SIZE) % MENU_SIZE, scroll: 0 };
      return;
    }
    if (page === "actions") {
      const size = this.current.actionKinds.length;
      if (size > 0) this.current = { ...this.current, cursor: (this.current.cursor + direction + size) % size, scroll: 0 };
      return;
    }
    if (page === "projects") {
      const size = this.current.snapshot.projects.length;
      if (size > 0) this.current = { ...this.current, cursor: (this.current.cursor + direction + size) % size, scroll: 0 };
      return;
    }
    this.current = { ...this.current, scroll: Math.max(0, this.current.scroll + direction) };
  }

  private enter(): void {
    if (this.current.page === "menu") {
      const pages: readonly ControlCenterPage[] = ["overview", "projects", "shared", "storage", "actions"];
      const page = pages[this.current.cursor];
      if (page) {
        this.current = { ...this.current, page, cursor: 0, scroll: 0, notice: "" };
      } else if (this.current.cursor === 5) {
        this.openAction("open-assistants");
      } else if (this.current.cursor === 6) {
        this.current = { ...this.current, done: true, cancelled: false };
      }
      return;
    }
    if (this.current.page === "actions") {
      const kind = this.current.actionKinds[this.current.cursor];
      if (kind) this.openAction(kind);
      return;
    }
    if (this.current.page === "projects") {
      const project = this.current.snapshot.projects[this.current.cursor];
      if (!project) return;
      if (this.current.pendingKind === "rename-project" || this.current.pendingKind === "bind-directory") {
        this.current = {
          ...this.current,
          page: "input",
          cursor: 0,
          scroll: 0,
          selectedProjectId: project.projectId,
          input: "",
          notice: "",
        };
      } else {
        this.current = { ...this.current, page: "project-detail", selectedProjectId: project.projectId, scroll: 0 };
      }
      return;
    }
    if (this.current.page === "result") {
      this.current = { ...this.current, page: "menu", cursor: 0, scroll: 0, result: "", notice: "" };
    }
  }
}
