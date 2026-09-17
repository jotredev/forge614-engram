import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";
import { isTestSource } from "./test-layout";

test("the actual production tree has only stable root entries and respects all boundaries", () => {
  const paths = [...new Bun.Glob("src/**/*.ts").scanSync(".")];
  expect(paths.filter(path => !isTestSource(path) && path.split("/").length === 2).sort()).toEqual(["src/cli.ts", "src/index.ts"]);
  expect(auditImports(Object.fromEntries([...paths, "package.json"].map(path => [path, readFileSync(path, "utf8")])))).toEqual([]);
});

test("CLI can compose sibling interfaces without a reverse dependency", () => {
  const files = {
    "src/interfaces/cli/main.ts": 'import "../mcp/server"; import "../tui/controller"; import "../terminal/setup";',
    "src/interfaces/mcp/server.ts": "export {};",
    "src/interfaces/tui/controller.ts": "export {};",
    "src/interfaces/terminal/setup.ts": "export {};",
  };
  expect(auditImports(files)).toEqual([]);
  expect(auditImports({...files, "src/interfaces/mcp/server.ts": 'import "../cli/main";'}).some(error => error.includes("cycle"))).toBe(true);
});

test("template literal dynamic imports cannot bypass the module boundary", () => {
  expect(auditImports({"src/modules/memory/index.ts": "import(`node:fs`);"})).toEqual([
    "src/modules/memory/index.ts: forbidden external import node:fs",
  ]);
});
