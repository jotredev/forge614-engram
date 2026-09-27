/**
 * Formas de datos centrales de un recuerdo: su tipo, su alcance, la entrada de guardado, el "dueño" que
 * lo posee (proyecto, alcance compartido o grupo), sus versiones, su estado y la explicación de por qué
 * salió en una búsqueda con esa puntuación. Lo usan casi todos los módulos de memoria y la capa SQLite
 * (`src/infrastructure/sqlite/memory.ts`, `search.ts`, `writes.ts`) para leer y escribir recuerdos.
 */
export const memoryTypes = ["fact", "decision", "procedure", "warning", "preference"] as const;
/** Uno de los cinco tipos de recuerdo: hecho, decisión, procedimiento, advertencia o preferencia. */
export type MemoryType = (typeof memoryTypes)[number];
/** Dónde vive un recuerdo: propio del proyecto, compartido por el usuario en todos sus proyectos, o compartido por un grupo de proyectos del ecosistema. */
export type MemoryScope = "project" | "shared" | "ecosystem";
/** Un MemoryScope, o "all" para buscar en los tres alcances a la vez. */
export type SearchScope = MemoryScope | "all";
/**
 * Los campos que llegan en una petición de guardado (memory_save): los campos comunes (título,
 * contenido, tipo y los opcionales de metadatos) más, según el alcance elegido, el proyecto dueño
 * (`project`, por defecto), nada más (`shared`), o el grupo y opcionalmente el proyecto de origen
 * (`ecosystem`).
 */
export type SaveInput = { title:string;content:string;type:MemoryType;topicKey?:string;pinned?:boolean;expectedVersion?:number;requestKey?:string;
  short?:string;supersedes?:string;affects?:readonly string[] }
  & ({scope?:"project";projectId:string}|{scope:"shared";projectId:null}|{scope:"ecosystem";projectId:null;groupId:string;fromProjectId?:string});
/** Un id de proyecto, `null` para el alcance shared, o un grupo para el alcance ecosystem: identifica a quién pertenece un recuerdo al construir la cláusula de dueño en SQL. */
export type MemoryOwner = string | null | { readonly groupId: string };
/** Una versión guardada de un recuerdo: su identidad, dueño, alcance, tema, contenido, si está fijado y cuándo se creó o actualizó esa versión. */
export interface MemoryVersion { id:string;projectId:string|null;scope:MemoryScope;topicKey:string|null;title:string;content:string;type:MemoryType;pinned:boolean;version:number;createdAt:string;updatedAt:string;groupId?:string }
/** Una versión de recuerdo más su estado actual: activo o archivado. */
export interface Memory extends MemoryVersion { state:"active"|"archived" }
/** Desglose de los boosts de refuerzo (ver `ranking.ts`) que explican por qué un recuerdo subió en el orden de búsqueda. */
export interface ReinforcementExplanation {
  revisionCount:number;duplicateCount:number;lastSeenAt:string;ageDays:number;
  pinnedBoost:number;recencyBoost:number;stabilityBoost:number;
}
/** Por qué un recuerdo salió con esa puntuación en una búsqueda: el modo de coincidencia usado, la puntuación de texto (BM25) si aplica, el multiplicador de refuerzo y, si hubo refuerzo, su desglose. */
export interface SearchExplanation {
  mode:"fts5"|"literal"|"hybrid";bm25:number|null;multiplier:number;orderScore:number|null;
  /** Desglose de los boosts que compusieron el multiplicador, presente solo cuando el recuerdo tenía refuerzo que explicar. */
  reinforcement?:ReinforcementExplanation;
}
/** Un recuerdo encontrado junto con la explicación de su puntuación en esa búsqueda. */
export interface SearchResult { memory:Memory;explanation:SearchExplanation }

/** Un recuerdo del mismo alcance y dueño que se parece al que se acaba de guardar (nivel 11). */
export interface SimilarCandidate { id:string;title:string;version:number;score:number }
