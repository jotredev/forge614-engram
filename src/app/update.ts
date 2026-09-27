/**
 * Actualiza el binario (programa ya compilado) de Forge614 Engram instalado en la
 * máquina, delegando la descarga e instalación en `updateInstalledEngram`. Esconde
 * cualquier error del instalador detrás de un único código de error, para no filtrar
 * detalles del sistema (como rutas o variables de entorno) hacia quien llama.
 */
import { updateInstalledEngram } from "../infrastructure/updater";
import { MemoryError } from "../shared/errors";

/** Resultado de intentar actualizar el binario instalado. */
export interface EngramUpdateResult {
  /** Si la versión instalada cambió (`false` cuando ya estaba en la última versión). */
  updated: boolean;
  /** Versión que estaba instalada antes de intentar actualizar. */
  previousVersion: string;
  /** Versión que quedó instalada tras el intento (igual a `previousVersion` si no hubo cambio). */
  installedVersion: string;
}

/**
 * Ejecuta la actualización del binario instalado, comparándolo con `currentVersion`.
 * @param currentVersion Versión que el programa en ejecución cree tener instalada.
 * @param dependencies `quiet` silencia la salida del instalador; `run` sustituye la
 * llamada real al instalador (usado en las pruebas para no descargar nada de verdad).
 * @returns El resultado de `updateInstalledEngram` (o de `dependencies.run`, si se dio).
 * @throws MemoryError con código `UPDATE_FAILED` si el instalador falla por cualquier motivo.
 */
export async function updateEngram(
  currentVersion: string,
  dependencies: { quiet?: boolean; run?: () => Promise<EngramUpdateResult> } = {},
): Promise<EngramUpdateResult> {
  try {
    return await (dependencies.run ?? (() => updateInstalledEngram(currentVersion, dependencies.quiet ? { quiet: true } : {})))();
  } catch {
    throw new MemoryError("UPDATE_FAILED", "No se pudo actualizar Forge614 Engram.");
  }
}
