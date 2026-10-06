/** Comprueba que `WorkspaceConfig` guarda, lee y actualiza la configuración global sin sobrescribir bytes válidos ni exponer secretos en errores. */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "../../infrastructure/filesystem/workspace-config";
import { expectPosixMode } from "../__test-support__/permissions";

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "forge614-config-")); dirs.push(dir);
  const root = join(dir, ".forge614");
  return { dir, root, path: join(root, ".env"), config: new WorkspaceConfig(root) };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

// Inspeccionar una configuración inexistente no debe crear ni la carpeta ni el archivo.
test("missing config inspection does not create files", () => {
  const f = fixture(); expect(f.config.exists()).toBe(false);
  expect(() => f.config.read()).toThrow(); expect(existsSync(f.root)).toBe(false);
});

/** Comprueba que PostgreSQL queda global y rechaza una revisión obsoleta sin cambiar el archivo. */
test("PostgreSQL synchronization config stays global and rejects stale replacements", () => {
  const f=fixture();f.config.save();
  const revision=f.config.revision();
  f.config.configurePostgres("postgresql://u:SECRET@127.0.0.1/db?sslmode=disable",revision);
  expect(f.config.read()).toEqual({storage:"sqlite",postgresUrl:"postgresql://u:SECRET@127.0.0.1/db?sslmode=disable"});
  expectPosixMode(f.path, 0o600);
  const before=readFileSync(f.path);
  expect(()=>f.config.configurePostgres(null,revision)).toThrow();
  expect(readFileSync(f.path)).toEqual(before);
  f.config.save();expect(readFileSync(f.path)).toEqual(before);
  f.config.configurePostgres(null,f.config.revision());
  expect(f.config.read()).toEqual({storage:"sqlite"});
  expect(readFileSync(f.path,"utf8")).not.toContain("SECRET");
});

// El id de instalación solo debe aparecer en el resultado cuando `FORGE614_ENGRAM_INSTALLATION_ID` está en el archivo.
test("installationId is exposed from FORGE614_ENGRAM_INSTALLATION_ID and absent otherwise", () => {
  const f=fixture();f.config.save();
  const revision=f.config.revision();
  f.config.configurePostgres("postgresql://u:SECRET@127.0.0.1/db?sslmode=disable",revision);
  expect(f.config.read()).toEqual({storage:"sqlite",postgresUrl:"postgresql://u:SECRET@127.0.0.1/db?sslmode=disable"});
  writeFileSync(f.path,'FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u:SECRET@127.0.0.1/db?sslmode=disable"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n',{mode:0o600});
  expect(f.config.read()).toEqual({storage:"sqlite",postgresUrl:"postgresql://u:SECRET@127.0.0.1/db?sslmode=disable",installationId:"3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"});
});

// El formato que deja "cloud off" (D9): id de instalación conservado, sin POSTGRES_URL; read() lo acepta.
test("read accepts the format 'cloud off' leaves behind: an installation id without POSTGRES_URL", () => {
  const f = fixture(); f.config.save();
  writeFileSync(f.path, 'FORMAT_VERSION="3"\nSTORAGE="sqlite"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n', { mode: 0o600 });
  expect(f.config.read()).toEqual({ storage: "sqlite", installationId: "3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f" });
});

// configurePostgres con un tercer argumento (installationId) lo escribe junto a la URL; repetir la llamada con el mismo id y la misma URL no reemplaza el archivo (no-op).
test("configurePostgres writes the installation id when given one, and repeating the same call is a no-op", () => {
  const f = fixture(); f.config.save();
  const id = "3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f";
  f.config.configurePostgres("postgresql://u@127.0.0.1/db?sslmode=disable", f.config.revision(), id);
  expect(f.config.read()).toEqual({ storage: "sqlite", postgresUrl: "postgresql://u@127.0.0.1/db?sslmode=disable", installationId: id });
  const before = readFileSync(f.path);
  f.config.configurePostgres("postgresql://u@127.0.0.1/db?sslmode=disable", f.config.revision(), id);
  expect(readFileSync(f.path)).toEqual(before);
});

// configurePostgres(null, ..., id) quita la URL pero conserva el id (forma de "cloud off"); sin id explícito (dos argumentos, como usan setup/init), el id que ya hubiera se conserva igual.
test("configurePostgres(null, ..., id) drops the URL but keeps the given id; the two-argument call preserves whatever id was already there", () => {
  const f = fixture(); f.config.save();
  const id = "3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f";
  f.config.configurePostgres("postgresql://u@127.0.0.1/db?sslmode=disable", f.config.revision(), id);
  f.config.configurePostgres(null, f.config.revision(), id);
  expect(f.config.read()).toEqual({ storage: "sqlite", installationId: id });
  f.config.configurePostgres("postgresql://u@127.0.0.1/db?sslmode=disable", f.config.revision());
  expect(f.config.read()).toEqual({ storage: "sqlite", postgresUrl: "postgresql://u@127.0.0.1/db?sslmode=disable", installationId: id });
});

/** Comprueba que la configuración global es única y conserva permisos POSIX privados si están disponibles. */
test("one private config contains no project identity or project-specific database path", () => {
  const f = fixture(); f.config.save();
  expect(f.config.read()).toEqual({ storage: "sqlite" });
  expect(readdirSync(f.root)).toEqual([".env"]);
  expectPosixMode(f.root, 0o700);
  expectPosixMode(f.path, 0o600);
  expect(f.config.databasePath).toBe(join(f.root, "engram.db"));
});

// Guardar varias veces cuando ya hay una configuración compatible no debe reemplazar sus bytes.
test("saving config repeatedly never replaces existing bytes", () => {
  const f = fixture(); f.config.save();
  writeFileSync(f.path, '# User comment\nFORMAT_VERSION="2"\nSTORAGE="sqlite"\n');
  const before = readFileSync(f.path); f.config.save();
  expect(readFileSync(f.path)).toEqual(before);
});

// Un enlace duro adicional apuntando al mismo archivo (como el que crea una publicación en curso) no debe impedir leer ni volver a guardar.
test("publication remains readable while the private staging link exists", () => {
  const f = fixture(); f.config.save();
  linkSync(f.path, join(f.root, ".env-staging.tmp"));
  expect(f.config.read()).toEqual({ storage: "sqlite" });
  expect(() => f.config.save()).not.toThrow();
});

// Permisos abiertos o un enlace simbólico en el archivo o en la carpeta raíz deben rechazarse sin seguir el enlace ni tocar su destino.
test("unsafe permissions and symlinked root or config are rejected", () => {
  const f = fixture(); f.config.save();
  chmodSync(f.path, 0o644); expect(() => f.config.read()).toThrow(); chmodSync(f.path, 0o600);
  const secret = join(f.dir, "secret"); const text = readFileSync(f.path);
  writeFileSync(secret, text, { mode: 0o600 }); rmSync(f.path); symlinkSync(secret, f.path);
  expect(() => f.config.read()).toThrow(); expect(() => f.config.save()).toThrow();
  expect(readFileSync(secret)).toEqual(text);
  const g = fixture(); const outside = join(g.dir, "outside"); mkdirSync(outside, { mode: 0o700 }); symlinkSync(outside, g.root);
  expect(() => g.config.save()).toThrow(); expect(readdirSync(outside)).toEqual([]);
});

// Una carpeta `projects` heredada de un formato de configuración por proyecto anterior debe rechazarse intacta, sin importarla ni borrarla.
test("old per-project configurations are rejected intact, never imported or removed", () => {
  const f = fixture(); mkdirSync(join(f.root,"projects"), { recursive:true, mode:0o700 });
  writeFileSync(join(f.root,"projects","old-config"), "KEEP");
  expect(() => f.config.save()).toThrow(); expect(() => f.config.exists()).toThrow();
  expect(readFileSync(join(f.root,"projects","old-config"),"utf8")).toBe("KEEP");
  expect(existsSync(f.path)).toBe(false);
});

// Un backend no soportado, campos heredados o un archivo mal formado deben fallar sin repetir el valor sospechoso en el error ni sobrescribir el archivo.
test("unsupported backends, legacy fields and malformed config fail without echoing or overwriting", () => {
  const f = fixture(); f.config.save();
  for (const text of [
    'FORMAT_VERSION="2"\nSTORAGE="postgresql"\n',
    'FORMAT_VERSION="1"\nSTORAGE="sqlite"\n',
    'FORMAT_VERSION="2"\nSTORAGE="sqlite"\nID_PROJECT="SECRET_MARKER"\n',
    'FORMAT_VERSION="2"\nSTORAGE="sqlite"\nDATABASE_PATH="SECRET_MARKER"\n',
    'FORMAT_VERSION="2"\nSTORAGE="sqlite"\nSTORAGE="SECRET_MARKER"\n',
    'FORMAT_VERSION="2"\nSTORAGE="$(SECRET_MARKER)"\n',
    "SECRET_MARKER",
  ]) {
    writeFileSync(f.path, text);
    let error: unknown; try { f.config.read(); } catch (caught) { error = caught; }
    expect(error).toBeDefined(); expect(String(error)).not.toContain("SECRET_MARKER");
    expect(() => f.config.save()).toThrow(); expect(readFileSync(f.path,"utf8")).toBe(text);
  }
});

/**
 * En Windows, como el sistema no devuelve permisos de grupo y otros comparables a POSIX, una
 * configuración guardada se lee aunque el sistema de archivos indique un modo 0o666 y la carpeta 0o777,
 * siempre que sea propiedad del usuario actual.
 */
test("Windows platform accepts open filesystem permissions due to lack of strict mode bits", () => {
  const f = fixture(); f.config.save();
  chmodSync(f.root, 0o777);
  chmodSync(f.path, 0o666);
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(f.config.read()).toEqual({ storage: "sqlite" });
    expect(() => f.config.save()).not.toThrow();
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  }
});
