import ts from 'typescript';
import {readFileSync,existsSync} from 'node:fs';
import {isTestSource} from '../../tests/architecture/test-layout';
const before=JSON.parse(readFileSync('.superpowers/colocated-tests/before.json','utf8')) as Record<string,string>;
const changed=Object.entries(before).filter(([p])=>p.startsWith('src/')&&!isTestSource(p)).filter(([p,t])=>!existsSync(p)||readFileSync(p,'utf8')!==t).map(([p])=>p);
function cases(files:Record<string,string>):Map<string,number>{
 const result=new Map<string,number>();
 for(const [p,text]of Object.entries(files))if(/\.test\.ts$/.test(p)){
  const root=(node:ts.Expression):string=>ts.isIdentifier(node)?node.text:ts.isPropertyAccessExpression(node)?root(node.expression):ts.isCallExpression(node)?root(node.expression):'';
  const visit=(node:ts.Node):void=>{
   if(ts.isCallExpression(node)&&['test','it','integration'].includes(root(node.expression))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
    const name=node.arguments[0].text;result.set(name,(result.get(name)??0)+1);
   }
   ts.forEachChild(node,visit);
  };visit(ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true));
 }return result;
}
const after=Object.fromEntries([...new Bun.Glob('{src,tests}/**/*.ts').scanSync('.')].map(p=>[p,readFileSync(p,'utf8')]));
const oldCases=cases(before),newCases=cases(after);
// Controller compared the old combined assertions against these three owner-specific cases.
const split={original:'preserves Unicode session boundary and summary/search bytes',replacements:[
 'session IDs count Unicode characters and reject blank, control and exterior whitespace',
 'summary rendering preserves structured field ordering and file lines',
 'search terms trim whitespace and escape quoted literals without treating them as FTS syntax',
]};
const splitRetained=split.replacements.every(name=>newCases.has(name));
const missing=[...oldCases].filter(([n,c])=>(newCases.get(n)??0)<c && !(n===split.original&&splitRetained));
console.log(JSON.stringify({changedProduction:changed,baselineNamedCases:[...oldCases.values()].reduce((a,b)=>a+b,0),currentNamedCases:[...newCases.values()].reduce((a,b)=>a+b,0),documentedSplit:splitRetained?split:null,missing},null,2));
if(changed.length||missing.length)process.exitCode=1;
