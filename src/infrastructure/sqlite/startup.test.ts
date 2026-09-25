import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { setGroupSource } from "./board";
import { bindProjectToGroup, createGroup } from "./ecosystem-groups";
import { createProject } from "./projects";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { startupBlock } from "./startup";
import { save, saveSessionSummary, startSession } from "./writes";

const section = (text: string, heading: string) => text.split("\n\n").find(part => part.startsWith(heading)) ?? "";
const lines = (text: string, heading: string) => section(text, heading).split("\n").slice(1);
const fields = { goal: "Build T6", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] };

test("at level 11 the block orders essentials, uses short versions, reports the interrupted session and indexes only live titles", () => withDatabase(db => {
  enableIntelligence(db);
  const ai = createProject(db, "forge614-ai").projectId, engram = createProject(db, "forge614-engram").projectId;
  const other = createProject(db, "other").projectId, group = createGroup(db, "forge614").id;
  for (const project of [ai, engram]) bindProjectToGroup(db, project, group, "command");
  setGroupSource(db, group, ai);
  const boardNote = save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Board note", content: "Unpinned board rule.", type: "procedure", affects: ["forge614-ai", "forge614-engram"] });
  const status = save(db, { scope: "ecosystem", projectId: null, groupId: group, fromProjectId: ai, title: "Current status", content: "Front: T6.", type: "fact", topicKey: "ecosystem/estado-actual" });
  const rule = save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Board rule", content: "Nodes speak JSON.", type: "decision", pinned: true, affects: ["forge614-ai", "forge614-engram"] });
  const critical = save(db, { scope: "shared", projectId: null, title: "Critical rule with a long title", content: "Every command starts with rtk.", type: "preference", pinned: true, short: "Prefix every command with rtk." });
  save(db, { scope: "shared", projectId: null, title: "Shared language", content: "Spanish", type: "preference", pinned: true, topicKey: "user/language" });
  const language = save(db, { scope: "project", projectId: ai, title: "Project language", content: "English here", type: "preference", topicKey: "user/language" });
  save(db, { scope: "shared", projectId: null, title: "Shared unpinned", content: "Not in the index", type: "fact" });
  const pinned = save(db, { scope: "project", projectId: ai, title: "Project pinned", content: "Keep", type: "decision", pinned: true });
  const old = save(db, { scope: "project", projectId: ai, title: "Old note", content: "Replaced", type: "fact" });
  const fresh = save(db, { scope: "project", projectId: ai, title: "New note", content: "Replaces the old one", type: "fact", supersedes: old.id });
  save(db, { scope: "project", projectId: other, title: "Other project note", content: "Elsewhere", type: "fact" });
  // Saves in the same millisecond tie on updated_at (then id decides): make the project order explicit.
  db.run("UPDATE memories SET updated_at=? WHERE id=?", ["2026-01-01T00:00:00.000Z", language.id]);
  startSession(db, ai, "first", "/ai");
  const summary = saveSessionSummary(db, ai, "first", fields, { requestKey: "summary-1" });
  startSession(db, ai, "second", "/ai");

  const block = startupBlock(db, ai);

  expect(lines(block.text, "## Essentials")).toEqual([
    `- Prefix every command with rtk. · personal · ${critical.id}`,
    `- Current status · board · ${status.id}`,
    `- Board rule · board · ${rule.id}`,
    `- Project pinned · project · ${pinned.id}`,
  ]);
  expect(section(block.text, "## Previous session")).toStartWith(
    `## Previous session (interrupted)\nSession first was interrupted at `);
  expect(section(block.text, "## Previous session")).toContain(`its last summary (${summary.memory.id} v${summary.memory.version}):\n`);
  // The board note is the oldest memory, yet it leads the index: board and project titles alternate.
  expect(lines(block.text, "## Index")).toEqual([
    `- Board note · board · ${boardNote.id}`,
    `- New note · project · ${fresh.id}`,
    `- Project language · project · ${language.id}`,
  ]);
  expect(block.text.split("\n\n")).toHaveLength(4);
  expect(block).toMatchObject({ format: 2, omitted: 0 });
  expect(block.chars).toBe(Array.from(block.text).length);
}));

test("below level 11 the block uses titles, has no previous session and still reads the project and shared drawers", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const project = createProject(db, "Pre11").projectId;
  const rule = save(db, { scope: "shared", projectId: null, title: "Shared rule", content: "Always", type: "preference", pinned: true });
  const note = save(db, { scope: "project", projectId: project, title: "Project note", content: "Body", type: "fact" });
  startSession(db, project, "a", "/p");
  startSession(db, project, "b", "/p");

  const block = startupBlock(db, project);

  expect(lines(block.text, "## Essentials")).toEqual([`- Shared rule · personal · ${rule.id}`]);
  expect(section(block.text, "## Previous session")).toBe("");
  expect(lines(block.text, "## Index")).toEqual([`- Project note · project · ${note.id}`]);
  expect(block.sections.previous).toBe(0);
}));

test("an unbound directory gets the shared essentials only, and the header counts every title left out", () => withDatabase(db => {
  enableIntelligence(db);
  for (let n = 0; n < 60; n++) save(db, { scope: "shared", projectId: null, title: `Shared rule ${n} ${"x".repeat(60)}`, content: "Body", type: "preference", pinned: true });

  const block = startupBlock(db, null);

  expect(section(block.text, "## Index")).toBe("");
  expect(block.sections.essentials).toBeLessThanOrEqual(1500);
  expect(block.omitted).toBe(60 - lines(block.text, "## Essentials").length);
  expect(block.text.split("\n")[1]).toBe(`${block.chars}/5000 chars · ${block.omitted} titles did not fit: find them with memory_search.`);
}));
