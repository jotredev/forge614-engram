import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const latestInstaller = "https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh";

type SpawnOptions = { stdio: "inherit" };
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; stderr?: string | Buffer; error?: Error };
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;
type ReadInstalledVersion = () => string;

function installedCommand(): string {
  return join(homedir(), ".forge614", "engram", "bin", "forge614-engram");
}

function readInstalledVersion(): string {
  const output = execFileSync(installedCommand(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const match = /^forge614-engram\s+([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?)$/.exec(output);
  if (!match) throw new Error("Installed Forge614 Engram did not report a valid version.");
  return match[1]!;
}

async function downloadInstaller(url: string): Promise<{ installer: string; cleanup: () => void }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the Forge614 Engram installer.");
  const directory = mkdtempSync(join(tmpdir(), "forge614-engram-update-"));
  const installer = join(directory, "install.sh");
  writeFileSync(installer, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  chmodSync(installer, 0o700);
  return { installer, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export async function updateInstalledEngram(currentVersion: string, options: {
  download?: Download;
  spawn?: Spawn;
  readInstalledVersion?: ReadInstalledVersion;
  quiet?: boolean;
} = {}): Promise<{ updated: boolean; previousVersion: string; installedVersion: string }> {
  const downloaded = await (options.download ?? downloadInstaller)(latestInstaller);
  const spawn: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  try {
    const result = spawn("bash", [downloaded.installer, "--force"], options.quiet ? undefined : { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
      throw new Error(stderr || "Forge614 Engram update failed.");
    }
    const previousVersion = currentVersion;
    const installedVersion = (options.readInstalledVersion ?? readInstalledVersion)();
    return { updated: installedVersion !== previousVersion, previousVersion, installedVersion };
  } finally {
    downloaded.cleanup();
  }
}
