/**
 * Desinstala Forge614 Engram del disco: pide confirmación textual exacta, desinstala
 * primero Forge614 Atlas si está presente (Engram es su dependencia), retira la entrada
 * de PATH y por último borra la carpeta de instalación.
 */
import { lstatSync, rmSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MemoryError } from "../shared/errors";
import { removePathPublication } from "../infrastructure/filesystem/path-publication";
import { assertSafePath } from "../infrastructure/filesystem/private-files";
import { engramBinDirectory, engramHome, forge614Home } from "../infrastructure/filesystem/paths";

/** Lo que quien llama debe aportar para autorizar la desinstalación: `confirmation` es la frase exacta que la persona debe escribir para confirmar, que varía según si Atlas también se va a quitar. */
export interface UninstallInput { confirmation: string; }
/** Piezas que `uninstallEngram` necesita del entorno; sustituibles en las pruebas. */
export interface UninstallDependencies {
  /** Carpeta personal a usar en vez de `homedir()`. */
  home?: string;
  /** Carpeta raíz de Forge614 a usar en vez de `forge614Home()`; si se da, cambia también dónde se busca el binario. */
  forgeHome?: string;
  /** Ruta del ejecutable de Engram en uso (informativa; no se usa para borrar nada aquí). */
  executable: string;
  /** Sustituye la ejecución real del desinstalador de Atlas (usado en pruebas). */
  runAtlasUninstall?: (command:string,args:string[]) => Promise<number>;
  /** Sustituye la función real que retira la entrada de PATH (usado en pruebas). */
  removePathPublication?: (home:string, binDirectory:string) => Promise<string[]>;
}
/** Resumen de lo que la desinstalación efectivamente hizo: `removed` si la carpeta de instalación de Engram existía y se borró; `atlasRemoved` si Forge614 Atlas estaba presente y se desinstaló como parte de este proceso; `pathPublications` las rutas (por ejemplo, de archivos de perfil de shell) de las que se retiró la publicación en PATH. */
export interface UninstallResult { removed: boolean; atlasRemoved: boolean; pathPublications: string[]; }

/** Como `lstatSync`, pero devuelve `null` en vez de lanzar cuando la ruta no existe. */
function stat(path:string):Stats|null { try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;} }
/**
 * Confirma que `path` es una carpeta real, no un enlace simbólico y no tiene en su
 * ascendencia ningún enlace simbólico fuera de los alias del sistema que permite
 * `assertSafePath`, antes de autorizar que se borre.
 * @param path Ruta a comprobar.
 * @returns La información (`Stats`) de la carpeta, o `null` si no existe.
 * @throws MemoryError con código `UNINSTALL_UNSAFE` si la ruta existe pero no es una
 * carpeta segura para borrar (no es carpeta, es un enlace, o su ruta no es segura).
 */
function safeDirectory(path:string):Stats|null {
  const entry=stat(path);if(!entry)return null;
  if(!entry.isDirectory()||entry.isSymbolicLink())throw new MemoryError('UNINSTALL_UNSAFE','La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.');
  try{assertSafePath(path);}catch{throw new MemoryError('UNINSTALL_UNSAFE','La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.');}
  return entry;
}
/** Ejecuta de verdad el binario de Atlas con los argumentos dados, sin heredar entrada ni salida, y espera su código de salida. */
async function defaultAtlasRunner(command:string,args:string[]):Promise<number>{
  const child=Bun.spawn([command,...args],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
  return await child.exited;
}

/**
 * Ejecuta la desinstalación completa: valida la frase de confirmación, desinstala Atlas
 * si corresponde, retira el acceso por PATH y borra la carpeta de instalación de Engram.
 * El orden importa: Atlas se quita antes que Engram (Atlas depende de Engram), y el PATH
 * se retira antes de borrar archivos para no dejar un ejecutable roto referenciado.
 * @param input Frase de confirmación escrita por la persona.
 * @param dependencies Rutas y funciones sustituibles descritas en {@link UninstallDependencies}.
 * @returns Qué se borró, si Atlas se desinstaló y de dónde se retiró el PATH.
 * @throws MemoryError con código `UNINSTALL_UNSAFE` si la carpeta de Atlas o de Engram no
 * son seguras de borrar; `UNINSTALL_CONFIRMATION` si la frase no coincide exactamente con
 * la esperada; `ATLAS_UNINSTALL_REQUIRED` si Atlas está presente pero su ejecutable no se
 * encuentra; `ATLAS_UNINSTALL_FAILED` si el desinstalador de Atlas falla o termina con
 * código distinto de 0; `PATH_REMOVE_FAILED` si no se puede retirar la entrada de PATH.
 */
export async function uninstallEngram(input:UninstallInput, dependencies:UninstallDependencies):Promise<UninstallResult> {
  const home=dependencies.home??homedir();
  const parent=dependencies.forgeHome??forge614Home();
  // Si se dio una carpeta raíz de Forge614 alternativa (pruebas), Engram vive dentro de ella en `engram/`.
  const root=dependencies.forgeHome===undefined?engramHome():join(parent,'engram');
  const binDirectory=dependencies.forgeHome===undefined?engramBinDirectory():join(root,'bin');
  const atlas=join(parent,'atlas');
  const hasAtlas=safeDirectory(atlas)!==null;
  // La frase de confirmación exigida cambia según si también se va a desinstalar Atlas, para que la persona sepa el alcance real.
  const expected=hasAtlas?'REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS':'REMOVE FORGE614-ENGRAM';
  if(input.confirmation!==expected)throw new MemoryError('UNINSTALL_CONFIRMATION','Escribe exactamente: '+expected);
  if(hasAtlas){
    const atlasCommand=join(atlas,'bin','forge614-atlas');
    const runner=dependencies.runAtlasUninstall??defaultAtlasRunner;
    if(!stat(atlasCommand))throw new MemoryError('ATLAS_UNINSTALL_REQUIRED','Forge614 Atlas existe pero no está disponible para desinstalarse de forma segura.');
    // Se le pide a Atlas que se desinstale a sí mismo con `--confirmed` para que no vuelva a pedir confirmación interactiva.
    let exitCode:number;try{exitCode=await runner(atlasCommand,['uninstall','--from','forge614-engram','--confirmed']);}catch{throw new MemoryError('ATLAS_UNINSTALL_FAILED','Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');}
    if(exitCode!==0)throw new MemoryError('ATLAS_UNINSTALL_FAILED','Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');
  }
  // Se comprueba que la carpeta de Engram es segura de borrar antes de tocar el PATH, para no dejar el PATH sin la carpeta si esta no fuera válida.
  const product=safeDirectory(root);
  let pathPublications:string[];
  try { pathPublications=await (dependencies.removePathPublication??(async (candidateHome, candidateBinDirectory)=>removePathPublication({home:candidateHome,binDirectory:candidateBinDirectory})))(home,binDirectory); }
  catch { throw new MemoryError('PATH_REMOVE_FAILED','No se pudo retirar de forma segura el acceso de Forge614 Engram en PATH; los datos de Engram se conservaron.'); }
  // Solo se borra si la carpeta existía (`product` no es null); `force:false` y `maxRetries:0` evitan reintentos silenciosos ante un borrado parcial.
  if(product)rmSync(root,{recursive:true,force:false,maxRetries:0});
  return {removed:product!==null,atlasRemoved:hasAtlas,pathPublications};
}
