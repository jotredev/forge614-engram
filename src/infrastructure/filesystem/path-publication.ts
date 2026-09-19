import { join } from "node:path";
import { AssistantConfigurationError, fail, guardedWrite, readSafeFile, type PrivateWrite } from "./private-files";

const START = "# >>> forge614-engram PATH >>>";
const END = "# <<< forge614-engram PATH <<<";

export interface PathPublicationOptions {
  readonly home: string;
  readonly platform?: NodeJS.Platform;
  readonly runWindowsRemoval?: (directory: string) => Promise<boolean>;
}

function shellQuote(value: string): string {
  return value.replace(/[^A-Za-z0-9_@%+=:,./-]/g, character => `\\${character}`);
}

function expectedUnixBody(directory: string, fish: boolean): string {
  const quoted = shellQuote(directory);
  return fish
    ? `if not contains -- ${quoted} $PATH\n  set -gx PATH ${quoted} $PATH\nend`
    : `case ":$PATH:" in\n  *:${quoted}:*) ;;\n  *) export PATH=${quoted}:"$PATH" ;;\nesac`;
}

function removeMarkedBlock(path: string, directory: string, fish: boolean): PrivateWrite | null {
  const before = readSafeFile(path);
  if (before === null) return null;
  const lines = before.split("\n");
  const starts = lines.reduce<number[]>((all, line, index) => line === START ? [...all, index] : all, []);
  const ends = lines.reduce<number[]>((all, line, index) => line === END ? [...all, index] : all, []);
  if (starts.length === 0 && ends.length === 0) return null;
  const start = starts[0];
  const end = ends[0];
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end <= start) {
    fail("PATH_CONFLICT", "The Forge614 Engram PATH block was changed or duplicated. It was not removed.");
  }
  const body = lines.slice(start + 1, end).join("\n");
  if (body !== expectedUnixBody(directory, fish)) {
    fail("PATH_CONFLICT", "The Forge614 Engram PATH block was edited. It was not removed.");
  }
  const after = [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n");
  return { path, before, after, kind: "config" };
}

function unixWrites(home: string): PrivateWrite[] {
  const directory = join(home, ".forge614", "engram", "bin");
  const candidates: readonly [string, boolean][] = [
    [join(home, ".zshrc"), false],
    [join(home, ".bash_profile"), false],
    [join(home, ".bashrc"), false],
    [join(home, ".config", "fish", "conf.d", "forge614-engram.fish"), true],
  ];
  const writes: PrivateWrite[] = [];
  for (const [path, fish] of candidates) {
    const write = removeMarkedBlock(path, directory, fish);
    if (write) writes.push(write);
  }
  return writes;
}

async function defaultWindowsRemoval(directory: string): Promise<boolean> {
  const script = [
    "$target = $env:FORGE614_ENGRAM_BIN.TrimEnd([char[]]@('\\', '/'))",
    "$current = [string][Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = @($current -split ';' | Where-Object { $_ -and $_.TrimEnd([char[]]@('\\', '/')) -ine $target })",
    "if ($parts.Count -eq @($current -split ';' | Where-Object { $_ }).Count) { exit 0 }",
    "[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')",
    "exit 0",
  ].join("; ");
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, FORGE614_ENGRAM_BIN: directory }, stdin: "ignore", stdout: "ignore", stderr: "ignore",
  });
  return await child.exited === 0;
}

/** Removes only the exact PATH publication created by Forge614 Engram's installers. */
export async function removePathPublication(options: PathPublicationOptions): Promise<string[]> {
  try {
    const platform = options.platform ?? process.platform;
    if (platform === "win32") {
      const directory = join(options.home, ".forge614", "engram", "bin");
      const removed = await (options.runWindowsRemoval ?? defaultWindowsRemoval)(directory);
      if (!removed) fail("PATH_REMOVE_FAILED", "Forge614 Engram could not remove its Windows PATH entry.");
      return removed ? [directory] : [];
    }
    if (platform !== "darwin" && platform !== "linux") return [];
    const writes = unixWrites(options.home);
    const applied: string[] = [];
    for (const write of writes) {
      guardedWrite(write, () => {}, path => applied.push(path));
    }
    return applied;
  } catch (error) {
    if (error instanceof AssistantConfigurationError) throw error;
    fail("PATH_REMOVE_FAILED", "Forge614 Engram could not safely remove its PATH publication.");
  }
}
