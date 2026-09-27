/**
 * Casos puntuales de `auditImports`, uno por regla de la política de importaciones entre capas:
 * quién puede importar a quién, qué formas de importación cuentan (de tipos, dinámicas,
 * `require`) y qué combinaciones producen un ciclo entre piezas.
 */
import { describe, expect, test } from "bun:test";
import { auditImports } from "./import-rules";

// Casos puntuales de auditImports para cada regla de la política de importaciones.
describe("module import policy", () => {
  // Un archivo de producción que no pertenece a ninguna pieza reconocida (`cli.ts` o uno sin
  // clasificar) tampoco puede importar la entrada pública del SDK (`src/index.ts`).
  test.each(["src/cli.ts", "src/unclassified.ts"])("rejects SDK entry imports from production source %s without a component", file => {
    expect(auditImports({
      [file]: 'import { MemoryStore } from "./index";',
      "src/index.ts": "export class MemoryStore {}",
    })).toEqual([`${file}: internal code cannot import the SDK entry`]);
  });

  // Un consumidor fuera de `src/` (aquí, una prueba) sí puede importar la entrada pública del
  // SDK sin ninguna infracción: la restricción anterior solo aplica al código interno.
  test("SDK consumers outside production source can import its public entry", () => {
    expect(auditImports({
      "tests/sdk.test.ts": 'import { MemoryStore } from "../src/index";',
      "src/index.ts": "export class MemoryStore {}",
    })).toEqual([]);
  });

  // Una consulta de tipo (`import(...).Project`) que apunta a un archivo interno de otro módulo,
  // no a su `index.ts`, también salta la entrada pública y debe rechazarse igual que un import normal.
  test("type queries and nested index files cannot bypass public module entries", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": 'type Project = import("../projects/private/index").Project;',
      "src/modules/projects/private/index.ts": "export interface Project {}",
    })).not.toEqual([]);
  });

  // Una interfaz no puede abrir `bun:sqlite` directamente (le corresponde a la infraestructura),
  // y lo compartido (shared) no puede depender de la aplicación (invertiría la dirección permitida).
  test("interfaces cannot open SQLite directly and shared cannot depend on application", () => {
    expect(auditImports({"src/interfaces/cli/main.ts": 'import { Database } from "bun:sqlite";'})).not.toEqual([]);
    expect(auditImports({
      "src/shared/errors.ts": 'import "../app";',
      "src/app/index.ts": "export {};",
    })).not.toEqual([]);
  });

  // Recorre las 9 aristas de MODULE_EDGES entre memory, projects, sessions, search y
  // synchronization (la de mcp → memory-protocol no está en la lista): la dependencia declarada
  // debe pasar sin infracciones, y su sentido contrario (no declarado) debe rechazarse.
  test.each([
    ["memory", "projects"], ["sessions", "memory"], ["sessions", "projects"],
    ["search", "memory"], ["search", "sessions"], ["search", "projects"],
    ["synchronization", "memory"], ["synchronization", "sessions"], ["synchronization", "projects"],
  ])("allows declared concept dependency %s -> %s and rejects its reverse", (from, to) => {
    expect(auditImports({
      [`src/modules/${from}/index.ts`]: `import "../${to}";`,
      [`src/modules/${to}/index.ts`]: "export {};",
    })).toEqual([]);
    expect(auditImports({
      [`src/modules/${from}/index.ts`]: "export {};",
      [`src/modules/${to}/index.ts`]: `import "../${from}";`,
    })).not.toEqual([]);
  });

  // La aplicación y la infraestructura pueden depender de módulos de dominio a través de su
  // entrada pública, y dos archivos internos del mismo módulo pueden importarse entre sí sin
  // pasar por ella; todo el árbol de ejemplo debe quedar sin infracciones.
  test("app and adapters use module entries, and module internal files may collaborate", () => {
    expect(auditImports({
      "src/app/index.ts": 'import "../infrastructure/sqlite/writes"; import "../modules/memory";',
      "src/infrastructure/sqlite/writes.ts": 'import "../../modules/memory"; import "./memory";',
      "src/infrastructure/sqlite/memory.ts": 'import "../../shared/errors";',
      "src/modules/memory/index.ts": 'export { value } from "./rules";',
      "src/modules/memory/rules.ts": 'import "../../shared/errors"; export const value = 1;',
      "src/shared/errors.ts": "export {};",
    })).toEqual([]);
  });
  // Un módulo de dominio no puede importar `bun:sqlite`: es una dependencia de infraestructura,
  // prohibida para un módulo que debe ser puro.
  test("rejects infrastructure dependencies from modules", () => {
    expect(auditImports({"src/modules/memory/index.ts":
      'import {Database} from "bun:sqlite";'})).not.toEqual([]);
  });

  // Una importación de solo tipos (`import type`) hacia la entrada pública de otro módulo
  // declarado como dependencia permitida no cuenta como infracción.
  test("allows declared module dependencies through public entries", () => {
    expect(auditImports({"src/modules/projects/index.ts": "export type ProjectId = string;",
      "src/modules/memory/index.ts": 'import type {ProjectId} from "../projects";'})).toEqual([]);
  });

  // Una reexportación de tipo (`export type { X } from ...`) que apunta a un archivo interno de
  // otro módulo, no a su `index.ts`, también debe rechazarse, aunque sea solo de tipos.
  test("rejects deep cross-module imports including type-only and reexports", () => {
    expect(auditImports({
      "src/modules/projects/index.ts": 'export type { Project } from "./types";',
      "src/modules/projects/types.ts": "export interface Project {}",
      "src/modules/memory/index.ts": 'export type { Project } from "../projects/types";',
    })).not.toEqual([]);
  });

  // Junta en un solo árbol dos infracciones distintas -una dependencia de módulo en el sentido no
  // declarado, y una interfaz importando infraestructura directamente- y exige que se reporten
  // exactamente esas dos, ni una más ni una menos.
  test("rejects forbidden module direction and interface edges", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": "export type Memory = {};",
      "src/modules/projects/index.ts": 'import type { Memory } from "../memory";',
      "src/interfaces/cli/index.ts": 'import "../../infrastructure/sqlite/index";',
      "src/infrastructure/sqlite/index.ts": "export {};",
    })).toHaveLength(2);
  });

  // Las tres formas alternativas de importar (`import ... = require(...)`, `require(...)` de
  // CommonJS y el `import(...)` dinámico con literal) deben reconocerse igual que un `import`
  // normal: las tres rutas que traen (bun:sqlite, node:fs y una interfaz) están prohibidas para
  // un módulo de dominio, así que las tres deben contarse como infracción.
  test("audits require, import-equals and literal dynamic imports", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": 'import db = require("bun:sqlite"); const fs = require("node:fs"); import("../../interfaces/cli");',
      "src/interfaces/cli/index.ts": "export {};",
    })).toHaveLength(3);
  });

  // Una ruta relativa que no existe en el árbol dado se reporta como importación local sin
  // resolver; y dos piezas que se importan entre sí en ambos sentidos (aplicación e
  // infraestructura) deben reportarse como un ciclo.
  test("reports unresolved local imports and component cycles", () => {
    expect(auditImports({"src/modules/memory/index.ts": 'import "./missing";'})).toHaveLength(1);
    expect(auditImports({
      "src/app/index.ts": 'import "../infrastructure/sqlite";',
      "src/infrastructure/sqlite/index.ts": 'import "../../app";',
    }).some(message => message.includes("cycle"))).toBe(true);
  });

  // Un módulo de dominio puede importar `node:crypto` y `node:util` (están en la lista de
  // básicos puros), pero no un paquete externo cualquiera como `zod`.
  test("allows pure built-ins but not arbitrary external packages", () => {
    expect(auditImports({"src/modules/memory/index.ts": 'import {createHash} from "node:crypto"; import {isDeepStrictEqual} from "node:util";'})).toEqual([]);
    expect(auditImports({"src/modules/memory/index.ts": 'import {z} from "zod";'})).not.toEqual([]);
  });

  // Una interfaz no puede importar un archivo interno de un módulo ni uno interno de la
  // aplicación (debe ser por su entrada pública en ambos casos), pero sí puede importar lo
  // compartido (shared) sin ninguna restricción.
  test("interfaces use app and module public entries while shared remains allowed", () => {
    expect(auditImports({
      "src/interfaces/cli/index.ts": 'import type { Memory } from "../../modules/memory/types";',
      "src/modules/memory/types.ts": "export interface Memory {}",
    })).not.toEqual([]);
    expect(auditImports({
      "src/interfaces/cli/index.ts": 'import { run } from "../../app/run";',
      "src/app/run.ts": "export const run = 1;",
    })).not.toEqual([]);
    expect(auditImports({
      "src/interfaces/cli/index.ts": 'import { MemoryError } from "../../shared/errors";',
      "src/shared/errors.ts": "export class MemoryError {}",
    })).toEqual([]);
  });

  // Ni la infraestructura puede importar un archivo interno de un módulo (debe ser por su
  // `index.ts`), ni la propia aplicación puede importar la entrada pública del SDK
  // (`src/index.ts`): ambas son código interno del proyecto, no un consumidor externo.
  test("all external module consumers use barrels and internal code cannot import the SDK", () => {
    expect(auditImports({
      "src/infrastructure/sqlite/index.ts": 'import type { Memory } from "../../modules/memory/types";',
      "src/modules/memory/types.ts": "export interface Memory {}",
    })).not.toEqual([]);
    expect(auditImports({
      "src/app/index.ts": 'import { MemoryStore } from "../index";',
      "src/index.ts": "export class MemoryStore {}",
    })).not.toEqual([]);
  });

  // La resolución usa el compilador real de TypeScript: una ruta que termina en `.js` debe
  // resolverse a su archivo `.ts` de origen (como en la compilación real), tanto para una
  // dependencia declarada válida como para una que salta la entrada pública de un módulo.
  test("uses TypeScript compiler resolution including source extension substitution", () => {
    expect(auditImports({
      "src/modules/projects/index.ts": "export interface Project {}",
      "src/modules/memory/index.ts": 'import type { Project } from "../projects/index.js";',
    })).toEqual([]);
    expect(auditImports({
      "src/interfaces/cli/index.ts": 'import type { Memory } from "../../modules/memory/types.js";',
      "src/modules/memory/types.ts": "export interface Memory {}",
    })).not.toEqual([]);
  });
});
