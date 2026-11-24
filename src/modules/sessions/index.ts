/** Punto de entrada del módulo `sessions`: reexporta las formas de datos de sesión y las reglas de validación, aviso y resumen. */
export type { Session,SessionEntry,SessionSummary,SessionSaveOptions,SessionSaveResult,SummaryFields,PreviousSession,ParallelSession } from "./types";
export type { CloudNotice } from "./rules";
export { sessionIdentity,sessionNotice,summaryContent,matchesSummaryWithSavedPins,PINNED_SUMMARY_HEADING,PINNED_SUMMARY_LIMIT,INACTIVITY_HOURS,PARALLEL_MINUTES } from "./rules";
