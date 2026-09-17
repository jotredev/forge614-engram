import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";

test("MemoryStore facade does not depend on SQLite directly", () => {
  const path = "src/app/memory-store.ts";
  const source = readFileSync(path, "utf8");
  expect(auditImports({[path]:source}).filter(error => error.includes("app cannot import bun:sqlite"))).toEqual([]);
});

test("extracted SQLite operations and source modules respect their dependency boundaries", () => {
  const files = Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync(".")]
    .map(path => [path, readFileSync(path,"utf8")]));
  const errors = auditImports(files).filter(error =>
    /^(src\/(app|modules|infrastructure\/sqlite)\/|component cycle:)/.test(error));
  expect(errors).toEqual([]);
});
