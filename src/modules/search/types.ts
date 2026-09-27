/**
 * Formas de datos de lectura de recuerdos: vista previa (sin el contenido completo), lectura de una
 * versión concreta, línea de tiempo alrededor de una versión, y el contexto de arranque (fijados,
 * recientes y resúmenes). Lo usa `src/infrastructure/sqlite/search.ts`, que arma estas formas a partir
 * de las filas de SQLite antes de devolverlas al llamador.
 */
import type { Memory,MemoryMark,MemoryMeta,MemoryVersion,SearchResult } from "../memory";
/** Un recuerdo sin su contenido completo, con `preview` (extracto) y `truncated` (si el extracto quedó recortado) en su lugar. */
export type MemoryPreview=Omit<MemoryVersion,"content">&{preview:string;truncated:boolean};
/** Un resultado de búsqueda en forma de vista previa: el recuerdo recortado, la explicación de su puntuación y, si aplican, sus metadatos y marcas. */
export interface PreviewResult{memory:MemoryPreview;explanation:SearchResult["explanation"];meta?:MemoryMeta;marks?:MemoryMark[]}
/** La lectura de una versión concreta de un recuerdo (memory_get), con la versión pedida, la versión vigente actual y el estado del recuerdo. */
export interface VersionRead{memory:MemoryVersion;currentVersion:number;state:Memory["state"];meta?:MemoryMeta;marks?:MemoryMark[]}
/** Petición de línea de tiempo (memory_timeline): la sesión que pide, el recuerdo y versión de referencia, y cuántas versiones anteriores (`before`) o posteriores (`after`) traer. */
export interface TimelineInput{sessionId:string;memoryId:string;version:number;before?:number;after?:number}
/** Una fila de la línea de tiempo: la vista previa de esa versión y cuándo se registró. */
export interface TimelineRow{memory:MemoryPreview;recordedAt:string}
/** El resultado completo de una línea de tiempo: la sesión que pidió, la versión de referencia (`focus`) y las versiones anteriores y posteriores encontradas. */
export interface TimelineResult{sessionId:string;focus:TimelineRow;before:TimelineRow[];after:TimelineRow[]}
/** Opciones de memory_context: si se pide en forma compacta (sin extracto de contenido) y el máximo de bytes a devolver. */
export interface ContextInput{compact?:boolean;maxBytes?:number}
/** Una fila del contexto de arranque: como MemoryPreview, pero `preview` es opcional (se omite en modo compacto). */
export type ContextRow=Omit<MemoryPreview,"preview">&{preview?:string};
/** El contexto de arranque completo: recuerdos fijados, recientes y resúmenes de sesión, cuántos de cada categoría quedaron fuera por el límite de tamaño, y si el resultado se truncó. */
export interface ContextResult{format:1;pinned:ContextRow[];recent:ContextRow[];summaries:ContextRow[];omitted:{pinned:number;recent:number;summaries:number};truncated:boolean}
