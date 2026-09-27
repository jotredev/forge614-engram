/**
 * Reglas de validación e identidad de los grupos del ecosistema: qué es un UUID v4 válido, qué nombre
 * de grupo se acepta, y cómo se calcula el identificador determinista (siempre el mismo a partir del
 * mismo nombre) que declara un archivo `forge614.node.json`. Lo usan `src/infrastructure/sqlite/ecosystem-groups.ts`
 * y `writes.ts` para validar antes de guardar, y `src/app/workspace.ts` al resolver un
 * grupo por su nombre.
 */
import { createHash } from "node:crypto";
import { MemoryError } from "../../shared/errors";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GROUP_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GROUP_NAME_MAXIMUM = 64;
export const FORGE614_GROUP_NAME = "forge614";
/** Identidad fija del grupo que declara cada nodo (máquina) de Forge614 en su `forge614.node.json`. */
export const FORGE614_GROUP_ID = "e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4";

/**
 * Comprueba que un valor sea una cadena con forma de UUID v4 (identificador único de 36 caracteres con
 * la variante y versión correctas) y lo devuelve tal cual si es válido.
 * @param value Valor a validar; puede ser de cualquier tipo, típicamente lo que llega de un llamador externo.
 * @returns El mismo valor, ya confirmado como UUID v4.
 * @throws MemoryError con código "INVALID_INPUT" si no es una cadena o no cumple el formato UUID v4.
 */
export function uuidV4(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) throw new MemoryError("INVALID_INPUT", "El identificador debe ser un UUID v4 válido.");
  return value;
}
/**
 * Comprueba que un valor sea el identificador (UUID) de un grupo, no su nombre legible. Usa la misma
 * validación de formato que `uuidV4`, pero con un mensaje de error específico para este caso de uso.
 * @param value Valor a validar como identificador de grupo.
 * @returns El mismo valor, ya confirmado como UUID v4.
 * @throws MemoryError con código "INVALID_INPUT" si no es un UUID v4 válido.
 */
export function groupIdentity(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) throw new MemoryError("INVALID_INPUT", "groupId debe ser un UUID válido de grupo, no su nombre.");
  return value;
}
/**
 * Comprueba que un valor sea un nombre de grupo válido: minúsculas y dígitos separados por guiones
 * simples, sin guiones al inicio, al final ni dobles, y de 1 a `GROUP_NAME_MAXIMUM` caracteres.
 * @param value Valor a validar como nombre de grupo.
 * @returns El mismo valor, ya confirmado como nombre válido.
 * @throws MemoryError con código "GROUP_NAME_INVALID" si no es una cadena, excede el largo máximo o no cumple el patrón.
 */
export function groupName(value: unknown): string {
  if (typeof value !== "string" || value.length > GROUP_NAME_MAXIMUM || !GROUP_NAME.test(value)) {
    throw new MemoryError("GROUP_NAME_INVALID", "El nombre del grupo usa minúsculas, dígitos y guiones simples (por ejemplo mi-tienda), de 1 a 64 caracteres.");
  }
  return value;
}
/**
 * Calcula el identificador (UUID v4) que le corresponde a un nombre de grupo declarado en un archivo de
 * nodo (`forge614.node.json`): un archivo de nodo solo lleva el nombre del grupo, así que cada máquina
 * debe derivar la misma identidad a partir de él (por eso el cálculo es un hash determinista y no un
 * identificador aleatorio). Los grupos creados a mano con `group-create` reciben en cambio una identidad
 * aleatoria, fuera de esta función.
 * @param name Nombre del grupo tal como aparece en el archivo de nodo; se valida con `groupName`.
 * @returns El UUID v4 derivado del nombre; para el nombre `forge614` siempre es `FORGE614_GROUP_ID` fijo.
 * @throws MemoryError con código "GROUP_NAME_INVALID" si `name` no es un nombre de grupo válido.
 */
export function declaredGroupId(name: unknown): string {
  // El hash SHA-256 del nombre da 32 bytes hexadecimales; de ahí se arma un UUID v4 válido tomando
  // los tramos exigidos por el formato y forzando el nibble de versión (4) y el de variante (8, 9, a o b).
  const hex = createHash("sha256").update(`forge614-ecosystem-group:${groupName(name)}`).digest("hex");
  const variant = "89ab"[Number.parseInt(hex[16]!, 16) % 4]!;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return name === FORGE614_GROUP_NAME ? FORGE614_GROUP_ID : id;
}
