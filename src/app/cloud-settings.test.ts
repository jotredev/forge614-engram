/**
 * Comprueba `cloudSettings`: da `null` sin configuración guardada, sin `POSTGRES_URL` o sin id de
 * instalación todavía asignado, y da los dos datos completos cuando la configuración los trae.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudSettings } from "./cloud-settings";

let directory = "";
let previousHome: string | undefined;
// Cada prueba usa su propio $FORGE614_HOME temporal, restaurado al terminar (mismo patrón que paths.test.ts/updater.test.ts).
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "forge614-cloud-settings-"));
  previousHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(directory, ".forge614");
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousHome;
  rmSync(directory, { recursive: true, force: true });
});

/** Escribe un `.env` de Engram válido con el contenido dado, con los permisos privados que `WorkspaceConfig.read()` exige. */
function writeEnv(content: string): void {
  const root = join(directory, ".forge614", "engram");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, ".env"), content, { mode: 0o600 });
}

// Sin ninguna configuración guardada (nunca se corrió init), cloudSettings da null en vez de lanzar.
test("cloudSettings is null when no configuration was ever saved", () => {
  expect(cloudSettings()).toBeNull();
});

// Con la configuración mínima (solo SQLite, formato 2), sin nube, cloudSettings da null.
test("cloudSettings is null for the plain SQLite-only configuration", () => {
  writeEnv('FORMAT_VERSION="2"\nSTORAGE="sqlite"\n');
  expect(cloudSettings()).toBeNull();
});

// Con réplica configurada pero sin id de instalación todavía asignado (antes de que `cloud on` lo genere), cloudSettings da null: aún no hay nube completa.
test("cloudSettings is null with a postgres URL but no installation id yet", () => {
  writeEnv('FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u@127.0.0.1/db?sslmode=disable"\n');
  expect(cloudSettings()).toBeNull();
});

// Con los dos datos completos, cloudSettings los da tal cual.
test("cloudSettings returns the postgres URL and installation id when both are set", () => {
  writeEnv('FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u@127.0.0.1/db?sslmode=disable"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n');
  expect(cloudSettings()).toEqual({ postgresUrl: "postgresql://u@127.0.0.1/db?sslmode=disable", installationId: "3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f" });
});
