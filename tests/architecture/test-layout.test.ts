import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditTestLayout } from "./test-layout";
import { auditImports } from "./import-rules";

test("each implementation with behavior needs its own sibling suite, not another component's coverage", () => {
  const files = {"src/modules/sessions/rules.ts":"export function valid(value:string){return value.length > 0;}",
    "src/modules/sessions/__tests__/combined.integration.test.ts":"import {test} from 'bun:test'; test('combined',()=>{});"};
  expect(auditTestLayout(files)).toEqual(["src/modules/sessions/rules.ts: missing sibling rules.test.ts"]);
  expect(auditTestLayout({...files,"src/modules/sessions/rules.test.ts":"import {test} from 'bun:test'; test('rejects empty IDs',()=>{});"})).toEqual([]);
});

test("types, static values and reexport barrels do not require artificial sibling tests", () => {
  expect(auditTestLayout({"src/modules/x/types.ts":"export interface X { name:string }; export const names = ['a'] as const;",
    "src/modules/x/index.ts":"export type {X} from './types';"})).toEqual([]);
});

test("runtime schemas and arrow functions have behavior even without function declarations", () => {
  expect(auditTestLayout({"src/modules/x/schema.ts":"export const schema = z.string().min(1);",
    "src/modules/x/policy.ts":"export const allowed = (x:number) => x > 0;"})).toHaveLength(2);
});

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

test("the CLI bootstrap exemption ends if it gains its own logic", () => {
  expect(auditTestLayout({"src/cli.ts":'import { main } from "./interfaces/cli/main"; await main(process.argv.slice(2));'})).toEqual([]);
  expect(auditTestLayout({"src/cli.ts":'export function ownRule(input:string){return input.trim();}'})).toEqual([
    "src/cli.ts: missing sibling cli.test.ts",
  ]);
});

test("colocated tests can exercise real dependencies without weakening production boundaries", () => {
  const files={"src/modules/x/rules.test.ts":"import {test} from 'bun:test'; import {Database} from 'bun:sqlite'; import './rules';",
    "src/modules/x/rules.ts":"export const ready = true;"};
  expect(auditImports(files)).toEqual([]);
  expect(auditImports({...files,"src/modules/x/rules.ts":"import './rules.test';"})).toContain("src/modules/x/rules.ts: production cannot import test source src/modules/x/rules.test.ts");
});

test("production cannot import test-only helpers or Bun's test runner", () => {
  expect(auditImports({"src/app/workspace.ts":"import './__test-support__/files'; import {test} from 'bun:test';",
    "src/app/__test-support__/files.ts":"export {};"})).toEqual([
      "src/app/workspace.ts: production cannot import test source src/app/__test-support__/files.ts",
      "src/app/workspace.ts: production cannot import bun:test",
    ]);
});

test("integration suites import implementations rather than other test suites", () => {
  expect(auditImports({"src/app/__tests__/combined.integration.test.ts":"import '../workspace.test';",
    "src/app/workspace.test.ts":"export {};"})).toEqual([
      "src/app/__tests__/combined.integration.test.ts: test suites cannot import other test suites src/app/workspace.test.ts",
    ]);
});

test("every current implementation has its own colocated suite", () => {
  const files=Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync('.')].map(path=>[path,readFileSync(path,'utf8')]));
  expect(auditTestLayout(files)).toEqual([]);
});
