/** Comprueba la planificación de consultas (palabras vacías, acentos, prefijos), el conteo de términos coincidentes y la similitud de Jaccard. */
import { expect, test } from "bun:test";
import { buildQuery, matchedTerms, MAX_QUERY_TERMS, similarity, termsOf } from "./query";

// Las palabras vacías ("qué", "sobre", "la", "y", "el") se descartan, los acentos se pliegan para
// comparar, los términos se unen con OR y los de cuatro o más letras buscan por prefijo (con *).
test("filler words are dropped, accents folded, terms OR-ed; four letters or more match by prefix", () => {
  expect(buildQuery("¿Qué decidimos sobre la versión de Sentinel y el bun?")).toEqual({
    terms: ["decidimos", "version", "sentinel", "bun"],
    words: '"decidimos"* OR "version"* OR "sentinel"* OR "bun"',
    trigram: '"decidimos" OR "version" OR "sentinel" OR "bun" OR "versión"',
  });
});

// Si todas las palabras son vacías se conservan igual (para no quedar sin consulta); si el texto solo
// tiene puntuación, no queda ningún término y ambas consultas resultan nulas.
test("a query made only of filler words keeps them; punctuation alone yields no query", () => {
  expect(buildQuery("de la")).toEqual({ terms: ["de", "la"], words: '"de" OR "la"', trigram: null });
  expect(buildQuery("¿?! --")).toEqual({ terms: [], words: null, trigram: null });
});

// Un texto largo se recorta a MAX_QUERY_TERMS términos, y una misma palabra repetida con distinto uso
// de mayúsculas cuenta una sola vez.
test("long texts are capped and repeated words counted once", () => {
  const text = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(" ");
  expect(buildQuery(text).terms).toHaveLength(MAX_QUERY_TERMS);
  expect(termsOf("Main main MAIN rama")).toEqual(["main", "rama"]);
});

// Un término de tres o más letras coincide como subcadena dentro de otra palabra; uno más corto
// ("ai") solo coincide como palabra completa, para no confundirlo con "email".
test("matched terms: substring from three letters, whole word below", () => {
  expect(matchedTerms(["proteccion", "main", "ai"], "Protección de main en forge614-ai")).toBe(3);
  expect(matchedTerms(["ai"], "email")).toBe(0);
  expect(matchedTerms(["pointerschema"], "NodePointerSchema es estricto")).toBe(1);
});

// El índice de Jaccard es el tamaño de la intersección entre el de la unión, redondeado a dos
// decimales; con un conjunto vacío el resultado es siempre 0.
test("similarity is the Jaccard index of two term sets, two decimals", () => {
  expect(similarity(["a", "b"], ["b", "c"])).toBe(0.33);
  expect(similarity(["a", "b"], ["b", "a"])).toBe(1);
  expect(similarity([], ["a"])).toBe(0);
});
