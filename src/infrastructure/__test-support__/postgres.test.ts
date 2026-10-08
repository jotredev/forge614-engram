/** Comprueba la omisión explícita en modo normal y el fallo obligatorio en modo estricto de la CI. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { postgresBinaryName, startPostgresCluster, stopPostgresCluster } from "./postgres";

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

// En Windows agrega .exe y en Unix conserva el nombre original sin extensión.
test("postgresBinaryName appends .exe on Windows and leaves Unix names without extension", () => {
  expect(postgresBinaryName("initdb", "win32")).toBe("initdb.exe");
  expect(postgresBinaryName("pg_ctl", "win32")).toBe("pg_ctl.exe");
  expect(postgresBinaryName("postgres", "win32")).toBe("postgres.exe");
  expect(postgresBinaryName("initdb", "darwin")).toBe("initdb");
  expect(postgresBinaryName("pg_ctl", "linux")).toBe("pg_ctl");
  expect(postgresBinaryName("postgres", "linux")).toBe("postgres");
});

// En Windows invoca initdb.exe y pg_ctl.exe con las tuberías y parámetros correspondientes.
test("startPostgresCluster invokes initdb.exe and pg_ctl.exe on Windows", () => {
  const spawnedCommands: { command: string; args: string[]; stdio: string }[] = [];
  const fakeBin = "C:\\Program Files\\PostgreSQL\\17\\bin";

  const cluster = startPostgresCluster(fakeBin, {
    platform: "win32",
    spawn: (cmd, args, options) => {
      spawnedCommands.push({ command: cmd, args, stdio: options.stdio });
      return { status: 0 };
    },
  });

  expect(cluster.available).toBe(true);
  if (!cluster.available) return;

  expect(spawnedCommands.length).toBe(2);
  expect(spawnedCommands[0]?.command).toBe(join(fakeBin, "initdb.exe"));
  expect(spawnedCommands[0]?.stdio).toBe("pipe");
  expect(spawnedCommands[1]?.command).toBe(join(fakeBin, "pg_ctl.exe"));
  expect(spawnedCommands[1]?.stdio).toBe("ignore");
  // En Windows se omite el socket Unix -k
  expect(spawnedCommands[1]?.args.some(a => /(?:^|\s)-k(?:\s|$)/.test(a))).toBe(false);

  // Detener el clúster invoca pg_ctl.exe
  stopPostgresCluster(cluster, {
    platform: "win32",
    spawn: (cmd, args, options) => {
      spawnedCommands.push({ command: cmd, args, stdio: options.stdio });
      return { status: 0 };
    },
  });

  expect(spawnedCommands.length).toBe(3);
  expect(spawnedCommands[2]?.command).toBe(join(fakeBin, "pg_ctl.exe"));
  expect(spawnedCommands[2]?.stdio).toBe("ignore");
});

// En plataformas Unix invoca initdb y pg_ctl sin extensión .exe y pasa -k para el socket.
test("startPostgresCluster invokes initdb and pg_ctl on Unix without .exe extension", () => {
  const spawnedCommands: { command: string; args: string[]; stdio: string }[] = [];
  const fakeBin = "/opt/homebrew/opt/postgresql@18/bin";

  const cluster = startPostgresCluster(fakeBin, {
    platform: "darwin",
    spawn: (cmd, args, options) => {
      spawnedCommands.push({ command: cmd, args, stdio: options.stdio });
      return { status: 0 };
    },
  });

  expect(cluster.available).toBe(true);
  if (!cluster.available) return;

  expect(spawnedCommands.length).toBe(2);
  expect(spawnedCommands[0]?.command).toBe(join(fakeBin, "initdb"));
  expect(spawnedCommands[1]?.command).toBe(join(fakeBin, "pg_ctl"));
  // En Unix incluye -k para el socket
  expect(spawnedCommands[1]?.args.some(a => /(?:^|\s)-k(?:\s|$)/.test(a))).toBe(true);

  stopPostgresCluster(cluster, {
    platform: "darwin",
    spawn: (cmd, args, options) => {
      spawnedCommands.push({ command: cmd, args, stdio: options.stdio });
      return { status: 0 };
    },
  });

  expect(spawnedCommands.length).toBe(3);
  expect(spawnedCommands[2]?.command).toBe(join(fakeBin, "pg_ctl"));
});

// En modo estricto lanza un error explícito cuando falta la variable de entorno en vez de omitir la suite.
test("startPostgresCluster in strict mode throws explicit error when binary is missing instead of skipping", () => {
  const previousBin = process.env.FORGE614_TEST_POSTGRES_BIN;
  const previousRequire = process.env.FORGE614_REQUIRE_TEST_POSTGRES;
  try {
    delete process.env.FORGE614_TEST_POSTGRES_BIN;
    process.env.FORGE614_REQUIRE_TEST_POSTGRES = "1";

    expect(() => startPostgresCluster()).toThrow(
      "FORGE614_REQUIRE_TEST_POSTGRES=1 is set, but FORGE614_TEST_POSTGRES_BIN is not configured",
    );
  } finally {
    if (previousBin !== undefined) process.env.FORGE614_TEST_POSTGRES_BIN = previousBin;
    else delete process.env.FORGE614_TEST_POSTGRES_BIN;
    if (previousRequire !== undefined) process.env.FORGE614_REQUIRE_TEST_POSTGRES = previousRequire;
    else delete process.env.FORGE614_REQUIRE_TEST_POSTGRES;
  }
});

// En modo estricto lanza un error explícito cuando falla el arranque del clúster en vez de omitir la suite.
test("startPostgresCluster in strict mode throws explicit error when cluster startup fails instead of skipping", () => {
  expect(() =>
    startPostgresCluster("/fake/bin", {
      strict: true,
      spawn: () => ({ status: 1, stderr: "initdb: error simulado" }),
    }),
  ).toThrow("FORGE614_REQUIRE_TEST_POSTGRES=1 is set, but disposable fixture failed");
});

// Conserva el resultado con available: false sin lanzar cuando se pasa una ruta explícita aunque FORGE614_REQUIRE_TEST_POSTGRES=1 esté activo.
test("startPostgresCluster preserves non-strict skip when explicit paths are supplied even if FORGE614_REQUIRE_TEST_POSTGRES=1", () => {
  const previousRequire = process.env.FORGE614_REQUIRE_TEST_POSTGRES;
  try {
    process.env.FORGE614_REQUIRE_TEST_POSTGRES = "1";

    // Ruta explícita vacía
    expect(startPostgresCluster("")).toEqual({
      available: false,
      reason: "FORGE614_TEST_POSTGRES_BIN is not configured",
    });

    // Ruta explícita inexistente
    expect(startPostgresCluster("/definitely-missing-forge614-postgres")).toMatchObject({
      available: false,
      reason: expect.stringContaining("PostgreSQL disposable fixture unavailable"),
    });
  } finally {
    if (previousRequire !== undefined) process.env.FORGE614_REQUIRE_TEST_POSTGRES = previousRequire;
    else delete process.env.FORGE614_REQUIRE_TEST_POSTGRES;
  }
});
