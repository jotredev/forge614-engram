import { MemoryWorkspace, MemoryError, memoryTypes, type SaveInput, type SearchScope } from "./index";
import { projectIdentity } from "./identity";
import { version } from "../package.json";

const HELP = `Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

init            Inicializa una sola configuración y base local, sin borrar datos.
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
get      --id <recuerdo>
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         Con proyecto, all es el valor por defecto: proyecto + shared.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
PostgreSQL todavía no está disponible. No hay copia local alternativa ni sincronización.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
Los resultados son JSON; errores a stderr y código de salida 1, sin conexiones privadas.
save es manual/programático; la integración memory_save con asistentes está pendiente.
`;

const MEMORY_OPTIONS = ["project-id", "scope"];
const OPTIONS: Record<string, readonly string[]> = {
  init: [], "project-create": ["name"], "project-list": [], "project-rename": ["project-id", "name"],
  save: [...MEMORY_OPTIONS,"title","content","type","topic","expected-version","request-key","pinned"],
  search: [...MEMORY_OPTIONS,"query","limit"],
  get: [...MEMORY_OPTIONS,"id"], history: [...MEMORY_OPTIONS,"id"],
  archive: [...MEMORY_OPTIONS,"id"], restore: [...MEMORY_OPTIONS,"id"],
};
function invalid(message: string): never { throw new MemoryError("INVALID_INPUT",message); }
function integer(value: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) invalid(`${field} debe ser un entero positivo.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid(`${field} está fuera del rango permitido.`);
  return n;
}

function main(args: string[]): void {
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
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i]!; const key = flag.slice(2); const value = args[i+1];
    if (!flag.startsWith("--") || !allowed.has(key) || values.has(key)) invalid("Opción desconocida o repetida. Consulta help.");
    if (!value?.trim() || value.startsWith("--") || value.includes("\0")) invalid("Cada opción necesita un valor no vacío.");
    values.set(key,value.trim());
  }
  const need = (key: string): string => values.get(key) ?? invalid(`Falta --${key}.`);
  const workspace = new MemoryWorkspace();
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
  } else if (command === "search") {
    query = need("query");
    if (values.has("limit")) limit = integer(need("limit"),"limit",100);
  } else { id = need("id"); }

  const store = workspace.open(["search","get","history"].includes(command));
  try {
    let result: unknown;
    switch (command) {
      case "save": result = store.save(saveInput!); break;
      case "search": result = store.search(projectId,query!,limit,scope as SearchScope); break;
      case "get":
        result = store.get(projectId,id!);
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
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify(error instanceof MemoryError
      ? { code: error.code, error: error.message }
      : { code: "STORAGE_ERROR", error: "No se pudo completar la operación. Comprueba permisos, configuración y disponibilidad de la base. No se creó una base de reemplazo." }));
    process.exitCode = 1;
  }
}
