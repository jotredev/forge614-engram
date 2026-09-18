import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hasWindowsReparsePoint } from './windows-reparse-guard';

export const MAX_CONFIG_BYTES=1024*1024;
export class AssistantConfigurationError extends Error {
  constructor(public readonly code:string,message:string){super(message);this.name='AssistantConfigurationError';}
}
export function fail(code:string,message:string):never{throw new AssistantConfigurationError(code,message);}
export function validPath(path:string):string {
  if(typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path)||path===parse(path).root)fail('INVALID_PATH','An absolute file or directory path is required.');
  return resolve(path);
}
function stat(path:string){try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
type WindowsReparsePointChecker = (path:string) => unknown;
function assertNoWindowsReparsePoints(paths:readonly string[],checker:WindowsReparsePointChecker):void{
  for(const path of paths){
    let result:unknown;
    try{result=checker(path);}catch{fail('UNSAFE_PATH','Could not verify Windows reparse-point safety.');}
    if(result===true)fail('UNSAFE_PATH','Configuration paths must not traverse Windows reparse points.');
    if(result!==false)fail('UNSAFE_PATH','Could not verify Windows reparse-point safety.');
  }
}
export function assertSafePath(path:string,platform:NodeJS.Platform=process.platform):void{
  validPath(path);let current=path;const entries:{path:string;entry:ReturnType<typeof stat>}[]=[];
  while(current!==parse(current).root){
    const entry=stat(current);
    if(entry)entries.push({path:current,entry});
    current=dirname(current);
  }
  if(platform==='win32'&&process.platform==='win32')assertNoWindowsReparsePoints(entries.map(({path})=>path),hasWindowsReparsePoint);
  for(const {path:current,entry} of entries){
    // macOS ships these root-owned system aliases; user-controlled symlinks remain forbidden.
    const systemAlias=process.platform==='darwin'&&['/var','/tmp'].includes(current)&&entry?.uid===0;
    if(entry?.isSymbolicLink()&&!systemAlias)fail('UNSAFE_PATH','Configuration paths must not traverse symbolic links.');
    if(entry&&current!==path&&!entry.isDirectory()&&!systemAlias)fail('UNSAFE_PATH','A configuration parent is not a directory.');
    // Windows mode bits are synthesized from the read-only attribute, not ACL permissions.
    if(platform!=='win32'&&entry&&current!==path&&!systemAlias&&(entry.mode&0o002)&&!(entry.mode&0o1000))fail('UNSAFE_PATH','A configuration parent is writable by other users.');
  }
}
export function readSafeFile(path:string):string|null{
  assertSafePath(path);const entry=stat(path);if(!entry)return null;
  if(!entry.isFile()||(typeof process.getuid==='function'&&entry.uid!==process.getuid())||entry.nlink!==1)fail('UNSAFE_FILE','Configuration must be a regular file owned by the current user.');
  if(entry.size>MAX_CONFIG_BYTES)fail('FILE_TOO_LARGE','Configuration exceeds the 1 MiB limit.');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const opened=fstatSync(fd);if(opened.ino!==entry.ino||opened.dev!==entry.dev)fail('CHANGED','Configuration changed during inspection.');
    // Bound allocation and reads even if another writer grows the file after lstat.
    const buffer=Buffer.alloc(MAX_CONFIG_BYTES+1);let length=0;
    while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(count===0)break;length+=count;}
    if(length>MAX_CONFIG_BYTES)fail('FILE_TOO_LARGE','Configuration exceeds the 1 MiB limit.');
    const bytes=buffer.subarray(0,length);
    const content=bytes.toString('utf8');if(!Buffer.from(content).equals(bytes))fail('MALFORMED','Configuration must contain valid UTF-8.');return content;
  }finally{closeSync(fd);}
}
export function hash(value:string|null):string|null{return value===null?null:createHash('sha256').update(value).digest('hex');}
export interface PrivateWrite {path:string;before:string|null;after:string;kind:'config'|'hooks'|'plugin';}
export interface ConfigurationFileIO {rename:(from:string,to:string)=>void;}
export function guardedWrite(write:PrivateWrite,onBackup:(path:string)=>void,onPublished:(path:string)=>void,io:ConfigurationFileIO={rename:renameSync}):void{
  if(readSafeFile(write.path)!==write.before)fail('CHANGED','Configuration changed after preview. Preview again before applying.');
  assertSafePath(write.path);mkdirSync(dirname(write.path),{recursive:true,mode:0o700});assertSafePath(write.path);
  if(write.before!==null){
    const backup=write.path+'.forge614-backup-'+randomUUID();
    writeFileSync(backup,write.before,{flag:'wx',mode:0o600});onBackup(backup);
  }
  const temporary=write.path+'.forge614-tmp-'+randomUUID();let created=false;
  try{
    const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
    try{writeFileSync(fd,write.after);fsyncSync(fd);}finally{closeSync(fd);}
    if(readSafeFile(write.path)!==write.before)fail('CHANGED','Configuration changed before replacement. The original backup was retained.');
    assertSafePath(write.path);io.rename(temporary,write.path);created=false;onPublished(write.path);
    try{
      if(readSafeFile(write.path)!==write.after)throw new Error();
    }catch{
      fail('PUBLISHED_UNVERIFIED','The file was published but its planned bytes could not be safely verified. Retained backups and external changes were not rolled back.');
    }
  }finally{if(created)try{unlinkSync(temporary);}catch{/* Retain recoverable material on cleanup failure. */}}
}
