export interface RankingMetrics {
  revisionCount: number;
  duplicateCount: number;
  lastSeenAt: string;
}

export interface RankingFactors extends RankingMetrics {
  ageDays: number;
  pinnedBoost: number;
  recencyBoost: number;
  stabilityBoost: number;
  multiplier: number;
}

export const RANKING_PINNED_WEIGHT = 0.10;
export const RANKING_RECENCY_WEIGHT = 0.06;
export const RANKING_RECENCY_DAYS = 30;
export const RANKING_STABILITY_WEIGHT = 0.04;
export const RANKING_STABILITY_BASE = 4;
export const RANKING_TITLE_WEIGHT = 5;
export const RANKING_CONTENT_WEIGHT = 1;
export const RANKING_TOPIC_WEIGHT = 3;
export const MILLISECONDS_PER_DAY = 86_400_000;

export function rankingFactors(metrics: RankingMetrics, pinned: boolean, now: string): RankingFactors {
  const elapsed = (Date.parse(now) - Date.parse(metrics.lastSeenAt)) / MILLISECONDS_PER_DAY;
  const ageDays = Math.max(0, elapsed);
  const reinforcements = metrics.revisionCount + metrics.duplicateCount;
  const pinnedBoost = pinned ? RANKING_PINNED_WEIGHT : 0;
  const recencyBoost = RANKING_RECENCY_WEIGHT / (1 + ageDays / RANKING_RECENCY_DAYS);
  const stabilityBoost = RANKING_STABILITY_WEIGHT * reinforcements / (reinforcements + RANKING_STABILITY_BASE);
  return {
    ...metrics,
    ageDays,
    pinnedBoost,
    recencyBoost,
    stabilityBoost,
    multiplier: 1 + pinnedBoost + recencyBoost + stabilityBoost,
  };
}
