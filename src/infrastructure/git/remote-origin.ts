/**
 * Lee el remoto `origin` de un repositorio Git directamente del archivo `config` de su directorio
 * común (el que ya calcula `project-directory.ts`), sin ejecutar `git` (así el arranque no se alarga
 * con un proceso más). La usa `src/app/project-context.ts` en cada ruta de escritura, para anotar el
 * remoto normalizado de un proyecto (D6, identidad de proyecto por remoto de Git).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Encabezado de sección de un archivo de configuración de Git: "[tipo]" o "[tipo \"subsección\"]",
// con espacios tolerados alrededor. El tipo de sección es insensible a mayúsculas; la subsección no.
const SECTION = /^\s*\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]/u;
// Una asignación "clave = valor" dentro de una sección, con espacios y tabuladores tolerados
// alrededor del "=". La clave es insensible a mayúsculas, como en el resto de Git.
const ASSIGNMENT = /^\s*([^\s=;#]+)\s*=\s*(.*)$/u;

/**
 * Lee, sin ejecutar `git`, el valor crudo de `url` dentro de la sección `[remote "origin"]` del
 * archivo `config` de un directorio común de Git.
 *
 * Limitación documentada: no resuelve `include`, `includeIf` ni `insteadOf` (directivas de Git que
 * traen configuración de otro archivo o la reescriben); solo lee lo que está escrito directamente en
 * este archivo. Quien llama debe normalizar el valor devuelto (con `normalizeRemote`) antes de
 * compararlo o guardarlo: este lector nunca normaliza ni valida, solo devuelve el texto tal cual.
 * @param commonDirectory Directorio común de Git (`.git`, o su equivalente en un `worktree`) que
 * contiene el archivo `config` a leer.
 * @returns El valor crudo de `url` dentro de `[remote "origin"]`, o `null` si el archivo no existe, no
 * se puede leer, o esa sección no declara ninguna línea `url`. Nunca lanza.
 */
export function readOriginRemote(commonDirectory: string): string | null {
  let text: string;
  try {
    // Se lee de una vez el archivo entero: son unas pocas líneas, no hace falta leerlo por partes.
    text = readFileSync(join(commonDirectory, "config"), "utf8");
  } catch {
    // Sin archivo, sin permiso de lectura, o cualquier otro fallo: se trata como "no hay remoto anotado".
    return null;
  }
  // Se recorre línea por línea, llevando si la línea actual cae dentro de la sección [remote "origin"].
  let insideOrigin = false;
  for (const line of text.split(/\r?\n/u)) {
    const section = SECTION.exec(line);
    if (section) {
      // Una nueva sección reemplaza la anterior: solo cuenta como "origin" si el tipo es "remote" y la
      // subsección entre comillas es exactamente "origin" (las subsecciones de Git distinguen mayúsculas).
      insideOrigin = section[1]!.toLowerCase() === "remote" && section[2] === "origin";
      continue;
    }
    if (!insideOrigin) continue;
    const assignment = ASSIGNMENT.exec(line);
    if (!assignment || assignment[1]!.toLowerCase() !== "url") continue;
    return unquote(stripComment(assignment[2]!));
  }
  // Se recorrió el archivo entero (o no había sección [remote "origin"], o no tenía línea "url").
  return null;
}

/**
 * Quita de un valor de configuración de Git el comentario final (`#` o `;`) que no está dentro de
 * comillas, y recorta los espacios sobrantes.
 * @param value Lo que sigue al "=" de una asignación, sin procesar todavía.
 * @returns El valor sin su comentario final, recortado.
 */
function stripComment(value: string): string {
  let insideQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    // Una comilla que no está escapada (\") abre o cierra el tramo entre comillas.
    if (char === "\"" && value[i - 1] !== "\\") insideQuotes = !insideQuotes;
    else if (!insideQuotes && (char === "#" || char === ";")) return value.slice(0, i).trim();
  }
  return value.trim();
}

/**
 * Quita las comillas envolventes de un valor de configuración de Git, si las tiene.
 * @param value Valor ya sin comentario final.
 * @returns `value` sin sus comillas envolventes; tal cual si no estaba entre comillas.
 */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
}
