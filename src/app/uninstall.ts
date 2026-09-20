import { lstatSync, rmSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryError } from "../shared/errors";
import { removePathPublication } from "../infrastructure/filesystem/path-publication";
import { assertSafePath } from "../infrastructure/filesystem/private-files";

export interface UninstallInput { confirmation: string; }
export interface UninstallDependencies {
  home?: string;
  executable: string;
  runAtlasUninstall?: (command:string,args:string[]) => Promise<number>;
  removePathPublication?: (home:string) => Promise<string[]>;
}
export interface UninstallResult { removed: boolean; atlasRemoved: boolean; pathPublications: string[]; }

function stat(path:string):Stats|null { try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;} }
function safeDirectory(path:string):Stats|null {
  const entry=stat(path);if(!entry)return null;
  if(!entry.isDirectory()||entry.isSymbolicLink())throw new MemoryError('UNINSTALL_UNSAFE','La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.');
  try{assertSafePath(path);}catch{throw new MemoryError('UNINSTALL_UNSAFE','La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.');}
  return entry;
}
async function defaultAtlasRunner(command:string,args:string[]):Promise<number>{
  const child=Bun.spawn([command,...args],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
  return await child.exited;
}

export async function uninstallEngram(input:UninstallInput, dependencies:UninstallDependencies):Promise<UninstallResult> {
  const home=dependencies.home??homedir(),parent=join(home,'.forge614'),root=join(parent,'engram'),atlas=join(parent,'atlas');
  const hasAtlas=safeDirectory(atlas)!==null;
  const expected=hasAtlas?'REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS':'REMOVE FORGE614-ENGRAM';
  if(input.confirmation!==expected)throw new MemoryError('UNINSTALL_CONFIRMATION','Escribe exactamente: '+expected);
  if(hasAtlas){
    const atlasCommand=join(atlas,'bin','forge614-atlas');
    const runner=dependencies.runAtlasUninstall??defaultAtlasRunner;
    if(!stat(atlasCommand))throw new MemoryError('ATLAS_UNINSTALL_REQUIRED','Forge614 Atlas existe pero no está disponible para desinstalarse de forma segura.');
    let exitCode:number;try{exitCode=await runner(atlasCommand,['uninstall','--from','forge614-engram','--confirmed']);}catch{throw new MemoryError('ATLAS_UNINSTALL_FAILED','Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');}
    if(exitCode!==0)throw new MemoryError('ATLAS_UNINSTALL_FAILED','Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');
  }
  const product=safeDirectory(root);
  let pathPublications:string[];
  try { pathPublications=await (dependencies.removePathPublication??(async candidateHome=>removePathPublication({home:candidateHome})))(home); }
  catch { throw new MemoryError('PATH_REMOVE_FAILED','No se pudo retirar de forma segura el acceso de Forge614 Engram en PATH; los datos de Engram se conservaron.'); }
  if(product)rmSync(root,{recursive:true,force:false,maxRetries:0});
  return {removed:product!==null,atlasRemoved:hasAtlas,pathPublications};
}
