import { resolve } from "node:path";
import { MemoryError, MemoryStore, memoryTypes, type SaveInput } from "./index";

const HELP = `Forge614 Engram — memoria personal local (etapa 1)

Uso: bun run cli <comando> --project <proyecto> [opciones]

save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false]
search   --query <texto> [--limit <1..100>]
get      --id <identificador>
history  --id <identificador>
archive  --id <identificador>
restore  --id <identificador>
help     Muestra esta ayuda sin crear archivos.

Todos los comandos de datos aceptan --db <ruta>.
Ruta predeterminada: .forge614/memory.sqlite, relativa al directorio de ejecución.
Las consultas son literales; todas las palabras deben coincidir.
Actualizar un tema existente exige --expected-version. No hay borrado definitivo.
Los resultados son JSON. Los errores van a stderr y devuelven código de salida 1.
`;

const OPTIONS: Record<string, readonly string[]> = {
  save: ["title","content","type","topic","expected-version","request-key","pinned"],
  search: ["query","limit"],
  get: ["id"], history: ["id"], archive: ["id"], restore: ["id"],
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
  if (command === "help" || command === "--help") {
    if (args.length > 1) invalid("help no acepta opciones.");
    console.log(HELP);
    return;
  }
  if (!Object.hasOwn(OPTIONS,command)) invalid("Comando desconocido. Consulta help.");
  const allowed = new Set(["db","project",...OPTIONS[command]!]);
  const values = new Map<string,string>();
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i]!;
    const key = flag.slice(2);
    const value = args[i+1];
    if (!flag.startsWith("--") || !allowed.has(key) || values.has(key)) invalid("Opción desconocida o repetida. Consulta help.");
    if (!value?.trim() || value.startsWith("--") || value.includes("\0")) invalid("Cada opción necesita un valor no vacío.");
    values.set(key,value.trim());
  }
  const need = (key: string): string => values.get(key) ?? invalid(`Falta --${key}.`);
  const project = need("project");
  let saveInput: SaveInput | undefined;
  let query: string | undefined;
  let id: string | undefined;
  let limit = 10;
  // Finish all user-input validation before creating directories or opening SQLite.
  if (command === "save") {
    const type = values.get("type") ?? "fact";
    if (!memoryTypes.includes(type as SaveInput["type"])) invalid("Tipo no válido. Consulta help.");
    const pinned = values.get("pinned");
    if (pinned !== undefined && pinned !== "true" && pinned !== "false") invalid("--pinned acepta true o false.");
    saveInput = { project, title: need("title"), content: need("content"), type: type as SaveInput["type"] };
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

  const db = values.get("db") ?? resolve(".forge614","memory.sqlite");
  const store = new MemoryStore(db);
  try {
    let result: unknown;
    switch (command) {
      case "save": result = store.save(saveInput!); break;
      case "search": result = store.search(project,query!,limit); break;
      case "get": {
        result = store.get(project,id!);
        if (result === null) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en este proyecto.");
        break;
      }
      case "history": result = store.history(project,id!); break;
      case "archive": result = store.archive(project,id!); break;
      case "restore": result = store.restore(project,id!); break;
    }
    console.log(JSON.stringify(result,null,2));
  } finally { store.close(); }
}

if (import.meta.main) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify(error instanceof MemoryError
      ? { code: error.code, error: error.message }
      : { code: "STORAGE_ERROR", error: "No se pudo completar la operación. Comprueba la ruta, permisos y disponibilidad de SQLite/FTS5." }));
    process.exitCode = 1;
  }
}
