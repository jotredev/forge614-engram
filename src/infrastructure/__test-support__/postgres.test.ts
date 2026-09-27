/** Comprueba que `startPostgresCluster` da una razón explícita para omitir la suite en vez de lanzar cuando no hay binario configurado o disponible. */
import { expect, test } from "bun:test";
import { startPostgresCluster } from "./postgres";

// Sin ruta de binario (cadena vacía), debe reportar exactamente que la variable de entorno no está configurada.
test("PostgreSQL test support reports an explicit skip reason when no binary directory is configured", () => {
  expect(startPostgresCluster("")).toEqual({
    available: false,
    reason: "FORGE614_TEST_POSTGRES_BIN is not configured",
  });
});

// Con una ruta que no existe, debe reportar que la instalación desechable no está disponible, no lanzar.
test("PostgreSQL test support turns an unavailable fixture into an explicit skip reason", () => {
  expect(startPostgresCluster("/definitely-missing-forge614-postgres")).toMatchObject({
    available: false,
    reason: expect.stringContaining("PostgreSQL disposable fixture unavailable"),
  });
});
