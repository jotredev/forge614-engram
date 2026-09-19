import { describe, expect, test } from "bun:test";
import { auditImports } from "./import-rules";

describe("module import policy", () => {
  test.each(["src/cli.ts", "src/unclassified.ts"])("rejects SDK entry imports from production source %s without a component", file => {
    expect(auditImports({
      [file]: 'import { MemoryStore } from "./index";',
      "src/index.ts": "export class MemoryStore {}",
    })).toEqual([`${file}: internal code cannot import the SDK entry`]);
  });

  test("SDK consumers outside production source can import its public entry", () => {
    expect(auditImports({
      "tests/sdk.test.ts": 'import { MemoryStore } from "../src/index";',
      "src/index.ts": "export class MemoryStore {}",
    })).toEqual([]);
  });

  test("type queries and nested index files cannot bypass public module entries", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": 'type Project = import("../projects/private/index").Project;',
      "src/modules/projects/private/index.ts": "export interface Project {}",
    })).not.toEqual([]);
  });

  test("interfaces cannot open SQLite directly and shared cannot depend on application", () => {
    expect(auditImports({"src/interfaces/cli/main.ts": 'import { Database } from "bun:sqlite";'})).not.toEqual([]);
    expect(auditImports({
      "src/shared/errors.ts": 'import "../app";',
      "src/app/index.ts": "export {};",
    })).not.toEqual([]);
  });

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
  test("rejects infrastructure dependencies from modules", () => {
    expect(auditImports({"src/modules/memory/index.ts":
      'import {Database} from "bun:sqlite";'})).not.toEqual([]);
  });

  test("allows declared module dependencies through public entries", () => {
    expect(auditImports({"src/modules/projects/index.ts": "export type ProjectId = string;",
      "src/modules/memory/index.ts": 'import type {ProjectId} from "../projects";'})).toEqual([]);
  });

  test("rejects deep cross-module imports including type-only and reexports", () => {
    expect(auditImports({
      "src/modules/projects/index.ts": 'export type { Project } from "./types";',
      "src/modules/projects/types.ts": "export interface Project {}",
      "src/modules/memory/index.ts": 'export type { Project } from "../projects/types";',
    })).not.toEqual([]);
  });

  test("rejects forbidden module direction and interface edges", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": "export type Memory = {};",
      "src/modules/projects/index.ts": 'import type { Memory } from "../memory";',
      "src/interfaces/cli/index.ts": 'import "../../infrastructure/sqlite/index";',
      "src/infrastructure/sqlite/index.ts": "export {};",
    })).toHaveLength(2);
  });

  test("audits require, import-equals and literal dynamic imports", () => {
    expect(auditImports({
      "src/modules/memory/index.ts": 'import db = require("bun:sqlite"); const fs = require("node:fs"); import("../../interfaces/cli");',
      "src/interfaces/cli/index.ts": "export {};",
    })).toHaveLength(3);
  });

  test("reports unresolved local imports and component cycles", () => {
    expect(auditImports({"src/modules/memory/index.ts": 'import "./missing";'})).toHaveLength(1);
    expect(auditImports({
      "src/app/index.ts": 'import "../infrastructure/sqlite";',
      "src/infrastructure/sqlite/index.ts": 'import "../../app";',
    }).some(message => message.includes("cycle"))).toBe(true);
  });

  test("allows only the build-generated Windows native addon import", () => {
    const addon = "../../../native/windows-reparse-guard/build/Release/windows_reparse_guard.node";
    const expected = "unresolved local import ../../../native/windows-reparse-guard/build/Release/windows_reparse_guard.node";
    expect(auditImports({
      "src/infrastructure/filesystem/windows-reparse-guard.ts": `require("${addon}");`,
    })).toEqual([]);
    expect(auditImports({
      "src/infrastructure/filesystem/windows-reparse-guard.ts": 'require("../../../native/windows-reparse-guard/build/Release/missing.node");',
    })).toEqual(["src/infrastructure/filesystem/windows-reparse-guard.ts: unresolved local import ../../../native/windows-reparse-guard/build/Release/missing.node"]);
    expect(auditImports({
      "src/modules/memory/index.ts": `require("${addon}");`,
    })).toEqual([`src/modules/memory/index.ts: ${expected}`]);
    expect(auditImports({
      "src/infrastructure/filesystem/other.ts": `require("${addon}");`,
    })).toEqual([`src/infrastructure/filesystem/other.ts: ${expected}`]);
  });

  test("allows pure built-ins but not arbitrary external packages", () => {
    expect(auditImports({"src/modules/memory/index.ts": 'import {createHash} from "node:crypto"; import {isDeepStrictEqual} from "node:util";'})).toEqual([]);
    expect(auditImports({"src/modules/memory/index.ts": 'import {z} from "zod";'})).not.toEqual([]);
  });

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
