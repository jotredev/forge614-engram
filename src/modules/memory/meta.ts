import { MemoryError } from "../../shared/errors";
import type { MemoryType } from "./types";

export const REVIEW_AFTER_DAYS = 90;
export const SHORT_MAX = 300;
export const AFFECTS_MAX = 20;
const DAY_MS = 86_400_000;

/** Metadata kept outside the memory version (schema level 11). */
export interface MemoryMeta { short: string | null; reviewAfter: string | null; supersededBy: string | null; affects: string[] | null }
export type MemoryMark = "superseded" | "verify";

/** Decisions and procedures are re-checked after REVIEW_AFTER_DAYS; other types never expire. */
export function reviewAfterFor(type: MemoryType, now: string): string | null {
  if (type !== "decision" && type !== "procedure") return null;
  return new Date(Date.parse(now) + REVIEW_AFTER_DAYS * DAY_MS).toISOString();
}

export function marksFor(meta: MemoryMeta | null, now: string): MemoryMark[] {
  if (meta === null) return [];
  const marks: MemoryMark[] = [];
  if (meta.supersededBy !== null) marks.push("superseded");
  if (meta.reviewAfter !== null && Date.parse(meta.reviewAfter) <= Date.parse(now)) marks.push("verify");
  return marks;
}

export function normalizeShort(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHORT_MAX || trimmed.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `short debe tener entre 1 y ${SHORT_MAX} caracteres, sin caracteres nulos.`);
  }
  return trimmed;
}

export function normalizeAffects(value: readonly string[]): string[] {
  const names = [...new Set(value.map(name => name.trim()))].sort();
  if (names.length === 0 || names.length > AFFECTS_MAX || names.some(name => !name || name.length > 64 || name.includes("\0"))) {
    throw new MemoryError("INVALID_INPUT", `affects debe nombrar entre 1 y ${AFFECTS_MAX} proyectos de 1 a 64 caracteres.`);
  }
  return names;
}
