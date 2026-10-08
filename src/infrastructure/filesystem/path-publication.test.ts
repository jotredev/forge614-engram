/** Comprueba que `removePathPublication` quita solo el bloque exacto de PATH de Engram, en zsh, Fish y con rutas con espacios. */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removePathPublication } from "./path-publication";

const start = "# >>> forge614-engram PATH >>>";
const end = "# <<< forge614-engram PATH <<<";

function unixBlock(directory: string): string {
  return `${start}\ncase ":$PATH:" in\n  *:${directory}:*) ;;\n  *) export PATH=${directory}:"$PATH" ;;\nesac\n${end}`;
}

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "engram-path-publication-"));
  try { await run(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

// El bloque de Engram debe desaparecer del archivo, dejando intactas las líneas que el usuario agregó alrededor.
test("removes only the exact Engram PATH block and keeps user shell settings", async () => withHome(async home => {
  const path = join(home, ".zshrc");
  const directory = join(home, ".forge614", "engram", "bin");
  writeFileSync(path, `export KEEP_THIS=1\n${unixBlock(directory)}\nexport KEEP_THAT=1\n`);
  const removed = await removePathPublication({ home, binDirectory: directory, platform: "darwin" });
  expect(removed).toEqual([path]);
  expect(readFileSync(path, "utf8")).toBe("export KEEP_THIS=1\nexport KEEP_THAT=1\n");
}));

// Si el cuerpo del bloque fue editado a mano, debe rechazarse con PATH_CONFLICT y dejar el archivo sin tocar.
test("refuses an edited Engram PATH block without changing it", async () => withHome(async home => {
  const path = join(home, ".zshrc");
  writeFileSync(path, `${start}\nexport PATH=/somewhere-else:$PATH\n${end}\n`);
  await expect(removePathPublication({ home, binDirectory: join(home, ".forge614", "engram", "bin"), platform: "darwin" })).rejects.toMatchObject({ code: "PATH_CONFLICT" });
  expect(readFileSync(path, "utf8")).toContain("/somewhere-else");
}));

// La ruta de Fish usa su propia sintaxis y archivo separado; su ausencia de .zshrc no debe crear ese archivo.
test("removes the dedicated Fish publication without touching an absent shell file", async () => withHome(async home => {
  const fish = join(home, ".config", "fish", "conf.d", "forge614-engram.fish");
  const directory = join(home, ".forge614", "engram", "bin");
  mkdirSync(join(home, ".config", "fish", "conf.d"), { recursive: true });
  writeFileSync(fish, `${start}\nif not contains -- ${directory} $PATH\n  set -gx PATH ${directory} $PATH\nend\n${end}\n`);
  const removed = await removePathPublication({ home, binDirectory: directory, platform: "darwin" });
  expect(removed).toEqual([fish]);
  expect(existsSync(join(home, ".zshrc"))).toBe(false);
  expect(readFileSync(fish, "utf8")).toBe("");
}));

// Una carpeta de binarios con espacios se escapa al escribir el bloque; la eliminación debe reconocer esa forma escapada.
test("removes the installer PATH block when the product path contains spaces", async () => {
  const home = mkdtempSync(join(tmpdir(), "engram path publication-"));
  try {
    const path = join(home, ".zshrc");
    const directory = join(home, ".forge614", "engram", "bin");
    const escaped = directory.replace(/ /g, "\\ ");
    writeFileSync(path, `keep=1\n${start}\ncase ":$PATH:" in\n  *:${escaped}:*) ;;\n  *) export PATH=${escaped}:"$PATH" ;;\nesac\n${end}\n`);
    await expect(removePathPublication({ home, binDirectory: directory, platform: "darwin" })).resolves.toEqual([path]);
    expect(readFileSync(path, "utf8")).toBe("keep=1\n");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// En Windows retira exactamente el directorio de Engram de User Path de forma insensible a mayúsculas.
test("removes exact Windows User Path entry with case-insensitivity", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writtenPath: string | undefined;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\Windows;C:\\Users\\test\\.forge614\\ENGRAM\\BIN;C:\\Program Files",
    writeUserPath: async (p) => { writtenPath = p; },
  });
  expect(removed).toEqual(["User Path"]);
  expect(writtenPath).toBe("C:\\Windows;C:\\Program Files");
});

// En Windows tolera la barra final en el elemento de User Path.
test("removes exact Windows User Path entry tolerating trailing backslash", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writtenPath: string | undefined;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\Users\\test\\.forge614\\engram\\bin\\;C:\\Other",
    writeUserPath: async (p) => { writtenPath = p; },
  });
  expect(removed).toEqual(["User Path"]);
  expect(writtenPath).toBe("C:\\Other");
});

// En Windows rechaza prefijos parecidos como bin-extra y no escribe nada.
test("refuses similar prefix like engram/bin-extra and does not modify Path", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writeCalled = false;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\Users\\test\\.forge614\\engram\\bin-extra;C:\\Other",
    writeUserPath: async () => { writeCalled = true; },
  });
  expect(removed).toEqual([]);
  expect(writeCalled).toBe(false);
});

// En Windows no escribe nada si no hay coincidencia.
test("returns empty array and does not write if there is no match", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writeCalled = false;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\Windows;C:\\Program Files",
    writeUserPath: async () => { writeCalled = true; },
  });
  expect(removed).toEqual([]);
  expect(writeCalled).toBe(false);
});

// En Windows elimina entradas duplicadas del directorio de Engram.
test("removes duplicate entries of the target directory from Windows User Path", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writtenPath: string | undefined;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\Users\\test\\.forge614\\engram\\bin;C:\\Windows;C:\\USERS\\TEST\\.FORGE614\\ENGRAM\\BIN\\",
    writeUserPath: async (p) => { writtenPath = p; },
  });
  expect(removed).toEqual(["User Path"]);
  expect(writtenPath).toBe("C:\\Windows");
});

// En Windows falla con PATH_REMOVE_FAILED si readUserPath falla.
test("fails with PATH_REMOVE_FAILED if readUserPath fails", async () => {
  await expect(removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: "C:\\Users\\test\\.forge614\\engram\\bin",
    platform: "win32",
    readUserPath: async () => { throw new Error("Registry locked"); },
  })).rejects.toMatchObject({ code: "PATH_REMOVE_FAILED" });
});

// En Windows falla con PATH_REMOVE_FAILED si writeUserPath falla.
test("fails with PATH_REMOVE_FAILED if writeUserPath fails", async () => {
  await expect(removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: "C:\\Users\\test\\.forge614\\engram\\bin",
    platform: "win32",
    readUserPath: async () => "C:\\Users\\test\\.forge614\\engram\\bin",
    writeUserPath: async () => { throw new Error("Access denied"); },
  })).rejects.toMatchObject({ code: "PATH_REMOVE_FAILED" });
});

// En Windows conserva el orden y texto de los demás elementos de PATH.
test("preserves order and exact text of other elements", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  let writtenPath: string | undefined;
  const removed = await removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    readUserPath: async () => "C:\\First;c:\\users\\test\\.forge614\\engram\\bin;C:\\Second;D:\\Third",
    writeUserPath: async (p) => { writtenPath = p; },
  });
  expect(removed).toEqual(["User Path"]);
  expect(writtenPath).toBe("C:\\First;C:\\Second;D:\\Third");
});

// En Windows transporta el PATH vía stdin codificado en base64 para soportar acentos, espacios y caracteres especiales de PowerShell.
test("transports Windows User Path via stdin base64 without embedding in arguments", async () => {
  const targetDir = "C:\\Users\\José\\.forge614\\engram\\bin";
  const initialPath = "C:\\Windows;C:\\Users\\José\\.forge614\\engram\\bin;D:\\Ruta con $variable, `comillas` y acentos";
  const expectedRemaining = "C:\\Windows;D:\\Ruta con $variable, `comillas` y acentos";

  const spawnCalls: { command: string; args: string[]; input?: string | Uint8Array | undefined }[] = [];

  const removed = await removePathPublication({
    home: "C:\\Users\\José",
    binDirectory: targetDir,
    platform: "win32",
    spawn: (cmd, args, options) => {
      spawnCalls.push({ command: cmd, args, input: options?.input });
      if (args.some(a => a.includes("[Environment]::GetEnvironmentVariable('Path', 'User')"))) {
        const base64 = Buffer.from(initialPath, "utf16le").toString("base64");
        return { status: 0, stdout: base64 };
      }
      return { status: 0 };
    },
  });

  expect(removed).toEqual(["User Path"]);
  expect(spawnCalls.length).toBe(2);
  const writeCall = spawnCalls[1]!;
  expect(["pwsh", "powershell.exe"]).toContain(writeCall.command);
  // Los argumentos NO deben contener el PATH ni el valor como parámetro CLI
  expect(writeCall.args.some(a => a.includes(expectedRemaining))).toBe(false);
  expect(writeCall.args).toContain("-Command");
  // La entrada stdin debe ser base64 de UTF-16LE
  expect(typeof writeCall.input).toBe("string");
  const decoded = Buffer.from(writeCall.input as string, "base64").toString("utf16le");
  expect(decoded).toBe(expectedRemaining);
});

// En Windows un fallo de escritura vía spawn no reporta éxito y lanza PATH_REMOVE_FAILED.
test("fails with PATH_REMOVE_FAILED if native PowerShell write via spawn fails", async () => {
  const targetDir = "C:\\Users\\test\\.forge614\\engram\\bin";
  const initialPath = "C:\\Windows;C:\\Users\\test\\.forge614\\engram\\bin";

  await expect(removePathPublication({
    home: "C:\\Users\\test",
    binDirectory: targetDir,
    platform: "win32",
    spawn: (_cmd, args) => {
      if (args.some(a => a.includes("[Environment]::GetEnvironmentVariable('Path', 'User')"))) {
        const base64 = Buffer.from(initialPath, "utf16le").toString("base64");
        return { status: 0, stdout: base64 };
      }
      return { status: 1, stderr: "Write failed" };
    },
  })).rejects.toMatchObject({ code: "PATH_REMOVE_FAILED" });
});
