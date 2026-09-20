import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const latestInstaller = "https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh";

type Spawn = (command: string, args: string[]) => { status: number | null; stderr?: string | Buffer; error?: Error };
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;

async function downloadInstaller(url: string): Promise<{ installer: string; cleanup: () => void }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the Forge614 Engram installer.");
  const directory = mkdtempSync(join(tmpdir(), "forge614-engram-update-"));
  const installer = join(directory, "install.sh");
  writeFileSync(installer, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  chmodSync(installer, 0o700);
  return { installer, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export async function updateInstalledEngram(options: { download?: Download; spawn?: Spawn } = {}): Promise<void> {
  const downloaded = await (options.download ?? downloadInstaller)(latestInstaller);
  const spawn = options.spawn ?? ((command, args) => spawnSync(command, args, { stdio: "inherit" }));
  try {
    const result = spawn("bash", [downloaded.installer, "--force"]);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
      throw new Error(stderr || "Forge614 Engram update failed.");
    }
  } finally {
    downloaded.cleanup();
  }
}
