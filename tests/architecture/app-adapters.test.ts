import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";

test("infrastructure cannot import the MemoryStore facade", () => {
  expect(auditImports({
    "src/infrastructure/sqlite/open.ts": 'import {MemoryStore} from "../../app/memory-store";',
    "src/app/memory-store.ts": "export class MemoryStore {}",
  })).not.toEqual([]);
});

test("application coordination cannot import terminal implementations", () => {
  expect(auditImports({
    "src/app/synchronization.ts": 'import "../interfaces/terminal/sync-watch";',
    "src/interfaces/terminal/sync-watch.ts": "export {};",
  })).not.toEqual([]);
});

test("workspace opening and application adapters have no backwards dependencies", () => {
  const files = Object.fromEntries([...new Bun.Glob("src/**/*.ts").scanSync(".")]
    .map(path => [path, readFileSync(path, "utf8")]));
  expect(auditImports(files).filter(error =>
    /^(src\/(app|modules|infrastructure|interfaces\/terminal)\/|component cycle:)/.test(error))).toEqual([]);
});
