/** Comprueba que el multiplicador de orden combine fijado, decaimiento de recencia y refuerzo, y que se mantenga finito en casos extremos. */
import { expect, test } from "bun:test";
import { rankingFactors } from "./ranking";

const NOW = "2026-09-17T12:00:00.000Z";

// Con recuerdo fijado, visto ahora mismo y con refuerzos, los tres boosts deben estar presentes a la vez
// y sumarse al multiplicador esperado (1 + 0.10 + 0.06 + 0.02).
test("ranking factors combine pin, recency, and four reinforcements", () => {
  const factors = rankingFactors({ revisionCount: 2, duplicateCount: 2, lastSeenAt: NOW }, true, NOW);

  expect(factors).toMatchObject({
    revisionCount: 2,
    duplicateCount: 2,
    lastSeenAt: NOW,
    ageDays: 0,
    pinnedBoost: 0.1,
    recencyBoost: 0.06,
    stabilityBoost: 0.02,
  });
  expect(factors.multiplier).toBeCloseTo(1.18, 12);
});

// A los treinta días (RANKING_RECENCY_DAYS) el boost de recencia cae a la mitad de su peso máximo, pero
// el de estabilidad no depende del tiempo transcurrido y se mantiene intacto mientras haya refuerzos.
test("ranking factors decay recency over thirty days without dropping stability", () => {
  const thirtyDaysAgo = "2026-08-18T12:00:00.000Z";

  expect(rankingFactors({ revisionCount: 2, duplicateCount: 2, lastSeenAt: thirtyDaysAgo }, true, NOW).multiplier)
    .toBeCloseTo(1.15, 12);
  expect(rankingFactors({ revisionCount: 0, duplicateCount: 0, lastSeenAt: thirtyDaysAgo }, false, NOW).multiplier)
    .toBeCloseTo(1.03, 12);
});

// Dos recuerdos con la misma puntuación de texto (BM25, aquí simulada con -2) deben ordenarse por su
// multiplicador: el reforzado y fijado sale antes que el que no tiene ningún refuerzo.
test("ranking factors make a reinforced equal BM25 result sort first", () => {
  const reinforced = rankingFactors({ revisionCount: 2, duplicateCount: 2, lastSeenAt: NOW }, true, NOW);
  const baseline = rankingFactors({ revisionCount: 0, duplicateCount: 0, lastSeenAt: NOW }, false, NOW);

  expect(-2 * reinforced.multiplier).toBeLessThan(-2 * baseline.multiplier);
  expect(baseline.multiplier).toBeCloseTo(1.06, 12);
});

// Una fecha de "última vez visto" posterior a "ahora" (reloj desincronizado) no debe producir una
// antigüedad negativa, y refuerzos extremos (Number.MAX_SAFE_INTEGER) no deben romper el cálculo.
test("ranking factors clamp future dates and remain finite at saturation", () => {
  const factors = rankingFactors({
    revisionCount: Number.MAX_SAFE_INTEGER,
    duplicateCount: Number.MAX_SAFE_INTEGER,
    lastSeenAt: "2026-09-18T12:00:00.000Z",
  }, false, NOW);

  expect(factors.ageDays).toBe(0);
  expect(factors.recencyBoost).toBe(0.06);
  expect(factors.stabilityBoost).toBeCloseTo(0.04, 12);
  expect(Number.isFinite(factors.multiplier)).toBe(true);
});
