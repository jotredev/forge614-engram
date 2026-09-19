import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../install.sh");
const temporaryDirectories: string[] = [];
const fixtureBytes = "#!/usr/bin/env sh\nprintf 'fixture release binary\\n'\n";
const testReleaseBaseUrl = "FORGE614_ENGRAM_TEST_RELEASE_BASE_URL";
const testMode = "FORGE614_ENGRAM_INSTALLER_TEST";

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "forge614-installer-"));
  temporaryDirectories.push(directory);
  return directory;
}

function markerCount(contents: string) {
  return contents.split("# >>> forge614-engram PATH >>>").length - 1;
}

function targetArtifact() {
  const target = `${process.platform}/${process.arch}`;
  const artifacts: Record<string, string> = {
    "darwin/x64": "forge614-engram-darwin-x64",
    "darwin/arm64": "forge614-engram-darwin-arm64",
    "linux/x64": "forge614-engram-linux-x64",
    "linux/arm64": "forge614-engram-linux-arm64",
  };
  const artifact = artifacts[target];
  if (!artifact) throw new Error(`Unsupported test host: ${target}`);
  return artifact;
}

function sha256(path: string) {
  const result = Bun.spawnSync(["shasum", "-a", "256", path]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().split(/\s+/)[0]!;
}

async function runInstaller(args: string[]) {
  const child = Bun.spawn(["/usr/bin/env", "bash", installer, ...args], {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

async function withFixtureEnvironment<T>(
  home: string,
  releaseBaseUrl: string,
  operation: () => Promise<T>,
  includeTestSentinel = true,
  shell?: string,
) {
  const saved = {
    home: process.env.HOME,
    shell: process.env.SHELL,
    releaseBaseUrl: process.env[testReleaseBaseUrl],
    testMode: process.env[testMode],
  };
  process.env.HOME = home;
  if (shell === undefined) delete process.env.SHELL;
  else process.env.SHELL = shell;
  process.env[testReleaseBaseUrl] = releaseBaseUrl;
  if (includeTestSentinel) process.env[testMode] = "1";
  else delete process.env[testMode];
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries({
      HOME: saved.home,
      SHELL: saved.shell,
      [testReleaseBaseUrl]: saved.releaseBaseUrl,
      [testMode]: saved.testMode,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function fixtureReleaseServer(artifact: string, fixturePath: string) {
  const digest = sha256(fixturePath);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const mismatch = url.pathname.startsWith("/mismatch/");
      const unsafeAssets = url.pathname.startsWith("/unsafe-assets/");
      const prefix = mismatch ? "/mismatch" : "/good";
      const baseUrl = `http://${url.host}${prefix}`;
      const assetBaseUrl = unsafeAssets ? "https://127.0.0.1:1" : baseUrl;
      if (url.pathname.endsWith("/releases/latest") || url.pathname.includes("/releases/tags/")) {
        return Response.json({
          assets: [
            { name: "SHA256SUMS", browser_download_url: `${assetBaseUrl}/download/SHA256SUMS` },
            { name: artifact, browser_download_url: `${assetBaseUrl}/download/${artifact}` },
          ],
        });
      }
      if (url.pathname.endsWith("/download/SHA256SUMS")) {
        const manifestDigest = mismatch ? "0".repeat(64) : digest;
        return new Response(`${manifestDigest}  ${artifact}\n`);
      }
      if (url.pathname.endsWith(`/download/${artifact}`)) {
        return new Response(readFileSync(fixturePath));
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

test.each([
  ["zsh", "/bin/zsh", ".zshrc"],
  ["bash", "/bin/bash", process.platform === "darwin" ? ".bash_profile" : ".bashrc"],
  ["fish", "/usr/bin/fish", ".config/fish/conf.d/forge614-engram.fish"],
])("publishes a custom bin directory once for %s", async (_name, shell, configurationFile) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "custom-bin");
  const fakeHome = join(root, "home");
  const configurationPath = join(fakeHome, configurationFile);
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(resolve(configurationPath, ".."), { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  writeFileSync(configurationPath, "# unrelated configuration\nexport KEEP_THIS=1\n");
  const server = fixtureReleaseServer(targetArtifact(), fixture);

  try {
    const first = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, shell);
    const second = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination, "--force"]), true, shell);
    const configuration = readFileSync(configurationPath, "utf8");

    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(first.stdout).toContain(configurationPath);
    expect(first.stdout).toContain("new terminal");
    expect(configuration).toContain("# unrelated configuration");
    expect(configuration).toContain("export KEEP_THIS=1");
    expect(configuration).toContain(destination);
    expect(configuration).toContain(
      shell.endsWith("fish") ? `set -gx PATH ${destination} $PATH` : `export PATH=${destination}:"$PATH"`,
    );
    expect(markerCount(configuration)).toBe(1);
  } finally {
    server.stop(true);
  }
});

test.each([
  ["zsh", "/bin/zsh", ".zshrc"],
  ["bash", "/bin/bash", process.platform === "darwin" ? ".bash_profile" : ".bashrc"],
])("keeps inherited PATH entries usable when sourcing the %s block", async (_name, shell, configurationFile) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "custom bin");
  const fakeHome = join(root, "home");
  const configurationPath = join(fakeHome, configurationFile);
  mkdirSync(resolve(configurationPath, ".."), { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);

  try {
    const installation = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, shell);
    const sourced = Bun.spawnSync([
      "/usr/bin/env",
      "bash",
      "-c",
      'PATH=/usr/bin:/bin\nsource "$1"\nenv printf "%s\\n" "$PATH"',
      "bash",
      configurationPath,
    ]);

    expect(installation.exitCode, installation.stderr).toBe(0);
    expect(sourced.exitCode, sourced.stderr.toString()).toBe(0);
    expect(sourced.stdout.toString()).toBe(`${destination}:/usr/bin:/bin\n`);
  } finally {
    server.stop(true);
  }
});

test.each([
  ["incomplete", "# >>> forge614-engram PATH >>>\nexport KEEP_THIS=1\n"],
  ["nested", "# >>> forge614-engram PATH >>>\nexport KEEP_THIS=1\n# >>> forge614-engram PATH >>>\n# <<< forge614-engram PATH <<<\n# <<< forge614-engram PATH <<<\n"],
  ["unmatched closing", "export KEEP_THIS=1\n# <<< forge614-engram PATH <<<\n"],
  ["complete then incomplete", "# >>> forge614-engram PATH >>>\nexport OLD_PATH=1\n# <<< forge614-engram PATH <<<\n# >>> forge614-engram PATH >>>\nexport KEEP_THIS=1\n"],
])("preserves %s marker files byte-for-byte across repeated installations", async (_name, original) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "custom-bin");
  const configuration = join(root, ".zshrc");
  writeFileSync(fixture, fixtureBytes);
  writeFileSync(configuration, original);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const results = [];
    for (const args of [["--bin-dir", destination], ["--bin-dir", destination, "--force"]]) {
      results.push(await withFixtureEnvironment(root, `${server.url}good`, () => runInstaller(args), true, "/bin/zsh"));
    }
    expect(readFileSync(configuration, "utf8")).toBe(original);
    for (const result of results) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("manually");
    }
    expect(readFileSync(join(destination, "forge614-engram"), "utf8")).toBe(fixtureBytes);
  } finally {
    server.stop(true);
  }
});

test("preserves symlink-managed rc files and offers manual PATH guidance", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const target = join(root, "dotfiles-zshrc");
  const configuration = join(root, ".zshrc");
  const original = "export KEEP_THIS=1\n";
  writeFileSync(fixture, fixtureBytes);
  writeFileSync(target, original);
  symlinkSync("dotfiles-zshrc", configuration);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(root, `${server.url}good`, () => runInstaller(["--bin-dir", join(root, "bin")]), true, "/bin/zsh");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(lstatSync(configuration).isSymbolicLink()).toBe(true);
    expect(readlinkSync(configuration)).toBe("dotfiles-zshrc");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(result.stdout).toContain("manually");
  } finally {
    server.stop(true);
  }
});

test.skipIf(process.platform !== "darwin").each([".profile", ".bash_login"])("preserves macOS Bash login behavior with existing %s", async (profile) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const original = "export FORGE614_EXISTING_PROFILE_LOADED=1\n";
  writeFileSync(fixture, fixtureBytes);
  writeFileSync(join(root, profile), original);
  const login = () => Bun.spawnSync(["/bin/bash", "-lc", 'printf "%s" "${FORGE614_EXISTING_PROFILE_LOADED:-unset}"'], {
    env: { HOME: root, PATH: "/usr/bin:/bin" },
  });
  expect(login().stdout.toString()).toBe("1");
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(root, `${server.url}good`, () => runInstaller(["--bin-dir", join(root, "bin")]), true, "/bin/bash");
    expect(result.exitCode, result.stderr).toBe(0);
    const after = login();
    expect(after.exitCode, after.stderr.toString()).toBe(0);
    expect(after.stdout.toString()).toBe("1");
    expect(existsSync(join(root, ".bash_profile"))).toBe(false);
    expect(readFileSync(join(root, profile), "utf8")).toBe(original);
    expect(result.stdout).toContain("manually");
  } finally {
    server.stop(true);
  }
});

for (const [shell, configurationFile] of [
  ["bash", process.platform === "darwin" ? ".bash_profile" : ".bashrc"],
  ["zsh", ".zshrc"],
  ["fish", ".config/fish/conf.d/forge614-engram.fish"],
] as const) {
  test.skipIf(!Bun.which(shell))(`avoids inherited or repeated runtime PATH entries in ${shell}`, async () => {
    const executable = Bun.which(shell);
    if (!executable) throw new Error(`Missing shell: ${shell}`);
    const root = temporaryDirectory();
    const fixture = join(root, "fixture-binary");
    const destination = join(root, "custom bin [literal]");
    writeFileSync(fixture, fixtureBytes);
    const server = fixtureReleaseServer(targetArtifact(), fixture);
    try {
      const result = await withFixtureEnvironment(root, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, executable);
      expect(result.exitCode, result.stderr).toBe(0);
      const pathCases = [
        ["/usr/bin:/bin", `${destination}:/usr/bin:/bin`],
        [`/usr/bin:${destination}:/bin`, `/usr/bin:${destination}:/bin`],
        [`${destination}:/usr/bin:/bin`, `${destination}:/usr/bin:/bin`],
        [`/usr/bin:/bin:${destination}`, `/usr/bin:/bin:${destination}`],
        [`${destination}-other:/usr/bin:/bin`, `${destination}:${destination}-other:/usr/bin:/bin`],
      ] as const;
      for (const [inherited, expected] of pathCases) {
        const code = shell === "fish"
          ? 'source "$argv[1]"; source "$argv[1]"; string join : -- $PATH'
          : 'source "$1"; source "$1"; printf "%s\\n" "$PATH"';
        const args = shell === "fish" ? [join(root, configurationFile)] : [shell, join(root, configurationFile)];
        const sourced = Bun.spawnSync([executable, "-c", code, ...args], { env: { HOME: root, PATH: inherited } });
        expect(sourced.exitCode, sourced.stderr.toString()).toBe(0);
        expect(sourced.stdout.toString()).toBe(`${expected}\n`);
      }
    } finally {
      server.stop(true);
    }
  });
}

test("leaves shell files untouched and prints manual PATH guidance for an unknown shell", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "custom-bin");
  const fakeHome = join(root, "home");
  const shellFiles = [".zshrc", ".bashrc", ".bash_profile", ".config/fish/conf.d/forge614-engram.fish"];
  mkdirSync(fakeHome, { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  for (const shellFile of shellFiles) {
    const path = join(fakeHome, shellFile);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `unrelated ${shellFile}\n`);
  }
  const server = fixtureReleaseServer(targetArtifact(), fixture);

  try {
    const first = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, "/bin/unknown");
    const second = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination, "--force"]), true, "/bin/unknown");

    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(first.stdout).toContain(`export PATH=${destination}:\"$PATH\"`);
    expect(first.stdout).toContain("manually");
    expect(second.stdout).toContain("manually");
    for (const shellFile of shellFiles) {
      expect(readFileSync(join(fakeHome, shellFile), "utf8")).toBe(`unrelated ${shellFile}\n`);
    }
  } finally {
    server.stop(true);
  }
});

test("downloads a verified release binary without writing user state", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "empty-home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  chmodSync(fixture, 0o755);
  const artifact = targetArtifact();
  const server = fixtureReleaseServer(artifact, fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () =>
      runInstaller(["--bin-dir", destination]),
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(destination, "forge614-engram"))).toBe(true);
    expect(readFileSync(join(destination, "forge614-engram"), "utf8")).toBe(fixtureBytes);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
    expect(result.stdout).toContain("forge614-engram setup");
  } finally {
    server.stop(true);
  }
});

test("default install uses the product bin and preserves Forge614 Shell", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const fakeHome = join(root, "home");
  const shellFile = join(fakeHome, ".forge614", "shell", "keep");
  mkdirSync(resolve(shellFile, ".."), { recursive: true });
  writeFileSync(shellFile, "unchanged");
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller([]), true, "/bin/unknown");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(fakeHome, ".forge614", "engram", "bin", "forge614-engram"))).toBe(true);
    expect(readFileSync(shellFile, "utf8")).toBe("unchanged");
    if (process.platform !== "win32") {
      expect(statSync(join(fakeHome, ".forge614", "engram")).mode & 0o777).toBe(0o700);
      expect(statSync(join(fakeHome, ".forge614", "engram", "bin")).mode & 0o777).toBe(0o700);
    }
  } finally { server.stop(true); }
});

test("refuses replacement without force", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "empty-home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]));
    const secondWithoutForce = await withFixtureEnvironment(fakeHome, `${server.url}good`, () =>
      runInstaller(["--bin-dir", destination]),
    );
    expect(secondWithoutForce.exitCode).not.toBe(0);
    expect(readFileSync(join(destination, "forge614-engram"), "utf8")).toBe(fixtureBytes);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("rejects a checksum mismatch before creating the destination", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const mismatchDestination = join(root, "checksum-mismatch-bin");
  const fakeHome = join(root, "empty-home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const checksumMismatch = await withFixtureEnvironment(fakeHome, `${server.url}mismatch`, () =>
      runInstaller(["--bin-dir", mismatchDestination]),
    );
    expect(checksumMismatch.exitCode).not.toBe(0);
    expect(existsSync(join(mismatchDestination, "forge614-engram"))).toBe(false);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
  } finally {
    server.stop(true);
  }
});

test.each([
  ["an HTTPS endpoint", "https://127.0.0.1:1"],
  ["a userinfo endpoint", "http://127.0.0.1:5432@localhost:1"],
])("rejects %s before downloading", async (_description, releaseBaseUrl) => {
  const root = temporaryDirectory();
  const fakeHome = join(root, "empty-home");
  const destination = join(root, "untrusted-bin");
  mkdirSync(fakeHome);

  const result = await withFixtureEnvironment(fakeHome, releaseBaseUrl, () =>
    runInstaller(["--bin-dir", destination]),
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("test release endpoint must be a loopback HTTP URL");
  expect(existsSync(destination)).toBe(false);
  expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
});

test("rejects a test endpoint without the test sentinel", async () => {
  const root = temporaryDirectory();
  const fakeHome = join(root, "empty-home");
  const destination = join(root, "untrusted-bin");
  mkdirSync(fakeHome);

  const result = await withFixtureEnvironment(fakeHome, "http://127.0.0.1:1", () =>
    runInstaller(["--bin-dir", destination]),
  false);

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("reserved for test fixtures");
  expect(existsSync(destination)).toBe(false);
  expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
});

test("rejects non-loopback release asset URLs from a test fixture", async () => {
  const root = temporaryDirectory();
  const fakeHome = join(root, "empty-home");
  const destination = join(root, "untrusted-bin");
  const fixture = join(root, "fixture-binary");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}unsafe-assets`, () =>
      runInstaller(["--bin-dir", destination]),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unsafe test fixture URL");
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
  } finally {
    server.stop(true);
  }
});
