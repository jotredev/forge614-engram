/**
 * Reglas del «tablero» del ecosistema (el espacio compartido de recuerdos de alcance `ecosystem`, visible
 * a todos los proyectos de un mismo grupo): cuántos recuerdos activos caben, cuántos proyectos como
 * mínimo debe afectar una entrada del tablero, qué tipos de recuerdo puede llevar y el límite de tamaño
 * de la nota de estado. Lo usa `src/infrastructure/sqlite/writes.ts` al crear o mover un recuerdo al
 * alcance `ecosystem`, para rechazar lo que no cumple estas reglas antes de guardarlo.
 */
export const ECOSYSTEM_BOARD_LIMIT = 40;
export const ECOSYSTEM_AFFECTS_MIN = 2;
/** Clave de tema (topicKey) reservada para la nota de estado compartida del grupo: solo el proyecto fuente (`GroupSource`) puede escribirla, y siempre queda fijada (pinned) en el tablero. */
export const ECOSYSTEM_STATUS_TOPIC = "ecosystem/estado-actual";
export const ECOSYSTEM_STATUS_MAX = 600;

/**
 * Dice si un tipo de recuerdo puede vivir en el tablero del ecosistema. `decision`, `procedure` y
 * `warning` siempre están permitidos; `fact` (hecho) solo se permite cuando el tema es exactamente
 * la nota de estado (`ECOSYSTEM_STATUS_TOPIC`), nunca como entrada libre del tablero.
 * @param type Tipo del recuerdo tal como llega en la escritura (p. ej. "decision", "fact").
 * @param topicKey Clave de tema del recuerdo, o `null` si no tiene una asignada.
 * @returns `true` si ese tipo puede guardarse con ese tema en el tablero del ecosistema.
 */
export function boardTypeAllowed(type: string, topicKey: string | null): boolean {
  return type === "decision" || type === "procedure" || type === "warning" || (topicKey === ECOSYSTEM_STATUS_TOPIC && type === "fact");
}
