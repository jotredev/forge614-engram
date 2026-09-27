/**
 * Comprueba, con `auditImports`, los límites de dependencia entre la infraestructura, la
 * aplicación y las interfaces de terminal: la infraestructura no debe depender hacia arriba de
 * la aplicación, y la aplicación no debe depender hacia abajo de una interfaz concreta.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";

// La infraestructura (una capa de más abajo) no puede importar una fachada de la aplicación
// (una capa de más arriba); eso invertiría la dirección permitida de la dependencia.
test("infrastructure cannot import the MemoryStore facade", () => {
  expect(auditImports({
    "src/infrastructure/sqlite/open.ts": 'import {MemoryStore} from "../../app/memory-store";',
    "src/app/memory-store.ts": "export class MemoryStore {}",
  })).not.toEqual([]);
});

// La aplicación no puede importar una implementación concreta de una interfaz (aquí, la de
// terminal): debe depender de una abstracción, no de un detalle de presentación.
test("application coordination cannot import terminal implementations", () => {
  expect(auditImports({
    "src/app/synchronization.ts": 'import "../interfaces/terminal/sync-watch";',
    "src/interfaces/terminal/sync-watch.ts": "export {};",
  })).not.toEqual([]);
});

// Corre la auditoría sobre el árbol real de `src/` y exige que no haya ninguna infracción de
// ninguna regla en archivos de `src/app`, `src/modules`, `src/infrastructure` y
// `src/interfaces/terminal`, ni un ciclo entre piezas, en el código real, no solo en los
// ejemplos de arriba.
test("workspace opening and application adapters have no backwards dependencies", () => {
  const files = Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync(".")]
    .map(path => [path, readFileSync(path, "utf8")]));
  expect(auditImports(files).filter(error =>
    /^(src\/(app|modules|infrastructure|interfaces\/terminal)\/|component cycle:)/.test(error))).toEqual([]);
});
