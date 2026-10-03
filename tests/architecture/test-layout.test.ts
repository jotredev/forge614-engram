/**
 * Comprueba `auditTestLayout` (qué archivo de producción necesita una prueba hermana) y, de
 * paso, las reglas de `auditImports` sobre quién puede importar código de prueba: una prueba de
 * colaboración de otro archivo no sustituye a la prueba propia, un tipo o dato estático no
 * necesita prueba, y ni la producción ni una suite pueden importar código de prueba ajeno.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditTestLayout } from "./test-layout";
import { auditImports } from "./import-rules";

// La prueba de colaboración de otro archivo (`__tests__/combined.integration.test.ts`) no cuenta
// como la prueba propia de `rules.ts`; solo agregar `rules.test.ts` junto a él hace que deje de faltar.
test("each implementation with behavior needs its own sibling suite, not another component's coverage", () => {
  const files = {"src/modules/sessions/rules.ts":"export function valid(value:string){return value.length > 0;}",
    "src/modules/sessions/__tests__/combined.integration.test.ts":"import {test} from 'bun:test'; test('combined',()=>{});"};
  expect(auditTestLayout(files)).toEqual(["src/modules/sessions/rules.ts: missing sibling rules.test.ts"]);
  expect(auditTestLayout({...files,"src/modules/sessions/rules.test.ts":"import {test} from 'bun:test'; test('rejects empty IDs',()=>{});"})).toEqual([]);
});

// Una interfaz, una constante estática (aunque sea un arreglo `as const`) y un archivo que solo
// reexporta un tipo no tienen conducta propia que probar, así que no exigen prueba hermana.
test("types, static values and reexport barrels do not require artificial sibling tests", () => {
  expect(auditTestLayout({"src/modules/x/types.ts":"export interface X { name:string }; export const names = ['a'] as const;",
    "src/modules/x/index.ts":"export type {X} from './types';"})).toEqual([]);
});

// Un esquema construido con una llamada encadenada (`z.string().min(1)`) y una función flecha
// asignada a una constante sí tienen conducta en tiempo de ejecución, aunque no sean una
// declaración de función; los dos archivos deben aparecer como faltantes.
test("runtime schemas and arrow functions have behavior even without function declarations", () => {
  expect(auditTestLayout({"src/modules/x/schema.ts":"export const schema = z.string().min(1);",
    "src/modules/x/policy.ts":"export const allowed = (x:number) => x > 0;"})).toHaveLength(2);
});

// Ninguna de estas ocho formas de código (un valor calculado en tiempo de ejecución, una
// condición, una deconstrucción con valor por defecto o clave calculada, un `if` de nivel
// superior, o una variable reasignada según una condición) cuenta como estática: todas exigen
// prueba hermana; en cambio, un objeto formado solo por literales (`as const`) no la exige.
test("computed initializers and top-level control flow cannot masquerade as static declarations", () => {
  for(const source of [
    'export const enabled = process.env.FEATURE === "enabled";',
    'export const next = previous + 1;',
    'export const chosen = enabled ? "a" : "b";',
    'export const state = { enabled: process.env.FEATURE };',
    'export const { enabled = computeEnabled() } = {};',
    'export const { [computeKey()]: value } = {};',
    'if (enabled) throw new Error("disabled");',
    'export let flag = false; if (enabled) flag = true;',
  ]) expect(auditTestLayout({"src/modules/x/policy.ts":source})).toEqual([
    "src/modules/x/policy.ts: missing sibling policy.test.ts",
  ]);
  expect(auditTestLayout({"src/modules/x/data.ts":'export const values = { limits: [1, 2], label: "safe", enabled: true } as const;'})).toEqual([]);
});

// `src/cli.ts` está exento mientras sea exactamente el arranque mínimo de dos líneas; en cuanto
// gana una función propia deja de calzar con ese arranque reconocido y vuelve a exigir su prueba hermana.
test("the CLI bootstrap exemption ends if it gains its own logic", () => {
  expect(auditTestLayout({"src/cli.ts":'import { main } from "./interfaces/cli/main"; await main(process.argv.slice(2));'})).toEqual([]);
  expect(auditTestLayout({"src/cli.ts":'export function ownRule(input:string){return input.trim();}'})).toEqual([
    "src/cli.ts: missing sibling cli.test.ts",
  ]);
});

// Una prueba colocada junto a su implementación puede importar una dependencia real como
// `bun:sqlite` sin ninguna infracción (esas restricciones son para la producción, no para las
// pruebas); pero si la implementación importa de vuelta a su propia prueba, sí es una infracción.
test("colocated tests can exercise real dependencies without weakening production boundaries", () => {
  const files={"src/modules/x/rules.test.ts":"import {test} from 'bun:test'; import {Database} from 'bun:sqlite'; import './rules';",
    "src/modules/x/rules.ts":"export const ready = true;"};
  expect(auditImports(files)).toEqual([]);
  expect(auditImports({...files,"src/modules/x/rules.ts":"import './rules.test';"})).toContain("src/modules/x/rules.ts: production cannot import test source src/modules/x/rules.test.ts");
});

// Un archivo de producción no puede importar ni un accesorio de apoyo de pruebas
// (`__test-support__`) ni el ejecutor de pruebas de Bun (`bun:test`); ambas son infracciones
// distintas y deben reportarse las dos.
test("production cannot import test-only helpers or Bun's test runner", () => {
  expect(auditImports({"src/app/workspace.ts":"import './__test-support__/files'; import {test} from 'bun:test';",
    "src/app/__test-support__/files.ts":"export {};"})).toEqual([
      "src/app/workspace.ts: production cannot import test source src/app/__test-support__/files.ts",
      "src/app/workspace.ts: production cannot import bun:test",
    ]);
});

// Una suite de integración que importa otra suite de pruebas (en vez de importar la
// implementación directamente) es una infracción: cada prueba debe montar sus propios datos.
test("integration suites import implementations rather than other test suites", () => {
  expect(auditImports({"src/app/__tests__/combined.integration.test.ts":"import '../workspace.test';",
    "src/app/workspace.test.ts":"export {};"})).toEqual([
      "src/app/__tests__/combined.integration.test.ts: test suites cannot import other test suites src/app/workspace.test.ts",
    ]);
});

// Sobre el árbol real de `src/`, ningún archivo de producción con conducta propia debe estar sin
// su prueba hermana: la migración a pruebas colocadas debe seguir completa.
test("every current implementation has its own colocated suite", () => {
  const files=Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync('.')].map(path=>[path,readFileSync(path,'utf8')]));
  expect(auditTestLayout(files)).toEqual([]);
});
