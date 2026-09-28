/** Punto de entrada del módulo `projects`: reexporta el tipo `Project`, la validación de identidad de
 * proyecto y la identidad de proyecto por remoto de Git (D6: normalización y coincidencia). No se
 * reexporta desde `src/index.ts`: es un detalle interno, no entra al SDK público. */
export type { Project } from "./types";
export { projectIdentity } from "./identity";
export { normalizeRemote, matchProjectByRemote } from "./remote";
