import { expect, test } from "bun:test";
import { rankingFactors } from "./ranking";

const NOW = "2026-09-17T12:00:00.000Z";

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

test("ranking factors decay recency over thirty days without dropping stability", () => {
  const thirtyDaysAgo = "2026-08-18T12:00:00.000Z";

  expect(rankingFactors({ revisionCount: 2, duplicateCount: 2, lastSeenAt: thirtyDaysAgo }, true, NOW).multiplier)
    .toBeCloseTo(1.15, 12);
  expect(rankingFactors({ revisionCount: 0, duplicateCount: 0, lastSeenAt: thirtyDaysAgo }, false, NOW).multiplier)
    .toBeCloseTo(1.03, 12);
});

test("ranking factors make a reinforced equal BM25 result sort first", () => {
  const reinforced = rankingFactors({ revisionCount: 2, duplicateCount: 2, lastSeenAt: NOW }, true, NOW);
  const baseline = rankingFactors({ revisionCount: 0, duplicateCount: 0, lastSeenAt: NOW }, false, NOW);

  expect(-2 * reinforced.multiplier).toBeLessThan(-2 * baseline.multiplier);
  expect(baseline.multiplier).toBeCloseTo(1.06, 12);
});

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
