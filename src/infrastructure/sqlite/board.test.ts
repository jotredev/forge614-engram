import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { demoteMemory, groupSource, setGroupSource } from "./board";
import { bindProjectToGroup, createGroup, identityEvents } from "./ecosystem-groups";
import { get, history } from "./memory";
import { createProject } from "./projects";
import { enableEcosystem, enableIntelligence, enableProjectBindings } from "./schema";
import { getVersion } from "./search";
import { archive, moveMemoryToGroup, save } from "./writes";

type Board = { group: string; ai: string; engram: string; shell: string; loose: string };
function board(run: (db: Database, x: Board) => void): void {
  withDatabase(db => {
    enableIntelligence(db);
    const ai = createProject(db, "forge614-ai").projectId, engram = createProject(db, "forge614-engram").projectId;
    const shell = createProject(db, "forge614-shell").projectId, loose = createProject(db, "suelto").projectId;
    const group = createGroup(db, "forge614").id;
    for (const project of [ai, engram, shell]) bindProjectToGroup(db, project, group, "command");
    run(db, { group, ai, engram, shell, loose });
  });
}
const rule = (group: string, extra: Record<string, unknown> = {}) => ({ scope: "ecosystem" as const, projectId: null, groupId: group,
  title: "Contrato de API", content: "Los nodos hablan JSON versionado.", type: "decision" as const, topicKey: "api",
  affects: ["forge614-engram", "forge614-shell"], ...extra });
const status = (group: string, extra: Record<string, unknown> = {}) => ({ scope: "ecosystem" as const, projectId: null, groupId: group,
  title: "Estado actual", content: "Frente: Engram 1.7.0; paso: T4.", type: "fact" as const, topicKey: "ecosystem/estado-actual", ...extra });
const code = (value: string) => expect.objectContaining({ code: value });

test("below level 11 the board keeps the 1.6.0 behavior and the new operations need intelligence", () => withDatabase(db => {
  enableProjectBindings(db); enableEcosystem(db);
  const project = createProject(db, "tienda-web").projectId, group = createGroup(db, "tienda").id;
  bindProjectToGroup(db, project, group, "command");
  const saved = save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Nota", content: "libre", type: "fact", fromProjectId: project });
  expect(saved.type).toBe("fact");
  expect(() => setGroupSource(db, group, project)).toThrow(code("INTELLIGENCE_REQUIRED"));
  expect(() => demoteMemory(db, project, saved.id)).toThrow(code("INTELLIGENCE_REQUIRED"));
}));

test("a board memory needs an allowed type and at least two affected projects of the group", () => board((db, { group }) => {
  expect(() => save(db, rule(group, { type: "fact", affects: undefined }))).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  expect(() => save(db, rule(group, { affects: undefined }))).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  expect(() => save(db, rule(group, { affects: ["forge614-engram"] }))).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  expect(() => save(db, rule(group, { affects: ["forge614-engram", "suelto"] }))).toThrow(code("ECOSYSTEM_AFFECTS_UNKNOWN"));
  const saved = save(db, rule(group, { affects: [" forge614-shell", "forge614-engram"] }));
  expect(getVersion(db, { groupId: group }, saved.id)?.meta?.affects).toEqual(["forge614-engram", "forge614-shell"]);
  // A new version may omit affects: the stored ones still count.
  expect(save(db, rule(group, { content: "v2", expectedVersion: 1, affects: undefined })).version).toBe(2);
}));

test("the board holds at most 40 active memories, with or without a topic; updates, archived ones and the status note do not count", () => board((db, { group, ai }) => {
  const ids = Array.from({ length: 40 }, (_, i) => save(db, rule(group, { title: `Regla ${i}`, content: `Contenido ${i}`, topicKey: i === 0 ? undefined : `regla/${i}` })).id);
  let error: unknown;
  try { save(db, rule(group, { title: "Regla 40", content: "otra", topicKey: "regla/40" })); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: "ECOSYSTEM_BOARD_FULL" });
  expect((error as Error).message).toContain("Regla 0");
  expect(save(db, rule(group, { title: "Regla 1", content: "cambiada", topicKey: "regla/1", expectedVersion: 1 })).version).toBe(2);
  setGroupSource(db, group, ai);
  expect(save(db, status(group, { fromProjectId: ai })).pinned).toBe(true);
  archive(db, { groupId: group }, ids[1]!);
  expect(save(db, rule(group, { title: "Regla 40", content: "otra", topicKey: "regla/40" })).scope).toBe("ecosystem");
}));

test("only the group's source project writes the status note: pinned, up to 600 characters, facts allowed", () => board((db, { group, ai, engram }) => {
  expect(() => save(db, status(group, { fromProjectId: ai }))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(setGroupSource(db, group, ai)).toEqual({ groupId: group, projectId: ai, setAt: expect.any(String) });
  expect(() => save(db, status(group, { fromProjectId: engram }))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(() => save(db, status(group))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(() => save(db, status(group, { fromProjectId: ai, type: "preference" }))).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  expect(() => save(db, status(group, { fromProjectId: ai, content: "x".repeat(601) }))).toThrow(code("ECOSYSTEM_STATUS_TOO_LONG"));
  const saved = save(db, status(group, { fromProjectId: ai, content: "é".repeat(600), requestKey: "estado-1" }));
  expect(saved).toMatchObject({ scope: "ecosystem", topicKey: "ecosystem/estado-actual", type: "fact", pinned: true });
  // Replaying the same request returns the same memory: pinned is forced before the request fingerprint.
  expect(save(db, status(group, { fromProjectId: ai, content: "é".repeat(600), requestKey: "estado-1" })).id).toBe(saved.id);
  expect(groupSource(db, group)?.projectId).toBe(ai);
}));

test("the group source must be a member of the group; setting it again replaces it and is recorded", () => board((db, { group, ai, engram, loose }) => {
  expect(() => setGroupSource(db, group, loose)).toThrow(code("GROUP_REQUIRED"));
  expect(() => setGroupSource(db, group, crypto.randomUUID())).toThrow(code("PROJECT_NOT_FOUND"));
  expect(() => setGroupSource(db, crypto.randomUUID(), ai)).toThrow(code("GROUP_NOT_FOUND"));
  expect(groupSource(db, group)).toBeNull();
  setGroupSource(db, group, ai);
  expect(setGroupSource(db, group, engram).projectId).toBe(engram);
  expect(groupSource(db, group)?.projectId).toBe(engram);
  expect(identityEvents(db).filter(event => event.action === "GROUP_SOURCE_SET")).toHaveLength(2);
}));

test("demoting returns a board memory to a member project and keeps its id, history and metadata", () => board((db, { group, engram, loose }) => {
  const first = save(db, rule(group));
  save(db, rule(group, { content: "v2", expectedVersion: 1 }));
  expect(() => demoteMemory(db, loose, first.id)).toThrow(code("GROUP_REQUIRED"));
  const demoted = demoteMemory(db, engram, first.id);
  expect(demoted.from).toEqual({ scope: "ecosystem", groupId: group });
  expect(demoted.to).toEqual({ scope: "project", projectId: engram });
  expect(demoted.memory).toMatchObject({ id: first.id, scope: "project", projectId: engram, version: 3, content: "v2", state: "active" });
  expect(history(db, engram, first.id).map(version => [version.version, version.scope])).toEqual([[1, "ecosystem"], [2, "ecosystem"], [3, "project"]]);
  expect(get(db, { groupId: group }, first.id)).toBeNull();
  expect(getVersion(db, engram, first.id)?.meta?.affects).toEqual(["forge614-engram", "forge614-shell"]);
  expect(identityEvents(db).some(event => event.action === "MEMORY_DEMOTED" && event.memoryId === first.id)).toBe(true);
  expect(() => demoteMemory(db, engram, first.id)).toThrow(code("NOT_FOUND"));
  const again = save(db, rule(group, { title: "Otro contrato", content: "otro" }));
  expect(() => demoteMemory(db, engram, again.id)).toThrow(code("TOPIC_CONFLICT"));
}));

test("moving a memory onto the board obeys the same rules at level 11", () => board((db, { group, engram }) => {
  const fact = save(db, { scope: "project", projectId: engram, title: "Hecho", content: "algo", type: "fact" });
  expect(() => moveMemoryToGroup(db, engram, fact.id, group)).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  const decision = { scope: "project" as const, projectId: engram, title: "Decisión", content: "usar JSON", type: "decision" as const, topicKey: "d" };
  const bare = save(db, decision);
  expect(() => moveMemoryToGroup(db, engram, bare.id, group)).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  save(db, { ...decision, expectedVersion: 1, affects: ["forge614-engram", "forge614-shell"] });
  expect(moveMemoryToGroup(db, engram, bare.id, group).memory.scope).toBe("ecosystem");
  const note = save(db, { scope: "project", projectId: engram, title: "Estado", content: "x", type: "fact", topicKey: "ecosystem/estado-actual" });
  expect(() => moveMemoryToGroup(db, engram, note.id, group)).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
}));
