import { createHash } from "node:crypto";
import { MemoryError } from "../../shared/errors";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GROUP_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GROUP_NAME_MAXIMUM = 64;
export const FORGE614_GROUP_NAME = "forge614";
/** Fixed identity of the group every Forge614 node declares in forge614.node.json. */
export const FORGE614_GROUP_ID = "e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4";

export function uuidV4(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) throw new MemoryError("INVALID_INPUT", "El identificador debe ser un UUID v4 válido.");
  return value;
}
export function groupIdentity(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) throw new MemoryError("INVALID_INPUT", "groupId debe ser un UUID válido de grupo, no su nombre.");
  return value;
}
export function groupName(value: unknown): string {
  if (typeof value !== "string" || value.length > GROUP_NAME_MAXIMUM || !GROUP_NAME.test(value)) {
    throw new MemoryError("GROUP_NAME_INVALID", "El nombre del grupo usa minúsculas, dígitos y guiones simples (por ejemplo mi-tienda), de 1 a 64 caracteres.");
  }
  return value;
}
/**
 * A node file only carries the group name, so every machine derives the same identity from it.
 * Groups created by hand with group-create get a random identity instead.
 */
export function declaredGroupId(name: unknown): string {
  const hex = createHash("sha256").update(`forge614-ecosystem-group:${groupName(name)}`).digest("hex");
  const variant = "89ab"[Number.parseInt(hex[16]!, 16) % 4]!;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return name === FORGE614_GROUP_NAME ? FORGE614_GROUP_ID : id;
}
