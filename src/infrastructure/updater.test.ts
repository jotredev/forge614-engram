/** Comprueba que `updateInstalledEngram` descarga, ejecuta y limpia el instalador correctamente, y que reporta la versión resultante sin cambiar nada si ya coincide. */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as crypto from "node:crypto";
import { installedEngramCommand, updateInstalledEngram, type SpawnOptions } from "./updater";

async function withForge614Home(run: (home: string) => Promise<void> | void): Promise<void> {
  const previous = process.env.FORGE614_HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "forge614-engram-update-test-"));
  try {
    process.env.FORGE614_HOME = tempHome;
    await run(tempHome);
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

// El comando instalado debe derivarse de FORGE614_HOME, no de una ruta fija.
test("updater derives its installed command from FORGE614_HOME", async () => {
  await withForge614Home(async (home) => {
    expect(installedEngramCommand()).toBe(join(home, "engram/bin/forge614-engram"));
  });
});

// Una actualización exitosa debe descargar el instalador estable, ejecutarlo con --force, limpiar el archivo y reportar la nueva versión.
test("update downloads the stable installer and explicitly replaces only the installed command", async () => {
  const calls: string[] = [];
  let cleaned = false;

  const result = await updateInstalledEngram("1.3.0", {
    download: async (url) => {
      calls.push(`download ${url}`);
      return { installer: "/tmp/forge614-engram-install.sh", cleanup: () => { cleaned = true; } };
    },
    spawn: (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { status: 0 };
    },
    readInstalledVersion: () => "1.4.0",
  });

  expect(calls).toEqual([
    "download https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh",
    "bash /tmp/forge614-engram-install.sh --force",
  ]);
  expect(cleaned).toBe(true);
  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

// Si el instalador falla, el comando instalado no debe darse por reemplazado y el archivo descargado debe limpiarse igual.
test("update preserves the installed command when the verified installer fails", async () => {
  let cleaned = false;

  await expect(updateInstalledEngram("1.3.0", {
    download: async () => ({ installer: "/tmp/forge614-engram-install.sh", cleanup: () => { cleaned = true; } }),
    spawn: () => ({ status: 1, stderr: "download failed" }),
  })).rejects.toThrow("download failed");

  expect(cleaned).toBe(true);
});

// Si la versión instalada tras ejecutar el instalador coincide con la anterior, debe reportarse como no actualizada.
test("update reports unchanged when the installed release already matches", async () => {
  const result = await updateInstalledEngram("1.3.0", {
    download: async () => ({ installer: "/tmp/forge614-engram-install.sh", cleanup: () => {} }),
    spawn: () => ({ status: 0 }),
    readInstalledVersion: () => "1.3.0",
  });

  expect(result).toEqual({ updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0" });
});

// Con quiet, la salida del instalador no debe heredarse a la terminal actual.
test("quiet updates do not inherit installer output", async () => {
  let spawnOptions: SpawnOptions | undefined;

  await updateInstalledEngram("1.3.0", {
    quiet: true,
    download: async () => ({ installer: "/tmp/forge614-engram-install.sh", cleanup: () => {} }),
    spawn: (_command, _args, options) => {
      spawnOptions = options;
      return { status: 0 };
    },
    readInstalledVersion: () => "1.4.0",
  });

  expect(spawnOptions).toBeUndefined();
});

// Sin quiet, la salida del instalador sí debe heredarse a la terminal actual.
test("interactive updates retain installer output", async () => {
  let spawnOptions: SpawnOptions | undefined;

  await updateInstalledEngram("1.3.0", {
    download: async () => ({ installer: "/tmp/forge614-engram-install.sh", cleanup: () => {} }),
    spawn: (_command, _args, options) => {
      spawnOptions = options;
      return { status: 0 };
    },
    readInstalledVersion: () => "1.4.0",
  });

  expect(spawnOptions).toEqual({ stdio: "inherit" });
});

// installedEngramCommand en Windows añade .exe.
test("installedEngramCommand appends .exe on Windows", async () => {
  await withForge614Home(async (home) => {
    expect(installedEngramCommand("win32")).toBe(join(home, "engram/bin/forge614-engram.exe"));
    expect(installedEngramCommand("darwin")).toBe(join(home, "engram/bin/forge614-engram"));
  });
});

const FAKE_WINDOWS_EXE = new Uint8Array([1, 2, 3]);
const FAKE_HASH = crypto.createHash("sha256").update(FAKE_WINDOWS_EXE).digest("hex");
const VALID_SHASUMS = `${FAKE_HASH}  forge614-engram-windows-x64.exe\n`;

test("windows update schedules swap and returns pendingVersion", async () => {
  await withForge614Home(async (home) => {
    let spawnArgs: string[] = [];
    let wrapperContent = "";
    let helperContent = "";

    const result = await updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchBuffer: async (url) => {
        expect(url).toBe("https://github.com/jotredev/forge614-engram/releases/latest/download/forge614-engram-windows-x64.exe");
        return FAKE_WINDOWS_EXE;
      },
      fetchText: async (url) => {
        expect(url).toBe("https://github.com/jotredev/forge614-engram/releases/latest/download/SHA256SUMS");
        return VALID_SHASUMS;
      },
      readInstalledVersion: (exe) => (exe ? "1.4.0" : "1.3.0"),
      spawn: (cmd, args) => {
        expect(cmd).toBe("pwsh");
        spawnArgs = args;

        // Lee el script de lanzamiento WMI desde el argumento -File
        const fileIndex = args.indexOf("-File");
        if (fileIndex !== -1 && args[fileIndex + 1]) {
          wrapperContent = readFileSync(args[fileIndex + 1]!, "utf8");
        }

        // Localiza el script ayudante dentro de -CommandLine
        const cmdIndex = args.indexOf("-CommandLine");
        if (cmdIndex !== -1 && args[cmdIndex + 1]) {
          const commandLine = args[cmdIndex + 1]!;
          const match = /"-File"\s+"([^"]+)"/.exec(commandLine);
          if (match && match[1]) {
            helperContent = readFileSync(match[1], "utf8");
          }
        }

        return { status: 0 };
      },
    });

    expect(result).toEqual({ updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0", pendingVersion: "1.4.0" });

    // Argumentos del envoltorio WMI
    expect(spawnArgs).toContain("-File");
    expect(spawnArgs).toContain("-CommandLine");
    expect(spawnArgs).toContain("-SpawnLogPath");

    const spawnLogIndex = spawnArgs.indexOf("-SpawnLogPath");
    const spawnLogPath = spawnArgs[spawnLogIndex + 1]!;
    expect(spawnLogPath.startsWith(join(home, "engram", "swap-helper-"))).toBe(true);
    expect(spawnLogPath.endsWith(".spawn.log")).toBe(true);

    const commandLineIndex = spawnArgs.indexOf("-CommandLine");
    const helperCommandLine = spawnArgs[commandLineIndex + 1]!;

    // Argumentos del script ayudante en la línea de comandos
    expect(helperCommandLine).toContain("swap-helper.ps1");
    expect(helperCommandLine).toContain("forge614-engram-windows-x64.exe");
    expect(helperCommandLine).toContain('"-ActiveLauncher"');
    expect(helperCommandLine).toContain(join(home, "engram", "bin", "forge614-engram.exe"));
    expect(helperCommandLine).toContain('"-LogFile"');

    const logFileMatch = /"-LogFile"\s+"([^"]+)"/.exec(helperCommandLine);
    expect(logFileMatch).not.toBeNull();
    const helperLogPath = logFileMatch![1]!;
    expect(helperLogPath.startsWith(join(home, "engram", "swap-helper-"))).toBe(true);
    expect(helperLogPath.endsWith(".log")).toBe(true);
    expect(helperLogPath.endsWith(".spawn.log")).toBe(false);

    // Comprobaciones de contenido y cableado de registro en los scripts PowerShell
    expect(wrapperContent).toContain("[string]$SpawnLogPath");
    expect(wrapperContent).toContain("Out-File -FilePath $SpawnLogPath -Append");
    expect(wrapperContent).toContain("Invoke-CimMethod -ClassName Win32_Process -MethodName Create");

    expect(helperContent).toContain("[string]$LogFile");
    expect(helperContent).toContain("Out-File -FilePath $LogFile -Append");
    expect(helperContent).toContain("Copy-Item -Path $NewBinary -Destination $ActiveLauncher -Force");
    expect(helperContent).toContain("Get-FileHash -Path $NewBinary -Algorithm SHA256");
    expect(helperContent).toContain("Get-FileHash -Path $ActiveLauncher -Algorithm SHA256");
    expect(helperContent).toContain("Remove-Item -Path $StagingDir -Recurse -Force");

    // Verifica que el ejecutable temporal contenga los bytes descargados
    const helperFileMatch = /"-File"\s+"([^"]+)"/.exec(helperCommandLine);
    expect(helperFileMatch).not.toBeNull();
    const stagingDir = join(helperFileMatch![1]!, "..");
    const fakeExePath = join(stagingDir, "forge614-engram-windows-x64.exe");
    const savedBytes = readFileSync(fakeExePath);
    expect(new Uint8Array(savedBytes)).toEqual(FAKE_WINDOWS_EXE);
  });
});

test("windows update ignores replacement if versions match", async () => {
  await withForge614Home(async (home) => {
    const result = await updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchBuffer: async () => FAKE_WINDOWS_EXE,
      fetchText: async () => VALID_SHASUMS,
      readInstalledVersion: () => "1.3.0",
      spawn: () => { throw new Error("Should not spawn"); },
    });

    expect(result).toEqual({ updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0" });

    // Comprueba que no dejó directorio de paso tras coincidir la versión
    const engramDir = join(home, "engram");
    if (existsSync(engramDir)) {
      const files = readdirSync(engramDir);
      expect(files.filter((f) => f.startsWith("update-")).length).toBe(0);
    }
  });
});

test("windows update rejects missing or bad shasum", async () => {
  await withForge614Home(async () => {
    // Rechaza huella incorrecta
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchBuffer: async () => FAKE_WINDOWS_EXE,
      fetchText: async () => "0000000000000000000000000000000000000000000000000000000000000000  forge614-engram-windows-x64.exe\n",
    })).rejects.toThrow("Downloaded asset checksum mismatch.");

    // Rechaza ausencia de renglón
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchText: async () => "nothing here",
    })).rejects.toThrow("Invalid or ambiguous SHA256SUMS file");

    // Rechaza duplicado idéntico
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchText: async () => VALID_SHASUMS + VALID_SHASUMS,
    })).rejects.toThrow("Invalid or ambiguous SHA256SUMS file");

    // Rechaza duplicado con hash mal formado
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchText: async () => VALID_SHASUMS + "AAAA  forge614-engram-windows-x64.exe\n",
    })).rejects.toThrow("Invalid or ambiguous SHA256SUMS file");

    // Rechaza manifiesto que solo contiene un asset ajeno
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchText: async () => `${FAKE_HASH}  other-asset.exe\n`,
    })).rejects.toThrow("Invalid or ambiguous SHA256SUMS file");
  });
});

test("windows update rejects WMI failure", async () => {
  await withForge614Home(async (home) => {
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchBuffer: async () => FAKE_WINDOWS_EXE,
      fetchText: async () => VALID_SHASUMS,
      readInstalledVersion: (exe) => (exe ? "1.4.0" : "1.3.0"),
      spawn: () => ({ status: 1 }),
    })).rejects.toThrow("Could not launch WMI process to finish update.");

    // Comprueba que la carpeta de paso se limpia si el lanzamiento WMI falla
    const engramDir = join(home, "engram");
    if (existsSync(engramDir)) {
      const files = readdirSync(engramDir);
      expect(files.filter((f) => f.startsWith("update-")).length).toBe(0);
    }
  });
});

test("windows update fails before download if arch is arm64", async () => {
  await withForge614Home(async () => {
    let downloaded = false;
    await expect(updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "arm64",
      fetchText: async () => { downloaded = true; return VALID_SHASUMS; },
    })).rejects.toThrow("Forge614 Engram updater only supports x64 on Windows.");
    expect(downloaded).toBe(false);
  });
});

test("windows update accepts valid asset line when another asset contains it as substring", async () => {
  await withForge614Home(async () => {
    const manifestWithSubstring = VALID_SHASUMS + `${FAKE_HASH}  forge614-engram-windows-x64.exe.sig\n`;
    const result = await updateInstalledEngram("1.3.0", {
      platform: "win32",
      arch: "x64",
      fetchBuffer: async () => FAKE_WINDOWS_EXE,
      fetchText: async () => manifestWithSubstring,
      readInstalledVersion: (exe) => (exe ? "1.4.0" : "1.3.0"),
      spawn: () => ({ status: 0 }),
    });
    expect(result).toEqual({ updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0", pendingVersion: "1.4.0" });
  });
});
