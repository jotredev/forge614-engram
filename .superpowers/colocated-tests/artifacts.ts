import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const dir=join(process.cwd(),'.superpowers/colocated-tests');
const [mode,name,other]=process.argv.slice(2);
if(mode==='snapshot'){
 const result=Bun.spawnSync(['git','ls-files','--cached','--others','--exclude-standard','-z']);
 const files:Record<string,string>={};
 for(const path of new Set(result.stdout.toString().split('\0').filter(Boolean)))if(existsSync(path))files[path]=readFileSync(path,'utf8');
 writeFileSync(join(dir,`${name}.json`),JSON.stringify(files));
}else if(mode==='diff'){
 const temp=mkdtempSync(join(tmpdir(),'engram-colocation-review-'));
 for(const [side,snapshot] of [['before',name],['after',other]]){
  const files=JSON.parse(readFileSync(join(dir,`${snapshot}.json`),'utf8')) as Record<string,string>;
  for(const [path,text]of Object.entries(files)){const dest=join(temp,side!,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,text);}
 }
 const r=Bun.spawnSync(['git','diff','--no-index','--find-renames=40%','-U8','--','before','after'],{cwd:temp,maxBuffer:20*1024*1024});
 if(r.exitCode>1)throw Error(r.stderr.toString());
 const output=join(dir,`${name}--${other}.diff`);writeFileSync(output,r.stdout.toString());console.log(output);
}else throw Error('snapshot NAME or diff BEFORE AFTER');
