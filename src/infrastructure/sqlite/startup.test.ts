/**
 * Prueba `startupBlock`: el bloque de arranque armado a partir de las memorias esenciales (pinned), el
 * índice y la sesión previa interrumpida, en nivel 11, por debajo de nivel 11 y para una carpeta sin proyecto.
 */
import { expect, setSystemTime, test } from "bun:test";
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

// Comprueba, en nivel 11, el orden de esenciales (compartida, ecosistema, proyecto), el uso de `short`
// cuando existe, el aviso de sesión previa dejada abierta, y que el índice solo liste memorias vivas.
test("at level 11 the block orders essentials, uses short versions, reports the previous session left open and indexes only live titles", () => withDatabase(db => { try {
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
  // Los guardados del mismo milisegundo empatan en updated_at (y luego decide el id): se fija el orden del proyecto a mano.
  db.run("UPDATE memories SET updated_at=? WHERE id=?", ["2026-01-01T00:00:00.000Z", language.id]);
  // El reloj se congela recién aquí: si se congelara antes, todos los guardados de arriba empatarían en updated_at.
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  startSession(db, ai, "first", "/ai");
  const summary = saveSessionSummary(db, ai, "first", fields, { requestKey: "summary-1" });
  // "first" debe quedar abierta por más de PARALLEL_MINUTES antes de arrancar "second" para que
  // previousInterrupted la reporte (desde 1.7.1 ya nadie se marca al arrancar la sesión).
  setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
  startSession(db, ai, "second", "/ai");

  const block = startupBlock(db, ai);

  expect(lines(block.text, "## Essentials")).toEqual([
    `- Prefix every command with rtk. · personal · ${critical.id}`,
    `- Current status · board · ${status.id}`,
    `- Board rule · board · ${rule.id}`,
    `- Project pinned · project · ${pinned.id}`,
  ]);
  expect(section(block.text, "## Previous session")).toStartWith(
    `## Previous session (interrupted)\nSession first was left open; its last activity was at `);
  expect(section(block.text, "## Previous session")).toContain(`its last summary (${summary.memory.id} v${summary.memory.version}):\n`);
  // La nota del tablero es la memoria más antigua, pero encabeza el índice: tablero y proyecto alternan sus títulos.
  expect(lines(block.text, "## Index")).toEqual([
    `- Board note · board · ${boardNote.id}`,
    `- New note · project · ${fresh.id}`,
    `- Project language · project · ${language.id}`,
  ]);
  expect(block.text.split("\n\n")).toHaveLength(4);
  expect(block).toMatchObject({ format: 2, omitted: 0 });
  expect(block.chars).toBe(Array.from(block.text).length);
} finally { setSystemTime(); } }));

// Comprueba que una sesión dejada abierta por menos de PARALLEL_MINUTES no cuenta como "previa interrumpida".
test("a session left open less than PARALLEL_MINUTES does not produce a Previous section", () => withDatabase(db => { setSystemTime(new Date("2026-01-01T00:00:00.000Z")); try {
  enableIntelligence(db);
  const project = createProject(db, "P").projectId;
  save(db, { scope: "project", projectId: project, title: "Project note", content: "Body", type: "fact" });
  startSession(db, project, "first", "/p");
  setSystemTime(new Date("2026-01-01T00:05:00.000Z")); // 5 minutos de inactividad: todavía en paralelo, no es "previa"
  startSession(db, project, "second", "/p");

  const block = startupBlock(db, project);

  expect(section(block.text, "## Previous session")).toBe("");
  expect(block.sections.previous).toBe(0);
} finally { setSystemTime(); } }));

// Comprueba que, por debajo de nivel 11, el bloque muestra títulos completos (sin `short`), no reporta
// sesión previa, y sigue leyendo tanto el cajón compartido como el del proyecto.
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

// Comprueba que una carpeta sin proyecto ligado solo recibe las esenciales compartidas, y que el
// encabezado cuenta correctamente cuántos títulos no cupieron.
test("an unbound directory gets the shared essentials only, and the header counts every title left out", () => withDatabase(db => {
  enableIntelligence(db);
  for (let n = 0; n < 60; n++) save(db, { scope: "shared", projectId: null, title: `Shared rule ${n} ${"x".repeat(60)}`, content: "Body", type: "preference", pinned: true });

  const block = startupBlock(db, null);

  expect(section(block.text, "## Index")).toBe("");
  expect(block.sections.essentials).toBeLessThanOrEqual(1500);
  expect(block.omitted).toBe(60 - lines(block.text, "## Essentials").length);
  expect(block.text.split("\n")[1]).toBe(`${block.chars}/5000 chars · ${block.omitted} titles did not fit: find them with memory_search.`);
}));
