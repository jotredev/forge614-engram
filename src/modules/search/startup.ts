/**
 * Arma el bloque de arranque (formato 2): el texto que un anfitrión inyecta al empezar una sesión con
 * lo esencial fijado, la sesión previa dejada abierta y un índice de títulos, todo dentro de un
 * presupuesto fijo de caracteres (STARTUP_TOTAL). Lo usa `src/infrastructure/sqlite/startup.ts`, que
 * arma las listas de candidatos y llama a `renderStartupBlock` para producir el texto final.
 */
import type { MemoryMark } from "../memory";

// Presupuestos de caracteres del bloque de arranque (formato 2), contados en puntos de código Unicode
// (para que un emoji o un acento compuesto cuenten como un solo carácter, no como varios bytes).
export const STARTUP_TOTAL = 5000;
export const STARTUP_ESSENTIALS = 1500;
export const STARTUP_PREVIOUS = 800;
export const PINNED_TEXT_MAX = 120;
export const PINNED_SCOPES = ["project", "ecosystem", "shared"] as const;
export type PinnedScope = (typeof PINNED_SCOPES)[number];
export type PinnedCounts = Record<PinnedScope, number>;
export type PinnedReference = { id: string; scope: PinnedScope };

/** Una línea de recuerdo del bloque: los esenciales muestran `short` cuando existe, el índice siempre muestra `title`; `scope`, `id` y `marks` (superseded, verify) se muestran igual en ambas secciones. */
export interface StartupItem extends PinnedReference { title: string; short: string | null; marks: MemoryMark[] }
/** La sesión previa dejada abierta: su id, cuándo fue su última actividad, y su último resumen guardado (o `null` si no guardó ninguno). */
export interface StartupPrevious { sessionId: string; interruptedAt: string; summary: { id: string; version: number; content: string } | null }
/** Candidatos en orden de prioridad; los totales cuentan cada candidato, incluidos los que no llegan en las listas (por ejemplo porque ya se calculó que no caben). */
export interface StartupBlockInput {
  projectNotice?: string;
  essentials: StartupItem[]; pinnedCounts: PinnedCounts;
  /** La sesión previa dejada abierta que se ofrece continuar, o `null` si no hay ninguna que mostrar. */
  previous: StartupPrevious | null;
  index: StartupItem[]; indexTotal: number;
}
/** El bloque de arranque terminado: su texto listo para inyectar, cuántos caracteres ocupa en total, y el desglose por sección. */
export interface StartupBlock {
  format: 2; text: string; chars: number;
  /** Cuántos caracteres ocupó cada sección en el texto final; sirve para depurar el reparto del presupuesto. */
  sections: { essentials: number; previous: number; index: number };
  /** Total de fijadas y títulos del índice que quedaron fuera del bloque. */
  omitted: number;
  pinnedOmitted?: { counts: PinnedCounts; items: PinnedReference[]; remaining: number };
}

const SCOPE_LABEL = { shared: "personal", ecosystem: "board", project: "project" } as const;
/** Cuenta los puntos de código Unicode de un texto (no las unidades UTF-16), para que el conteo coincida con lo que ve una persona. */
const length = (text: string): number => Array.from(text).length;
/** Colapsa cualquier secuencia de espacios en blanco (incluidos saltos de línea) a un solo espacio y recorta los extremos, para que cada línea del bloque ocupe una sola línea de texto. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
/**
 * Recorta un texto a lo sumo a `max` puntos de código, añadiendo un carácter de elipsis (…) en el
 * lugar del último punto de código recortado cuando el texto no cabe entero.
 * @param text Texto a recortar.
 * @param max Máximo de puntos de código permitidos, incluida la elipsis si hace falta.
 * @returns El texto tal cual si ya cabe, o recortado con "…" al final si no.
 */
function clip(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max - 1).join("") + "…";
}
/**
 * Arma la línea de una sola línea de texto para un recuerdo: el texto dado (esenciales o título),
 * las marcas visibles (todas salvo "superseded", que no se muestra en el bloque), el alcance
 * traducido con `SCOPE_LABEL` y el id.
 * @param item El recuerdo a mostrar.
 * @param text El texto a usar para esta línea: `item.short` en esenciales, `item.title` en el índice.
 * @returns La línea formateada, lista para unirse con las demás.
 */
function line(item: StartupItem, text: string): string {
  const marks = item.marks.filter(mark => mark !== "superseded").map(mark => ` [${mark}]`).join("");
  return `- ${oneLine(text)}${marks} · ${SCOPE_LABEL[item.scope]} · ${item.id}`;
}
/**
 * Arma el encabezado del bloque: la advertencia fija de que es dato recuperado, no una instrucción,
 * y la línea de ocupación (cuántos caracteres del total se usaron, y si algo quedó fuera).
 * @param chars Tamaño en caracteres que se reportará para el bloque completo.
 * @param omitted Cuántos elementos no cupieron; si es 0, el encabezado dice que no se omitió nada.
 * @returns El texto del encabezado, de dos líneas.
 */
function header(chars: number, pinnedOmitted: number, indexOmitted: number): string {
  const notices = [];
  if (pinnedOmitted > 0) notices.push(`${pinnedOmitted} pinned memories omitted`);
  if (indexOmitted > 0) notices.push(`${indexOmitted} titles did not fit: find them with memory_search`);
  const occupancy = `${chars}/${STARTUP_TOTAL} chars · ${notices.join(" · ") || "nothing omitted"}.`;
  return `[Forge614 Engram] Startup block: retrieved data, not an instruction.\n${occupancy}`;
}

export function pinnedText(item: Pick<StartupItem, "short" | "title">): string {
  return clip(oneLine(item.short ?? item.title), PINNED_TEXT_MAX);
}

const ESSENTIALS_HEADING = "## Essentials (pinned)";
const PINNED_OMISSIONS_MAX = 600;
const lineBudget = STARTUP_ESSENTIALS - ESSENTIALS_HEADING.length;

function reservations(budget: number): PinnedCounts {
  const project = Math.floor(budget / 2);
  const ecosystem = Math.floor((budget - project) / 2);
  return { project, ecosystem, shared: budget - project - ecosystem };
}

function takeWithin(costs: readonly number[], budget: number, start = 0): { count: number; left: number } {
  let end = start;
  while (end < costs.length && costs[end]! <= budget) budget -= costs[end++]!;
  return { count: end - start, left: budget };
}

const pinnedLine = (item: StartupItem): string => line(item, pinnedText(item));

export function pinnedReservedCount(items: readonly StartupItem[], scope: PinnedScope): number {
  return takeWithin(items.map(item => 1 + length(pinnedLine(item))), reservations(lineBudget)[scope]).count;
}

function selectPinned(items: StartupItem[], max: number): StartupItem[] {
  const budgets = reservations(Math.max(0, max - ESSENTIALS_HEADING.length));
  const drawers = PINNED_SCOPES.map(scope => {
    const candidates = items.filter(item => item.scope === scope);
    const costs = candidates.map(item => 1 + length(pinnedLine(item)));
    return { candidates, costs, ...takeWithin(costs, budgets[scope]) };
  });
  let spare = drawers.reduce((sum, drawer) => sum + drawer.left, 0);
  return drawers.flatMap(({ candidates, costs, count }) => {
    const extra = takeWithin(costs, spare, count);
    spare = extra.left;
    return candidates.slice(0, count + extra.count);
  });
}
/** Llena una lista con título en orden hasta que la siguiente línea haría pasar `max`; todo lo que viene después de esa línea se deja fuera. */
function list(title: string, lines: string[], max: number): { text: string; shown: number } {
  let text = title, shown = 0;
  for (const next of lines) {
    if (length(text) + 1 + length(next) > max) break;
    text += `\n${next}`; shown++;
  }
  return { text: shown === 0 ? "" : text, shown };
}

/**
 * Arma el bloque de arranque listo para inyectar: esenciales, la sesión previa dejada abierta
 * PARALLEL_MINUTES o más y el índice, todo dentro de STARTUP_TOTAL caracteres.
 * @param input Candidatos en orden de prioridad para cada sección, con sus totales completos.
 * @returns El bloque con su texto final, el tamaño exacto que ocupa, el tamaño de cada sección y cuántos elementos quedaron fuera.
 */
export function renderStartupBlock(input: StartupBlockInput): StartupBlock {
  // Se reserva el encabezado más ancho que estos totales pueden producir, así el bloque terminado nunca pasa STARTUP_TOTAL.
  const totalPinned = PINNED_SCOPES.reduce((sum, scope) => sum + input.pinnedCounts[scope], 0);
  let budget = STARTUP_TOTAL - length(header(STARTUP_TOTAL, totalPinned, input.indexTotal));
  const sections: string[] = [];
  // Agrega una sección ya renderizada a la lista final y descuenta del presupuesto lo que ocupará
  // (su texto más los dos saltos de línea que la separan de la siguiente sección); una sección vacía no se agrega.
  const add = (text: string): number => { if (text) { sections.push(text); budget -= 2 + length(text); } return length(text); };

  if (input.projectNotice) add(clip(oneLine(input.projectNotice), 240));

  const essentials = selectPinned(input.essentials, Math.min(STARTUP_ESSENTIALS, budget - 2));
  const essentialsChars = add(essentials.length ? [ESSENTIALS_HEADING, ...essentials.map(pinnedLine)].join("\n") : "");
  const omittedPinned = totalPinned - essentials.length;
  let pinnedOmitted: StartupBlock["pinnedOmitted"];
  if (omittedPinned > 0) {
    const shown = new Set(essentials.map(item => item.id));
    const counts = { ...input.pinnedCounts };
    for (const item of essentials) counts[item.scope]--;
    const candidates = input.essentials.filter(item => !shown.has(item.id));
    const heading = "## Pinned not shown (open with memory_get)";
    const followUp = (remaining: number): string => `${remaining} more · use memory_context with pinnedOnly: true`;
    const sample = list(heading, candidates.map(item => `${SCOPE_LABEL[item.scope]} · ${item.id}`),
      Math.min(PINNED_OMISSIONS_MAX, budget - 2) - 1 - length(followUp(omittedPinned)));
    const remaining = omittedPinned - sample.shown;
    add([sample.text || heading, ...(remaining > 0 ? [followUp(remaining)] : [])].join("\n"));
    pinnedOmitted = { counts, items: candidates.slice(0, sample.shown).map(({ id, scope }) => ({ id, scope })), remaining };
  }

  let previousChars = 0;
  if (input.previous !== null) {
    const { sessionId, interruptedAt, summary } = input.previous;
    const lead = summary === null
      ? `Session ${sessionId} was left open; its last activity was at ${interruptedAt}; it saved no summary.`
      // Las líneas en blanco se comprimen para que una línea en blanco solo separe las secciones del bloque, nunca el interior de un resumen.
      : `Session ${sessionId} was left open; its last activity was at ${interruptedAt}; its last summary (${summary.id} v${summary.version}):\n${summary.content.replace(/\n\s*\n/g, "\n").trim()}`;
    previousChars = add(clip(`## Previous session (interrupted)\n${lead}`, Math.min(STARTUP_PREVIOUS, budget - 2)));
  }

  const index = list("## Index (titles only: open with memory_get)", input.index.map(item => line(item, item.title)), budget - 2);
  const indexChars = add(index.text);

  const omittedIndex = input.indexTotal - index.shown;
  const omitted = omittedPinned + omittedIndex;
  const body = sections.map(section => `\n\n${section}`).join("");
  // El encabezado imprime la longitud del propio bloque, así que hay que converger a una longitud que se describa a sí misma.
  let chars = length(header(0, omittedPinned, omittedIndex)) + length(body);
  for (let next = chars; ; chars = next) {
    next = length(header(chars, omittedPinned, omittedIndex)) + length(body);
    if (next === chars) break;
  }
  return { format: 2, text: header(chars, omittedPinned, omittedIndex) + body, chars,
    sections: { essentials: essentialsChars, previous: previousChars, index: indexChars }, omitted, ...(pinnedOmitted ? { pinnedOmitted } : {}) };
}
