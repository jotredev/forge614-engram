import { updateInstalledEngram } from "../infrastructure/updater";

export async function updateEngram(dependencies: { run?: () => Promise<void> } = {}): Promise<void> {
  await (dependencies.run ?? updateInstalledEngram)();
}
