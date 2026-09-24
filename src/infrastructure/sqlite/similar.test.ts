import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { similarTo } from "./similar";
import { archive, save, saveWithSession } from "./writes";

const cause = { type: "decision" as const, title: "Bun 1.3.8 se atora en Linux", content: "La causa del cuelgue de CI es Bun 1.3.8 al cargar módulos en Linux; Bun 1.3.9 pasa." };
const fix = { type: "decision" as const, title: "Bun 1.4.2 fijado como versión única", content: "Todos los nodos fijan Bun 1.4.2; la 1.3.8 se atoraba en Linux al cargar módulos." };

test("look-alikes: same scope and owner only, never itself, archived memories or session summaries", () => withDatabase(db => {
  enableIntelligence(db);
  const mine = createProject(db, "Mine"), other = createProject(db, "Other");
  const kept = save(db, { projectId: mine.projectId, ...cause });
  const gone = save(db, { projectId: mine.projectId, ...cause, title: "Bun 1.3.8 se atora en Linux (copia)" });
  archive(db, mine.projectId, gone.id);
  save(db, { projectId: mine.projectId, ...cause, title: "Resumen", topicKey: "session/abc/summary" });
  save(db, { projectId: other.projectId, ...cause });
  save(db, { projectId: mine.projectId, type: "fact", title: "Color favorito", content: "Negro con morado." });
  const probe = save(db, { projectId: mine.projectId, ...fix });
  const found = similarTo(db, { scope: "project", ownerColumn: "projectId", ownerId: mine.projectId, title: fix.title, content: fix.content, excludeId: probe.id });
  expect(found.map(candidate => candidate.id)).toEqual([kept.id]);
  expect(found[0]!.score).toBeGreaterThanOrEqual(0.25);
  expect(found[0]).toEqual({ id: kept.id, title: cause.title, version: 1, score: found[0]!.score });
}));

test("a new memory without a topic reports look-alikes; topics, identical text and older levels do not", () => {
  withDatabase(db => {
    enableIntelligence(db);
    const project = createProject(db, "Save");
    const first = saveWithSession(db, { projectId: project.projectId, ...cause });
    expect(first.similar).toBeUndefined();
    const second = saveWithSession(db, { projectId: project.projectId, ...fix });
    expect(second.similar?.map(candidate => candidate.id)).toEqual([first.memory.id]);
    expect(saveWithSession(db, { projectId: project.projectId, ...fix, topicKey: "bun" }).similar).toBeUndefined();
    expect(saveWithSession(db, { projectId: project.projectId, ...fix })).not.toHaveProperty("similar");
  });
  withDatabase(db => {
    enableSearchReinforcement(db);
    const project = createProject(db, "Old");
    saveWithSession(db, { projectId: project.projectId, ...cause });
    expect(saveWithSession(db, { projectId: project.projectId, ...fix })).not.toHaveProperty("similar");
  });
});
