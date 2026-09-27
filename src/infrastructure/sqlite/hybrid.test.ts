/**
 * Pruebas de la búsqueda híbrida de nivel 11 (`hybridHits`, usada por `search`/`searchPreviews`):
 * comprueba que mejora al nivel anterior con un banco de preguntas de referencia, que exige
 * varios términos coincidentes, que nunca mezcla memorias de distintos proyectos, y que una
 * consulta sin palabras útiles no devuelve resultados.
 */
import { expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { BENCHMARK_MEMORIES, BENCHMARK_QUERIES } from "../../../tests/fixtures/search-benchmark";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { search, searchPreviews } from "./search";
import { save } from "./writes";

/**
 * Guarda todas las memorias de referencia (BENCHMARK_MEMORIES) en un proyecto nuevo y cuenta
 * en cuántas de las preguntas de referencia (BENCHMARK_QUERIES) el resultado esperado aparece
 * entre los primeros 3 resultados de búsqueda.
 * @param db conexión abierta a la base SQLite.
 * @returns cuántas de las preguntas de referencia acertaron.
 */
function benchmarkHits(db: Database): number {
  const project = createProject(db, "Benchmark");
  for (const memory of BENCHMARK_MEMORIES) save(db, { projectId: project.projectId, ...memory });
  // Cuenta acierto si el título esperado aparece entre los primeros 3 resultados para esa pregunta.
  return BENCHMARK_QUERIES.filter(([query, expected]) =>
    searchPreviews(db, project.projectId, query, 3, "all").some(result => result.memory.title === expected)).length;
}

// Comprueba que el nivel 11 (índice híbrido) acierta más preguntas del banco de referencia que el nivel de refuerzo anterior, y nunca menos.
test("benchmark: 20 natural-language questions, at least 18 found in the top 3 (was far fewer before level 11)", () => {
  let before = 0, after = 0;
  withDatabase(db => { enableSearchReinforcement(db); before = benchmarkHits(db); });
  withDatabase(db => { enableIntelligence(db); after = benchmarkHits(db); });
  expect(after).toBeGreaterThanOrEqual(18);
  expect(before).toBeLessThan(after);
});

// Busca con términos escritos con acentos distintos a los guardados; exige al menos dos términos coincidentes para no traer resultados sin relación.
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

// Encuentra por fragmento de un nombre técnico compuesto, y comprueba que las memorias de otro proyecto nunca se filtran entre los resultados.
test("code names are found by fragment, and another project's memories never leak", () => withDatabase(db => {
  enableIntelligence(db);
  const mine = createProject(db, "Mine"), other = createProject(db, "Other");
  const schema = save(db, { projectId: mine.projectId, type: "fact", title: "Credencial del nodo", content: "NodePointerSchema es estricto" });
  save(db, { projectId: other.projectId, type: "fact", title: "Credencial del nodo", content: "NodePointerSchema es estricto" });
  expect(search(db, mine.projectId, "PointerSchema", 10, "all").map(result => result.memory.id)).toEqual([schema.id]);
  expect(searchPreviews(db, mine.projectId, "PointerSchema", 10, "project").map(result => result.memory.id)).toEqual([schema.id]);
}));

// Una consulta sin palabras utilizables (solo símbolos, o sin ninguna relación con lo guardado) debe devolver nada en vez de resultados sin sentido.
test("a query with no usable words returns nothing instead of noise", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Empty");
  save(db, { projectId: project.projectId, type: "fact", title: "Algo", content: "texto" });
  expect(searchPreviews(db, project.projectId, "¿?!", 10, "all")).toEqual([]);
  expect(searchPreviews(db, project.projectId, "nada relacionado aquí", 10, "all")).toEqual([]);
}));
