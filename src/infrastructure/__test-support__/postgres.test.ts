import { expect, test } from "bun:test";
import { startPostgresCluster } from "./postgres";

test("PostgreSQL test support reports an explicit skip reason when no binary directory is configured", () => {
  expect(startPostgresCluster("")).toEqual({
    available: false,
    reason: "FORGE614_TEST_POSTGRES_BIN is not configured",
  });
});

test("PostgreSQL test support turns an unavailable fixture into an explicit skip reason", () => {
  expect(startPostgresCluster("/definitely-missing-forge614-postgres")).toMatchObject({
    available: false,
    reason: expect.stringContaining("PostgreSQL disposable fixture unavailable"),
  });
});
