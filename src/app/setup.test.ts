/**
 * Comprueba la configuración guiada de extremo a extremo: cancelación en cualquier punto sin
 * dejar rastro, permisos restringidos automáticamente, la base nueva nace ya con refuerzo
 * (sin preguntar por él), no se filtra ninguna credencial, y solo se aplica algo tras la
 * confirmación final.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { expectPosixMode } from "../infrastructure/__test-support__/permissions";
import { MemoryWorkspace } from "./workspace";
import { runSetup, type SetupIO } from "./setup";
import { legacyConfiguredWorkspace } from "../../tests/fixtures/legacy-workspace";

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-setup-"));
  directories.push(dir);
  const config = new WorkspaceConfig(join(dir, ".forge614"));
  return { config, workspace: new MemoryWorkspace(config) };
}
function conversation(answers: (string | null)[], beforeAnswer?: () => void) {
  const output: string[] = [];
  const questions: string[] = [];
  const io: SetupIO = {
    write: text => { output.push(text); },
    ask: async text => { questions.push(text); beforeAnswer?.(); return answers.shift() ?? null; },
  };
  return { io, output, questions };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// Verifica que cancelar con cualquiera de las respuestas reconocidas como "no"/"cancelar" no deja rastro de un espacio de trabajo nuevo.
test("setup cancellation leaves a fresh workspace absent", async () => {
  for (const answer of [null, "q", "cancelar", "", "no", "n"]) {
    const { config } = fixture();
    const { io } = conversation([answer], () => expect(existsSync(config.root)).toBe(false));
    expect(await runSetup(io, config)).toEqual({ cancelled: true });
    expect(existsSync(config.root)).toBe(false);
  }
});

/** Comprueba que una carpeta existente se restringe a 0o700 antes de preguntar, sin crear configuración ni base. */
test("setup automatically restricts an existing user-owned workspace directory before prompting", async () => {
  const { config } = fixture();
  mkdirSync(config.root, { mode: 0o755 });
  chmodSync(config.root, 0o755);

  expect(await runSetup(conversation(["q"]).io, config)).toEqual({ cancelled: true });

  expectPosixMode(config.root, 0o700);
  expect(existsSync(join(config.root, ".env"))).toBe(false);
  expect(existsSync(config.databasePath)).toBe(false);
});

// Verifica que sin elegir PostgreSQL se inicializa el almacenamiento global sin crear ningún proyecto, y que la base nueva ya reporta el refuerzo activado sin haber preguntado por él.
test("setup defaults to no PostgreSQL and initializes global storage without a project", async () => {
  const { config, workspace } = fixture();
  // La base nueva nace ya en el esquema 11: no se pregunta por el refuerzo, y lo reporta activado desde el principio.
  const { io, output, questions } = conversation(["", "sí"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(workspace.listProjects()).toEqual([]);
  expect(readFileSync(join(config.root, ".env"), "utf8")).toBe('FORMAT_VERSION="2"\nSTORAGE="sqlite"\n');
  expect(output.join("\n")).toContain(config.databasePath);
  expect(output.join("\n")).toContain("La base nueva se creará con la memoria inteligente (esquema 11), que ya incluye sesiones y el refuerzo de recuerdos.");
  const store = workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(true); }
  finally { store.close(); }
});

// Verifica que en una base completamente nueva se muestra la frase sobre memoria inteligente y nunca se pregunta por el refuerzo.
test("setup on a brand-new database writes the intelligence phrase and never asks about reinforcement", async () => {
  const { config } = fixture();
  const { io, output, questions } = conversation(["", "sí"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(output.join("\n")).toContain("La base nueva se creará con la memoria inteligente (esquema 11), que ya incluye sesiones y el refuerzo de recuerdos.");
  expect(output.join("\n")).not.toContain("¿Quieres habilitar el refuerzo de recuerdos?");
  // Solo la pregunta de PostgreSQL y la confirmación final: ninguna pregunta de refuerzo en medio.
  expect(questions).toHaveLength(2);
});

// Verifica que ejecutar setup sobre un espacio ya en uso conserva proyectos y memorias existentes, sin preguntar por ningún proyecto ni mencionar su nombre o id en la salida.
test("setup preserves existing projects and memories without asking which project to use", async () => {
  const { config, workspace } = fixture();
  const project = workspace.createProject("PRIVATE_PROJECT_NAME");
  const store = workspace.open();
  let id: string;
  try { id = store.save({ projectId: project.projectId, title: "Keep", content: "SQLite", type: "fact" }).id; }
  finally { store.close(); }
  const before = readFileSync(join(config.root, ".env"));
  // El proyecto se creó a través de workspace.createProject(), que ya hace nacer la base en el
  // esquema 11 (memoria inteligente): el refuerzo ya está activado, así que setup lo reporta en vez de preguntar.
  const { io, output, questions } = conversation(["no", "yes"]);
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(workspace.listProjects()).toEqual([project]);
  expect(readFileSync(join(config.root, ".env"))).toEqual(before);
  const reopened = workspace.open(true);
  try { expect(reopened.get(project.projectId, id)!.content).toBe("SQLite"); }
  finally { reopened.close(); }
  expect(output.join("\n")).not.toContain(project.name);
  expect(output.join("\n")).not.toContain(project.projectId);
});

// Verifica que respuestas inválidas o que parecen opciones de un menú de proyectos ya retirado no confunden el bucle de confirmación, que sigue pidiendo hasta obtener si/no.
test("setup retries invalid confirmation without interpreting old project menu choices", async () => {
  const { config, workspace } = fixture();
  // Base completamente nueva: no se pregunta por el refuerzo, así que el bucle de confirmación empieza justo después de la pregunta de PostgreSQL.
  const { io, questions } = conversation(["no", "1", "Demo", "2", "3", "maybe", "si"], () => expect(existsSync(config.root)).toBe(false));
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(7);
  expect(workspace.listProjects()).toEqual([]);
});

// Verifica que cancelar tras escribir una URL de PostgreSQL con credenciales no llega a conectarse ni filtra la contraseña en ningún mensaje mostrado.
test("setup cancels PostgreSQL before connecting or publishing credentials", async()=>{
  const {config}=fixture();
  const {io,output}=conversation(["si","postgresql://u:SECRET@127.0.0.1:1/db?sslmode=disable","no"]);
  expect(await runSetup(io,config)).toEqual({cancelled:true});
  expect(existsSync(config.root)).toBe(false);
  expect(output.join("\n")).not.toContain("SECRET");
});

// Verifica que cancelar setup no borra ni modifica un proyecto que ya existía antes de ejecutarlo.
test("setup cancellation preserves existing project records", async () => {
  const { config, workspace } = fixture();
  const project = workspace.createProject("Original");
  expect(await runSetup(conversation(["no"]).io, config)).toEqual({ cancelled: true });
  expect(workspace.listProjects()).toEqual([project]);
});

// Verifica que si la configuración existe pero el archivo de base de datos falta, setup se rechaza antes de preguntar nada y sin recrear el archivo.
test("setup refuses a missing configured database before prompting without recreating it", async () => {
  const { config, workspace } = fixture();
  workspace.init(); rmSync(config.databasePath);
  const { io, questions } = conversation(["si"]);
  await expect(runSetup(io, config)).rejects.toMatchObject({ code: "DATABASE_MISSING" });
  expect(questions).toEqual([]);
  expect(existsSync(config.databasePath)).toBe(false);
});

// Verifica los tres desenlaces de la pregunta de refuerzo sobre una base heredada (legada): rechazarla la deja desactivada, cancelar después no aplica nada, y aceptarla la activa y muestra las advertencias correspondientes.
test("setup only enrolls reinforcement after the final confirmation", async () => {
  // La pregunta de refuerzo solo se hace para una base que ya existe por debajo del nivel 7: un
  // espacio de trabajo completamente nuevo nace con él ya activado (ver las pruebas de arriba),
  // así que cada escenario aquí parte de una base heredada, ya configurada de antemano.
  const declined = fixture();
  legacyConfiguredWorkspace(declined.config);
  const declinedConfig = readFileSync(join(declined.config.root, ".env"));
  expect(await runSetup(conversation(["no", "no", "si"]).io, declined.config))
    .toEqual({ cancelled: false, storage: "sqlite" });
  expect(readFileSync(join(declined.config.root, ".env"))).toEqual(declinedConfig);
  let store = declined.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  const cancelled = fixture();
  legacyConfiguredWorkspace(cancelled.config);
  const cancelledDatabase = readFileSync(cancelled.config.databasePath);
  const cancelledConfig = readFileSync(join(cancelled.config.root, ".env"));
  expect(await runSetup(conversation(["no", "si", "no"]).io, cancelled.config))
    .toEqual({ cancelled: true });
  expect(readFileSync(cancelled.config.databasePath)).toEqual(cancelledDatabase);
  expect(readFileSync(join(cancelled.config.root, ".env"))).toEqual(cancelledConfig);
  store = cancelled.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(false); }
  finally { store.close(); }

  const accepted = fixture();
  legacyConfiguredWorkspace(accepted.config);
  const { io, output } = conversation(["no", "si", "si"]);
  expect(await runSetup(io, accepted.config)).toEqual({ cancelled: false, storage: "sqlite" });
  store = accepted.workspace.open(true);
  try { expect(store.reinforcementEnabled()).toBe(true); }
  finally { store.close(); }
  expect(output.join("\n")).toContain("registrar repeticiones mejora el orden; no verifica la verdad.");
  expect(output.join("\n")).toContain("sincronizar esta función requiere actualizar todos los equipos.");
  expect(output.join("\n")).toContain("sync --upgrade-format");
});

// Verifica que si el refuerzo ya estaba activado, setup lo informa sin ofrecer nunca la opción de desactivarlo.
test("setup reports existing reinforcement without offering a downgrade", async () => {
  const { config, workspace } = fixture();
  workspace.init();
  const store = workspace.open();
  try { store.enableSearchReinforcement(); }
  finally { store.close(); }
  const { io, output, questions } = conversation(["no", "si"]);
  expect(await runSetup(io, config)).toEqual({ cancelled: false, storage: "sqlite" });
  expect(questions).toHaveLength(2);
  expect(output.join("\n")).toContain("El refuerzo de recuerdos ya está habilitado.");
  expect(output.join("\n")).not.toContain("¿Quieres habilitar el refuerzo de recuerdos?");
  const reopened = workspace.open(true);
  try { expect(reopened.reinforcementEnabled()).toBe(true); }
  finally { reopened.close(); }
});
