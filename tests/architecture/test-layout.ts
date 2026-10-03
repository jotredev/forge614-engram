/**
 * Reglas sobre qué archivos son código de prueba (en lugar de producción) y sobre la exigencia
 * de que cada archivo de producción con lógica propia tenga su prueba hermana (`<nombre>.test.ts`
 * junto a él); usadas por `import-rules.ts`, `final-tree.test.ts` y `test-layout.test.ts`.
 * `auditTestLayout` usa `isTestSource` para no exigir prueba hermana a las pruebas mismas.
 */
/** Dice si una ruta es código de prueba: vive bajo `tests/`, termina en `.test.ts`/`.spec.ts`, o
 * está dentro de una carpeta `__tests__`, `__fixtures__` o `__test-support__`. */
export function isTestSource(path: string): boolean {
  return path.startsWith("tests/") || /\.(test|spec)\.ts$/.test(path) || /\/(?:__tests__|__fixtures__|__test-support__)\//.test(path);
}

// Reconoce el arranque mínimo de `src/cli.ts`: solo importa `main` desde
// `./interfaces/cli/main` y lo llama con `process.argv.slice(2)`, sin ninguna otra sentencia. Ese
// archivo está exento de tener su propia prueba porque no tiene lógica propia que probar: toda su
// conducta la cubre la prueba de `interfaces/cli/main`.
function minimalBootstrap(source: ts.SourceFile): boolean {
  if(source.statements.length!==2)return false;
  const [entry,run]=source.statements;
  if(!entry||!ts.isImportDeclaration(entry)||!ts.isStringLiteral(entry.moduleSpecifier)||entry.moduleSpecifier.text!=="./interfaces/cli/main")return false;
  const imports=entry.importClause?.namedBindings;
  if(!imports||!ts.isNamedImports(imports)||imports.elements.length!==1||imports.elements[0]?.name.text!=="main"||imports.elements[0]?.propertyName)return false;
  if(!run||!ts.isExpressionStatement(run)||!ts.isAwaitExpression(run.expression))return false;
  const call=run.expression.expression;
  if(!ts.isCallExpression(call)||!ts.isIdentifier(call.expression)||call.expression.text!=="main"||call.arguments.length!==1)return false;
  const args=call.arguments[0];
  if(!args||!ts.isCallExpression(args)||args.arguments.length!==1||!ts.isNumericLiteral(args.arguments[0]!)||args.arguments[0]!.text!=="2")return false;
  const slice=args.expression;
  return ts.isPropertyAccessExpression(slice)&&slice.name.text==="slice"&&ts.isPropertyAccessExpression(slice.expression)&&
    slice.expression.name.text==="argv"&&ts.isIdentifier(slice.expression.expression)&&slice.expression.expression.text==="process";
}

// Dice si una expresión es un valor estático (literal, arreglo u objeto formado solo por
// literales, sin nada calculado en tiempo de ejecución); atraviesa las conversiones de tipo
// (`as`, aserción, `satisfies`) y los paréntesis para mirar el valor real de debajo.
function staticValue(value: ts.Expression): boolean {
  if(ts.isAsExpression(value)||ts.isTypeAssertionExpression(value)||ts.isSatisfiesExpression(value)||ts.isParenthesizedExpression(value))return staticValue(value.expression);
  if(ts.isLiteralExpression(value)||value.kind===ts.SyntaxKind.TrueKeyword||value.kind===ts.SyntaxKind.FalseKeyword||value.kind===ts.SyntaxKind.NullKeyword)return true;
  if(ts.isArrayLiteralExpression(value))return value.elements.every(item=>!ts.isSpreadElement(item)&&staticValue(item));
  if(ts.isObjectLiteralExpression(value))return value.properties.every(property=>
    ts.isPropertyAssignment(property)&&!ts.isComputedPropertyName(property.name)&&staticValue(property.initializer));
  return false;
}

// Dice si una sentencia de nivel superior no aporta conducta propia que probar: declaraciones de
// importación/exportación, interfaces y tipos (no existen en tiempo de ejecución), una función sin
// cuerpo (una sobrecarga de tipos), una variable cuyo valor es estático o no tiene inicializador,
// o una exportación por defecto (`export =`) de un valor estático.
function declarationOnly(statement: ts.Statement): boolean {
  if(ts.isImportDeclaration(statement)||ts.isImportEqualsDeclaration(statement)||ts.isExportDeclaration(statement)||
    ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)||ts.isEmptyStatement(statement))return true;
  if(ts.isFunctionDeclaration(statement)&&!statement.body)return true;
  if(ts.isVariableStatement(statement))return statement.declarationList.declarations.every(declaration=>
    ts.isIdentifier(declaration.name) && (!declaration.initializer || staticValue(declaration.initializer)));
  if(ts.isExportAssignment(statement))return staticValue(statement.expression);
  return false;
}

/**
 * Audita un árbol de archivos (ruta -> contenido) y devuelve, ordenada, la lista de archivos de
 * producción (bajo `src/`) que tienen conducta propia pero no tienen su prueba hermana
 * `<nombre>.test.ts` junto a ellos en el mismo árbol; una lista vacía significa que todos la tienen.
 */
export function auditTestLayout(files: Record<string,string>): string[] {
  const errors:string[]=[];
  for(const [path,text] of Object.entries(files)){
    if(!path.startsWith('src/') || !path.endsWith('.ts') || isTestSource(path))continue;
    // Este arranque ejecutable de dos líneas lo ejercita la suite del instalador, aparte.
    // Delega toda su conducta en interfaces/cli/main, que debe tener su propia suite.
    const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
    if(path==='src/cli.ts'&&minimalBootstrap(source))continue;
    const behavior=source.statements.some(statement=>!declarationOnly(statement));
    const sibling=path.replace(/\.ts$/,'.test.ts');
    if(behavior && !(sibling in files))errors.push(`${path}: missing sibling ${basename(sibling)}`);
  }
  return errors.sort();
}
import ts from "typescript";
import { basename } from "node:path";
