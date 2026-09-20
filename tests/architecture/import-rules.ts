import ts from "typescript";
import { dirname, posix, resolve } from "node:path";
import { isTestSource } from "./test-layout";

type Component = { kind: "module"; name: string } | { kind: "app" | "interface" | "infrastructure" | "shared"; name: string } | null;
const PURE_BUILTINS = new Set(["node:crypto", "node:util"]);
const MODULE_EDGES: Record<string, readonly string[]> = {
  memory: ["projects"], projects: [], sessions: ["memory", "projects"],
  search: ["memory", "sessions", "projects"], synchronization: ["memory", "sessions", "projects"],
  workspace: [], mcp: [],
};

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

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
const compilerOptions = configPath
  ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath,ts.sys.readFile).config,ts.sys,dirname(configPath)).options
  : {moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext};

function resolveLocal(from: string, specifier: string, files: Record<string,string>): string | null {
  const root=process.cwd(), absoluteFiles=new Map(Object.keys(files).map(file=>[resolve(root,file),file]));
  const host:ts.ModuleResolutionHost={
    fileExists:path=>absoluteFiles.has(resolve(path))||ts.sys.fileExists(path),
    readFile:path=>{const virtual=absoluteFiles.get(resolve(path));return virtual===undefined?ts.sys.readFile(path):files[virtual];},
    directoryExists:path=>[...absoluteFiles.keys()].some(file=>file.startsWith(resolve(path)+posix.sep))||(ts.sys.directoryExists?.(path)??false),
    realpath:path=>path,
    getCurrentDirectory:()=>root,
  };
  const resolved=ts.resolveModuleName(specifier,resolve(root,from),compilerOptions,host).resolvedModule?.resolvedFileName;
  return resolved ? absoluteFiles.get(resolve(resolved))??null : null;
}

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

export function auditImports(files: Record<string, string>): string[] {
  const errors: string[] = [], graph = new Map<string,Set<string>>();
  for (const [file,text] of Object.entries(files)) {
    const testSource = isTestSource(file);
    const from = testSource ? null : component(file); if (from) graph.set(`${from.kind}:${from.name}`, graph.get(`${from.kind}:${from.name}`) ?? new Set());
    const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    for (const specifier of sourceSpecifiers(source)) {
      const target = resolveLocal(file,specifier,files);
      if (testSource) {
        if (target && /\.(test|spec)\.ts$/.test(target)) errors.push(`${file}: test suites cannot import other test suites ${target}`);
        continue;
      }
      if (file.startsWith("src/") && specifier === "bun:test") {
        errors.push(`${file}: production cannot import bun:test`); continue;
      }
      if (target && isTestSource(target) && file.startsWith("src/")) {
        errors.push(`${file}: production cannot import test source ${target}`); continue;
      }
      if (!target && !specifier.startsWith(".")) {
        if (from?.kind === "app" && specifier === "bun:sqlite") errors.push(`${file}: app cannot import bun:sqlite`);
        if (from?.kind === "interface" && specifier === "bun:sqlite") errors.push(`${file}: interface cannot import bun:sqlite`);
        if (from?.kind === "module" && !PURE_BUILTINS.has(specifier)) errors.push(`${file}: forbidden external import ${specifier}`);
        continue;
      }
      if (!target) { errors.push(`${file}: unresolved local import ${specifier}`); continue; }
      if (!target) continue;
      if (target === "src/index.ts" && file.startsWith("src/") && file !== "src/index.ts")
        errors.push(`${file}: internal code cannot import the SDK entry`);
      const to = component(target); if (!from || !to) continue;
      const fromKey=`${from.kind}:${from.name}`,toKey=`${to.kind}:${to.name}`;
      if(fromKey!==toKey) graph.get(fromKey)!.add(toKey);
      if (to.kind === "module" && (from.kind !== "module" || from.name !== to.name) && target !== `src/modules/${to.name}/index.ts`)
        errors.push(`${file}: external module import must use public entry ${specifier}`);
      if (from.kind === "module") {
        if (to.kind !== "module" && to.kind !== "shared") errors.push(`${file}: module cannot import ${target}`);
        else if (to.kind === "module" && from.name !== to.name) {
          if (target !== `src/modules/${to.name}/index.ts`) errors.push(`${file}: cross-module import must use public entry ${specifier}`);
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
  const visiting=new Set<string>(),visited=new Set<string>();
  const walk=(key:string,path:string[])=>{if(visiting.has(key)){errors.push(`component cycle: ${[...path,key].join(" -> ")}`);return;}if(visited.has(key))return;visiting.add(key);for(const next of graph.get(key)??[])walk(next,[...path,key]);visiting.delete(key);visited.add(key);};
  for(const key of graph.keys())walk(key,[]);
  return errors;
}
