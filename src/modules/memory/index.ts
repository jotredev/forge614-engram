/** Punto de entrada del módulo `memory`: reexporta los tipos centrales del recuerdo, la comparación de confirmaciones, el cálculo del multiplicador de orden, la detección de secretos y los metadatos (short, affects, marcas). */
export { memoryTypes } from "./types";
export type { MemoryType, MemoryScope, MemoryOwner, SearchScope, SaveInput, MemoryVersion, Memory, SearchResult, ReinforcementExplanation, SearchExplanation, SimilarCandidate } from "./types";
export { sameConfirmationPayload } from "./confirmations";
export type { Confirmation,ConfirmationPayload,ConfirmationRequest } from "./confirmations";
export {
  rankingFactors, MILLISECONDS_PER_DAY, RANKING_PINNED_WEIGHT, RANKING_RECENCY_DAYS,
  RANKING_RECENCY_WEIGHT, RANKING_STABILITY_BASE, RANKING_STABILITY_WEIGHT,
  RANKING_TITLE_WEIGHT, RANKING_CONTENT_WEIGHT, RANKING_TOPIC_WEIGHT,
} from "./ranking";
export type { RankingFactors,RankingMetrics } from "./ranking";
export { findSecret } from "./secrets";
export { REVIEW_AFTER_DAYS, SHORT_MAX, AFFECTS_MAX, reviewAfterFor, marksFor, normalizeShort, normalizeAffects } from "./meta";
export type { MemoryMeta, MemoryMark } from "./meta";
