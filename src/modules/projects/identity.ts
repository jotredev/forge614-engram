/**
 * Valida el identificador (UUID v4) de un proyecto. Lo usa la capa SQLite (`src/infrastructure/sqlite`)
 * para comprobar que un `projectId` recibido tiene forma de UUID antes de usarlo en una consulta, y no,
 * por ejemplo, el nombre del proyecto.
 */
import { MemoryError } from "../../shared/errors";
/**
 * Comprueba que un valor sea el identificador (UUID v4) de un proyecto, no su nombre.
 * @param value Valor a validar; puede ser de cualquier tipo, típicamente lo que llega de un llamador externo.
 * @returns El mismo valor, ya confirmado como UUID v4 de proyecto.
 * @throws MemoryError con código "INVALID_INPUT" si no es una cadena o no cumple el formato UUID v4.
 */
export function projectIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new MemoryError("INVALID_INPUT", "projectId debe ser un UUID válido de proyecto, no su nombre.");
  return value;
}
