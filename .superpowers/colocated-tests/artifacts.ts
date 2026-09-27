/**
 * Guarda y compara fotos (snapshots) del árbol de archivos del repositorio, para revisar
 * a mano que una reorganización de pruebas (moverlas junto a su archivo de implementación,
 * ver `context.md`) no cambió ni perdió ningún archivo. `check.ts` lee la foto "antes" que
 * este script produce; a `check.ts` no le importa quién produjo la foto "después", así que
 * lee el árbol actual directamente en vez de otra foto de este archivo.
 * Uso: `bun artifacts.ts snapshot <nombre>` guarda el árbol actual con ese nombre;
 * `bun artifacts.ts diff <antes> <después>` compara dos fotos ya guardadas.
 */
import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const dir=join(process.cwd(),'.superpowers/colocated-tests');
const [mode,name,other]=process.argv.slice(2);
if(mode==='snapshot'){
 // Toma todo lo que Git conoce: lo ya versionado (--cached) y lo nuevo sin ignorar (--others
 // --exclude-standard), separado por NUL (-z) para que ninguna ruta con espacios se corte mal.
 const result=Bun.spawnSync(['git','ls-files','--cached','--others','--exclude-standard','-z']);
 const files:Record<string,string>={};
 // Un Set quita duplicados; si el archivo ya no existe (se borró tras listarlo) se omite en vez de fallar.
 for(const path of new Set(result.stdout.toString().split('\0').filter(Boolean)))if(existsSync(path))files[path]=readFileSync(path,'utf8');
 writeFileSync(join(dir,`${name}.json`),JSON.stringify(files));
}else if(mode==='diff'){
 // Se reconstruyen las dos fotos como carpetas reales en un directorio temporal porque
 // `git diff --no-index` compara carpetas o archivos en disco, no los JSON directamente.
 const temp=mkdtempSync(join(tmpdir(),'engram-colocation-review-'));
 for(const [side,snapshot] of [['before',name],['after',other]]){
  const files=JSON.parse(readFileSync(join(dir,`${snapshot}.json`),'utf8')) as Record<string,string>;
  for(const [path,text]of Object.entries(files)){const dest=join(temp,side!,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,text);}
 }
 // --find-renames=40% agrupa un archivo movido/renombrado con su original si comparten al menos
 // ese porcentaje de contenido, en vez de mostrarlo como borrado + creado; -U8 da más líneas de
 // contexto alrededor de cada cambio para que la revisión a mano sea más fácil de leer.
 const r=Bun.spawnSync(['git','diff','--no-index','--find-renames=40%','-U8','--','before','after'],{cwd:temp,maxBuffer:20*1024*1024});
 // git diff --no-index sale con 1 cuando SÍ hay diferencias (no es un error); solo >1 es un fallo real.
 if(r.exitCode>1)throw Error(r.stderr.toString());
 const output=join(dir,`${name}--${other}.diff`);writeFileSync(output,r.stdout.toString());console.log(output);
}else throw Error('snapshot NAME or diff BEFORE AFTER');
