/** Comprueba que `updateInstalledEngram` descarga, ejecuta y limpia el instalador correctamente, y que reporta la versión resultante sin cambiar nada si ya coincide. */
import { expect, test } from "bun:test";
import { installedEngramCommand, updateInstalledEngram } from "./updater";

function withForge614Home(value: string | undefined, run: () => void): void {
  const previous = process.env.FORGE614_HOME;
  try {
    if (value === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
  }
}

// El comando instalado debe derivarse de FORGE614_HOME, no de una ruta fija.
test("updater derives its installed command from FORGE614_HOME", () => withForge614Home("/tmp/forge614-update", () => {
  expect(installedEngramCommand()).toBe("/tmp/forge614-update/engram/bin/forge614-engram");
}));

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
  let spawnOptions: { stdio: "inherit" } | undefined;

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
  let spawnOptions: { stdio: "inherit" } | undefined;

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
