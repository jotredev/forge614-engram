/**
 * Metadatos de un recuerdo que viven fuera de su versión (nivel de esquema 11): resumen corto, fecha de
 * revisión, quién lo reemplazó y a qué proyectos afecta. Incluye las funciones que calculan cuándo toca
 * revisar un recuerdo, qué marcas mostrar (superseded, verify) y cómo normalizar `short` y `affects`
 * antes de guardarlos. Lo usa `src/infrastructure/sqlite/writes.ts` al guardar y `search.ts`/`startup.ts`
 * al mostrar resultados con sus marcas.
 */
import { MemoryError } from "../../shared/errors";
import type { MemoryType } from "./types";

export const REVIEW_AFTER_DAYS = 90;
export const SHORT_MAX = 300;
export const AFFECTS_MAX = 20;
const DAY_MS = 86_400_000;

/** Metadatos guardados fuera de la versión del recuerdo (nivel de esquema 11): resumen corto (`short`), fecha en que toca revisarlo (`reviewAfter`), id de quien lo reemplazó (`supersededBy`) y proyectos a los que afecta (`affects`); cada uno `null` cuando no aplica. */
export interface MemoryMeta { short: string | null; reviewAfter: string | null; supersededBy: string | null; affects: string[] | null }
/** Marca que puede mostrarse junto a un recuerdo: "superseded" (fue reemplazado) o "verify" (pasó su fecha de revisión). */
export type MemoryMark = "superseded" | "verify";

/**
 * Calcula la fecha en la que un recuerdo de tipo `decision` o `procedure` debe revisarse de nuevo
 * (REVIEW_AFTER_DAYS días después de guardarlo); los demás tipos nunca vencen.
 * @param type Tipo del recuerdo.
 * @param now Fecha ISO de guardado, usada como punto de partida del conteo.
 * @returns La fecha ISO de revisión, o `null` si el tipo no expira.
 */
export function reviewAfterFor(type: MemoryType, now: string): string | null {
  if (type !== "decision" && type !== "procedure") return null;
  return new Date(Date.parse(now) + REVIEW_AFTER_DAYS * DAY_MS).toISOString();
}

/**
 * Calcula qué marcas mostrar para un recuerdo según sus metadatos: "superseded" si fue reemplazado,
 * "verify" si ya pasó su fecha de revisión. Puede llevar ambas a la vez.
 * @param meta Metadatos del recuerdo, o `null` si el recuerdo no tiene metadatos guardados.
 * @param now Fecha ISO usada como "ahora" para comparar contra `reviewAfter`.
 * @returns Arreglo con las marcas aplicables, en orden: primero "superseded", luego "verify".
 */
export function marksFor(meta: MemoryMeta | null, now: string): MemoryMark[] {
  if (meta === null) return [];
  const marks: MemoryMark[] = [];
  if (meta.supersededBy !== null) marks.push("superseded");
  if (meta.reviewAfter !== null && Date.parse(meta.reviewAfter) <= Date.parse(now)) marks.push("verify");
  return marks;
}

/**
 * Recorta espacios y valida el resumen corto (`short`) que reemplaza al título en el bloque de arranque.
 * @param value Texto propuesto como resumen corto.
 * @returns El texto recortado.
 * @throws MemoryError con código "INVALID_INPUT" si queda vacío, supera SHORT_MAX caracteres o contiene un carácter nulo.
 */
export function normalizeShort(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHORT_MAX || trimmed.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `short debe tener entre 1 y ${SHORT_MAX} caracteres, sin caracteres nulos.`);
  }
  return trimmed;
}

/**
 * Recorta, deduplica, ordena y valida la lista de proyectos afectados (`affects`) de una regla del
 * tablero del ecosistema.
 * @param value Lista de nombres de proyecto propuesta.
 * @returns La lista sin duplicados, recortada y ordenada alfabéticamente.
 * @throws MemoryError con código "INVALID_INPUT" si queda vacía, supera AFFECTS_MAX nombres, o algún nombre está vacío, supera 64 caracteres o contiene un carácter nulo.
 */
export function normalizeAffects(value: readonly string[]): string[] {
  const names = [...new Set(value.map(name => name.trim()))].sort();
  if (names.length === 0 || names.length > AFFECTS_MAX || names.some(name => !name || name.length > 64 || name.includes("\0"))) {
    throw new MemoryError("INVALID_INPUT", `affects debe nombrar entre 1 y ${AFFECTS_MAX} proyectos de 1 a 64 caracteres.`);
  }
  return names;
}
