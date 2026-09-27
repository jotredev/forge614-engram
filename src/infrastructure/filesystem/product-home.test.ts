/** Comprueba que `EngramProductHome` migra solo los archivos antiguos conocidos y protege la carpeta de Engram sin tocar la de Forge614. */
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withDirectory } from "../__test-support__/fixtures";
import { EngramProductHome } from "./product-home";
import { MemoryError } from "../../shared/errors";

const config = 'FORMAT_VERSION="2"\nSTORAGE="sqlite"\n';

function fixture(directory: string) {
  const parent = join(directory, ".forge614");
  const product = join(parent, "engram");
  return { parent, product, home: new EngramProductHome(parent, product) };
}

// La migración debe mover solo los nombres conocidos de Engram y dejar intacto cualquier otro contenido del padre.
test("migrates only known root-level Engram files and preserves Shell", () => withDirectory(directory => {
  const { parent, product, home } = fixture(directory);
  mkdirSync(join(parent, "shell"), { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, "shell", "keep"), "unchanged");
  writeFileSync(join(parent, ".env"), config, { mode: 0o600 });
  writeFileSync(join(parent, "engram.db"), "database", { mode: 0o600 });
  writeFileSync(join(parent, "engram.db-wal"), "wal", { mode: 0o600 });

  expect(home.migrateLegacyWorkspace()).toBe("migrated");

  expect(readFileSync(join(product, ".env"), "utf8")).toBe(config);
  expect(readFileSync(join(product, "engram.db"), "utf8")).toBe("database");
  expect(readFileSync(join(product, "engram.db-wal"), "utf8")).toBe("wal");
  expect(existsSync(join(parent, "engram.db"))).toBe(false);
  expect(readFileSync(join(parent, "shell", "keep"), "utf8")).toBe("unchanged");
}));

// Si el destino ya tiene un archivo con el mismo nombre, debe rechazar antes de mover nada, sin pérdidas ni mezclas.
test("rejects a destination conflict without moving any legacy file", () => withDirectory(directory => {
  const { parent, product, home } = fixture(directory);
  mkdirSync(product, { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, ".env"), config, { mode: 0o600 });
  writeFileSync(join(product, "engram.db"), "different", { mode: 0o600 });

  let error: unknown;
  try { home.migrateLegacyWorkspace(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(MemoryError);
  expect((error as MemoryError).code).toBe("LEGACY_CONFLICT");
  expect(readFileSync(join(parent, ".env"), "utf8")).toBe(config);
  expect(readFileSync(join(product, "engram.db"), "utf8")).toBe("different");
}));

// `prepare` no debe modificar los permisos del padre compartido, solo los de la carpeta propia de Engram.
test("keeps the shared Forge614 parent permissions unchanged while securing only Engram", () => withDirectory(directory => {
  const { parent, product, home } = fixture(directory);
  mkdirSync(join(parent, "shell"), { recursive: true, mode: 0o755 });
  writeFileSync(join(parent, "shell", "keep"), "unchanged");
  chmodSync(parent, 0o755);

  home.prepare();

  expect(home.root).toBe(product);
  expect(existsSync(product)).toBe(true);
  expect(statSync(parent).mode & 0o777).toBe(0o755);
  expect(statSync(product).mode & 0o777).toBe(0o700);
  expect(readFileSync(join(parent, "shell", "keep"), "utf8")).toBe("unchanged");
}));

// Un candidato a archivo antiguo que en realidad es un enlace simbólico debe rechazarse sin seguirlo ni moverlo.
test("rejects a linked legacy candidate without moving it", () => withDirectory(directory => {
  const { parent, home } = fixture(directory);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const outside = join(directory, "outside.db");
  writeFileSync(outside, "keep", { mode: 0o600 });
  symlinkSync(outside, join(parent, "engram.db"));

  let error: unknown;
  try { home.migrateLegacyWorkspace(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(MemoryError);
  expect((error as MemoryError).code).toBe("LEGACY_UNSAFE");
  expect(readFileSync(outside, "utf8")).toBe("keep");
}));
