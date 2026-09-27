/**
 * Analizador de argumentos del CLI (interfaz de línea de comandos): qué opciones (`--algo`) acepta cada comando
 * y en qué forma. `commands.ts` recibe el resultado de `parseArguments` y lo usa para decidir qué hacer.
 */
import { MemoryError } from "../../shared/errors";

const MEMORY_OPTIONS = ["project-id", "scope", "group"];
const OPTIONS: Record<string, readonly string[]> = {
  init: ["json", "postgres-url", "directory"], update: ["json"], uninstall:["confirm"], sync: ["upgrade-format"], "sync-watch": ["interval","upgrade-format"], "sessions-enable": [], "reinforcement-enable": [], "intelligence-enable": [], "memory-protocol": ["json","protocol-version"], mcp: [],
  "group-create": ["name"], "group-list": [], "group-bind": ["project-id","group"], "group-unbind": ["project-id"], "group-rename": ["group","name"], "group-source-set": ["group","project-id"],
  "memory-demote": ["id","project-id"],
  "memory-move": ["id","project-id","scope","to-scope","group"],
  "project-create": ["name"], "project-list": [], "project-rename": ["project-id", "name"], "project-bind": ["directory","project-id"],
  save: [...MEMORY_OPTIONS,"title","content","type","topic","expected-version","request-key","pinned","session-id","session-project-id","affects"],
  search: [...MEMORY_OPTIONS,"query","limit","preview"],
  get: [...MEMORY_OPTIONS,"id","version"], history: [...MEMORY_OPTIONS,"id"],
  archive: [...MEMORY_OPTIONS,"id"], restore: [...MEMORY_OPTIONS,"id"],
  "session-start":["directory","session-id"], "session-end":["project-id","session-id"],
  "session-summary":["project-id","session-id","summary-json","request-key","expected-version"],
  timeline:["project-id","session-id","id","version","before","after"],
  context:["project-id","scope","group","compact","max-bytes"],
  "startup-context":["directory","json","format"],
};
const BOOLEAN_FLAGS=new Set(["preview","compact","upgrade-format","json"]);
/** Lanza un `MemoryError` de código `INVALID_INPUT` con el mensaje dado; lo usan tanto este archivo como `commands.ts` para cortar en el primer argumento inválido. */
export function invalid(message: string): never { throw new MemoryError("INVALID_INPUT",message); }
/** Valida que `value` sea un entero positivo (1 en adelante) hasta `max`; usado por opciones como `--interval` o `--limit`. */
export function integer(value: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) invalid(`${field} debe ser un entero positivo.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid(`${field} está fuera del rango permitido.`);
  return n;
}
/** Como `integer`, pero acepta 0; usado por opciones como `--before` y `--after` de `timeline`, donde 0 es un valor válido. */
export function nonnegative(value:string,field:string,max:number):number {
  if(!/^\d+$/.test(value)) invalid(`${field} debe ser un entero entre 0 y ${max}.`);
  const n=Number(value);if(!Number.isSafeInteger(n)||n>max)invalid(`${field} está fuera del rango permitido.`);return n;
}

/**
 * Analiza los argumentos crudos de la línea de comandos (`process.argv` sin el ejecutable ni el script) en un
 * comando reconocido y sus opciones. Sin argumentos, el comando es "help". Cada comando solo acepta las opciones
 * listadas en `OPTIONS`; una opción desconocida, repetida o sin valor no vacío detiene todo con `invalid`.
 * Las reglas propias de un comando (p. ej. que `--postgres-url` exija `init --json`) se comprueban después, aparte.
 */
export function parseArguments(args:string[]) {
  const command=args[0] ?? "help";
  if (!Object.hasOwn(OPTIONS,command)) invalid("Comando desconocido. Consulta help.");
  const allowed = new Set(OPTIONS[command]!);
  const values = new Map<string,string>();
  for (let i = 1; i < args.length;) {
    const flag = args[i]!; const key = flag.slice(2); const value = args[i+1];
    if (!flag.startsWith("--") || !allowed.has(key) || values.has(key)) invalid("Opción desconocida o repetida. Consulta help.");
    // Una bandera booleana (--json, --preview, etc.) no consume un valor; el resto siempre necesita uno.
    if(BOOLEAN_FLAGS.has(key)){values.set(key,"true");i+=1;continue;}
    if (!value?.trim() || value.startsWith("--") || value.includes("\0")) invalid("Cada opción necesita un valor no vacío.");
    values.set(key,value.trim());
    i+=2;
  }
  if (command === "init" && values.has("postgres-url") && !values.has("json")) {
    invalid("--postgres-url requiere init --json.");
  }
  if (command === "memory-protocol" && !values.has("json")) {
    invalid("memory-protocol requiere --json.");
  }
  if (command === "memory-protocol" && values.has("protocol-version") && !["1","2","3","4"].includes(values.get("protocol-version")!)) {
    invalid("protocol-version debe ser 1, 2, 3 o 4.");
  }
  if (command === "init" && values.has("directory") && !values.has("json")) {
    invalid("--directory requiere init --json.");
  }
  if (command === "init" && values.has("directory") && values.has("postgres-url")) {
    invalid("--directory no se combina con --postgres-url.");
  }
  if (command === "startup-context" && !values.has("json")) {
    invalid("startup-context requiere --json.");
  }
  if (command === "startup-context" && values.has("format") && !["1","2"].includes(values.get("format")!)) {
    invalid("format debe ser 1 o 2.");
  }
  const need = (key: string): string => values.get(key) ?? invalid(`Falta --${key}.`);
  return { command, values, need };
}
/** Forma del resultado de `parseArguments`: el comando, sus opciones ya validadas y `need` para exigir una obligatoria. */
export type ParsedCommand = ReturnType<typeof parseArguments>;
