/**
 * Pruebas de extremo a extremo de `scripts/release-smoke.sh`, la verificación de publicación: comprueban
 * que el script corre sus casos con un FORGE614_HOME y un HOME propios y temporales (nunca la base real de
 * quien lo ejecuta), que los borra al salir, y que se niega a correr si el entorno ya apunta a un
 * FORGE614_HOME que no es temporal.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../scripts/release-smoke.sh");
const entry = resolve(import.meta.dir, "../../src/cli.ts");
const directories: string[] = [];
function temporary(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "forge614-smoke-test-")));
  directories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

// Corre el script con un entorno mínimo y controlado; `env` añade o sustituye variables.
async function runScript(binary: string, env: Record<string, string>) {
  const child = Bun.spawn(["/bin/bash", script, binary], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env }, stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

// Con un HOME falso, sin FORGE614_HOME y un TMPDIR propio, el script debe crear sus temporales ahí, correr
// todos sus casos con el binario compilado de esta misma copia del código (se compila aquí con
// `bun build --compile`, igual que el release), dejar el TMPDIR vacío al salir (borró lo que creó) y no
// crear `.forge614` en el HOME falso. Existe porque la verificación manual de publicación escribió una
// vez en la base real de un equipo al olvidar el FORGE614_HOME temporal.
test("the release smoke runs in its own temporary homes, cleans them up and leaves the caller's HOME untouched", async () => {
  const root = temporary();
  const binary = join(root, "forge614-engram");
  const build = Bun.spawnSync([process.execPath, "build", entry, "--compile", "--outfile", binary], { stderr: "pipe" });
  expect(build.exitCode, build.stderr.toString()).toBe(0);
  const fakeHome = join(root, "fake-home"); const scratch = join(root, "scratch");
  mkdirSync(fakeHome); mkdirSync(scratch);
  const result = await runScript(binary, { HOME: fakeHome, TMPDIR: scratch });
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("todos los casos pasaron");
  expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
  expect(readdirSync(fakeHome)).toEqual([]);
  expect(readdirSync(scratch)).toEqual([]);
}, 120_000);

// Con FORGE614_HOME ya definido en una carpeta que NO está dentro de la carpeta temporal del sistema, el
// script debe salir con código distinto de 0 sin escribir nada: ni en esa carpeta ni en el HOME falso ni en
// el TMPDIR. Existe para que una verificación de publicación nunca pueda tocar una base real por error.
test("the release smoke refuses a FORGE614_HOME outside the system temporary directory and writes nothing", async () => {
  const root = temporary();
  const fakeHome = join(root, "fake-home"); const scratch = join(root, "scratch"); const realLooking = join(root, "real-home");
  for (const directory of [fakeHome, scratch, realLooking]) mkdirSync(directory);
  const marker = join(realLooking, "keep.txt"); writeFileSync(marker, "intact");
  const result = await runScript(join(root, "no-binary"), { HOME: fakeHome, TMPDIR: scratch, FORGE614_HOME: realLooking });
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("fuera de la carpeta temporal");
  expect(readdirSync(realLooking)).toEqual(["keep.txt"]);
  expect(readdirSync(fakeHome)).toEqual([]);
  expect(readdirSync(scratch)).toEqual([]);
});
