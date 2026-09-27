/**
 * Calcula el multiplicador de orden (ranking) que empuja un recuerdo reforzado (editado o duplicado
 * varias veces), fijado (pinned) o visto recientemente hacia arriba en los resultados de búsqueda.
 * El multiplicador se aplica sobre la puntuación de texto (BM25) que calcula la búsqueda; lo usan
 * `src/infrastructure/sqlite/search.ts` y `hybrid.ts` al ordenar resultados.
 */
export interface RankingMetrics {
  /** Veces que el recuerdo se guardó de nuevo bajo el mismo topicKey (ediciones). */
  revisionCount: number;
  /** Veces que se guardó algo muy parecido a este recuerdo sin usar topicKey (level 11). */
  duplicateCount: number;
  /** Fecha ISO de la última vez que se vio o guardó este recuerdo. */
  lastSeenAt: string;
}

/** RankingMetrics más los boosts (empujones) ya calculados y el multiplicador final combinado. */
export interface RankingFactors extends RankingMetrics {
  /** Días transcurridos desde `lastSeenAt`, nunca negativo. */
  ageDays: number;
  /** Empujón fijo si el recuerdo está fijado (pinned); 0 si no. */
  pinnedBoost: number;
  /** Empujón que decae con la antigüedad del recuerdo. */
  recencyBoost: number;
  /** Empujón que crece y se satura con las revisiones y duplicados. */
  stabilityBoost: number;
  /** 1 más la suma de los tres empujones; el factor final que se aplica a la puntuación de búsqueda. */
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

/**
 * Combina las métricas crudas de un recuerdo (revisiones, duplicados, última vez visto) con si está
 * fijado, para producir los tres boosts (fijado, recencia, estabilidad) y el multiplicador final.
 * @param metrics Métricas crudas del recuerdo: cuántas veces se revisó, se duplicó y cuándo se vio por última vez.
 * @param pinned Si el recuerdo está fijado (pinned); solo entonces se aplica `pinnedBoost`.
 * @param now Fecha ISO usada como "ahora" para calcular la antigüedad; parametrizada para que las pruebas sean deterministas.
 * @returns Las métricas originales más `ageDays`, los tres boosts y el `multiplier` (1 + la suma de los tres).
 */
export function rankingFactors(metrics: RankingMetrics, pinned: boolean, now: string): RankingFactors {
  const elapsed = (Date.parse(now) - Date.parse(metrics.lastSeenAt)) / MILLISECONDS_PER_DAY;
  // Una fecha de "última vez visto" en el futuro (reloj desincronizado) se recorta a 0 días de
  // antigüedad, nunca a un valor negativo que invertiría el boost de recencia.
  const ageDays = Math.max(0, elapsed);
  const reinforcements = metrics.revisionCount + metrics.duplicateCount;
  const pinnedBoost = pinned ? RANKING_PINNED_WEIGHT : 0;
  // El boost de recencia decae con la edad: a los RANKING_RECENCY_DAYS días queda en la mitad del peso máximo.
  const recencyBoost = RANKING_RECENCY_WEIGHT / (1 + ageDays / RANKING_RECENCY_DAYS);
  // El boost de estabilidad crece con los refuerzos pero se satura (nunca supera RANKING_STABILITY_WEIGHT),
  // gracias a la base RANKING_STABILITY_BASE en el denominador; así es finito incluso con refuerzos extremos.
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
