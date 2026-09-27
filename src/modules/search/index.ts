/** Punto de entrada del módulo `search`: reexporta las formas de lectura, la validación de búsqueda por comando, la planificación de consultas híbridas y el armado del bloque de arranque. */
export type { MemoryPreview,PreviewResult,VersionRead,TimelineInput,TimelineRow,TimelineResult,ContextInput,ContextRow,ContextResult } from "./types";
export { searchTerms,validateSearchLimit } from "./rules";
export { buildQuery,termsOf,matchedTerms,similarity,MAX_QUERY_TERMS,MIN_MATCHED_TERMS,RRF_K,HYBRID_CANDIDATES,SIMILAR_LIMIT,SIMILAR_MIN_SCORE } from "./query";
export type { QueryPlan } from "./query";
export { renderStartupBlock,STARTUP_TOTAL,STARTUP_ESSENTIALS,STARTUP_PREVIOUS } from "./startup";
export type { StartupBlock,StartupBlockInput,StartupItem,StartupPrevious } from "./startup";
