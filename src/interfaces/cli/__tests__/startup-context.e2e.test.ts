/** Prueba de punta a punta de `startup-context` como proceso real del CLI: validación, vínculo, aislamiento, permisos de solo lectura, los dos formatos de salida y la espera de arranque con nube (D8). */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { procSnapshot } from "../../../../tests/fixtures/proc-snapshot";
import { enableCloud } from "../../../infrastructure/sqlite/schema";

const directories: string[] = [];
function temporary(prefix = "forge614-startup-context-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
const cli = resolve(import.meta.dir, "../../../cli.ts");
// Ver cli.e2e.test.ts: Bun.spawnSync tiene un error de bloqueo confirmado y sin corregir en Bun
// (oven-sh/bun#34069), por eso el lanzador del CLI usa aquí el camino asíncrono Bun.spawn en su lugar.
async function runCli(cwd: string, userDirectory: string, ...args: string[]) {
  return (await runCliWithEnvironment(cwd, userDirectory, {}, ...args));
}
async function runCliWithEnvironment(cwd: string, userDirectory: string, environment: Record<string, string | undefined>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd, env: { ...process.env, FORGE614_HOME: join(userDirectory,".forge614"), ...environment }, stdout:"pipe", stderr:"pipe",
  });
  let killedByWatchdog = false;
  let procSnapshotResult: Record<string, unknown> | undefined;
  const timer = setTimeout(() => { killedByWatchdog = true; procSnapshotResult = procSnapshot(child.pid); child.kill(); }, 20_000);
  try {
    const [code,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if (killedByWatchdog) {
      let completeJson = false;
      try { JSON.parse(stdout); completeJson = true; } catch {}
      console.error(JSON.stringify({
        diag: "watchdog-killed", args, code,
        stdoutBytes: stdout.length, stderrBytes: stderr.length, completeJson,
        stdoutTail: stdout.slice(-300), stderrTail: stderr.slice(-300),
        procSnapshot: procSnapshotResult,
      }));
    }
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
afterEach(() => { for (const directory of directories.splice(0).reverse()) rmSync(directory, { recursive: true, force: true }); });

// Sin --json o sin --directory, startup-context falla con INVALID_INPUT antes de crear ningún archivo de usuario.
test("startup-context requires --json and --directory before touching storage", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const missingJson = (await runCli(root, userDirectory, "startup-context", "--directory", temporary()));
  expect(missingJson.code).toBe(1);
  expect(JSON.parse(missingJson.stderr).code).toBe("INVALID_INPUT");
  expect(missingJson.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);

  const missingDirectory = (await runCli(root, userDirectory, "startup-context", "--json"));
  expect(missingDirectory.code).toBe(1);
  expect(JSON.parse(missingDirectory.stderr).code).toBe("INVALID_INPUT");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
}, 40000);

// Sin haber ejecutado init antes, startup-context falla con CONFIG_NOT_FOUND; no lo confunde con un proyecto simplemente sin vincular.
test("startup-context on a never-initialized workspace is a real error, not an unbound project", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json"));
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stderr).code).toBe("CONFIG_NOT_FOUND");
  expect(result.stdout).toBe("");
  expect(existsSync(join(root, "user", ".forge614"))).toBe(false);
}, 40000);

// Con FORGE614_HOME apuntando a otra carpeta, init, save y startup-context escriben y leen ahí, nunca en la carpeta de usuario real del proceso.
test("FORGE614_HOME isolates init, save, and startup-context from the process home", async () => {
  const root = temporary(); const userDirectory = join(root, "user"); const forgeHome = join(root, "forge614");
  const environment = { FORGE614_HOME: forgeHome };
  expect((await runCliWithEnvironment(root, userDirectory, environment, "init", "--json")).code).toBe(0);
  expect((await runCliWithEnvironment(root, userDirectory, environment, "save", "--scope", "shared", "--title", "Favorite color", "--content", "black and purple", "--type", "preference", "--topic", "user/preference/favorite-color")).code).toBe(0);
  const directory = temporary();
  const context = (await runCliWithEnvironment(root, userDirectory, environment, "startup-context", "--directory", directory, "--json"));
  expect(context.code).toBe(0);
  expect(JSON.parse(context.stdout)).toMatchObject({ format: 1, project: { status: "unbound" } });
  expect(JSON.parse(context.stdout).shared.recent).toEqual(expect.arrayContaining([
    expect.objectContaining({ topicKey: "user/preference/favorite-color", title: "Favorite color" }),
  ]));
  expect(existsSync(join(forgeHome, "engram", ".env"))).toBe(true);
  expect(existsSync(join(forgeHome, "engram", "engram.db"))).toBe(true);
  expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
}, 40000);

// Un FORGE614_HOME vacío o relativo falla con INVALID_FORGE614_HOME antes de crear siquiera la carpeta histórica ~/.forge614.
test("empty or relative FORGE614_HOME fails before creating the historic home", async () => {
  for (const value of ["", "relative/forge614"]) {
    const root = temporary(); const userDirectory = join(root, "user");
    const result = (await runCliWithEnvironment(root, userDirectory, { FORGE614_HOME: value }, "init", "--json"));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_FORGE614_HOME" });
    expect(existsSync(join(userDirectory, ".forge614"))).toBe(false);
  }
}, 40000);

// Para una carpeta ya vinculada, startup-context devuelve el contexto del proyecto junto con shared (con previsualizaciones) y no cambia la lista de proyectos.
test("startup-context returns the bound project's context alongside shared, previews included, and creates nothing new", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const created = (await runCli(root, userDirectory, "project-create", "--name", "demo"));
  const projectId = JSON.parse(created.stdout).projectId;
  const projectDirectory = temporary();
  expect((await runCli(root, userDirectory, "project-bind", "--directory", projectDirectory, "--project-id", projectId)).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project note", "--content", "Only this repo", "--type", "fact")).code).toBe(0);

  const before = JSON.parse((await runCli(root, userDirectory, "project-list")).stdout);
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", projectDirectory, "--json"));
  expect(result.code).toBe(0);
  const body = JSON.parse(result.stdout);
  expect(body.format).toBe(1);
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(body.shared.recent[0]).toHaveProperty("preview");
  expect(body.project).toMatchObject({ status: "bound", projectId });
  expect(body.project.context.recent.map((row: { title: string }) => row.title).sort()).toEqual(["Project note", "Shared"]);
  const after = JSON.parse((await runCli(root, userDirectory, "project-list")).stdout);
  expect(after).toEqual(before);
}, 40000);

// Una carpeta sin vincular no es un error (status unbound); consultarla no la vincula, y repetir la misma consulta da exactamente la misma salida.
test("startup-context reports an unbound directory without an error and without binding it, and is idempotent", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everyone sees this", "--type", "fact")).code).toBe(0);
  const directory = temporary();

  const first = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
  const second = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
  expect(first.code).toBe(0); expect(second.code).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const body = JSON.parse(first.stdout);
  expect(body.project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
  expect(body.shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
}, 40000);

// La carpeta personal (home) y la raíz del sistema de archivos también reportan status unbound y devuelven igual el bloque shared; ninguna de las dos se vincula.
test("startup-context returns shared favorite-color for home and filesystem root without binding either", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Favorite color", "--content", "black and purple", "--type", "preference", "--topic", "user/preference/favorite-color")).code).toBe(0);

  for (const directory of [homedir(), parse(realpathSync(homedir())).root]) {
    const result = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({ format: 1, project: { status: "unbound", projectId: null, context: null } });
    expect(body.shared.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Favorite color", topicKey: "user/preference/favorite-color" }),
    ]));
  }
  expect(JSON.parse((await runCli(root, userDirectory, "project-list")).stdout)).toEqual([]);
}, 40000);

// Que una carpeta tenga Git no la hace un proyecto por sí sola: solo la que se vinculó explícitamente devuelve status bound con su propio contexto.
test("startup-context distinguishes an unbound Git directory from a bound Git directory", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  const unboundDirectory = temporary(); const boundDirectory = temporary();
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect(Bun.spawnSync(["git", "init", unboundDirectory], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "init", boundDirectory], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const projectId = JSON.parse((await runCli(root, userDirectory, "project-create", "--name", "bound-git")).stdout).projectId;
  expect((await runCli(root, userDirectory, "project-bind", "--directory", boundDirectory, "--project-id", projectId)).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Everywhere", "--type", "fact")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project", "--content", "Bound only", "--type", "fact")).code).toBe(0);

  const unbound = (await runCli(root, userDirectory, "startup-context", "--directory", unboundDirectory, "--json"));
  const bound = (await runCli(root, userDirectory, "startup-context", "--directory", boundDirectory, "--json"));

  expect(unbound.code).toBe(0);
  expect(JSON.parse(unbound.stdout).project).toEqual({ status: "unbound", projectId: null, context: null, source: "unbound" });
  expect(bound.code).toBe(0);
  expect(JSON.parse(bound.stdout).project).toMatchObject({ status: "bound", projectId });
  expect(JSON.parse(bound.stdout).project.context.recent.map((row: { title: string }) => row.title).sort()).toEqual(["Project", "Shared"]);
}, 40000);

// Con el archivo de la base marcado de solo lectura a nivel de sistema de archivos (0o400), startup-context igual funciona, porque no necesita escribir.
test("startup-context succeeds against a database file made read-only at the filesystem level", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Shared", "--content", "Read-only safe", "--type", "fact")).code).toBe(0);
  const dbPath = join(userDirectory, ".forge614", "engram", "engram.db");
  const originalMode = statSync(dbPath).mode;
  chmodSync(dbPath, 0o400);
  try {
    const result = (await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json"));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).shared.recent.map((row: { title: string }) => row.title)).toContain("Shared");
  } finally { chmodSync(dbPath, originalMode); }
}, 40000);

// Cuando falla, el error nunca repite la ruta de directorio pedida ni ningún otro dato sensible en su mensaje.
test("startup-context never leaks the requested directory or other secrets on failure", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const marker = "SECRET_MARKER_STARTUP";
  const missingDirectory = join(root, `does-not-exist-${marker}`);
  const result = (await runCli(root, userDirectory, "startup-context", "--directory", missingDirectory, "--json"));
  expect(result.code).toBe(1);
  const parsed = JSON.parse(result.stderr);
  expect(typeof parsed.code).toBe("string");
  expect(result.stderr).not.toContain(marker);
  expect(result.stdout).toBe("");
}, 40000);

// Una ruta inexistente, un archivo regular en vez de carpeta, y una carpeta sin permiso de lectura fallan igual con INVALID_DIRECTORY, sin filtrar la ruta en el error.
test("startup-context rejects missing, regular-file, and unreadable paths with safe JSON", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const missing = join(root, "missing-STARTUP_PATH_SECRET");
  const file = join(root, "file-STARTUP_PATH_SECRET"); writeFileSync(file, "not a directory");
  const unreadable = temporary("forge614-startup-context-unreadable-"); chmodSync(unreadable, 0o000);
  try {
    for (const directory of [missing, file, unreadable]) {
      const result = (await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json"));
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "INVALID_DIRECTORY" });
      expect(result.stderr).not.toContain("STARTUP_PATH_SECRET");
    }
  } finally { chmodSync(unreadable, 0o700); }
}, 40000);

// Después de init, ejecutar startup-context no agrega ni quita ningún archivo bajo la carpeta del espacio de trabajo.
test("startup-context creates no files under the workspace root beyond what init already created", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const engramDirectory = join(userDirectory, ".forge614", "engram");
  const before = readdirSync(engramDirectory).sort();
  expect((await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json")).code).toBe(0);
  const after = readdirSync(engramDirectory).sort();
  expect(after).toEqual(before);
}, 40000);

// startup-context abre la base en modo solo lectura cuando no tiene nada que escribir, así que los archivos WAL (log de escritura anticipada de SQLite) que ya existían quedan exactamente igual.
test("startup-context opens the base read-only when nothing has to be written, so an existing WAL footprint is left exactly as found", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const engramDirectory = join(userDirectory, ".forge614", "engram");
  // Deja archivos WAL reales, como los dejaría un cliente que se cayó sin cerrar la base o uno aún en ejecución (Linux siempre los conserva).
  const holder = Bun.spawn([process.execPath, "-e",
    'const {Database}=require("bun:sqlite");const d=new Database(process.argv[1]);d.query("select count(*) from projects").get();console.log("ready");setInterval(()=>{},1000)',
    join(engramDirectory, "engram.db")], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = holder.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ready");
    holder.kill(9); await holder.exited;
    const before = readdirSync(engramDirectory).sort();
    expect(before).toContain("engram.db-wal");
    expect((await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json")).code).toBe(0);
    expect(readdirSync(engramDirectory).sort()).toEqual(before);
  } finally { holder.kill(9); }
}, 40000);

// D8: con nube configurada contra un servidor TCP que acepta y nunca responde, startup-context no se
// queda esperando a Neon: el proceso imprime el bloque igual y termina pronto (el tope de espera de
// arranque, 1000 ms, más el resto del comando, caben de sobra en 1500 ms).
test("startup-context with cloud configured against a mute TCP endpoint still prints and exits promptly", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  const mute = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  try {
    const dbPath = join(userDirectory, ".forge614", "engram", "engram.db");
    const db = new Database(dbPath); enableCloud(db); db.close();
    writeFileSync(join(userDirectory, ".forge614", "engram", ".env"),
      `FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u@127.0.0.1:${mute.port}/db?sslmode=disable"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n`,
      { mode: 0o600 });
    const start = Date.now();
    const result = await runCli(root, userDirectory, "startup-context", "--directory", temporary(), "--json");
    expect(Date.now() - start).toBeLessThanOrEqual(1500);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ format: 1, project: { status: "unbound" } });
  } finally { mute.stop(true); }
}, 40000);

// --format 2 imprime el bloque de texto listo para inyectar; --format 1 coincide byte a byte con el valor por defecto (sin --format); cualquier otro valor falla con INVALID_INPUT.
test("startup-context --format 2 prints the ready-to-inject block, --format 1 matches the default byte for byte and other formats fail", async () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect((await runCli(root, userDirectory, "init", "--json")).code).toBe(0);
  expect((await runCli(root, userDirectory, "intelligence-enable")).code).toBe(0);
  const projectId = JSON.parse((await runCli(root, userDirectory, "project-create", "--name", "demo")).stdout).projectId;
  const directory = temporary();
  expect((await runCli(root, userDirectory, "project-bind", "--directory", directory, "--project-id", projectId)).code).toBe(0);
  expect((await runCli(root, userDirectory, "save", "--project-id", projectId, "--title", "Project note", "--content", "Only this repo", "--type", "fact")).code).toBe(0);

  const block = await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json", "--format", "2");
  expect(block.code).toBe(0);
  const body = JSON.parse(block.stdout);
  expect(Object.keys(body)).toEqual(["format", "text", "chars", "sections", "omitted"]);
  expect(body).toMatchObject({ format: 2, omitted: 0 });
  expect(body.text).toContain("- Project note · project · ");
  const byDefault = await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json");
  const explicit = await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json", "--format", "1");
  expect(explicit.stdout).toBe(byDefault.stdout);
  expect(JSON.parse(byDefault.stdout).format).toBe(1);
  const unknown = await runCli(root, userDirectory, "startup-context", "--directory", directory, "--json", "--format", "3");
  expect(unknown.code).toBe(1);
  expect(JSON.parse(unknown.stderr).code).toBe("INVALID_INPUT");
  expect(unknown.stdout).toBe("");
}, 60000);
