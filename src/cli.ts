import { MemoryWorkspace, MemoryError, memoryTypes, type SaveInput, type SearchScope } from "./index";
import { projectIdentity } from "./identity";
import { version } from "../package.json";
import { setupTerminal } from "./setup-terminal";
import { syncWorkspace, watchSync } from "./sync-runner";
import { bindProjectContext, startProjectSession } from "./project-context";
import { startMcp } from "./mcp";
import { detectAssistants, isClientId } from "./assistants/catalog";
import { runMemoryHook } from "./assistants/hooks";
import { assistantTui } from "./assistant-tui";

const HELP = `Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
tui             Asistentes: flechas, Espacio, vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve explícitamente una réplica formato 1.
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
mcp             Inicia el servidor MCP local por stdio; no migra la base.
assistant-list  Detecta asistentes y muestra configuración/cobertura sin escribir archivos.
memory-hook     --client <claude-code|codex|cursor|opencode|gemini-cli>
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>
project-bind    --directory <carpeta> --project-id <UUID>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false] [--session-id <id>] [--session-project-id <UUID>]
         type=fact por defecto; un save shared con sesión requiere --session-project-id.
get      --id <recuerdo> [--version <n>]
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>] [--preview]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         limit=10; con proyecto, scope=all: proyecto + shared.

Sesiones (requieren antes sessions-enable; la habilitación y promoción nunca son automáticas):
session-start --directory <carpeta> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json>
                --request-key <clave> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <recuerdo> --version <n>
         [--before <0..20>] [--after <0..20>] (ambos por defecto 5)
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
        compact=false y max-bytes=16384 por defecto.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada en setup.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup puede añadir metadatos de sincronización al esquema 3 sin borrar recuerdos.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup y tui muestran texto y requieren terminal; cancelar devuelve código 130.
Los comandos de datos devuelven JSON; errores a stderr y código de salida 1, sin conexiones privadas.
MCP expone memory_save a asistentes; el modelo puede omitir guardados. No captura transcripciones.
La resolución de directorios de proyecto requiere Git disponible, incluso para carpetas sin Git.
`;

const MEMORY_OPTIONS = ["project-id", "scope"];
const OPTIONS: Record<string, readonly string[]> = {
  setup: [], tui: [], init: [], sync: ["upgrade-format"], "sync-watch": ["interval","upgrade-format"], "integration-enable": [], "sessions-enable": [], mcp: [], "assistant-list": [], "memory-hook": ["client"],
  "project-create": ["name"], "project-list": [], "project-rename": ["project-id", "name"], "project-bind": ["directory","project-id"],
  save: [...MEMORY_OPTIONS,"title","content","type","topic","expected-version","request-key","pinned","session-id","session-project-id"],
  search: [...MEMORY_OPTIONS,"query","limit","preview"],
  get: [...MEMORY_OPTIONS,"id","version"], history: [...MEMORY_OPTIONS,"id"],
  archive: [...MEMORY_OPTIONS,"id"], restore: [...MEMORY_OPTIONS,"id"],
  "session-start":["directory","session-id"], "session-end":["project-id","session-id"],
  "session-summary":["project-id","session-id","summary-json","request-key","expected-version"],
  timeline:["project-id","session-id","id","version","before","after"],
  context:["project-id","scope","compact","max-bytes"],
};
const BOOLEAN_FLAGS=new Set(["preview","compact","upgrade-format"]);
function invalid(message: string): never { throw new MemoryError("INVALID_INPUT",message); }
function integer(value: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) invalid(`${field} debe ser un entero positivo.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid(`${field} está fuera del rango permitido.`);
  return n;
}
function nonnegative(value:string,field:string,max:number):number {
  if(!/^\d+$/.test(value)) invalid(`${field} debe ser un entero entre 0 y ${max}.`);
  const n=Number(value);if(!Number.isSafeInteger(n)||n>max)invalid(`${field} está fuera del rango permitido.`);return n;
}

async function main(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  if (command === "--version") {
    if (args.length > 1) invalid("--version no acepta opciones.");
    console.log(`forge614-engram ${version}`); return;
  }
  if (command === "help" || command === "--help") {
    if (args.length > 1) invalid("help no acepta opciones.");
    console.log(HELP); return;
  }
  if (!Object.hasOwn(OPTIONS,command)) invalid("Comando desconocido. Consulta help.");
  const allowed = new Set(OPTIONS[command]!);
  const values = new Map<string,string>();
  for (let i = 1; i < args.length;) {
    const flag = args[i]!; const key = flag.slice(2); const value = args[i+1];
    if (!flag.startsWith("--") || !allowed.has(key) || values.has(key)) invalid("Opción desconocida o repetida. Consulta help.");
    if(BOOLEAN_FLAGS.has(key)){values.set(key,"true");i+=1;continue;}
    if (!value?.trim() || value.startsWith("--") || value.includes("\0")) invalid("Cada opción necesita un valor no vacío.");
    values.set(key,value.trim());
    i+=2;
  }
  const need = (key: string): string => values.get(key) ?? invalid(`Falta --${key}.`);
  if (command === "setup") { await setupTerminal(); return; }
  if (command === "tui") { const result=await assistantTui();if(result.cancelled)process.exitCode=130;return; }
  if (command === "sync") {console.log(JSON.stringify(await syncWorkspace(undefined,{upgradeFormat:values.has("upgrade-format")}),null,2));return;}
  if(command==="sync-watch"&&values.has("upgrade-format"))invalid("sync-watch no acepta --upgrade-format.");
  if (command === "sync-watch") {await watchSync(values.has("interval")?integer(need("interval"),"interval",3600):30);return;}
  if (command === "mcp") { await startMcp(); return; }
  if (command === "assistant-list") {console.log(JSON.stringify(detectAssistants({engramExecutable:process.execPath}),null,2));return;}
  if (command === "memory-hook") {const client=need("client");if(!isClientId(client))invalid("Asistente desconocido.");await runMemoryHook(client);return;}
  const workspace = new MemoryWorkspace();
  if (command === "integration-enable") {
    workspace.init(); const store = workspace.open();
    try { store.enableAssistantIntegration(); }
    finally { store.close(); }
    console.log(JSON.stringify({ enabled:true,schema:5 },null,2)); return;
  }
  if(command==="sessions-enable"){
    workspace.init();const store=workspace.open();try{store.enableSessions();}finally{store.close();}
    console.log(JSON.stringify({enabled:true,schema:6},null,2));return;
  }
  if (command === "project-bind") {
    const store = workspace.open();
    try { console.log(JSON.stringify(bindProjectContext(store,need("directory"),projectIdentity(need("project-id"))),null,2)); }
    finally { store.close(); }
    return;
  }
  if (command === "init" || command.startsWith("project-")) {
    let result: unknown;
    switch (command) {
      case "init": workspace.init(); result = { initialized: true, storage: "sqlite" }; break;
      case "project-create": result = workspace.createProject(need("name")); break;
      case "project-list": result = workspace.listProjects(); break;
      case "project-rename": result = workspace.renameProject(projectIdentity(need("project-id")),need("name")); break;
    }
    console.log(JSON.stringify(result,null,2)); return;
  }
  if(command==="session-start"){
    const store=workspace.open();try{console.log(JSON.stringify(startProjectSession(store,need("directory"),need("session-id")),null,2));}finally{store.close();}return;
  }
  if(command==="session-end"){
    const store=workspace.open();try{console.log(JSON.stringify(store.endSession(projectIdentity(need("project-id")),need("session-id")),null,2));}finally{store.close();}return;
  }
  if(command==="session-summary"){
    let summary:unknown;try{summary=JSON.parse(need("summary-json"));}catch{invalid("--summary-json debe ser JSON válido.");}
    const keys=["goal","instructions","discoveries","accomplishments","nextSteps","files"];
    if(!summary||typeof summary!=="object"||Array.isArray(summary)||Object.keys(summary).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(summary,key)))invalid("--summary-json requiere exactamente goal, instructions, discoveries, accomplishments, nextSteps y files.");
    const expected=values.has("expected-version")?integer(need("expected-version"),"expected-version"):undefined;
    const store=workspace.open();try{console.log(JSON.stringify(store.saveSessionSummary(projectIdentity(need("project-id")),need("session-id"),summary as any,{requestKey:need("request-key"),...(expected?{expectedVersion:expected}:{})}),null,2));}finally{store.close();}return;
  }
  if(command==="timeline"){
    const store=workspace.open(true);try{console.log(JSON.stringify(store.timeline(projectIdentity(need("project-id")),{sessionId:need("session-id"),memoryId:need("id"),version:integer(need("version"),"version"),...(values.has("before")?{before:nonnegative(need("before"),"before",20)}:{}),...(values.has("after")?{after:nonnegative(need("after"),"after",20)}:{})}),null,2));}finally{store.close();}return;
  }
  if(command==="context"){
    const scope=values.get("scope")??"project";if(scope!=="project"&&scope!=="shared")invalid("scope debe ser project o shared.");
    if(scope==="shared"&&values.has("project-id"))invalid("scope shared no acepta --project-id.");
    const projectId=scope==="shared"?null:projectIdentity(need("project-id"));
    const store=workspace.open(true);try{console.log(JSON.stringify(store.context(projectId,{compact:values.has("compact"),...(values.has("max-bytes")?{maxBytes:integer(need("max-bytes"),"max-bytes",65536)}:{})}),null,2));}finally{store.close();}return;
  }
  // Complete argument validation before reading config or opening any database.
  const scope = values.get("scope") ?? (command === "search" ? "all" : "project");
  const projectId = values.has("project-id") ? projectIdentity(need("project-id")) : null;
  if (command === "search") {
    if (!["all","project","shared"].includes(scope)) invalid("scope debe ser all, project o shared.");
    if (scope !== "shared" && projectId === null) invalid("Indica --project-id o selecciona --scope shared explícitamente.");
  } else {
    if (scope !== "project" && scope !== "shared") invalid("scope debe ser project o shared.");
    if (scope === "shared" && projectId !== null) invalid("scope shared no acepta --project-id en operaciones sobre un recuerdo.");
    if (scope === "project" && projectId === null) invalid("scope project requiere --project-id.");
  }
  let saveInput: SaveInput | undefined;
  let query: string | undefined;
  let id: string | undefined;
  let limit = 10;
  if (command === "save") {
    const type = values.get("type") ?? "fact";
    if (!memoryTypes.includes(type as SaveInput["type"])) invalid("Tipo no válido. Consulta help.");
    const pinned = values.get("pinned");
    if (pinned !== undefined && pinned !== "true" && pinned !== "false") invalid("--pinned acepta true o false.");
    const target = scope === "shared"
      ? { scope: "shared" as const, projectId: null }
      : { scope: "project" as const, projectId: projectId! };
    saveInput = { ...target, title: need("title"), content: need("content"), type: type as SaveInput["type"] };
    if (values.has("topic")) saveInput.topicKey = need("topic");
    if (values.has("request-key")) saveInput.requestKey = need("request-key");
    if (pinned !== undefined) saveInput.pinned = pinned === "true";
    if (values.has("expected-version")) {
      if (!saveInput.topicKey) invalid("--expected-version requiere --topic.");
      saveInput.expectedVersion = integer(need("expected-version"),"expected-version");
    }
    if(values.has("session-project-id")&&(scope!=="shared"||!values.has("session-id")))invalid("--session-project-id requiere scope shared y --session-id.");
    if(scope==="shared"&&values.has("session-id")&&!values.has("session-project-id"))invalid("Un save shared con sesión requiere --session-project-id.");
  } else if (command === "search") {
    query = need("query");
    if (values.has("limit")) limit = integer(need("limit"),"limit",100);
  } else { id = need("id"); }

  const store = workspace.open(["search","get","history"].includes(command));
  try {
    let result: unknown;
    switch (command) {
      case "save": result = values.has("session-id") ? store.saveWithSession(saveInput!,{sessionId:need("session-id"),...(values.has("session-project-id")?{projectId:projectIdentity(need("session-project-id"))}:{})}).memory : store.save(saveInput!); break;
      case "search": result = values.has("preview") ? store.searchPreviews(projectId,query!,limit,scope as SearchScope) : store.search(projectId,query!,limit,scope as SearchScope); break;
      case "get":
        result = values.has("version") ? store.getVersion(projectId,id!,integer(need("version"),"version")) : store.get(projectId,id!);
        if (result === null) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
        break;
      case "history": result = store.history(projectId,id!); break;
      case "archive": result = store.archive(projectId,id!); break;
      case "restore": result = store.restore(projectId,id!); break;
    }
    console.log(JSON.stringify(result,null,2));
  } finally { store.close(); }
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify(error instanceof MemoryError
      ? { code: error.code, error: error.message }
      : { code: "STORAGE_ERROR", error: "No se pudo completar la operación. Comprueba permisos, configuración y disponibilidad de la base. No se creó una base de reemplazo." }));
    process.exitCode = 1;
  }
}
