/**
 * Formas de datos y comparación para el guardado idempotente (repetible sin duplicar) por `requestKey`:
 * cuando un cliente reintenta un `memory_save` con la misma clave de petición, se devuelve la
 * confirmación ya guardada en vez de crear un recuerdo nuevo. Lo usa
 * `src/infrastructure/sqlite/writes.ts`, que guarda la petición y compara el contenido con
 * `sameConfirmationPayload` para detectar si la clave se reintenta con el mismo contenido o con otro
 * (conflicto).
 */
import type { MemoryType, MemoryVersion } from "./types";

/** Confirmación de una escritura ya aplicada: qué recuerdo y versión resultaron, cuándo se registró y en qué sesión (o `null` si no hubo sesión). */
export interface Confirmation {
  /** Identificador único de esta confirmación de escritura. */
  confirmationId:string;
  /** Id del recuerdo que resultó de la escritura confirmada. */
  memoryId:string;
  /** Número de versión del recuerdo tras la escritura. */
  version:number;
  /** Fecha ISO en que se registró la confirmación. */
  recordedAt:string;
  /** Id de la sesión que hizo la escritura, o `null` si no hubo sesión. */
  sessionId:string|null;
}

/**
 * Una petición de guardado ya resuelta, indexada por `requestKey`: guarda el hash del contenido
 * pedido (`payloadHash`) para poder distinguir un reintento idéntico de un conflicto, y la respuesta
 * completa (`response`) que se repite tal cual ante un reintento idéntico.
 */
export interface ConfirmationRequest {
  /** Id del recuerdo al que se aplicó la petición. */
  memoryId:string;
  /** Clave de petición estable que identifica este guardado lógico. */
  requestKey:string;
  /** Huella del contenido pedido, para detectar si un reintento trae el mismo contenido o uno distinto. */
  payloadHash:string;
  /** Versión esperada que llevaba la petición original, o `null` si no se exigió ninguna. */
  expectedVersion:number|null;
  /** Id de la confirmación generada al aplicar esta petición. */
  confirmationId:string;
  /** Respuesta que se repite tal cual ante un reintento con la misma requestKey. */
  response:{
    memory:MemoryVersion;
    sessionId:string|null;
    sessionSource:"explicit"|"inferred"|"manual"|null;
  };
}

/** Los campos del recuerdo que definen si dos peticiones de guardado piden exactamente lo mismo. */
export interface ConfirmationPayload {
  /** Título propuesto para el recuerdo. */
  title:string;
  /** Contenido propuesto para el recuerdo. */
  content:string;
  /** Tipo propuesto para el recuerdo. */
  type:MemoryType;
  /** Tema propuesto para el recuerdo, o `null` si no lleva uno. */
  topicKey:string|null;
  /** Si el recuerdo propuesto queda fijado (pinned). */
  pinned:boolean;
}

/**
 * Compara un recuerdo ya guardado contra un payload de confirmación campo por campo, para saber si
 * un reintento con la misma `requestKey` pide exactamente el mismo contenido.
 * @param memory Versión del recuerdo tal como quedó guardada.
 * @param payload Contenido que pide la petición actual.
 * @returns `true` si título, contenido, tipo, topicKey y pinned coinciden todos con el recuerdo guardado.
 */
export function sameConfirmationPayload(memory: MemoryVersion, payload: ConfirmationPayload): boolean {
  return memory.title===payload.title && memory.content===payload.content && memory.type===payload.type
    && memory.topicKey===payload.topicKey && memory.pinned===payload.pinned;
}
