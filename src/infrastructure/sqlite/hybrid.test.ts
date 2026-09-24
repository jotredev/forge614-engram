import { expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { BENCHMARK_MEMORIES, BENCHMARK_QUERIES } from "../../../tests/fixtures/search-benchmark";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { search, searchPreviews } from "./search";
import { save } from "./writes";

function benchmarkHits(db: Database): number {
  const project = createProject(db, "Benchmark");
  for (const memory of BENCHMARK_MEMORIES) save(db, { projectId: project.projectId, ...memory });
  return BENCHMARK_QUERIES.filter(([query, expected]) =>
    searchPreviews(db, project.projectId, query, 3, "all").some(result => result.memory.title === expected)).length;
}

test("benchmark: 20 natural-language questions, at least 18 found in the top 3 (was far fewer before level 11)", () => {
  let before = 0, after = 0;
  withDatabase(db => { enableSearchReinforcement(db); before = benchmarkHits(db); });
  withDatabase(db => { enableIntelligence(db); after = benchmarkHits(db); });
  expect(after).toBeGreaterThanOrEqual(18);
  expect(before).toBeLessThan(after);
});

test("OR search with accents folded; a result needs at least two of the query terms", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Hybrid");
  const replica = save(db, { projectId: project.projectId, type: "fact", title: "Réplica en PostgreSQL", content: "sincronización explícita" });
  save(db, { projectId: project.projectId, type: "fact", title: "Notas de la rama", content: "la rama main está protegida" });
  const results = searchPreviews(db, project.projectId, "cómo configuro la replica de postgres en main", 10, "all");
  expect(results.map(result => result.memory.id)).toEqual([replica.id]);
  const explanation = results[0]!.explanation;
  expect(explanation.mode).toBe("hybrid");
  expect(explanation.multiplier).toBeGreaterThan(1);
  expect(explanation.orderScore!).toBeLessThan(0);
}));

test("code names are found by fragment, and another project's memories never leak", () => withDatabase(db => {
  enableIntelligence(db);
  const mine = createProject(db, "Mine"), other = createProject(db, "Other");
  const schema = save(db, { projectId: mine.projectId, type: "fact", title: "Credencial del nodo", content: "NodePointerSchema es estricto" });
  save(db, { projectId: other.projectId, type: "fact", title: "Credencial del nodo", content: "NodePointerSchema es estricto" });
  expect(search(db, mine.projectId, "PointerSchema", 10, "all").map(result => result.memory.id)).toEqual([schema.id]);
  expect(searchPreviews(db, mine.projectId, "PointerSchema", 10, "project").map(result => result.memory.id)).toEqual([schema.id]);
}));

test("a query with no usable words returns nothing instead of noise", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Empty");
  save(db, { projectId: project.projectId, type: "fact", title: "Algo", content: "texto" });
  expect(searchPreviews(db, project.projectId, "¿?!", 10, "all")).toEqual([]);
  expect(searchPreviews(db, project.projectId, "nada relacionado aquí", 10, "all")).toEqual([]);
}));
