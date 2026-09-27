/**
 * Lee el nombre de ecosistema (grupo de proyectos relacionados) declarado en el archivo `forge614.node.json`
 * de una carpeta, si existe y es válido; lo usa `src/app/project-identity.ts` para saber a qué ecosistema
 * pertenece el proyecto actual.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { groupName } from "../../modules/ecosystem";

const MAX_BYTES = 64 * 1024;

/**
 * `forge614.node.json` pertenece a otro nodo del ecosistema Forge614: Engram solo lee su campo opcional
 * `ecosystem` (el nombre del grupo al que pertenece el proyecto) e ignora cualquier cosa que no pueda usar
 * de forma segura; la validación completa de ese archivo es responsabilidad del verificador del ecosistema,
 * no de Engram.
 * @param root Carpeta del proyecto donde buscar `forge614.node.json`.
 * @returns El nombre de ecosistema declarado y ya validado por {@link groupName}, o `null` si el archivo no
 * existe, es un enlace simbólico, supera {@link MAX_BYTES}, no es JSON de un objeto, no declara `ecosystem`
 * como cadena, o esa cadena no es un nombre de grupo válido.
 */
export function readNodeEcosystem(root: string): string | null {
  const path = join(root, "forge614.node.json");
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_BYTES) return null;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const declared = (value as { ecosystem?: unknown }).ecosystem;
    return typeof declared === "string" ? groupName(declared) : null;
  } catch { return null; }
}
