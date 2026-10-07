/**
 * Comprueba, contra el árbol real de `src/`, que la forma general del código de producción se
 * mantiene estable (solo dos archivos sueltos en la raíz) y que no hay ninguna infracción de las
 * reglas de importación; además comprueba dos casos puntuales de `auditImports` con árboles
 * hechos a mano: composición legítima entre interfaces hermanas y un ciclo entre ellas.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditImports } from "./import-rules";
import { isTestSource } from "./test-layout";

/** Comprueba los dos archivos raíz de `src` con separadores de ruta portables y audita sus importaciones. */
test("the actual production tree has only stable root entries and respects all boundaries", () => {
  const paths = [...new Bun.Glob("src/**/*.ts").scanSync(".")];
  expect(paths.filter(path => !isTestSource(path) && path.split(/[\\/]/).length === 2).map(p => p.replace(/\\/g, "/")).sort()).toEqual(["src/cli.ts", "src/index.ts"]);
  expect(auditImports(Object.fromEntries([...paths, "package.json"].map(path => [path, readFileSync(path, "utf8")])))).toEqual([]);
});

// La interfaz de línea de comandos (CLI) puede importar a sus interfaces hermanas (MCP, terminal)
// sin que eso cuente como infracción; pero si una de esas hermanas importa de vuelta al CLI, se
// cierra un ciclo entre piezas y `auditImports` debe reportarlo como tal.
test("CLI can compose sibling interfaces without a reverse dependency", () => {
  const files = {
    "src/interfaces/cli/main.ts": 'import "../mcp/server"; import "../terminal/setup";',
    "src/interfaces/mcp/server.ts": "export {};",
    "src/interfaces/terminal/setup.ts": "export {};",
  };
  expect(auditImports(files)).toEqual([]);
  expect(auditImports({...files, "src/interfaces/mcp/server.ts": 'import "../cli/main";'}).some(error => error.includes("cycle"))).toBe(true);
});

// Un `import()` dinámico escrito con acentos graves (una plantilla de texto sin variables) debe
// reconocerse igual que un `import` normal, para que un módulo de dominio no pueda usarlo como
// atajo para saltarse la lista blanca de importaciones externas permitidas.
test("template literal dynamic imports cannot bypass the module boundary", () => {
  expect(auditImports({"src/modules/memory/index.ts": "import(`node:fs`);"})).toEqual([
    "src/modules/memory/index.ts: forbidden external import node:fs",
  ]);
});
