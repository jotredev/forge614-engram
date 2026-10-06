/**
 * Reglas de arquitectura sobre importaciones entre las capas de `src/` (los módulos de dominio,
 * la aplicación, las interfaces, la infraestructura y lo compartido), usadas por las pruebas de
 * `tests/architecture/*.test.ts` (app-adapters, final-tree, import-rules, sqlite-facade y
 * test-layout) para comprobar que el código real respeta los límites entre capas. No la usa nada
 * fuera de esas pruebas.
 */
import ts from "typescript";
import { dirname, resolve, sep } from "node:path";
import { isTestSource } from "./test-layout";

// Cada archivo de `src/` pertenece como mucho a una de estas piezas (o a ninguna, fuera de `src/`).
type Component = { kind: "module"; name: string } | { kind: "app" | "interface" | "infrastructure" | "shared"; name: string } | null;
// node:crypto y node:util no dependen de un motor de JavaScript concreto, así que un módulo de
// dominio (que debe ser puro) puede importarlos aunque no sean parte de `src/`.
const PURE_BUILTINS = new Set(["node:crypto", "node:util"]);
// A qué otros módulos de dominio puede importar cada módulo (por su entrada pública); una
// dependencia que no está en esta lista es una dependencia prohibida entre módulos.
const MODULE_EDGES: Record<string, readonly string[]> = {
  memory: ["projects"], projects: [], sessions: ["memory", "projects"],
  search: ["memory", "sessions", "projects"], synchronization: ["memory", "sessions", "projects"],
  workspace: [], mcp: ["memory-protocol"], ecosystem: [],
};

// Identifica a qué pieza pertenece un archivo según su ruta bajo `src/`; null si no pertenece a
// ninguna pieza reconocida (por ejemplo, un archivo fuera de `src/` o directamente en `src/`).
function component(file: string): Component {
  const parts = file.split("/");
  if (parts[0] !== "src") return null;
  if (parts[1] === "modules" && parts[2]) return {kind:"module", name:parts[2]};
  if (parts[1] === "interfaces") return {kind:"interface", name:parts[2] ?? "interfaces"};
  if (parts[1] === "infrastructure") return {kind:"infrastructure", name:parts[2] ?? "infrastructure"};
  if (parts[1] === "app") return {kind:"app", name:"app"};
  if (parts[1] === "shared") return {kind:"shared", name:"shared"};
  return null;
}

// Usa el tsconfig.json real del repositorio si existe (para resolver rutas igual que el
// compilador), y si no, unas opciones mínimas razonables para que la función siga funcionando
// con archivos de prueba sueltos que no forman parte del proyecto real.
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
const compilerOptions = configPath
  ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath,ts.sys.readFile).config,ts.sys,dirname(configPath)).options
  : {moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext};

// Resuelve una ruta de importación (`specifier`) a la ruta de otro archivo dado en `files`, usando
// el resolvedor de módulos real de TypeScript sobre un sistema de archivos virtual: `files` es el
// árbol completo que se está auditando (puede ser un fragmento de prueba, no el repositorio en disco),
// así que el host solo conoce esas rutas y delega en el disco real para lo que falte (node_modules, etc.).
function resolveLocal(from: string, specifier: string, files: Record<string,string>): string | null {
  const root=process.cwd(), absoluteFiles=new Map(Object.keys(files).map(file=>[resolve(root,file),file]));
  const host:ts.ModuleResolutionHost={
    fileExists:path=>absoluteFiles.has(resolve(path))||ts.sys.fileExists(path),
    readFile:path=>{const virtual=absoluteFiles.get(resolve(path));return virtual===undefined?ts.sys.readFile(path):files[virtual];},
    directoryExists:path=>[...absoluteFiles.keys()].some(file=>file.startsWith(resolve(path)+sep))||(ts.sys.directoryExists?.(path)??false),
    realpath:path=>path,
    getCurrentDirectory:()=>root,
  };
  const resolved=ts.resolveModuleName(specifier,resolve(root,from),compilerOptions,host).resolvedModule?.resolvedFileName;
  return resolved ? absoluteFiles.get(resolve(resolved))??null : null;
}

// Recorre el árbol sintáctico y junta todas las rutas de importación/reexportación que aparecen en
// el archivo: `import`/`export ... from`, `import type` con literal, `import =` con `require`,
// el `import()` dinámico y el `require()` de CommonJS.
function sourceSpecifiers(source: ts.SourceFile): string[] {
  const values: string[] = [];
  const add = (node: ts.Expression | undefined) => { if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) values.push(node.text); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal as ts.Expression);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source); return values;
}

/**
 * Audita un árbol de archivos (ruta -> contenido) contra las reglas de arquitectura y devuelve
 * la lista de infracciones encontradas, una cadena de texto por infracción; una lista vacía
 * significa que no hay ninguna. Cubre, entre otras: pruebas que importan otras pruebas, código de
 * producción que importa `bun:test` o código de prueba, un módulo de dominio que hace una
 * importación externa no permitida o que salta la entrada pública de otro módulo, una interfaz o
 * la aplicación cruzando hacia una capa que no le corresponde, y un ciclo de dependencias entre piezas.
 */
export function auditImports(files: Record<string, string>): string[] {
  const errors: string[] = [], graph = new Map<string,Set<string>>();
  for (const [file,text] of Object.entries(files)) {
    const testSource = isTestSource(file);
    // Un archivo de prueba no pertenece a ninguna pieza (from queda null) porque las pruebas no
    // están sujetas a las reglas entre capas; solo se registra el nodo en el grafo de piezas
    // reales, para poder detectar ciclos entre ellas más abajo.
    const from = testSource ? null : component(file); if (from) graph.set(`${from.kind}:${from.name}`, graph.get(`${from.kind}:${from.name}`) ?? new Set());
    const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    for (const specifier of sourceSpecifiers(source)) {
      const target = resolveLocal(file,specifier,files);
      if (testSource) {
        // A una prueba solo se le exige una cosa: no importar otra suite de pruebas (cada una
        // debe montar sus propios datos, no reusar los de otra).
        if (target && /\.(test|spec)\.ts$/.test(target)) errors.push(`${file}: test suites cannot import other test suites ${target}`);
        continue;
      }
      if (file.startsWith("src/") && specifier === "bun:test") {
        errors.push(`${file}: production cannot import bun:test`); continue;
      }
      if (target && isTestSource(target) && file.startsWith("src/")) {
        errors.push(`${file}: production cannot import test source ${target}`); continue;
      }
      // Una importación externa (no relativa) que no se pudo resolver a un archivo local: aquí
      // se filtran las que están prohibidas para ciertas piezas (bun:sqlite fuera de infraestructura,
      // cualquier externa no elemental desde un módulo de dominio).
      if (!target && !specifier.startsWith(".")) {
        if (from?.kind === "app" && specifier === "bun:sqlite") errors.push(`${file}: app cannot import bun:sqlite`);
        if (from?.kind === "interface" && specifier === "bun:sqlite") errors.push(`${file}: interface cannot import bun:sqlite`);
        if (from?.kind === "module" && !PURE_BUILTINS.has(specifier)) errors.push(`${file}: forbidden external import ${specifier}`);
        continue;
      }
      // Una importación relativa que no se pudo resolver a ningún archivo dado es un error de
      // por sí (apunta a algo que no existe en el árbol auditado).
      if (!target) { errors.push(`${file}: unresolved local import ${specifier}`); continue; }
      if (!target) continue;
      if (target === "src/index.ts" && file.startsWith("src/") && file !== "src/index.ts")
        errors.push(`${file}: internal code cannot import the SDK entry`);
      const to = component(target); if (!from || !to) continue;
      // Se registra la arista en el grafo de piezas (para el ciclo, más abajo) antes de decidir
      // si la importación en sí está permitida.
      const fromKey=`${from.kind}:${from.name}`,toKey=`${to.kind}:${to.name}`;
      if(fromKey!==toKey) graph.get(fromKey)!.add(toKey);
      // Cualquier pieza que no sea el propio módulo debe entrar por su archivo `index.ts`
      // público, nunca por un archivo interno del módulo.
      if (to.kind === "module" && (from.kind !== "module" || from.name !== to.name) && target !== `src/modules/${to.name}/index.ts`)
        errors.push(`${file}: external module import must use public entry ${specifier}`);
      if (from.kind === "module") {
        // Un módulo de dominio solo puede depender de otros módulos o de lo compartido.
        if (to.kind !== "module" && to.kind !== "shared") errors.push(`${file}: module cannot import ${target}`);
        else if (to.kind === "module" && from.name !== to.name) {
          if (target !== `src/modules/${to.name}/index.ts`) errors.push(`${file}: cross-module import must use public entry ${specifier}`);
          // MODULE_EDGES es la lista blanca de qué módulo puede depender de cuál otro.
          if (!(MODULE_EDGES[from.name] ?? []).includes(to.name)) errors.push(`${file}: forbidden module dependency ${from.name} -> ${to.name}`);
        }
      }
      if (from.kind === "interface") {
        if (!["app","module","shared","interface"].includes(to.kind))
          errors.push(`${file}: interface cannot import ${to.kind}`);
        if (to.kind === "app" && target !== "src/app/index.ts") errors.push(`${file}: interface must use app public entry ${specifier}`);
      }
      if (from.kind === "infrastructure" && (to.kind === "app" || to.kind === "interface")) errors.push(`${file}: infrastructure cannot import ${to.kind}`);
      if (from.kind === "app" && to.kind === "interface") errors.push(`${file}: app cannot import interfaces`);
      if (from.kind === "shared" && to.kind !== "shared") errors.push(`${file}: shared cannot import ${to.kind}`);
    }
  }
  // Búsqueda en profundidad (depth-first) sobre el grafo de piezas: si se vuelve a visitar una
  // pieza que ya está en la pila de la búsqueda actual (`visiting`), hay un ciclo; `visited`
  // evita recorrer de nuevo una pieza ya explorada por completo desde otro punto de partida.
  const visiting=new Set<string>(),visited=new Set<string>();
  const walk=(key:string,path:string[])=>{if(visiting.has(key)){errors.push(`component cycle: ${[...path,key].join(" -> ")}`);return;}if(visited.has(key))return;visiting.add(key);for(const next of graph.get(key)??[])walk(next,[...path,key]);visiting.delete(key);visited.add(key);};
  for(const key of graph.keys())walk(key,[]);
  return errors;
}
