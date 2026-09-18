import { describe, expect, test } from "bun:test";
import type { ControlCenterSnapshot } from "../../modules/control-center";
import { ControlCenterSession, type ControlCenterState } from "./control-center-state";
import { renderControlCenterScreen } from "./control-center-render";

const projectId = "12345678-1234-4234-8234-123456789abc";

function snapshot(): ControlCenterSnapshot {
  return {
    storage: {
      initialized: true,
      databasePath: "/safe/engram.db",
      capabilities: { schema: 6, assistantIntegration: true, sessions: true, reinforcement: false },
      postgres: "configured",
    },
    projects: [{
      projectId,
      name: "Renderer project",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      bindings: ["/safe/project"],
      memories: { active: 2, archived: 1, lastUpdatedAt: "2026-09-02T00:00:00.000Z" },
    }],
    shared: { active: 3, archived: 4, lastUpdatedAt: "2026-09-03T00:00:00.000Z" },
  };
}

function detailState(value = snapshot()): ControlCenterState {
  const session = new ControlCenterSession(value);
  session.key("down");
  session.key("enter");
  session.key("enter");
  return session.state;
}

describe("bounded control-center rendering", () => {
  test.each([[18, 5], [1, 1]] as const)("fits a %ix%i viewport and always retains a footer", (width, height) => {
    const text = renderControlCenterScreen(new ControlCenterSession(snapshot()).state, width, height);
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(height);
    expect(lines.every(line => Array.from(line).length <= width)).toBe(true);
    expect(lines.at(-1)?.length).toBeGreaterThan(0);
  });

  test("clamps oversized and invalid dimensions", () => {
    const state = new ControlCenterSession(snapshot()).state;
    const oversized = renderControlCenterScreen(state, 1000, 1000).split("\n");
    expect(oversized.length).toBeLessThanOrEqual(200);
    expect(oversized.every(line => Array.from(line).length <= 240)).toBe(true);
    const invalid = renderControlCenterScreen(state, 0, 0).split("\n");
    expect(invalid).toHaveLength(1);
    expect(Array.from(invalid[0] ?? "")).toHaveLength(1);
  });
});

test("never renders snapshot-only secret fields, memory content, or a PostgreSQL URL", () => {
  const unsafe = snapshot() as ControlCenterSnapshot & {
    postgresUrl: string;
    title: string;
    content: string;
  };
  unsafe.postgresUrl = "_postgresql://user:SECRET_PASSWORD@example.invalid/db";
  unsafe.title = "SECRET_MEMORY_TITLE";
  unsafe.content = "SECRET_MEMORY_CONTENT";
  unsafe.storage.databasePath = unsafe.postgresUrl;
  unsafe.projects[0]!.name = "7postgresql://user:DIGIT_SECRET@example.invalid/db";

  const storage = new ControlCenterSession(unsafe);
  for (let index = 0; index < 3; index += 1) storage.key("down");
  storage.key("enter");
  const text = renderControlCenterScreen(storage.state, 120, 40)
    + renderControlCenterScreen(detailState(unsafe), 120, 40);
  expect(text).not.toContain("SECRET_PASSWORD");
  expect(text).not.toContain("DIGIT_SECRET");
  expect(text).not.toContain("SECRET_MEMORY_TITLE");
  expect(text).not.toContain("SECRET_MEMORY_CONTENT");
  expect(text).not.toContain("postgresql://");
});

test("sanitizes ANSI, bidi, zero-width, controls, and every non-ASCII display cell", () => {
  const unsafe = snapshot();
  unsafe.projects[0]!.name = "unsafe\x1b[31m\u202e\u200bEspañol😀";
  unsafe.projects[0]!.bindings = ["/tmp/line\nnext\u2066é"];
  const text = renderControlCenterScreen(detailState(unsafe), 120, 40);
  expect(text).toContain("unsafe?[31m??Espa?ol?");
  expect(text).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
  expect(Array.from(text).every(character => character === "\n" || character.codePointAt(0)! <= 0x7f)).toBe(true);
});

test("project lists abbreviate UUIDs while detail renders the full UUID", () => {
  const session = new ControlCenterSession(snapshot());
  session.key("down");
  session.key("enter");
  const list = renderControlCenterScreen(session.state, 120, 40);
  expect(list).toContain("12345678");
  expect(list).not.toContain(projectId);
  session.key("enter");
  const detail = renderControlCenterScreen(session.state, 120, 40);
  expect(detail).toContain(projectId);
  expect(detail).toContain("/safe/project");
});

test("list and detail pages never echo unrelated raw typed input", () => {
  const listState: ControlCenterState = {
    ...new ControlCenterSession(snapshot()).state,
    page: "projects",
    input: "RAW_TYPED_CREDENTIAL",
  };
  const detail: ControlCenterState = { ...detailState(), input: "RAW_TYPED_CREDENTIAL" };
  expect(renderControlCenterScreen(listState, 120, 40)).not.toContain("RAW_TYPED_CREDENTIAL");
  expect(renderControlCenterScreen(detail, 120, 40)).not.toContain("RAW_TYPED_CREDENTIAL");
});

test("read-only and confirmation labels explain that navigation does not write", () => {
  const menu = renderControlCenterScreen(new ControlCenterSession(snapshot()).state, 120, 40);
  expect(menu).toContain("solo lectura");

  const session = new ControlCenterSession(snapshot());
  session.openAction("enable-reinforcement");
  const confirmation = renderControlCenterScreen(session.state, 120, 40);
  expect(confirmation).toContain("confirm");
  expect(confirmation).toContain("aun no se ha ejecutado");
  expect(confirmation.split("\n").at(-1)).toContain("Esc");
});

test("Actions previews capability target schemas, preservation, and no downgrade", () => {
  const value = snapshot();
  value.storage.capabilities = { schema: 3, assistantIntegration: false, sessions: false, reinforcement: false };
  const session = new ControlCenterSession(value);
  for (let index = 0; index < 4; index += 1) session.key("down");
  session.key("enter");
  const text = renderControlCenterScreen(session.state, 120, 60);
  expect(text).toContain("schema 5");
  expect(text).toContain("schema 6");
  expect(text).toContain("schema 7");
  expect(text).toContain("Existing memories are preserved");
  expect(text).toContain("No downgrade is offered");
});

test.each([
  ["enable-integration", 5],
  ["enable-sessions", 6],
  ["enable-reinforcement", 7],
] as const)("%s confirmation previews schema %i and migration consequences", (kind, schema) => {
  const value = snapshot();
  value.storage.capabilities = { schema: 3, assistantIntegration: false, sessions: false, reinforcement: false };
  const session = new ControlCenterSession(value);
  session.openAction(kind);
  const text = renderControlCenterScreen(session.state, 120, 40);
  expect(text).toContain(`Target schema: ${schema}`);
  expect(text).toContain("Existing memories are preserved");
  expect(text).toContain("No downgrade is offered");
});

test("sync confirmation promises neither format promotion nor a background service", () => {
  const session = new ControlCenterSession(snapshot());
  session.openAction("sync-now");
  const text = renderControlCenterScreen(session.state, 120, 40);
  expect(text).toContain("does not promote format");
  expect(text).toContain("does not start a background service");
});
