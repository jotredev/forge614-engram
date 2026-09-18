import { describe, expect, test } from "bun:test";
import type { ControlCenterSnapshot } from "../../modules/control-center";
import { ControlCenterSession, type ControlCenterIntent } from "./control-center-state";

const firstProject = {
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "Duplicate",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  bindings: ["/work/first"],
  memories: { active: 2, archived: 1, lastUpdatedAt: "2026-09-02T00:00:00.000Z" },
};

const secondProject = {
  ...firstProject,
  projectId: "22222222-2222-4222-8222-222222222222",
  bindings: ["/work/second"],
};

function snapshot(overrides: Partial<ControlCenterSnapshot> = {}): ControlCenterSnapshot {
  return {
    storage: {
      initialized: true,
      databasePath: "/safe/engram.db",
      capabilities: { schema: 3, assistantIntegration: false, sessions: false, reinforcement: false },
      postgres: "not-configured",
    },
    projects: [firstProject, secondProject],
    shared: { active: 3, archived: 4, lastUpdatedAt: "2026-09-03T00:00:00.000Z" },
    ...overrides,
  };
}

function type(session: ControlCenterSession, value: string): void {
  for (const character of value) session.key(character === " " ? "space" : character);
}

function confirm(session: ControlCenterSession): ControlCenterIntent | null {
  type(session, "CoNfIrM");
  session.key("enter");
  return session.consumeConfirmation();
}

describe("control-center menu navigation", () => {
  test.each([
    [0, "overview"],
    [1, "projects"],
    [2, "shared"],
    [3, "storage"],
    [4, "actions"],
  ] as const)("menu position %i opens %s without emitting an intent", (moves, page) => {
    const session = new ControlCenterSession(snapshot());
    for (let index = 0; index < moves; index += 1) session.key("down");
    session.key("enter");
    expect(session.state.page).toBe(page);
    expect(session.consumeConfirmation()).toBeNull();
    session.key("escape");
    expect(session.state.page).toBe("menu");
  });

  test("Shared and Storage are independent read-only pages", () => {
    const session = new ControlCenterSession(snapshot());
    session.key("down");
    session.key("down");
    session.key("enter");
    expect(session.state.page).toBe("shared");
    session.key("escape");
    for (let index = 0; index < 3; index += 1) session.key("down");
    session.key("enter");
    expect(session.state.page).toBe("storage");
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("unknown keys do not change state", () => {
    const session = new ControlCenterSession(snapshot());
    const before = session.state;
    session.key("f13");
    expect(session.state).toEqual(before);
  });
});

describe("control-center action availability", () => {
  test("shows project actions, only unavailable capabilities, and configured sync", () => {
    const session = new ControlCenterSession(snapshot({
      storage: {
        initialized: true,
        databasePath: "/safe/engram.db",
        capabilities: { schema: 6, assistantIntegration: true, sessions: false, reinforcement: false },
        postgres: "configured",
      },
    }));
    expect(session.state.actionKinds).toEqual([
      "create-project",
      "rename-project",
      "bind-directory",
      "enable-sessions",
      "enable-reinforcement",
      "sync-now",
    ]);
    expect(session.state.actionKinds).not.toContain("enable-integration");
    expect(session.state.actionKinds).not.toContain("sync-upgrade-format");
    expect(session.state.actionKinds).not.toContain("sync-watch");
  });

  test("hides project-specific actions without projects and all mutations when uninitialized", () => {
    const empty = new ControlCenterSession(snapshot({ projects: [] }));
    expect(empty.state.actionKinds).not.toContain("rename-project");
    expect(empty.state.actionKinds).not.toContain("bind-directory");

    const uninitialized = new ControlCenterSession(snapshot({
      storage: { initialized: false, databasePath: null, capabilities: null, postgres: "not-configured" },
      projects: [],
      shared: null,
    }));
    expect(uninitialized.state.actionKinds).toEqual([]);
  });

  test("refresh recalculates capabilities without inventing an action", () => {
    const session = new ControlCenterSession(snapshot());
    session.refresh(snapshot({
      storage: {
        initialized: true,
        databasePath: "/safe/engram.db",
        capabilities: { schema: 7, assistantIntegration: true, sessions: true, reinforcement: true },
        postgres: "not-configured",
      },
    }));
    expect(session.state.actionKinds).toEqual(["create-project", "rename-project", "bind-directory"]);
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("refresh cancels a project draft when its UUID disappears", () => {
    const session = new ControlCenterSession(snapshot());
    session.openAction("rename-project");
    session.key("down");
    session.key("enter");
    type(session, "Orphaned rename");
    session.key("enter");
    expect(session.state.pendingIntent).toEqual({
      kind: "rename-project",
      projectId: secondProject.projectId,
      name: "Orphaned rename",
    });

    session.refresh(snapshot({ projects: [firstProject] }));

    expect(session.state.page).toBe("actions");
    expect(session.state.selectedProjectId).toBeNull();
    expect(session.state.pendingKind).toBeNull();
    expect(session.state.pendingIntent).toBeNull();
    expect(session.state.input).toBe("");
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("refresh clamps the Actions cursor when available actions shrink", () => {
    const session = new ControlCenterSession(snapshot({
      storage: { ...snapshot().storage, postgres: "configured" },
    }));
    for (let index = 0; index < 4; index += 1) session.key("down");
    session.key("enter");
    for (let index = 0; index < 6; index += 1) session.key("down");
    expect(session.state.cursor).toBe(6);

    session.refresh(snapshot({
      storage: {
        ...snapshot().storage,
        capabilities: { schema: 7, assistantIntegration: true, sessions: true, reinforcement: true },
      },
    }));

    expect(session.state.actionKinds).toEqual(["create-project", "rename-project", "bind-directory"]);
    expect(session.state.cursor).toBe(2);
  });
});

describe("control-center confirmed inputs", () => {
  test("Escape clears draft input and returns one page", () => {
    const session = new ControlCenterSession(snapshot());
    session.openAction("create-project");
    type(session, "draft");
    expect(session.state.page).toBe("input");
    expect(session.state.input).toBe("draft");
    session.key("escape");
    expect(session.state.page).toBe("actions");
    expect(session.state.input).toBe("");
    expect(session.state.pendingKind).toBeNull();
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("create rejects blank and NUL input, trims a valid name, and requires typed confirmation", () => {
    const session = new ControlCenterSession(snapshot());
    session.openAction("create-project");
    type(session, "   ");
    session.key("\0");
    session.key("enter");
    expect(session.state.page).toBe("input");
    expect(session.state.notice).not.toBe("");
    expect(session.state.input).not.toContain("\0");
    session.key("escape");

    session.openAction("create-project");
    type(session, "  New project  ");
    session.key("enter");
    expect(session.state.page).toBe("confirm");
    session.key("enter");
    expect(session.consumeConfirmation()).toBeNull();
    expect(confirm(session)).toEqual({ kind: "create-project", name: "New project" });
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("rename selects and retains the exact UUID when names are duplicates", () => {
    const session = new ControlCenterSession(snapshot());
    session.openAction("rename-project");
    expect(session.state.page).toBe("projects");
    session.key("down");
    session.key("enter");
    type(session, "Renamed");
    session.key("enter");
    expect(confirm(session)).toEqual({
      kind: "rename-project",
      projectId: secondProject.projectId,
      name: "Renamed",
    });
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("bind rejects relative and blank paths, then emits an absolute trimmed directory once", () => {
    const session = new ControlCenterSession(snapshot());
    session.openAction("bind-directory");
    session.key("enter");
    type(session, "relative/path");
    session.key("enter");
    expect(session.state.page).toBe("input");
    expect(session.state.notice).not.toBe("");
    for (let index = 0; index < "relative/path".length; index += 1) session.key("backspace");
    type(session, "  /work/new binding  ");
    session.key("enter");
    expect(confirm(session)).toEqual({
      kind: "bind-directory",
      projectId: firstProject.projectId,
      directory: "/work/new binding",
    });
    expect(session.consumeConfirmation()).toBeNull();
  });

  test("capabilities and configured sync require the confirmation phrase", () => {
    for (const kind of ["enable-integration", "enable-sessions", "enable-reinforcement"] as const) {
      const session = new ControlCenterSession(snapshot());
      session.openAction(kind);
      expect(session.state.page).toBe("confirm");
      session.key("enter");
      expect(session.consumeConfirmation()).toBeNull();
      expect(confirm(session)).toEqual({ kind });
      expect(session.consumeConfirmation()).toBeNull();
    }

    const unavailable = new ControlCenterSession(snapshot());
    unavailable.openAction("sync-now");
    expect(unavailable.state.page).toBe("menu");
    expect(unavailable.consumeConfirmation()).toBeNull();

    const configured = new ControlCenterSession(snapshot({
      storage: { ...snapshot().storage, postgres: "configured" },
    }));
    configured.openAction("sync-now");
    expect(configured.state.page).toBe("confirm");
    expect(confirm(configured)).toEqual({ kind: "sync-now" });
  });
});

test("Assistants emits directly, cancel marks the session cancelled, and Exit does not", () => {
  const assistants = new ControlCenterSession(snapshot());
  for (let index = 0; index < 5; index += 1) assistants.key("down");
  assistants.key("enter");
  expect(assistants.consumeConfirmation()).toEqual({ kind: "open-assistants" });
  expect(assistants.consumeConfirmation()).toBeNull();

  const cancelled = new ControlCenterSession(snapshot());
  cancelled.openAction("create-project");
  type(cancelled, "never executed");
  cancelled.key("cancel");
  expect(cancelled.state.done).toBe(true);
  expect(cancelled.state.cancelled).toBe(true);
  expect(cancelled.state.input).toBe("");
  expect(cancelled.consumeConfirmation()).toBeNull();

  const exited = new ControlCenterSession(snapshot());
  for (let index = 0; index < 6; index += 1) exited.key("down");
  exited.key("enter");
  expect(exited.state.done).toBe(true);
  expect(exited.state.cancelled).toBe(false);
});
