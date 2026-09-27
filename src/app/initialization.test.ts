/**
 * Comprueba el flujo de inicialización en dos pasos: la inspección no crea nada, la vista
 * previa no expone credenciales ni toca el disco, y aplicar respeta la revisión esperada y
 * nunca desactiva el refuerzo de recuerdos ya activado.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";
import { applyMemoryInitialization, inspectMemoryInitialization, previewMemoryInitialization } from "./initialization";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "forge614-initialization-"));
  directories.push(directory);
  const config = new WorkspaceConfig(join(directory, ".forge614", "engram"));
  return { config, workspace: new MemoryWorkspace(config) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// Verifica que inspeccionar un espacio de trabajo inexistente no lo crea y reporta todo en false.
test("inspection reports absent storage without creating it", () => {
  const { config } = fixture();

  expect(inspectMemoryInitialization(config)).toEqual({
    initialized: false,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: false,
  });
  expect(existsSync(config.root)).toBe(false);
});

// Verifica que la inspección lee el estado real del refuerzo desde una base ya inicializada.
test("inspection reports enabled reinforcement from an existing local workspace", () => {
  const { config, workspace } = fixture();
  workspace.init();
  const store = workspace.open();
  try { store.enableSearchReinforcement(); }
  finally { store.close(); }

  expect(inspectMemoryInitialization(config)).toEqual({
    initialized: true,
    storage: "sqlite",
    postgresConfigured: false,
    reinforcementEnabled: true,
  });
});

// Verifica que la vista previa valida la URL de PostgreSQL sin filtrar la contraseña en el resultado ni tocar el disco.
test("preview validates a PostgreSQL request without exposing its credential or creating storage", async () => {
  const { config } = fixture();

  const preview = await previewMemoryInitialization({
    postgresUrl: "postgresql://user:SECRET_MARKER@127.0.0.1/db?sslmode=disable",
    enableReinforcement: true,
  }, config);

  expect(preview).toEqual({
    status: {
      initialized: false,
      storage: "sqlite",
      postgresConfigured: false,
      reinforcementEnabled: false,
    },
    expectedRevision: null,
    initializesStorage: true,
    configuresPostgres: true,
    enablesReinforcement: true,
  });
  expect(JSON.stringify(preview)).not.toContain("SECRET_MARKER");
  expect(existsSync(config.root)).toBe(false);
});

// Verifica que aplicar sin PostgreSQL ni refuerzo pedidos igual inicializa el almacenamiento y no crea ningún proyecto.
test("apply initializes local storage without creating a project", async () => {
  const { config, workspace } = fixture();
  const request = { postgresUrl: null, enableReinforcement: false };
  const preview = await previewMemoryInitialization(request, config);

  const result = await applyMemoryInitialization(request, preview.expectedRevision, config);

  // Una base recién nacida arranca con memoria inteligente (esquema 11), que ya incluye el
  // refuerzo: lo reporta activado aunque esta solicitud no pidiera activarlo.
  expect(result).toEqual({
    status: {
      initialized: true,
      storage: "sqlite",
      postgresConfigured: false,
      reinforcementEnabled: true,
    },
    initializedStorage: true,
    configuredPostgres: false,
    enabledReinforcement: false,
  });
  expect(workspace.listProjects()).toEqual([]);
});

// Verifica que aplicar una vista previa vieja, tras cambiar la configuración mientras tanto, se rechaza y no toca lo ya cambiado.
test("apply rejects a preview after the configuration changes", async () => {
  const { config, workspace } = fixture();
  workspace.init();
  const request = { postgresUrl: null, enableReinforcement: false };
  const preview = await previewMemoryInitialization(request, config);
  config.configurePostgres("postgresql://user:password@127.0.0.1/db?sslmode=disable", config.revision());

  await expect(applyMemoryInitialization(request, preview.expectedRevision, config))
    .rejects.toMatchObject({ code: "CONFIG_CHANGED" });
  expect(config.read().postgresUrl).toBe("postgresql://user:password@127.0.0.1/db?sslmode=disable");
});

// Verifica que pedir enableReinforcement:false nunca desactiva un refuerzo que ya estaba activado.
test("apply never disables existing reinforcement", async () => {
  const { config } = fixture();
  const enabled = { postgresUrl: null, enableReinforcement: true };
  const enabledPreview = await previewMemoryInitialization(enabled, config);
  await applyMemoryInitialization(enabled, enabledPreview.expectedRevision, config);
  const disabled = { postgresUrl: null, enableReinforcement: false };
  const disabledPreview = await previewMemoryInitialization(disabled, config);

  const result = await applyMemoryInitialization(disabled, disabledPreview.expectedRevision, config);

  expect(result.status.reinforcementEnabled).toBe(true);
  expect(result.enabledReinforcement).toBe(false);
});
