export const ECOSYSTEM_BOARD_LIMIT = 40;
export const ECOSYSTEM_AFFECTS_MIN = 2;
export const ECOSYSTEM_STATUS_TOPIC = "ecosystem/estado-actual";
export const ECOSYSTEM_STATUS_MAX = 600;

/** decision, procedure and warning always; fact too, but only for the status note. */
export function boardTypeAllowed(type: string, topicKey: string | null): boolean {
  return type === "decision" || type === "procedure" || type === "warning" || (topicKey === ECOSYSTEM_STATUS_TOPIC && type === "fact");
}
