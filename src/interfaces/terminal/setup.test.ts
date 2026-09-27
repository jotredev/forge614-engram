/** Comprueba `forge614 init` interactivo real (proceso hijo con una terminal simulada): cancelación, guardado completo y ocultamiento de secretos. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemoryWorkspace } from "../../app/workspace";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";

const directories: string[] = [];
/** Lanza `forge614 init` en un proceso hijo con una terminal (TTY) simulada que recibe `input` como si se escribiera. */
function terminal(input: string) {
  const dir = mkdtempSync(join(tmpdir(), "forge614-terminal-"));
  directories.push(dir);
  const rawMode = join(dir, "raw-terminal.ts");
  writeFileSync(rawMode, "Object.defineProperty(process.stdin, 'setRawMode', { value: () => process.stdin });");
  const result = Bun.spawnSync([
    process.execPath,
    "--preload", resolve(import.meta.dir, "../../../tests/fixtures/interactive-terminal.ts"),
    "--preload", rawMode,
    resolve(import.meta.dir, "../../cli.ts"), "init",
  ], { cwd: dir, env: { ...process.env, FORGE614_HOME: join(dir,".forge614") }, stdin: Buffer.from(input), timeout: 5000 });
  return { result, config: new WorkspaceConfig(join(dir, ".forge614", "engram")) };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// Fin de archivo (EOF) o Ctrl+C en cualquier punto del asistente cancela con el código 130 y no crea ningún archivo de almacenamiento.
test("terminal EOF and Ctrl+C cancel without initializing storage", () => {
  for (const input of ["", "maybe\n", "\x03", "maybe\n\x03", "no\n"]) {
    const { result, config } = terminal(input);
    expect(result.exitCode).toBe(130);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("cancelada");
    expect(existsSync(config.root)).toBe(false);
  }
});

// Terminar el asistente sin elegir un asistente de IA concreto igual crea la base de datos y deja la lista de proyectos vacía.
test("terminal completes memory setup without opening assistant selection", () => {
  // Recién creado: la pregunta de reforzamiento se salta (el esquema 11 ya la incluye), así que el
  // bucle de confirmación empieza justo después de la pregunta de PostgreSQL.
  const { result, config } = terminal("no\nmaybe\nsi\n");
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  const projects = new MemoryWorkspace(config).listProjects();
  expect(projects).toEqual([]);
  expect(existsSync(config.databasePath)).toBe(true);
});

// Una credencial de PostgreSQL pegada por adelantado, antes de que aparezca su propia pregunta secreta, nunca se imprime en stdout ni en stderr.
test("terminal never echoes a pasted PostgreSQL credential even before the secret prompt",()=>{
  const {result,config}=terminal("si\npostgresql://u:SECRET_MARKER@127.0.0.1:1/db?sslmode=disable\nno\n");
  expect(result.exitCode).toBe(130);
  expect(result.stdout.toString()+result.stderr.toString()).not.toContain("SECRET_MARKER");
  expect(existsSync(config.root)).toBe(false);
});
