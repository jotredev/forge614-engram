import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

/** Source launches must discover a compiled installation; Bun itself is never registered. */
export function resolveInstalledEngram(options:{home?:string;path?:string;executable?:string}={}):string|null{
  const candidates=options.executable?[options.executable]:[
    ...(basename(process.execPath)==='forge614-engram'?[process.execPath]:[]),
    Bun.which('forge614-engram',{PATH:options.path??process.env.PATH??''}),
    join(options.home??homedir(),'.forge614','engram','bin','forge614-engram'),
    join(options.home??homedir(),'.local/bin/forge614-engram'),
  ];
  for(const candidate of candidates){
    if(!candidate||!isAbsolute(candidate))continue;
    try{
      const path=realpathSync(candidate);
      if(['bun','bunx','node'].includes(basename(path)))continue;
      accessSync(path,constants.X_OK);if(statSync(path).isFile())return path;
    }catch{/* An unavailable candidate does not authorize another runtime. */}
  }
  return null;
}
