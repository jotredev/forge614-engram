/** Punto de entrada del módulo `sessions`: reexporta las formas de datos de sesión y las reglas de validación, aviso y resumen. */
export type { Session,SessionEntry,SessionSummary,SessionSaveOptions,SessionSaveResult,SummaryFields,PreviousSession,ParallelSession } from "./types";
export { sessionIdentity,sessionNotice,summaryContent,INACTIVITY_HOURS,PARALLEL_MINUTES } from "./rules";
