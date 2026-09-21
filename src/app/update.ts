import { updateInstalledEngram } from "../infrastructure/updater";
import { MemoryError } from "../shared/errors";

export interface EngramUpdateResult {
  updated: boolean;
  previousVersion: string;
  installedVersion: string;
}

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
