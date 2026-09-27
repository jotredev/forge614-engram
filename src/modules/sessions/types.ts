/**
 * Formas de datos de sesión: la sesión en sí, sus entradas de historial, sus resúmenes, las opciones de
 * un guardado con sesión, la sesión previa dejada abierta y las sesiones en paralelo. Lo usa la capa
 * SQLite (`src/infrastructure/sqlite/writes.ts`, `sessions.ts`) para llevar el ciclo de vida de una
 * sesión y sus resúmenes.
 */
import type { MemoryVersion,SimilarCandidate } from "../memory";
/** Una sesión: su id, el proyecto al que pertenece, si es de ejecución automática (`runtime`) o manual, y cuándo empezó y terminó (`endedAt` es `null` mientras sigue abierta). */
export interface Session {sessionId:string;projectId:string;kind:"runtime"|"manual";startedAt:string;endedAt:string|null}
/** Una entrada del historial de una sesión: qué recuerdo y versión tocó, y cuándo. */
export interface SessionEntry {sessionId:string;memoryId:string;version:number;recordedAt:string}
/** El resumen vigente de una sesión: qué recuerdo y versión lo contiene. */
export interface SessionSummary {sessionId:string;memoryId:string;version:number}
/** Opciones de un guardado asociado a una sesión: la sesión y proyecto involucrados, si el modo es independiente o de asistente, y el directorio de ejecución para inferir la sesión cuando no se da una explícita. */
export interface SessionSaveOptions {sessionId?:string;projectId?:string;mode?:"independent"|"assistant";runtimeDirectory?:string}
/** El resultado de un guardado asociado a sesión: el recuerdo guardado, la sesión usada (o `null`), cómo se determinó esa sesión, y candidatos similares si los hubo. */
export interface SessionSaveResult {memory:MemoryVersion;sessionId:string|null;sessionSource:"explicit"|"inferred"|"manual"|null;similar?:SimilarCandidate[]}
/** Los campos estructurados de un resumen de sesión: objetivo, instrucciones, hallazgos, logros, próximos pasos y archivos tocados. */
export interface SummaryFields {goal:string;instructions:string;discoveries:string;accomplishments:string;nextSteps:string;files:string[]}
/** La sesión previa dejada abierta: su id, cuándo fue su última actividad, y su resumen (o `null` si no guardó ninguno). */
export interface PreviousSession {sessionId:string;interruptedAt:string;summary:MemoryVersion|null}
/** Una sesión que sigue abierta en paralelo a la actual: su id y cuándo fue su última actividad. */
export interface ParallelSession {sessionId:string;lastActivityAt:string}
