/**
 * Lee y escribe archivos de configuración privados del usuario actual (como los que publican el PATH o
 * los ganchos de shell) con las comprobaciones necesarias para no seguir enlaces simbólicos, no operar
 * sobre archivos de otro usuario y no perder datos si algo falla a mitad de una escritura: cada escritura
 * pasa por un archivo temporal con permisos `0600`, se verifica antes de reemplazar el original y deja una
 * copia de respaldo del contenido previo. La usan `src/app/uninstall.ts` (`assertSafePath`) y
 * `src/infrastructure/filesystem/path-publication.ts` (`PrivateFileError`, `fail`, `guardedWrite`,
 * `readSafeFile`, `PrivateWrite`).
 */
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_CONFIG_BYTES=1024*1024;
/** Error de este módulo cuando una ruta o archivo de configuración no es seguro de leer o escribir. */
export class PrivateFileError extends Error {
  /**
   * @param code Código de máquina del fallo (p. ej. `UNSAFE_PATH`, `FILE_TOO_LARGE`, `CHANGED`).
   * @param message Mensaje legible para personas.
   */
  constructor(public readonly code:string,message:string){super(message);this.name='PrivateFileError';}
}
/**
 * Lanza un `PrivateFileError` con el código y mensaje dados; su tipo de retorno `never` permite usarla
 * dentro de una expresión sin que el resto del código deba comprobar un valor de error.
 * @param code Código de máquina del fallo.
 * @param message Mensaje legible para personas.
 * @throws PrivateFileError siempre, con el código y mensaje recibidos.
 */
export function fail(code:string,message:string):never{throw new PrivateFileError(code,message);}
/**
 * Comprueba que una ruta tiene la forma mínima exigida antes de tocar el disco: es una cadena, es
 * absoluta, no contiene un carácter nulo ni saltos de línea, y no es la raíz del sistema de archivos.
 * @param path Ruta a validar.
 * @returns La misma ruta resuelta (normalizada) a su forma absoluta.
 * @throws PrivateFileError con código `INVALID_PATH` si la ruta no cumple alguna de esas condiciones.
 */
export function validPath(path:string):string {
  if(typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path)||path===parse(path).root)fail('INVALID_PATH','An absolute file or directory path is required.');
  return resolve(path);
}
/**
 * Obtiene la información de una ruta sin seguir enlaces simbólicos y sin lanzar si no existe.
 * @param path Ruta a inspeccionar.
 * @returns El resultado de `lstatSync`, o `null` si la ruta no existe.
 * @throws El error original si `lstat` falla por una razón distinta a que falte la ruta.
 */
function stat(path:string){try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
/**
 * Añade la bandera `O_NOFOLLOW` a las banderas de apertura dadas, para que `open` falle si el último
 * componente de la ruta resulta ser un enlace simbólico en vez de seguirlo.
 * @param unixFlags Banderas de apertura de POSIX a combinar (p. ej. `O_RDONLY`).
 * @returns Las mismas banderas con `O_NOFOLLOW` añadida.
 */
function safeOpenFlag(unixFlags:number):number{return unixFlags|constants.O_NOFOLLOW;}
/**
 * Recorre una ruta desde el archivo final hasta la raíz (con `dirname`) y rechaza si algún tramo
 * intermedio es un enlace simbólico, no es una carpeta, o es una carpeta escribible por otros usuarios
 * (sin el bit «sticky» que limita quién puede borrar dentro de ella); las excepciones del propio sistema
 * en macOS (`/var` y `/tmp`, alias de solo lectura del sistema) se permiten porque son del usuario `root`,
 * no de otra cuenta.
 * @param path Ruta absoluta a comprobar; se revisa de hoja a raíz.
 * @throws PrivateFileError con código `INVALID_PATH` (vía {@link validPath}) o `UNSAFE_PATH` si algún tramo
 * es un enlace simbólico, deja de ser una carpeta antes del final, o es escribible por otros sin «sticky bit».
 */
export function assertSafePath(path:string):void{
  validPath(path);let current=path;const entries:{path:string;entry:ReturnType<typeof stat>}[]=[];
  while(current!==parse(current).root){
    const entry=stat(current);
    if(entry)entries.push({path:current,entry});
    current=dirname(current);
  }
  for(const {path:current,entry} of entries){
    // macOS trae estos alias de sistema propiedad de root; los enlaces simbólicos de un usuario siguen prohibidos.
    const systemAlias=process.platform==='darwin'&&['/var','/tmp'].includes(current)&&entry?.uid===0;
    if(entry?.isSymbolicLink()&&!systemAlias)fail('UNSAFE_PATH','Configuration paths must not traverse symbolic links.');
    if(entry&&current!==path&&!entry.isDirectory()&&!systemAlias)fail('UNSAFE_PATH','A configuration parent is not a directory.');
    // En Windows, `stat.mode` no trae permisos de grupo y otros como macOS y Linux: un archivo con `chmod 0o600` se lee `0o666` (corrida 37511442141).
    const windowsBase=process.platform==='win32';
    if(entry&&current!==path&&!systemAlias&&!windowsBase&&(entry.mode&0o002)&&!(entry.mode&0o1000))fail('UNSAFE_PATH','A configuration parent is writable by other users.');
  }
}
/**
 * Lee un archivo de configuración de forma segura: valida la ruta, exige que sea un archivo regular del
 * usuario actual con un solo enlace duro, limita su tamaño a {@link MAX_CONFIG_BYTES} y comprueba, tras
 * abrirlo, que sigue siendo el mismo archivo (mismo inodo y dispositivo) que se vio al inspeccionarlo, para
 * cerrar la ventana entre `lstat` y `open` en la que otro proceso podría sustituirlo.
 * @param path Ruta absoluta del archivo a leer.
 * @returns El contenido del archivo como texto UTF-8, o `null` si la ruta no existe.
 * @throws PrivateFileError con código `UNSAFE_FILE` si no es un archivo regular del usuario actual o tiene
 * más de un enlace duro; `FILE_TOO_LARGE` si excede el límite de tamaño; `CHANGED` si el archivo cambió
 * entre la inspección y la apertura; `MALFORMED` si su contenido no es UTF-8 válido.
 */
export function readSafeFile(path:string):string|null{
  assertSafePath(path);const entry=stat(path);if(!entry)return null;
  if(!entry.isFile()||(typeof process.getuid==='function'&&entry.uid!==process.getuid())||entry.nlink!==1)fail('UNSAFE_FILE','Configuration must be a regular file owned by the current user.');
  if(entry.size>MAX_CONFIG_BYTES)fail('FILE_TOO_LARGE','Configuration exceeds the 1 MiB limit.');
  const fd=openSync(path,safeOpenFlag(constants.O_RDONLY));
  try{
    const opened=fstatSync(fd);if(opened.ino!==entry.ino||opened.dev!==entry.dev)fail('CHANGED','Configuration changed during inspection.');
    // Limita la reserva y la lectura aunque otro proceso agrande el archivo después del lstat.
    const buffer=Buffer.alloc(MAX_CONFIG_BYTES+1);let length=0;
    while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(count===0)break;length+=count;}
    if(length>MAX_CONFIG_BYTES)fail('FILE_TOO_LARGE','Configuration exceeds the 1 MiB limit.');
    const bytes=buffer.subarray(0,length);
    const content=bytes.toString('utf8');if(!Buffer.from(content).equals(bytes))fail('MALFORMED','Configuration must contain valid UTF-8.');return content;
  }finally{closeSync(fd);}
}
/**
 * Calcula el hash SHA-256 de un texto, en hexadecimal, para comparar contenidos sin guardarlos completos;
 * no la usa ningún otro módulo del proyecto ni su propia prueba.
 * @param value Texto a resumir, o `null`.
 * @returns El hash en hexadecimal, o `null` si `value` es `null`.
 */
export function hash(value:string|null):string|null{return value===null?null:createHash('sha256').update(value).digest('hex');}
/**
 * Describe una escritura propuesta sobre un archivo de configuración gestionado.
 * @property path Ruta absoluta del archivo.
 * @property before Contenido que se espera encontrar antes de escribir (o `null` si no debía existir);
 * si el archivo no coincide con este valor, {@link guardedWrite} rechaza la escritura.
 * @property after Contenido que debe quedar tras la escritura (o `null` para borrar el archivo).
 * @property kind Tipo de archivo gestionado (`'config'`, `'hooks'` o `'plugin'`), informativo para quien
 * llama.
 */
export interface PrivateWrite {path:string;before:string|null;after:string|null;kind:'config'|'hooks'|'plugin';}
/** Forma mínima de un sistema de archivos que {@link guardedWrite} necesita para renombrar un archivo; permite sustituirla por una versión de prueba. */
export interface ConfigurationFileIO {rename:(from:string,to:string)=>void;}
/**
 * Aplica una escritura de configuración de forma segura y casi atómica: comprueba que el archivo sigue
 * teniendo el contenido `before` esperado, guarda una copia de respaldo si había contenido previo, escribe
 * el contenido nuevo en un archivo temporal exclusivo y lo renombra sobre el destino final, verificando en
 * cada paso que nadie más cambió el archivo mientras tanto.
 * @param write Descripción de la escritura a aplicar (ruta, contenido esperado antes, contenido deseado
 * después).
 * @param onBackup Se llama con la ruta de la copia de respaldo, si se creó una (solo cuando `before` no
 * era `null`).
 * @param onPublished Se llama con la ruta del archivo una vez que el cambio (escritura o borrado) quedó
 * aplicado.
 * @param io Operaciones de sistema de archivos a usar para el renombrado final; por defecto, `renameSync`
 * real (sustituible en pruebas).
 * @throws PrivateFileError con código `CHANGED` si el archivo no tenía el contenido `before` esperado, ya
 * fuera antes de empezar o justo antes de reemplazarlo; `DELETE_FAILED` si no se pudo borrar el archivo
 * cuando `after` es `null`; `PUBLISHED_UNVERIFIED` si el cambio se aplicó pero no se pudo confirmar que el
 * archivo quedó exactamente como se esperaba.
 */
export function guardedWrite(write:PrivateWrite,onBackup:(path:string)=>void,onPublished:(path:string)=>void,io:ConfigurationFileIO={rename:renameSync}):void{
  if(readSafeFile(write.path)!==write.before)fail('CHANGED','Configuration changed after preview. Preview again before applying.');
  assertSafePath(write.path);mkdirSync(dirname(write.path),{recursive:true,mode:0o700});assertSafePath(write.path);
  if(write.before!==null){
    const backup=write.path+'.forge614-backup-'+randomUUID();
    writeFileSync(backup,write.before,{flag:'wx',mode:0o600});onBackup(backup);
  }
  if(write.after===null){
    if(write.before===null)return;
    try{unlinkSync(write.path);}catch{fail('DELETE_FAILED','The managed configuration file could not be removed.');}
    if(readSafeFile(write.path)!==null)fail('PUBLISHED_UNVERIFIED','The managed configuration file was removed but could not be verified.');
    onPublished(write.path);return;
  }
  const temporary=write.path+'.forge614-tmp-'+randomUUID();let created=false;
  try{
    const fd=openSync(temporary,safeOpenFlag(constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL),0o600);created=true;
    try{writeFileSync(fd,write.after);fsyncSync(fd);}finally{closeSync(fd);}
    if(readSafeFile(write.path)!==write.before)fail('CHANGED','Configuration changed before replacement. The original backup was retained.');
    assertSafePath(write.path);io.rename(temporary,write.path);created=false;onPublished(write.path);
    try{
      if(readSafeFile(write.path)!==write.after)throw new Error();
    }catch{
      fail('PUBLISHED_UNVERIFIED','The file was published but its planned bytes could not be safely verified. Retained backups and external changes were not rolled back.');
    }
  }finally{if(created)try{unlinkSync(temporary);}catch{/* Conserva el material recuperable si la limpieza falla. */}}
}
