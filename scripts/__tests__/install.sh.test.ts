/**
 * Pruebas de extremo a extremo (end-to-end, contra el proceso real, no simulado) de
 * `scripts/install.sh`: levantan un servidor HTTP local que imita la API de lanzamientos
 * (releases) de GitHub y ejecutan el instalador de verdad como proceso hijo, comprobando que
 * descarga el binario correcto, verifica su suma de comprobación (checksum), agrega el
 * directorio elegido al PATH del shell sin duplicar ni romper lo que ya había, instala
 * Forge614 Engines como dependencia, y rechaza endpoints de prueba inseguros o mal configurados.
 */
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

interface FixtureOptions {
  /** Versión que imprime el `node` falso; `null` no agrega ningún `node` al PATH. */
  nodeVersion?: string | null;
  /** Código de salida del instalador falso de Shell. */
  shellExit?: number;
  /** Reemplaza por completo el PATH del proceso hijo (sin `node` falso). */
  path?: string;
}

function installerLogPath(home: string) {
  return join(home, "installer-calls.log");
}

function installerLog(home: string) {
  const path = installerLogPath(home);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

function writeFakeNode(directory: string, version: string) {
  mkdirSync(directory, { recursive: true });
  const node = join(directory, "node");
  writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  chmodSync(node, 0o755);
}

// Una carpeta con enlaces solo a las herramientas que usa el instalador, para probar un PATH sin `node` o sin `tar`.
function restrictedPathDirectory(root: string, options: { without?: string[]; nodeVersion?: string } = {}) {
  const directory = join(root, "restricted-path");
  mkdirSync(directory, { recursive: true });
  const tools = ["bash", "env", "uname", "curl", "shasum", "sha256sum", "mktemp", "awk", "sed", "tr", "cat", "cp", "chmod", "mkdir", "ln", "rm", "mv", "dirname", "tar"];
  for (const tool of tools) {
    if (options.without?.includes(tool)) continue;
    const found = Bun.which(tool);
    if (found) symlinkSync(found, join(directory, tool));
  }
  if (options.nodeVersion) writeFakeNode(directory, options.nodeVersion);
  return directory;
}

async function withFixtureEnvironment<T>(
  home: string,
  releaseBaseUrl: string,
  operation: () => Promise<T>,
  includeTestSentinel = true,
  shell?: string,
  options: FixtureOptions = {},
) {
  const saved = {
    home: process.env.HOME,
    shell: process.env.SHELL,
    path: process.env.PATH,
    releaseBaseUrl: process.env[testReleaseBaseUrl],
    testMode: process.env[testMode],
    enginesInstaller: process.env.FORGE614_ENGINES_INSTALLER_TEST_URL,
    shellInstaller: process.env.FORGE614_SHELL_INSTALLER_TEST_URL,
  };
  const log = installerLogPath(home);
  process.env.HOME = home;
  if (shell === undefined) delete process.env.SHELL;
  else process.env.SHELL = shell;
  process.env[testReleaseBaseUrl] = releaseBaseUrl;
  if (includeTestSentinel) process.env[testMode] = "1";
  else delete process.env[testMode];
  if (options.path !== undefined) {
    process.env.PATH = options.path;
  } else if (options.nodeVersion !== null) {
    const nodeDirectory = join(home, "fake-node-bin");
    writeFakeNode(nodeDirectory, options.nodeVersion ?? "v22.19.0");
    process.env.PATH = `${nodeDirectory}:${saved.path ?? ""}`;
  }
  if (includeTestSentinel && process.env.FORGE614_ENGINES_INSTALLER_TEST_URL === undefined) {
    const enginesInstaller = join(home, "forge614-engines-test-installer.sh");
    writeFileSync(enginesInstaller, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'forge_home="${FORGE614_HOME:-$HOME/.forge614}"',
      `printf 'engines args=%s home=%s\\n' "$*" "$forge_home" >> '${log}'`,
      'mkdir -p "$forge_home/engines/bin"',
      "printf '#!/usr/bin/env sh\\nexit 0\\n' > \"$forge_home/engines/bin/forge614-engines\"",
      'chmod 700 "$forge_home/engines/bin/forge614-engines"',
    ].join("\n"));
    process.env.FORGE614_ENGINES_INSTALLER_TEST_URL = `file://${enginesInstaller}`;
  }
  if (includeTestSentinel && process.env.FORGE614_SHELL_INSTALLER_TEST_URL === undefined) {
    const shellInstaller = join(home, "forge614-shell-test-installer.sh");
    writeFileSync(shellInstaller, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'shell args=%s home=%s\\n' "$*" "$FORGE614_HOME" >> '${log}'`,
      `if [ ${options.shellExit ?? 0} -ne 0 ]; then exit ${options.shellExit ?? 0}; fi`,
      'mkdir -p "$FORGE614_HOME/shell/bin"',
      "printf '#!/usr/bin/env sh\\nexit 0\\n' > \"$FORGE614_HOME/shell/bin/forge614-shell\"",
      'chmod 700 "$FORGE614_HOME/shell/bin/forge614-shell"',
    ].join("\n"));
    process.env.FORGE614_SHELL_INSTALLER_TEST_URL = `file://${shellInstaller}`;
  }
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries({
      HOME: saved.home,
      SHELL: saved.shell,
      PATH: saved.path,
      [testReleaseBaseUrl]: saved.releaseBaseUrl,
      [testMode]: saved.testMode,
      FORGE614_ENGINES_INSTALLER_TEST_URL: saved.enginesInstaller,
      FORGE614_SHELL_INSTALLER_TEST_URL: saved.shellInstaller,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function fixtureReleaseServer(artifact: string, fixturePath: string) {
  const digest = sha256(fixturePath);
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests += 1;
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
  return Object.assign(server, { requestCount: () => requests });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

// Para cada shell soportado, instala dos veces (con y sin --force) en un directorio bin propio:
// el bloque de PATH debe agregarse una sola vez y el resto del archivo de configuración, quedar igual.
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

// Tras instalar, cargar (source) el bloque agregado debe anteponer el directorio del binario
// al PATH heredado de la terminal, sin perder las rutas que ese PATH ya traía.
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

// Con cuatro formas de bloque de marcadores mal formado (incompleto, anidado, cierre sin
// apertura y uno completo seguido de otro incompleto), el instalador debe negarse a tocar el
// archivo de configuración (queda idéntico byte a byte) y aun así instalar el binario dos veces.
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

// Cuando el archivo de configuración del shell es un enlace simbólico (lo gestiona un
// administrador de dotfiles), el instalador no lo reemplaza -perdería el enlace- y en vez de
// eso imprime la guía manual para agregar el PATH a mano.
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

// Solo en macOS: si ya existe `.profile` o `.bash_login`, crear `.bash_profile` apagaría ese
// archivo en el arranque de una shell de acceso (login shell); el instalador debe dejarlo
// intacto, no crear `.bash_profile` y avisar la guía manual de PATH.
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
  // Con el PATH heredado ya conteniendo el destino en distintas posiciones (al principio, en medio,
  // al final o como prefijo de otro nombre), cargar el bloque agregado dos veces debe dejar el
  // destino una sola vez, sin desordenar el resto de las rutas heredadas.
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

// Con un shell desconocido, ningún archivo de configuración existente se toca (ni con --force) y
// la salida imprime la línea `export PATH=...` para que la persona lo agregue a mano.
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

// Con las variables de entorno por defecto, la instalación descarga el binario de Engram,
// instala Forge614 Engines como dependencia y no crea configuración de ningún cliente de IA.
test("downloads verified Engram and Engines binaries without configuring an AI client", async () => {
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
    expect(existsSync(join(fakeHome, ".forge614", "engines", "bin", "forge614-engines"))).toBe(true);
    expect(existsSync(join(fakeHome, ".claude.json"))).toBe(false);
    expect(result.stdout).toContain("forge614-shell init --product engram");
  } finally {
    server.stop(true);
  }
});

// Sin --bin-dir se usa el directorio del producto bajo `$FORGE614_HOME/engram/bin`, con
// permisos 700, y un archivo ya existente de Forge614 Shell bajo el mismo `$FORGE614_HOME` queda intacto.
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

// Con `FORGE614_HOME` absoluto en el entorno, tanto Engram como Engines se instalan ahí y el
// directorio histórico `$HOME/.forge614` nunca se crea.
test("default install uses an absolute FORGE614_HOME and leaves the historic home untouched", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const fakeHome = join(root, "home");
  const forgeHome = join(root, "forge614-root");
  mkdirSync(fakeHome, { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  const previous = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = forgeHome;
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller([]), true, "/bin/unknown");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(forgeHome, "engram", "bin", "forge614-engram"))).toBe(true);
    expect(existsSync(join(forgeHome, "engines", "bin", "forge614-engines"))).toBe(true);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
    server.stop(true);
  }
});

// Un `FORGE614_HOME` vacío o relativo (no absoluto) debe rechazarse con `INVALID_FORGE614_HOME`
// antes de crear nada, para las dos formas inválidas.
test("installer rejects empty and relative FORGE614_HOME before creating a destination", async () => {
  const root = temporaryDirectory();
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  const previous = process.env.FORGE614_HOME;
  try {
    for (const value of ["", "relative/forge614"]) {
      process.env.FORGE614_HOME = value;
      const result = await withFixtureEnvironment(fakeHome, "http://127.0.0.1:1", () => runInstaller([]));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("INVALID_FORGE614_HOME");
      expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
    }
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
  }
});

// Instalar dos veces sin --force debe fallar en la segunda, dejando intactos tanto el binario ya
// instalado como la dependencia de Engines instalada en la primera vuelta.
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
    expect(existsSync(join(fakeHome, ".forge614", "engines", "bin", "forge614-engines"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

// Si SHA256SUMS no coincide con el binario descargado, el instalador debe fallar antes de crear
// el destino y sin llegar a crear el directorio `$FORGE614_HOME`.
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

// El endpoint de pruebas debe ser HTTP de loopback (127.0.0.1 o localhost) con puerto explícito y
// sin credenciales incrustadas en la URL (userinfo); un endpoint HTTPS o con usuario:contraseña se
// rechaza antes de intentar descargar nada.
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

// Usar el endpoint de lanzamientos (releases) de prueba sin la variable centinela
// `FORGE614_ENGRAM_INSTALLER_TEST=1` debe rechazarse: ese endpoint está reservado a los
// accesorios (fixtures) de prueba.
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

// Aunque el servidor de pruebas responda con URLs de descarga que apuntan a otro host (no de
// loopback), el instalador vuelve a comprobarlas por su cuenta y rechaza el resultado si no lo son.
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

// Con un instalador de Engines de prueba inyectado por variable de entorno, la instalación deja
// el binario de Engines en su lugar y no crea configuración de ningún cliente de IA.
test("installs Forge614 Engines as a dependency without configuring an AI client", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "bin");
  const fakeHome = join(root, "home");
  const enginesInstaller = join(root, "engines-install.sh");
  mkdirSync(fakeHome, { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  writeFileSync(enginesInstaller, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "mkdir -p \"$HOME/.forge614/engines/bin\"",
    "printf '#!/usr/bin/env sh\\nexit 0\\n' > \"$HOME/.forge614/engines/bin/forge614-engines\"",
    "chmod 700 \"$HOME/.forge614/engines/bin/forge614-engines\"",
  ].join("\n"));
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  const previous = process.env.FORGE614_ENGINES_INSTALLER_TEST_URL;
  process.env.FORGE614_ENGINES_INSTALLER_TEST_URL = `file://${enginesInstaller}`;
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(fakeHome, ".forge614", "engines", "bin", "forge614-engines"))).toBe(true);
    expect(existsSync(join(fakeHome, ".claude.json"))).toBe(false);
    expect(existsSync(join(fakeHome, ".codex", "config.toml"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.FORGE614_ENGINES_INSTALLER_TEST_URL;
    else process.env.FORGE614_ENGINES_INSTALLER_TEST_URL = previous;
    server.stop(true);
  }
});

const nodeMissingMessage = "Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer. Nothing was installed. Install Node.js from https://nodejs.org (or run: brew install node) and run this installer again.";
const nodeOldMessage = (found: string) => `Forge614 Engram installs Forge614 Shell, which needs Node.js 22.19 or newer; found ${found}. Nothing was installed. Update Node.js from https://nodejs.org (or run: brew upgrade node) and run this installer again.`;
const tarMissingMessage = "Forge614 Engram installs Forge614 Shell, which needs tar. Nothing was installed. Install tar and run this installer again.";

function shellQuote(value: string) {
  return Bun.spawnSync(["bash", "-c", 'printf "%q" "$1"', "bash", value]).stdout.toString();
}

// Afirmaciones comunes de «no se instaló nada»: ni una petición al servidor de releases, ni carpeta
// de Forge614, ni binario de Engram, y ningún instalador falso (Shell o Engines) fue llamado.
function expectNothingInstalled(home: string, destination: string, requests: number) {
  expect(requests).toBe(0);
  expect(existsSync(join(home, ".forge614"))).toBe(false);
  expect(existsSync(join(destination, "forge614-engram"))).toBe(false);
  expect(installerLog(home)).toEqual([]);
}

// Sin `node` en el PATH, el instalador se detiene antes de bajar nada y explica cómo cumplir el requisito.
test("stops before downloading anything when Node.js is missing", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const path = restrictedPathDirectory(root);
  expect(Bun.spawnSync(["/bin/sh", "-c", "command -v node"], { env: { PATH: path } }).exitCode).not.toBe(0);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, undefined, { path });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBe(`${nodeMissingMessage}\n`);
    expectNothingInstalled(fakeHome, destination, server.requestCount());
  } finally {
    server.stop(true);
  }
});

// Con un Node menor que 22.19 (o una versión ilegible), el instalador se detiene igual y dice qué encontró.
test.each(["v22.18.0", "v21.20.0", "not-a-version"])("stops before downloading anything when Node.js reports %s", async (version) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, undefined, { nodeVersion: version });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBe(`${nodeOldMessage(version)}\n`);
    expectNothingInstalled(fakeHome, destination, server.requestCount());
  } finally {
    server.stop(true);
  }
});

// Sin `tar` (con un Node válido) tampoco se instala nada.
test("stops before downloading anything when tar is missing", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const path = restrictedPathDirectory(root, { without: ["tar"], nodeVersion: "v22.19.0" });
  expect(Bun.spawnSync(["/bin/sh", "-c", "command -v tar"], { env: { PATH: path } }).exitCode).not.toBe(0);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, undefined, { path });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBe(`${tarMissingMessage}\n`);
    expectNothingInstalled(fakeHome, destination, server.requestCount());
  } finally {
    server.stop(true);
  }
});

// Node 22.19.0 (el mínimo) y 23.0.0 (mayor superior) son aceptados y la instalación termina bien.
test.each(["v22.19.0", "v23.0.0"])("accepts Node.js %s", async (version) => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, undefined, { nodeVersion: version });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(destination, "forge614-engram"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

// Si el instalador de Shell falla (sale con 69), Engram no se instala y Engines no se llama.
test("does not change Engram when the Forge614 Shell installer fails", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, undefined, { shellExit: 69 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Forge614 Shell could not be installed; Engram was not changed.");
    expect(existsSync(join(destination, "forge614-engram"))).toBe(false);
    expect(installerLog(fakeHome).map((line) => line.split(" ")[0])).toEqual(["shell"]);
  } finally {
    server.stop(true);
  }
});

// Con Forge614 Shell ya instalado, el instalador de Shell no se llama y Engram se instala igual.
test("reuses an already installed Forge614 Shell without calling its installer", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  const shellCommand = join(fakeHome, ".forge614", "shell", "bin", "forge614-shell");
  mkdirSync(resolve(shellCommand, ".."), { recursive: true });
  writeFileSync(shellCommand, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(shellCommand, 0o755);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]));
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Forge614 Shell is already available: ${shellCommand}`);
    expect(installerLog(fakeHome).some((line) => line.startsWith("shell "))).toBe(false);
    expect(existsSync(join(destination, "forge614-engram"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

// Camino completo: Shell se instala antes que Engines (con `--latest` y el FORGE614_HOME de la prueba)
// y el mensaje final indica el siguiente paso con la ruta absoluta de Shell.
test("installs Forge614 Shell before Engines and prints the next step", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  const forgeHome = join(root, "forge614-root");
  mkdirSync(fakeHome);
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  const previous = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = forgeHome;
  try {
    const result = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]), true, "/bin/unknown");
    expect(result.exitCode, result.stderr).toBe(0);
    const log = installerLog(fakeHome);
    expect(log[0]).toBe(`shell args=--latest home=${forgeHome}`);
    expect(log[1]?.startsWith("engines ")).toBe(true);
    expect(log).toHaveLength(2);
    expect(existsSync(join(destination, "forge614-engram"))).toBe(true);
    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines.slice(-2)).toEqual([
      "Next step: open a new terminal and run:",
      `${shellQuote(join(forgeHome, "shell", "bin", "forge614-shell"))} init --product engram`,
    ]);
    expect(lines).not.toContain("forge614-engram init");
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
    server.stop(true);
  }
});

// La variable de prueba de Shell solo se acepta con el centinela y con una URL `file:///`: sin centinela
// se rechaza como reservada, y con centinela pero URL `http://` se rechaza por no ser local.
test("rejects unsafe Forge614 Shell test installer overrides without installing anything", async () => {
  const root = temporaryDirectory();
  const fixture = join(root, "fixture-binary");
  const destination = join(root, "chosen-bin");
  const fakeHome = join(root, "home");
  const curlDirectory = join(root, "fake-curl-bin");
  mkdirSync(fakeHome);
  mkdirSync(curlDirectory);
  writeFileSync(fixture, fixtureBytes);
  const artifact = targetArtifact();
  writeFileSync(join(root, "release.json"), JSON.stringify({
    assets: [
      { name: "SHA256SUMS", browser_download_url: "https://assets.test/download/SHA256SUMS" },
      { name: artifact, browser_download_url: `https://assets.test/download/${artifact}` },
    ],
  }));
  writeFileSync(join(root, "SHA256SUMS"), `${sha256(fixture)}  ${artifact}\n`);
  // Un `curl` falso que responde desde archivos locales, para llegar hasta la dependencia de Shell sin red.
  const fakeCurl = join(curlDirectory, "curl");
  writeFileSync(fakeCurl, [
    "#!/bin/sh",
    "out=''; url=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --output) out="$2"; shift 2 ;;',
    '    --proto) shift 2 ;;',
    '    -*) shift ;;',
    '    *) url="$1"; shift ;;',
    "  esac",
    "done",
    'case "$url" in',
    `  */releases/latest) cp '${join(root, "release.json")}' "$out" ;;`,
    `  */SHA256SUMS) cp '${join(root, "SHA256SUMS")}' "$out" ;;`,
    `  */${artifact}) cp '${fixture}' "$out" ;;`,
    "  *) exit 22 ;;",
    "esac",
  ].join("\n"));
  chmodSync(fakeCurl, 0o755);
  const server = fixtureReleaseServer(artifact, fixture);
  const savedPath = process.env.PATH;
  const savedOverride = process.env.FORGE614_SHELL_INSTALLER_TEST_URL;
  process.env.FORGE614_SHELL_INSTALLER_TEST_URL = "http://127.0.0.1:1/install.sh";
  try {
    process.env.PATH = `${curlDirectory}:${savedPath ?? ""}`;
    const withoutSentinel = await withFixtureEnvironment(fakeHome, "", () => runInstaller(["--bin-dir", destination]), false);
    process.env.PATH = savedPath;
    const notLocal = await withFixtureEnvironment(fakeHome, `${server.url}good`, () => runInstaller(["--bin-dir", destination]));

    expect(withoutSentinel.exitCode).not.toBe(0);
    expect(withoutSentinel.stderr).toContain("The Shell installer override is reserved for test fixtures.");
    expect(notLocal.exitCode).not.toBe(0);
    expect(notLocal.stderr).toContain("The Shell test installer must be a local file URL.");
    for (const result of [withoutSentinel, notLocal]) expect(result.stdout).not.toContain("Installed:");
    expect(existsSync(join(destination, "forge614-engram"))).toBe(false);
    expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
    expect(installerLog(fakeHome)).toEqual([]);
  } finally {
    process.env.PATH = savedPath;
    if (savedOverride === undefined) delete process.env.FORGE614_SHELL_INSTALLER_TEST_URL;
    else process.env.FORGE614_SHELL_INSTALLER_TEST_URL = savedOverride;
    server.stop(true);
  }
});
