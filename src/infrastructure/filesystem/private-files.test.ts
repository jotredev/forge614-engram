/** Comprueba que `assertSafePath` no permite atajos por tipos y que `guardedWrite`/`readSafeFile` protegen bytes y respaldos. */
import { expect, test } from "bun:test";
import { chmodSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafePath, guardedWrite, readSafeFile } from "./private-files";
import { withDirectory } from "../__test-support__/fixtures";
import { expectPosixMode } from "../__test-support__/permissions";

type Equal<Left,Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Condition extends true> = Condition;

// Comprueba en tiempo de compilación que la firma pública de assertSafePath sigue siendo (path: string), sin parámetros extra que permitan saltarse alguna comprobación.
test("assertSafePath exposes no checker bypass in its public API", () => {
  type AssertSafePathPublicSignature = Expect<Equal<Parameters<typeof assertSafePath>,[path:string]>>;
  const signature:AssertSafePathPublicSignature=true;
  expect(signature).toBe(true);
});

/** Comprueba que una escritura guardada conserva respaldo y contenido, y aplica permisos POSIX privados si están disponibles. */
test("guarded replacement retains exact backup and private published bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "old");
  const backups: string[] = [], published: string[] = [];
  guardedWrite({ path, before: "old", after: "new", kind: "config" }, p => backups.push(p), p => published.push(p));
  expect(readSafeFile(path)).toBe("new"); expect(published).toEqual([path]);
  expect(backups).toHaveLength(1); expect(readFileSync(backups[0]!, "utf8")).toBe("old");
  expectPosixMode(path, 0o600);
  expect(readdirSync(dir).some(p => p.includes("-tmp-"))).toBe(false);
}));

// Si el archivo ya no tiene el contenido esperado en `before`, o la ruta es un enlace simbólico, la operación debe rechazarse sin tocar los bytes reales del destino.
test("stale preview and symlink reads fail without changing target bytes", () => withDirectory(dir => {
  const path = join(dir, "config"); writeFileSync(path, "external");
  expect(() => guardedWrite({ path, before: "old", after: "new", kind: "config" }, () => {}, () => {})).toThrow(expect.objectContaining({ code: "CHANGED" }));
  const link = join(dir, "link"); symlinkSync(path, link);
  expect(() => readSafeFile(link)).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  expect(readFileSync(path, "utf8")).toBe("external"); expect(readdirSync(dir).sort()).toEqual(["config", "link"]);
}));

/**
 * En Windows, como el sistema no devuelve permisos de grupo y otros comparables a POSIX,
 * una carpeta padre con permisos 0o777 no causa que la ruta se rechace por considerarse
 * escribible por otros usuarios.
 */
test("Windows platform accepts 0o777 parent directories because group permissions are not reported", () => withDirectory(dir => {
  const realDir = realpathSync(dir);
  const path = join(realDir, "config");
  writeFileSync(path, "content");
  chmodSync(realDir, 0o777);

  if (process.platform !== "win32") {
    expect(() => assertSafePath(path)).toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
  }

  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(() => assertSafePath(path)).not.toThrow();
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  }
}));
