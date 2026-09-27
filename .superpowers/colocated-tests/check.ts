/**
 * Comprueba que la reorganización de pruebas (moverlas junto a su archivo de implementación,
 * ver `context.md`) no cambió código de producción ni perdió casos de prueba con nombre.
 * Lee la foto "antes" (`before.json`, hecha con `artifacts.ts snapshot`) y la compara contra
 * el árbol de archivos actual: ningún archivo de `src/` que no sea de prueba debe haber
 * cambiado byte a byte, y cada caso `test`/`it`/`integration` con el mismo nombre en las
 * pruebas de antes debe seguir existiendo (con una única excepción documentada más abajo).
 * Sale con código de salida distinto de cero si encuentra código cambiado o casos perdidos.
 */
import ts from 'typescript';
import {readFileSync,existsSync} from 'node:fs';
import {isTestSource} from '../../tests/architecture/test-layout';
const before=JSON.parse(readFileSync('.superpowers/colocated-tests/before.json','utf8')) as Record<string,string>;
// Solo interesa el código de producción bajo src/ (isTestSource excluye pruebas y accesorios);
// "cambió" es que ya no exista o que su contenido actual difiera del que tenía en la foto.
const changed=Object.entries(before).filter(([p])=>p.startsWith('src/')&&!isTestSource(p)).filter(([p,t])=>!existsSync(p)||readFileSync(p,'utf8')!==t).map(([p])=>p);
/** Cuenta, por nombre, cuántas veces aparece cada caso `test`/`it`/`integration` en los archivos `.test.ts` dados. */
function cases(files:Record<string,string>):Map<string,number>{
 const result=new Map<string,number>();
 for(const [p,text]of Object.entries(files))if(/\.test\.ts$/.test(p)){
  // Sigue la cadena de la llamada hasta su identificador raíz: así `test.each(...)('nombre', …)`
  // o `test.skipIf(...)('nombre', …)` también se reconocen como un caso, no solo `test('nombre', …)`
  // directo; la raíz tiene que ser `test`, `it` o `integration` (un `describe` no cuenta).
  const root=(node:ts.Expression):string=>ts.isIdentifier(node)?node.text:ts.isPropertyAccessExpression(node)?root(node.expression):ts.isCallExpression(node)?root(node.expression):'';
  const visit=(node:ts.Node):void=>{
   if(ts.isCallExpression(node)&&['test','it','integration'].includes(root(node.expression))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
    // Se cuenta por nombre, no por archivo: si el mismo nombre aparece en dos archivos tras
    // mover pruebas, cuenta igual que si siguiera en el archivo original.
    const name=node.arguments[0].text;result.set(name,(result.get(name)??0)+1);
   }
   ts.forEachChild(node,visit);
  };visit(ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true));
 }return result;
}
// El árbol actual se lee directamente del disco (no de otra foto): a esta comparación
// no le importa qué otra herramienta produjo el estado "después".
const after=Object.fromEntries([...new Bun.Glob('{src,tests}/**/*.ts').scanSync('.')].map(p=>[p,readFileSync(p,'utf8')]));
const oldCases=cases(before),newCases=cases(after);
// La sesión que coordinaba el cambio (controller) comparó las aserciones del caso combinado
// original contra estos tres casos específicos que lo reemplazan; por eso esta única división
// no cuenta como pérdida.
const split={original:'preserves Unicode session boundary and summary/search bytes',replacements:[
 'session IDs count Unicode characters and reject blank, control and exterior whitespace',
 'summary rendering preserves structured field ordering and file lines',
 'search terms trim whitespace and escape quoted literals without treating them as FTS syntax',
]};
const splitRetained=split.replacements.every(name=>newCases.has(name));
// "Perdido" es que el nombre aparezca menos veces después que antes (o haya desaparecido),
// salvo el caso original de la división ya aprobada, si sus tres reemplazos están presentes.
const missing=[...oldCases].filter(([n,c])=>(newCases.get(n)??0)<c && !(n===split.original&&splitRetained));
console.log(JSON.stringify({changedProduction:changed,baselineNamedCases:[...oldCases.values()].reduce((a,b)=>a+b,0),currentNamedCases:[...newCases.values()].reduce((a,b)=>a+b,0),documentedSplit:splitRetained?split:null,missing},null,2));
if(changed.length||missing.length)process.exitCode=1;
