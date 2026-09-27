/**
 * Comprueba, con `auditImports`, que la fachada `MemoryStore` de la aplicación no depende de
 * `bun:sqlite` directamente (debe llegarle a través de la infraestructura), y que las
 * operaciones de SQLite ya extraídas siguen respetando sus límites de dependencia en el árbol real.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";

// Se lee el archivo real de la fachada (no un ejemplo hecho a mano) para que la prueba falle si
// alguien le agrega una importación directa de `bun:sqlite` en el futuro.
test("MemoryStore facade does not depend on SQLite directly", () => {
  const path = "src/app/memory-store.ts";
  const source = readFileSync(path, "utf8");
  expect(auditImports({[path]:source}).filter(error => error.includes("app cannot import bun:sqlite"))).toEqual([]);
});

// Sobre el árbol real de `src/`, ninguna infracción de límites entre la aplicación, los módulos
// de dominio o la capa de SQLite de la infraestructura (ni un ciclo entre esas piezas).
test("extracted SQLite operations and source modules respect their dependency boundaries", () => {
  const files = Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync(".")]
    .map(path => [path, readFileSync(path,"utf8")]));
  const errors = auditImports(files).filter(error =>
    /^(src\/(app|modules|infrastructure\/sqlite)\/|component cycle:)/.test(error));
  expect(errors).toEqual([]);
});
