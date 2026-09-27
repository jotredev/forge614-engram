/**
 * Pruebas de extremo a extremo del instalador de desarrollo (`scripts/install-from-source.sh`,
 * que compila el binario en vez de descargarlo): comprueban que el binario compilado funciona
 * como una CLI aislada (sin Bun ni Node en el PATH) y que el servidor MCP compilado sirve
 * sesiones y escrituras/lecturas progresivas de memoria de verdad, además de los rechazos del
 * instalador cuando faltan Bun o Git, o las dependencias no están preparadas.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/app/memory-store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const installer = resolve(import.meta.dir,"../../scripts/install-from-source.sh");
const dirs: string[] = [];
const buildEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` };
function workspace() {
  const dir = mkdtempSync(join(tmpdir(),"forge614-install-"));
  dirs.push(dir);
  return dir;
}
function install(cwd: string, args: string[], env = buildEnv) {
  const home=join(cwd,'isolated-home');mkdirSync(home,{recursive:true});
  const result = Bun.spawnSync(["/bin/bash",installer,...args],{cwd,env:{...env,HOME:home,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  return { code: result.exitCode, out: result.stdout.toString(), error: result.stderr.toString() };
}
afterEach(() => { for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true}); });

// Compila e instala el binario, y lo ejecuta con un PATH que solo contiene el propio binario
// (sin Bun ni Node): debe funcionar como CLI independiente (ayuda, versión, guardar/leer contra
// un SQLite directo con MemoryStore), rechazar una conexión por proyecto antes de mirar la
// configuración real del usuario, negarse a reinstalar sin --force dejando el binario intacto, y
// reinstalar con --force sin perder los datos ya guardados.
test("developer source installer produces a standalone CLI usable outside the repo without Bun on PATH", () => {
  const dir = workspace();
  const bin = join(dir,"bin with spaces");
  const installed = install(dir,["--bin-dir",bin]);
  expect(installed.code).toBe(0);
  expect(installed.out).toContain('forge614-engram init');
  expect(existsSync(join(dir,'isolated-home/.forge614'))).toBe(false);
  const target = join(bin,"forge614-engram");
  expect(existsSync(target)).toBe(true);
  // Solo el comando instalado es localizable: ni bun, ni node, ni el script de origen.
  const run = (...args: string[]) => Bun.spawnSync(["forge614-engram",...args],{cwd:dir,env:{PATH:bin,HOME:join(dir,'isolated-home')}});
  const help = run("help");
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("Uso: forge614-engram");
  expect(existsSync(join(dir,".forge614"))).toBe(false);
  expect(run("--version").stdout.toString()).toMatch(/^forge614-engram \d+\.\d+\.\d+/);
  const path = join(dir,"isolated.sqlite");
  const store = new MemoryStore(path);
  const project = store.createProject("Install test");
  const saved = store.save({projectId:project.projectId,title:"Keep",content:"SQLite standalone",type:"fact"});
  store.close();
  // El binario instalado debe rechazar las conexiones por proyecto antes de consultar la
  // configuración real del usuario. Los flujos completos de memoria corren en pruebas de
  // proceso hijo aisladas (aparte de esta).
  const connection = run("save","--project-id",project.projectId,"--db",path,"--title","No","--content","No");
  expect(connection.exitCode).toBe(1);
  expect(JSON.parse(connection.stderr.toString()).code).toBe("INVALID_INPUT");
  const original = Bun.hash(readFileSync(target));
  expect(install(dir,["--bin-dir",bin]).code).not.toBe(0);
  expect(Bun.hash(readFileSync(target))).toBe(original);
  expect(install(dir,["--bin-dir",bin,"--force"]).code).toBe(0);
  expect(run("--version").exitCode).toBe(0);
  const check = new MemoryStore(path,{readonly:true});
  try { expect(check.get(project.projectId,saved.id)?.content).toBe("SQLite standalone"); }
  finally { check.close(); }
},30000);

// --help debe salir con éxito y una opción desconocida debe fallar; en ninguno de los dos casos
// se crea el directorio de destino.
test("developer installer help and invalid options create no destination", () => {
  const dir = workspace();
  const bin = join(dir,"bin");
  expect(install(dir,["--help"]).code).toBe(0);
  expect(install(dir,["--bin-dir",bin,"--unknown"]).code).not.toBe(0);
  expect(existsSync(bin)).toBe(false);
});

// Con `FORGE614_HOME` absoluto, la instalación queda ahí y nunca toca el `.forge614` del hogar
// aislado; con un valor vacío o relativo, falla con `INVALID_FORGE614_HOME` para los dos.
test("developer installer uses absolute FORGE614_HOME and rejects invalid values", () => {
  const dir = workspace();
  const forgeHome = join(dir, "forge614-root");
  const installed = install(dir, [], { ...buildEnv, FORGE614_HOME: forgeHome });
  expect(installed.code).toBe(0);
  expect(existsSync(join(forgeHome, "engram", "bin", "forge614-engram"))).toBe(true);
  expect(existsSync(join(dir, "isolated-home", ".forge614"))).toBe(false);
  for (const value of ["", "relative/forge614"]) {
    const invalid = install(dir, ["--bin-dir", join(dir, `invalid-${value.length}`)], { ...buildEnv, FORGE614_HOME: value });
    expect(invalid.code).toBe(1);
    expect(invalid.error).toContain("INVALID_FORGE614_HOME");
  }
});

const nativeMac = process.platform === "darwin" ? test : test.skip;
// Solo en macOS: envuelve `git` con un script que registra con qué variables de entorno lo
// invocó el servidor MCP compilado al resolver el proyecto canónico, para diagnosticar esa
// invocación real (no afirma un resultado concreto, solo imprime la evidencia recogida).
nativeMac("diagnostic: compiled MCP records canonical-project Git invocation metadata",async()=>{
  const dir=workspace(),bin=join(dir,"bin"),home=join(dir,"isolated-home"),project=join(dir,"project"),commands=join(dir,"commands"),diagnostic=join(dir,"git-diagnostic");
  mkdirSync(project);mkdirSync(commands);
  const git=join(commands,"git");
  writeFileSync(git,[
    "#!/bin/sh",
    "/usr/bin/git \"$@\"",
    "status=$?",
    "printf 'gitExit=%s lcAll=%s global=%s noSystem=%s optionalLocks=%s\\n' \"$status\" \"$LC_ALL\" \"$GIT_CONFIG_GLOBAL\" \"$GIT_CONFIG_NOSYSTEM\" \"$GIT_OPTIONAL_LOCKS\" > \"$FORGE614_ENGRAM_GIT_DIAGNOSTIC\"",
    "exit \"$status\"",
    "",
  ].join("\n"),{mode:0o700});chmodSync(git,0o700);
  expect(install(dir,["--bin-dir",bin]).code).toBe(0);
  const executable=join(bin,"forge614-engram"),env={PATH:`${bin}:${commands}:/usr/bin:/bin`,HOME:home,FORGE614_ENGRAM_GIT_DIAGNOSTIC:diagnostic};
  expect(Bun.spawnSync([executable,"sessions-enable"],{cwd:dir,env}).exitCode).toBe(0);
  const transport=new StdioClientTransport({command:executable,args:["mcp"],cwd:project,env,stderr:"pipe"});
  const client=new Client({name:"installed-git-diagnostic",version:"1"},{capabilities:{}});await client.connect(transport);
  try{
    const result=await client.callTool({name:"memory_session_start",arguments:{directory:project,sessionId:"installed-git-diagnostic"}}) as CallToolResult;
    const response=JSON.parse((result.content.find(block=>block.type==="text") as {text:string}).text) as {code?:string};
    console.info(JSON.stringify({diagnostic:"compiled-canonical-project-git",wrapperInvoked:existsSync(diagnostic),wrapperMetadata:existsSync(diagnostic)?readFileSync(diagnostic,"utf8").trim():null,responseCode:response.code??null}));
  }finally{await client.close();}
},30000);

// Contra el binario compilado e instalado de verdad, ejercita por MCP la secuencia completa de
// una sesión: arranque, guardado, búsqueda, lectura, línea de tiempo, contexto, resumen y cierre;
// y comprueba que repetir el mismo guardado (misma requestKey) tras cerrar la sesión es idempotente.
test("developer-installed compiled binary executes progressive MCP session reads and writes",async()=>{
  const dir=workspace(),bin=join(dir,"bin"),home=join(dir,"isolated-home"),project=join(dir,"project");mkdirSync(project);
  expect(install(dir,["--bin-dir",bin]).code).toBe(0);
  const executable=join(bin,"forge614-engram"),env={PATH:`${bin}:/usr/bin:/bin`,HOME:home};
  expect(Bun.spawnSync([executable,"sessions-enable"],{cwd:dir,env}).exitCode).toBe(0);
  const transport=new StdioClientTransport({command:executable,args:["mcp"],cwd:project,env,stderr:"pipe"});
  const client=new Client({name:"installed-session-test",version:"1"},{capabilities:{}});await client.connect(transport);
  const call=async(name:string,args:Record<string,unknown>={})=>await client.callTool({name,arguments:args}) as CallToolResult;
  const json=(result:CallToolResult)=>JSON.parse((result.content.find(block=>block.type==="text") as {text:string}).text);
  try{
    const session=json(await call("memory_session_start",{directory:project,sessionId:"installed-chat"}));
    expect(session).toMatchObject({sessionId:"installed-chat",projectId:expect.any(String)});
    const saveInput={directory:project,title:"Installed",content:"Progressive context",type:"decision",sessionId:"installed-chat",requestKey:"installed-save-1"};
    const saved=json(await call("memory_save",saveInput));
    expect(saved).toMatchObject({projectId:session.projectId,sessionId:"installed-chat",sessionSource:"explicit"});
    expect(json(await call("memory_search",{directory:project,query:"Progressive"}))).toMatchObject({format:2,results:[{memory:{id:saved.id}}]});
    expect(json(await call("memory_get",{directory:project,id:saved.id}))).toMatchObject({memory:{content:"Progressive context"},currentVersion:1});
    expect(json(await call("memory_timeline",{directory:project,sessionId:"installed-chat",id:saved.id,version:1,before:0,after:0}))).toMatchObject({before:[],after:[]});
    expect(json(await call("memory_context",{directory:project,compact:true}))).toMatchObject({format:1,recent:expect.any(Array)});
    const summary=json(await call("memory_session_summary",{directory:project,sessionId:"installed-chat",requestKey:"installed-summary-1",summary:{goal:"Verify installed workflow",instructions:"",discoveries:"Compiled MCP works",accomplishments:"Exercised all progressive reads",nextSteps:"Close explicitly",files:[]}}));
    expect(summary).toMatchObject({memory:{type:"procedure",topicKey:"session/installed-chat/summary",version:1},sessionId:"installed-chat",sessionSource:"explicit"});
    const ended=json(await call("memory_session_end",{directory:project,sessionId:"installed-chat"}));
    expect(ended).toMatchObject({sessionId:"installed-chat",projectId:session.projectId,kind:"runtime",endedAt:expect.any(String)});
    expect(json(await call("memory_save",saveInput))).toEqual(saved);
  }finally{await client.close();}
},30000);

// Con un PATH que no incluye a Bun, el instalador debe fallar mencionando «Bun» en el error, sin
// llegar a crear el directorio de destino.
test("developer installer reports a missing Bun prerequisite without creating destination", () => {
  const dir = workspace();
  const bin = join(dir,"bin");
  const result = install(dir,["--bin-dir",bin],{...process.env,PATH:"/usr/bin:/bin"});
  expect(result.code).not.toBe(0);
  expect(result.error).toContain("Bun");
  expect(existsSync(bin)).toBe(false);
});

// En una copia aislada sin `node_modules` ni dependencias instaladas, el instalador debe fallar
// indicando el comando `bun install --frozen-lockfile --ignore-scripts` para prepararlas, sin
// crear `node_modules`, el directorio de destino ni `.forge614`.
test('developer installer reports offline dependency preparation in an isolated checkout',()=>{
  const dir=workspace();mkdirSync(join(dir,'scripts'));copyFileSync(installer,join(dir,'scripts/install-from-source.sh'));
  copyFileSync(resolve(import.meta.dir,'../../package.json'),join(dir,'package.json'));
  const result=Bun.spawnSync(['/bin/bash',join(dir,'scripts/install-from-source.sh'),'--bin-dir',join(dir,'bin')],{cwd:dir,env:{...buildEnv,HOME:dir,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'}});
  expect(result.exitCode).toBe(1);expect(result.stderr.toString()).toContain('bun install --frozen-lockfile --ignore-scripts');
  expect(existsSync(join(dir,'node_modules'))).toBe(false);expect(existsSync(join(dir,'bin'))).toBe(false);expect(existsSync(join(dir,'.forge614'))).toBe(false);
});

// Con un PATH que solo tiene a Bun (simulado con un enlace simbólico) y `uname`, pero no Git, el
// instalador debe fallar mencionando «Git» antes de intentar compilar, sin crear el destino.
test('developer installer fails closed when Git is unavailable before compilation',()=>{
  const dir=workspace(),path=join(dir,'commands');mkdirSync(path);
  symlinkSync(process.execPath,join(path,'bun'));symlinkSync('/usr/bin/uname',join(path,'uname'));
  const result=install(dir,['--bin-dir',join(dir,'bin')],{...buildEnv,PATH:path});
  expect(result.code).toBe(1);expect(result.error).toContain('Git');expect(existsSync(join(dir,'bin'))).toBe(false);
});
